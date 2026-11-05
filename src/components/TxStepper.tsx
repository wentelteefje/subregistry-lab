import { useDeployment } from "../hooks/useDeployment";
/** Renders a tx sequence: one row per step with live status + links. */

import type { StepDef } from "../lib/steps";
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
}: {
  plan: StepDef[];
  steps: Record<string, StepState>;
  running: boolean;
  onRetry?: () => void;
}) {
  const network = useDeployment();
  const failed = plan.some((s) => steps[s.id]?.status === "failed");
  return (
    <div className="flex flex-col gap-1">
      {steps["sequence-error"]?.detail && <p role="alert" className="text-sm text-red-700">{steps["sequence-error"].detail}</p>}
      <ol className="flex flex-col gap-2">
        {plan.map((step, i) => {
          const state = steps[step.id];
          const status = state?.status ?? "queued";
          return (
            <li
              key={step.id}
              className={`rounded-lg border px-4 py-3 ${
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
                <span className="text-sm font-medium">
                  <span className="mr-2 inline-block w-5 text-center">
                    {STATUS_ICON[status]}
                  </span>
                  {i + 1}. {step.title}
                </span>
                <span className="flex items-center gap-3 text-xs">
                  {status === "wallet" && <span className="opacity-70">confirm in wallet…</span>}
                  {status === "mining" && <span className="opacity-70">mining…</span>}
                  {status === "verifying" && <span className="opacity-70">verifying…</span>}
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
              {state?.detail && (
                <p
                  className={`ml-7 mt-1 text-xs ${
                    status === "failed" ? "text-red-700" : "text-emerald-800"
                  }`}
                >
                  {state.detail}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {failed && onRetry && !running && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
        >
          Resume from failed step
        </button>
      )}
    </div>
  );
}
