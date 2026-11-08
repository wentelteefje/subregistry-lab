import { useDeployment } from "../hooks/useDeployment";
import { getDeployment } from "../config/deployments";
/** Renders a tx sequence: one row per step with live status + links. */

import type { StepCtx, StepDef } from "../lib/steps";
import { TransactionDetails } from "./TransactionDetails";
import { TransactionError } from "./TransactionError";
import { classifyError } from "../lib/errors";
import { etherscanTx } from "../lib/links";
import type { StepState } from "../state/labSession";

const STATUS_ICON: Record<string, string> = {
  queued: "○",
  wallet: "✍️",
  mining: "⛏️",
  verifying: "🔎",
  done: "✓",
  skipped: "↷",
  failed: "✗",
};

export function TxStepper({
  plan,
  steps,
  running,
  onRetry,
  error,
  ctx,
  retryDisabled,
}: {
  plan: StepDef[];
  steps: Record<string, StepState>;
  running: boolean;
  onRetry?: () => void;
  error?: string;
  ctx?: StepCtx;
  retryDisabled?: boolean;
}) {
  const selectedNetwork = useDeployment();
  const network = ctx?.chainId ? getDeployment(ctx.chainId) : selectedNetwork;
  const failed = plan.some((s) => steps[s.id]?.status === "failed");
  const repeatsStepError = Boolean(
    error &&
    plan.some((step) => {
      const state = steps[step.id];
      const raw = state?.technicalDetail ?? state?.detail;
      return (
        state?.status === "failed" &&
        raw &&
        (error === raw ||
          error === state.detail ||
          error === classifyError(raw).message)
      );
    }),
  );
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      {error && !repeatsStepError && <TransactionError error={error} />}
      <ol className="flex min-w-0 max-w-full flex-col gap-2">
        {plan.map((step, i) => {
          const state = steps[step.id];
          const status = state?.status ?? "queued";
          return (
            <li
              key={step.id}
              className={`min-w-0 max-w-full rounded-lg border px-4 py-3 ${
                status === "failed"
                  ? "border-red-300 bg-red-50"
                  : status === "done"
                    ? "border-emerald-200 bg-emerald-50"
                    : status === "skipped"
                      ? "border-neutral-200 bg-neutral-50 opacity-60"
                      : "border-neutral-200"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words text-sm font-medium">
                  <span className="mr-2 inline-block w-5 text-center">
                    {STATUS_ICON[status]}
                  </span>
                  {i + 1}. {step.title}
                </span>
                <span className="flex items-center gap-3 text-xs">
                  {status === "wallet" && (
                    <span className="opacity-70">confirm in wallet…</span>
                  )}
                  {status === "mining" && (
                    <span className="opacity-70">mining…</span>
                  )}
                  {status === "verifying" && (
                    <span className="opacity-70">verifying…</span>
                  )}
                  {state?.txHash && (
                    <a
                      href={etherscanTx(state.txHash, network.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-dotted"
                    >
                      tx ↗
                    </a>
                  )}
                </span>
              </div>
              <p className="ml-7 mt-0.5 text-xs opacity-70">{step.explain}</p>
              {ctx && (
                <TransactionDetails step={step} ctx={ctx} state={state} />
              )}
              {state?.confirmed &&
                !state.reverted &&
                !state.cancelled &&
                status === "failed" && (
                  <p className="ml-7 mt-1 text-xs text-amber-800">
                    Transaction mined; its result was not verified. Check chain
                    state before starting another paid action.
                  </p>
                )}
              {status === "failed" &&
              (state?.technicalDetail || state?.detail) ? (
                <div className="ml-7 mt-2 min-w-0">
                  <TransactionError
                    error={state.technicalDetail ?? state.detail!}
                    state={state}
                  />
                </div>
              ) : (
                state?.detail && (
                  <p
                    className={`ml-7 mt-1 break-words text-xs [overflow-wrap:anywhere] ${
                      status === "failed" ? "text-red-700" : "text-emerald-800"
                    }`}
                  >
                    {state.detail}
                  </p>
                )
              )}
            </li>
          );
        })}
      </ol>
      {failed && onRetry && !running && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="mt-2 self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          Resume from failed step
        </button>
      )}
    </div>
  );
}
