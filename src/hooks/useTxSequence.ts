import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { getAccount } from "@wagmi/core";
import type { Address } from "viem";
import { wagmiConfig } from "../wagmiConfig";
import { classifyError } from "../lib/errors";
import type { StepCtx, StepDef } from "../lib/steps";
import { executeSequence } from "../lib/sequence";
import { acquireRun, isRunning, subscribeRuns } from "../lib/inflight";
import { useLab } from "../state/LabContext";
import { isPendingTransaction, type StepState } from "../state/labSession";

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
  const runKey = `${scope}:${sequenceId}`;
  const busy = useSyncExternalStore(subscribeRuns, () => isRunning(runKey));
  const [status, setStatus] = useState<SequenceStatus>("idle");
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const getSteps = useCallback(
    () =>
      scope ? (getState().sessions[scope]?.sequences[sequenceId] ?? {}) : {},
    [scope, getState, sequenceId],
  );
  const setStep = useCallback(
    (id: string, value: StepState) => {
      dispatch({
        type: "step-state",
        sequenceId,
        stepId: id,
        state: value,
        sessionKey: scope,
      });
    },
    [dispatch, scope, sequenceId],
  );
  const reset = useCallback(() => {
    if (isRunning(runKey)) return;
    const steps = getSteps();
    const retained = Object.entries(steps).filter(
      ([, step]) =>
        isPendingTransaction(step) ||
        (step.capture === "subResolver" &&
          step.confirmed &&
          !steps["set-sub-resolver"]?.confirmed),
    );
    dispatch({ type: "reset-sequence", sequenceId, sessionKey: scope });
    for (const [id, step] of retained) setStep(id, step);
    setStatus("idle");
  }, [dispatch, scope, sequenceId, runKey, getSteps, setStep]);

  const run = useCallback(
    async (plan: StepDef[], ctx: StepCtx) => {
      if (!session || !scope || !publicClient || !walletClient) return;
      const release = acquireRun(runKey);
      if (!release) return;
      const signal = lifetime.current?.signal;
      setStatus("running");
      const chainId = session.chainId;
      const account = session.wallet as Address;
      const assertCurrent = () => {
        const connected = getAccount(wagmiConfig);
        const sameAccount =
          connected.address?.toLowerCase() === account &&
          ctx.account.toLowerCase() === account;
        const sameNetwork =
          ctx.chainId === chainId &&
          connected.chainId === chainId &&
          publicClient.chain.id === chainId;
        if (
          signal?.aborted ||
          getState().activeKey !== scope ||
          !sameAccount ||
          !sameNetwork
        ) {
          throw new Error(
            "Session changed. Return to the original account, name and network to resume.",
          );
        }
      };
      const assertIdentity = async () => {
        assertCurrent();
        const walletChainId = await walletClient.getChainId();
        assertCurrent();
        if (walletChainId !== chainId)
          throw new Error("Wallet network changed");
      };
      try {
        setStep("sequence-error", { status: "queued" });
        const stranded = Object.entries(getSteps()).some(
          ([id, step]) =>
            isPendingTransaction(step) &&
            !plan.some((candidate) => candidate.id === id),
        );
        if (stranded)
          throw new Error(
            "Check the pending transaction above before starting a different action",
          );
        const result = await executeSequence(plan, ctx, {
          assertIdentity,
          read: (p) =>
            publicClient.readContract({ ...p, args: p.args as unknown[] }),
          getState: (id) => getSteps()[id],
          setState: setStep,
          send: async (action) => {
            await assertIdentity();
            if (action.type === "deploy")
              return walletClient.deployContract({
                abi: action.abi,
                bytecode: action.bytecode,
                account,
                chain: publicClient.chain,
                args: action.args as unknown[],
              });
            const { request } = await publicClient.simulateContract({
              address: action.address,
              abi: action.abi,
              functionName: action.functionName,
              account,
              args: action.args as unknown[],
            });
            await assertIdentity();
            return walletClient.writeContract({
              ...request,
              chain: publicClient.chain,
            });
          },
          transaction: async (hash) => {
            const transaction = await publicClient.getTransaction({ hash });
            return {
              nonce: transaction.nonce,
              from: transaction.from,
              to: transaction.to,
              input: transaction.input,
              value: transaction.value.toString(),
            };
          },
          receipt: (hash, onReplaced) =>
            publicClient.waitForTransactionReceipt({
              hash,
              confirmations: 1,
              onReplaced: ({ reason, transaction }) =>
                onReplaced?.({
                  hash: transaction.hash,
                  cancelled: reason !== "repriced",
                  transaction: {
                    nonce: transaction.nonce,
                    from: transaction.from,
                    to: transaction.to,
                    input: transaction.input,
                    value: transaction.value.toString(),
                  },
                }),
            }),
          patch: (patch, blockNumber) => {
            const addresses: Partial<NonNullable<typeof session>["addresses"]> =
              {};
            if (patch.userRegistry) addresses.userRegistry = patch.userRegistry;
            if (patch.resolver) addresses.resolver = patch.resolver;
            if (patch.registrar) addresses.registrar = patch.registrar;
            if (Object.keys(addresses).length)
              dispatch({
                type: "patch-addresses",
                patch: addresses,
                sessionKey: scope,
              });
            if (patch.userRegistry)
              dispatch({
                type: "set-registry-deploy-block",
                block: blockNumber,
                sessionKey: scope,
              });
          },
        });
        await assertIdentity();
        setStatus("done");
        return result;
      } catch (error) {
        setStep("sequence-error", {
          status: "failed",
          detail: classifyError(error).message,
        });
        setStatus("failed");
      } finally {
        release();
      }
    },
    [
      session,
      scope,
      publicClient,
      walletClient,
      dispatch,
      setStep,
      getState,
      getSteps,
      runKey,
    ],
  );
  return {
    status: busy ? "running" : status,
    steps: session?.sequences[sequenceId] ?? {},
    run,
    reset,
  };
}
