import { useState } from "react";
import { getDeployment } from "../config/deployments";
import { inspectStep } from "../lib/inspect";
import { etherscanAddress } from "../lib/links";
import type { StepCtx, StepDef } from "../lib/steps";
import type { StepState } from "../state/labSession";
import { TransactionError } from "./TransactionError";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setMessage("Copied");
            } catch {
              setMessage("Select and copy the text below");
            }
          }}
        >
          Copy {label.toLowerCase()}
        </button>
      </div>
      <pre
        tabIndex={0}
        className="nodrag nowheel max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-200 bg-white p-3 font-mono text-xs select-text"
      >
        {text}
      </pre>
      {message && (
        <p role="status" className="mt-1 text-xs opacity-70">
          {message}
        </p>
      )}
    </div>
  );
}

export function TransactionDetails({
  step,
  ctx,
  state,
}: {
  step: StepDef;
  ctx: StepCtx;
  state?: StepState;
}) {
  const [open, setOpen] = useState(false);
  const info = open ? inspectStep(step, ctx, state) : undefined;
  const network = getDeployment(ctx.chainId);
  const contractName =
    info?.to &&
    Object.entries(network.addresses).find(
      ([, value]) => value.toLowerCase() === info.to?.toLowerCase(),
    )?.[0];
  return (
    <details
      className="ml-7 mt-2 min-w-0 text-xs"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer py-1 font-medium underline decoration-dotted underline-offset-4">
        Transaction details
      </summary>
      {info && (
        <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <p className="font-medium">
            {info.source === "recorded"
              ? state?.txHash
                ? "Recorded transaction request"
                : "Prepared wallet request"
              : info.source === "unrecorded"
                ? "Request not recorded"
                : "Next wallet request"}
          </p>
          {info.previousAttempt && (
            <details className="rounded-md border border-neutral-200 p-2">
              <summary className="cursor-pointer">
                Previous attempt · {info.previousAttempt.reason}
              </summary>
              <p className="my-2 opacity-70">
                The request below belongs to the previous attempt. Resume uses
                the next wallet request shown outside this disclosure.
              </p>
              {info.previousAttempt.hash && (
                <p className="mb-2 break-all font-mono">
                  Transaction hash: {info.previousAttempt.hash}
                </p>
              )}
              {info.previousAttempt.transaction && (
                <CopyBlock
                  label="Previous request"
                  text={JSON.stringify(
                    info.previousAttempt.transaction,
                    null,
                    2,
                  )}
                />
              )}
            </details>
          )}
          {info.source === "unrecorded" ? (
            <p>
              This older transaction has no saved request. Inspect the
              transaction using its explorer link above.
            </p>
          ) : (
            <>
              <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                <dt>Network</dt>
                <dd>
                  {network.chain.name} · chain ID {info.chainId}
                </dd>
                <dt>From</dt>
                <dd className="break-all font-mono">{info.from}</dd>
                <dt>To</dt>
                <dd className="break-all font-mono">
                  {info.to ? (
                    <>
                      <span className="font-sans">
                        {contractName && `${contractName} · `}
                      </span>
                      <a
                        href={etherscanAddress(info.to, info.chainId)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {info.to} ↗
                      </a>
                    </>
                  ) : info.kind === "create" ? (
                    "Contract creation (CREATE; no to address)"
                  ) : (
                    "Available after deployment"
                  )}
                </dd>
                <dt>ETH value</dt>
                <dd>
                  {info.value} wei {info.value === "0" && "(0 ETH)"}
                </dd>
                {info.nonce !== undefined && (
                  <>
                    <dt>Nonce</dt>
                    <dd>{info.nonce}</dd>
                  </>
                )}
                {info.signature && (
                  <>
                    <dt>
                      {info.kind === "create" ? "Constructor" : "Function"}
                    </dt>
                    <dd className="break-all font-mono">{info.signature}</dd>
                  </>
                )}
                {info.data && info.kind === "call" && (
                  <>
                    <dt>Selector</dt>
                    <dd className="font-mono">{info.data.slice(0, 10)}</dd>
                  </>
                )}
              </dl>
              {info.args && (
                <CopyBlock
                  label="Decoded arguments"
                  text={JSON.stringify(info.args, null, 2)}
                />
              )}
              {info.initializer && (
                <CopyBlock
                  label={`${info.initializer.contract} initializer`}
                  text={`${info.initializer.signature}\n${JSON.stringify(info.initializer.args, null, 2)}`}
                />
              )}
              {info.roles && (
                <p className="break-words">
                  Registry root permissions: {info.roles.join(", ") || "none"}.
                  Resolver permissions use a separate role namespace; ALL_ROLES
                  grants every user and admin role.
                </p>
              )}
              {info.missing.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="font-medium">Calldata is not available yet</p>
                  <ul className="mt-1 list-disc pl-4">
                    {info.missing.map((dependency) => (
                      <li key={dependency}>{dependency}</li>
                    ))}
                  </ul>
                  <p className="mt-1">
                    Exact bytes and request JSON appear when these addresses are
                    known. No placeholder address is encoded.
                  </p>
                </div>
              )}
              {info.error && (
                <TransactionError
                  error={info.error}
                  summary="Decoded view unavailable."
                />
              )}
              {info.data && (
                <>
                  <p className="break-all font-mono">
                    {(info.data.length - 2) / 2} bytes · keccak256:{" "}
                    {info.dataHash}
                  </p>
                  <CopyBlock
                    label={
                      info.kind === "create"
                        ? "Deployment initcode"
                        : "Raw calldata"
                    }
                    text={info.data}
                  />
                  {info.kind === "create" && (
                    <p>
                      Initcode includes the contract bytecode and ABI-encoded
                      constructor arguments.
                    </p>
                  )}
                  <CopyBlock
                    label="Request JSON"
                    text={JSON.stringify(info.request, null, 2)}
                  />
                </>
              )}
              <p className="opacity-70">
                {info.source === "recorded"
                  ? state?.txHash
                    ? "Recorded transaction data; compare with the linked transaction. A wallet replacement may differ from the original request."
                    : "Prepared for the current wallet prompt. No transaction hash has been recorded yet."
                  : "Transaction data only. The wallet selects fees; the app assigns and records the pending nonce at submission. This is not a simulation or a guarantee of success."}
              </p>
              <p className="break-all opacity-60">
                Deployment artifacts: {network.artifactCommit}
              </p>
            </>
          )}
        </div>
      )}
    </details>
  );
}
