import { errorSummary } from "../lib/errors";
import type { StepState } from "../state/labSession";

/** Raw wallet/RPC errors can contain many kilobytes of unbroken calldata. */
export function TransactionError({
  error,
  summary,
  state,
}: {
  error: string;
  summary?: string;
  state?: Pick<StepState, "txHash" | "reverted" | "cancelled">;
}) {
  const message = summary ?? errorSummary(error, state);
  return (
    <div className="min-w-0 max-w-full text-red-700">
      <p role="alert" className="break-words text-sm [overflow-wrap:anywhere]">
        {message}
      </p>
      {error !== message && (
        <details className="mt-2 min-w-0 max-w-full text-xs text-neutral-600">
          <summary className="cursor-pointer underline decoration-dotted underline-offset-2">
            Technical error details
          </summary>
          <pre
            tabIndex={0}
            className="mt-2 max-h-40 w-full min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-200 bg-white p-3 font-mono select-text"
          >
            {error}
          </pre>
        </details>
      )}
    </div>
  );
}
