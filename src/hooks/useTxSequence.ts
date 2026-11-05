import { useCallback, useRef, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { getAccount } from "@wagmi/core";
import type { Address } from "viem";
import { wagmiConfig } from "../wagmiConfig";
import { classifyError } from "../lib/errors";
import type { StepCtx, StepDef } from "../lib/steps";
import { executeSequence } from "../lib/sequence";
import { useLab } from "../state/LabContext";
import type { StepState } from "../state/labSession";

export type SequenceStatus = "idle" | "running" | "done" | "failed";
export type SequenceHandle = {
  status: SequenceStatus;
  steps: Record<string, StepState>;
  run: (plan: StepDef[], ctx: StepCtx) => Promise<StepCtx | undefined>;
  reset: () => void;
};

export function useTxSequence(sequenceId: string): SequenceHandle {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { session, state, dispatch, getState } = useLab();
  const scope = state.activeKey;
  const [status, setStatus] = useState<SequenceStatus>("idle");
  const running = useRef(false);
  const states = useRef<Record<string, StepState>>(session?.sequences[sequenceId] ?? {});
  const [, render] = useState(0);

  const setStep = useCallback((id: string, value: StepState) => {
    states.current = { ...states.current, [id]: value };
    dispatch({ type: "step-state", sequenceId, stepId: id, state: value, sessionKey: scope });
    render(n => n + 1);
  }, [dispatch, scope, sequenceId]);

  const reset = useCallback(() => {
    if (running.current) return;
    // Reset synchronously: run() in the same event must see the new state.
    // Retain unresolved hashes so retries recover instead of spending again.
    states.current = Object.fromEntries(Object.entries(states.current).filter(([, s]) => s.txHash && !s.reverted && s.status !== "done"));
    dispatch({ type: "reset-sequence", sequenceId, sessionKey: scope });
    for (const [id, value] of Object.entries(states.current)) setStep(id, value);
    setStatus("idle");
    render(n => n + 1);
  }, [dispatch, scope, sequenceId, setStep]);

  const run = useCallback(async (plan: StepDef[], ctx: StepCtx) => {
    if (running.current || !session || !scope || !publicClient || !walletClient) return;
    running.current = true;
    setStatus("running");
    const chainId = session.chainId;
    const account = session.wallet as Address;
    const assertIdentity = async () => {
      const connected = getAccount(wagmiConfig);
      if (ctx.chainId !== chainId || getState().activeKey !== scope || connected.chainId !== chainId || connected.address?.toLowerCase() !== account || publicClient.chain.id !== chainId || ctx.account.toLowerCase() !== account) {
        throw new Error("Wallet or network changed. Return to the original account and network to resume.");
      }
      if (await walletClient.getChainId() !== chainId) throw new Error("Wallet network changed");
    };
    try {
      setStep("sequence-error", { status: "queued" });
      const stranded = Object.entries(states.current).some(([id, state]) => state.txHash && !state.reverted && state.status !== "done" && !plan.some(step => step.id === id));
      if (stranded) throw new Error("Resume the unfinished operation before starting a different action");
      const result = await executeSequence(plan, ctx, {
        assertIdentity,
        read: p => publicClient.readContract({ ...p, args: p.args as unknown[] }),
        getState: id => states.current[id],
        setState: setStep,
        send: async action => {
          await assertIdentity();
          if (action.type === "deploy") return walletClient.deployContract({ abi: action.abi, bytecode: action.bytecode, account, chain: publicClient.chain, args: action.args as unknown[] });
          const { request } = await publicClient.simulateContract({ address: action.address, abi: action.abi, functionName: action.functionName, account, args: action.args as unknown[] });
          await assertIdentity();
          return walletClient.writeContract({ ...request, chain: publicClient.chain });
        },
        receipt: hash => publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }),
        patch: (patch, receipt) => {
          const addresses: Partial<NonNullable<typeof session>["addresses"]> = {};
          if (patch.userRegistry) addresses.userRegistry = patch.userRegistry;
          if (patch.resolver) addresses.resolver = patch.resolver;
          if (patch.registrar) addresses.registrar = patch.registrar;
          if (Object.keys(addresses).length) dispatch({ type: "patch-addresses", patch: addresses, sessionKey: scope });
          if (patch.userRegistry) dispatch({ type: "set-registry-deploy-block", block: receipt.blockNumber, sessionKey: scope });
        },
      });
      await assertIdentity();
      setStatus("done");
      return result;
    } catch (error) {
      const classified = classifyError(error);
      setStep("sequence-error", { status: "failed", detail: classified.message });
      setStatus("failed");
    } finally {
      running.current = false;
    }
  }, [session, scope, publicClient, walletClient, dispatch, setStep, getState]);
  return { status, steps: states.current, run, reset };
}
