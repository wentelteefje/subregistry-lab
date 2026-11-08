import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { usePublicClient } from "wagmi";
import { TransactionReceiptNotFoundError, isHash, type Address } from "viem";
import { useLab } from "../state/LabContext";
import { isPendingTransaction } from "../state/labSession";
import { getDeployment } from "../config/deployments";
import { useDeployment } from "../hooks/useDeployment";
import { useIsReady } from "./ChainGuard";
import { recoveredRegistryAdoption } from "../lib/registrySelection";
import { recoverPending } from "../lib/recovery";
import { acquireRun, isRunning, subscribeRuns } from "../lib/inflight";
import { etherscanTx } from "../lib/links";
import { TransactionError } from "./TransactionError";
import { errorSummary } from "../lib/errors";

export function PendingTransactions({
  onRecovered,
}: {
  onRecovered?: () => void;
}) {
  const queryClient = useQueryClient();
  const { session, state, dispatch } = useLab();
  if (!session) return null;
  return (
    <>
      {Object.entries(session.sequences).flatMap(([sequenceId, steps]) =>
        Object.entries(steps)
          .filter(([, step]) => isPendingTransaction(step))
          .map(([id, step]) => (
            <PendingTransaction
              key={`${sequenceId}:${id}`}
              scope={state.activeKey!}
              sequenceId={sequenceId}
              id={id}
              step={step}
              account={session.wallet as Address}
              patch={(result) => {
                dispatch({
                  type: "step-state",
                  sessionKey: state.activeKey,
                  sequenceId,
                  stepId: id,
                  state: result,
                });
                if (result.confirmed) {
                  void queryClient.invalidateQueries();
                  onRecovered?.();
                }
                if (sequenceId === "relink") {
                  const adoption = recoveredRegistryAdoption(
                    result,
                    session.parentLabel,
                    getDeployment(session.chainId),
                  );
                  if (adoption)
                    dispatch({ ...adoption, sessionKey: state.activeKey });
                }
                if (result.context) {
                  const {
                    userRegistry,
                    resolver,
                    registrar,
                    subResolver,
                    subResolverName,
                  } = result.context;
                  if (subResolver && subResolverName)
                    dispatch({
                      type: "cache-own-resolver",
                      sessionKey: state.activeKey,
                      name: subResolverName,
                      address: subResolver,
                    });
                  const addresses = Object.fromEntries(
                    Object.entries({
                      userRegistry,
                      resolver,
                      registrar,
                    }).filter(([, value]) => value !== undefined),
                  );
                  if (Object.keys(addresses).length)
                    dispatch({
                      type: "patch-addresses",
                      sessionKey: state.activeKey,
                      patch: addresses,
                    });
                  if (userRegistry && result.blockNumber)
                    dispatch({
                      type: "set-registry-deploy-block",
                      sessionKey: state.activeKey,
                      block: BigInt(result.blockNumber),
                    });
                }
              }}
            />
          )),
      )}
    </>
  );
}

function PendingTransaction({
  scope,
  sequenceId,
  id,
  step,
  account,
  patch,
}: {
  scope: string;
  sequenceId: string;
  id: string;
  step: import("../state/labSession").StepState;
  account: Address;
  patch: (result: import("../state/labSession").StepState) => void;
}) {
  const client = usePublicClient();
  const network = useDeployment();
  const ready = useIsReady();
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState<string>();
  const key = `${scope}:${sequenceId}`;
  const busy = useSyncExternalStore(subscribeRuns, () => isRunning(key));
  const recover = async () => {
    if (!client || !ready) return;
    const release = acquireRun(key);
    if (!release) return;
    setError(undefined);
    try {
      const input = replacement.trim();
      if (input && !isHash(input))
        throw new Error(
          "Enter the full replacement transaction hash from your wallet activity",
        );
      const result = await recoverPending(
        step,
        input ? (input as `0x${string}`) : undefined,
        account,
        network,
        {
          receipt: async (hash) => {
            try {
              return await client.getTransactionReceipt({ hash });
            } catch (error) {
              if (error instanceof TransactionReceiptNotFoundError) return null;
              throw error;
            }
          },
          transaction: async (hash) => {
            const tx = await client.getTransaction({ hash });
            return {
              nonce: tx.nonce,
              from: tx.from,
              to: tx.to,
              input: tx.input,
              value: tx.value.toString(),
            };
          },
          minedNonce: (address) =>
            client.getTransactionCount({ address, blockTag: "latest" }),
        },
      );
      patch(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      release();
    }
  };
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <strong>Pending: {step.title ?? id}</strong>
      <a
        href={etherscanTx(step.txHash!, network.id)}
        target="_blank"
        rel="noreferrer"
        className="underline"
      >
        View transaction
      </a>
      {step.detail || step.technicalDetail ? (
        step.status === "failed" ? (
          <TransactionError
            error={step.technicalDetail ?? step.detail!}
            state={step}
          />
        ) : (
          <p className="break-words [overflow-wrap:anywhere]">
            {errorSummary(step.detail ?? step.technicalDetail, step)}
          </p>
        )
      ) : (
        <p>Check its receipt before starting another operation.</p>
      )}
      <label>
        Replacement hash (if sped up or cancelled)
        <input
          className="ml-2 rounded border p-2 font-mono text-xs"
          aria-label={`Replacement hash for ${step.title ?? id}`}
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="self-start rounded border px-3 py-1 disabled:opacity-40"
        disabled={!ready || busy}
        onClick={recover}
      >
        {busy
          ? "Waiting for current operation…"
          : "Check / recover transaction"}
      </button>
      {error && <TransactionError error={error} state={step} />}
    </div>
  );
}
