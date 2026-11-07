/**
 * Turn viem/wallet errors into something a non-coder can act on.
 * Classification is by error name / message substring so it works across
 * viem's nested error causes without importing every error class.
 */

export type ClassifiedError = {
  kind:
    | "user-rejected"
    | "wrong-chain"
    | "unauthorized"
    | "insufficient-allowance"
    | "insufficient-balance"
    | "insufficient-eth"
    | "name-unavailable"
    | "salt-reused"
    | "rpc-rate-limit"
    | "rpc-behind"
    | "rpc-snapshot"
    | "rpc-range"
    | "unknown";
  message: string;
  hint?: string;
};

type ErrorLike = {
  name?: string;
  message?: string;
  shortMessage?: string;
  details?: string;
  cause?: unknown;
  code?: number;
};

/** Flatten an error and its causes into one searchable string. */
function flatten(err: unknown, depth = 0): string {
  if (err == null || depth > 6) return "";
  const e = err as ErrorLike;
  const parts = [e.name, e.shortMessage, e.message, e.details].filter(Boolean);
  return `${parts.join(" | ")} ${flatten(e.cause, depth + 1)}`;
}

/** Avoid multiplying requests after a provider has explicitly throttled us. */
export function isRateLimitError(error: unknown): boolean {
  let value = error;
  for (let depth = 0; value && depth < 7; depth++) {
    if (typeof value === "string") return /rate[ -]?limit|too many requests|\b429\b/i.test(value);
    const e = value as ErrorLike & { status?: number; body?: unknown };
    if (e.status === 429) return true;
    // HttpRequestError.message contains the request body; a coin type or input
    // of 429 is not evidence that the provider throttled the request.
    const text = [e.shortMessage, e.details, e.body ? undefined : e.message].filter(Boolean).join(" ");
    if (/rate[ -]?limit|too many requests|\b429\b/i.test(text)) return true;
    value = e.cause;
  }
  return false;
}

export function classifyError(err: unknown): ClassifiedError {
  const e = (
    typeof err === "string" ? { message: err } : (err ?? {})
  ) as ErrorLike;
  const text = flatten(e);

  if (
    e.code === 4001 ||
    text.includes("UserRejectedRequestError") ||
    /user rejected|user denied|rejected the request/i.test(text)
  ) {
    return {
      kind: "user-rejected",
      message: "You cancelled the transaction in your wallet.",
      hint: "Nothing was sent. Use Resume to try again.",
    };
  }
  if (
    text.includes("ChainMismatchError") ||
    text.includes("does not match the target chain")
  ) {
    return {
      kind: "wrong-chain",
      message: "Your wallet is on the wrong network.",
      hint: "Switch to the selected network and try again.",
    };
  }
  if (
    text.includes("EACUnauthorizedAccountRoles") ||
    text.includes("EACUnauthorized")
  ) {
    return {
      kind: "unauthorized",
      message:
        "This wallet doesn't have the required permission for that action.",
      hint: "Make sure the connected wallet owns the name (or was granted the role).",
    };
  }
  if (
    text.includes("ERC20InsufficientAllowance") ||
    text.includes("insufficient allowance")
  ) {
    return {
      kind: "insufficient-allowance",
      message: "The registrar isn't approved to take the payment yet.",
      hint: "Run the approve step first.",
    };
  }
  if (
    text.includes("ERC20InsufficientBalance") ||
    text.includes("transfer amount exceeds balance")
  ) {
    return {
      kind: "insufficient-balance",
      message: "Not enough USDC in your wallet.",
    };
  }
  if (
    text.includes("exceeds the balance of the account") ||
    text.includes("insufficient funds")
  ) {
    return {
      kind: "insufficient-eth",
      message: "Not enough ETH to pay for gas.",
    };
  }
  if (text.includes("NameNotAvailable") || text.includes("LabelUnavailable")) {
    return {
      kind: "name-unavailable",
      message: "That subname is already taken.",
      hint: "Pick a different label.",
    };
  }
  if (text.includes("CreateCollision") || text.includes("deployment failed")) {
    return {
      kind: "salt-reused",
      message: "A contract already exists at the computed address.",
      hint: "Resume to recover its deployment, or inspect factory history.",
    };
  }
  if (isRateLimitError(err)) return { kind: "rpc-rate-limit", message: "The public RPC is rate limited. Wait briefly, then retry." };
  if (/provider is behind|header not found|unknown block/i.test(text)) return { kind: "rpc-behind", message: "The RPC has not reached this snapshot block. Retry shortly." };
  if (/missing trie|historical state|state.*unavailable|archive requests|pruned/i.test(text))
    return { kind: "rpc-snapshot", message: "This block’s state is unavailable. Refresh the configuration to read a newer snapshot." };
  if (
    text.includes("block range") ||
    text.includes("blocks range") ||
    text.includes("ranges over") ||
    text.includes("query returned more than") ||
    text.includes("Log response size exceeded")
  ) {
    return {
      kind: "rpc-range",
      message: "The RPC refused a large log query.",
      hint: "The scan retries automatically with smaller chunks.",
    };
  }
  return {
    kind: "unknown",
    message: (e.shortMessage || e.message || "Something went wrong.").slice(
      0,
      300,
    ),
  };
}

type ErrorContext = {
  txHash?: string;
  reverted?: boolean;
  cancelled?: boolean;
};

/** Also handles old saved viem dumps, without mutating persisted history. */
export function errorSummary(
  error: unknown,
  context: ErrorContext = {},
): string {
  if (context.reverted)
    return "Transaction reverted on-chain. Review the details before retrying.";
  if (context.cancelled)
    return "Transaction replaced or cancelled in your wallet. Review the previous attempt before resuming.";
  const classified = classifyError(error);
  if (classified.kind === "user-rejected")
    return context.txHash
      ? "Wallet request cancelled. Check the recorded transaction before resuming."
      : "Request cancelled in your wallet. Resume when you’re ready.";
  if (classified.kind !== "unknown") return classified.message;
  const firstLine = classified.message
    .split(/\n|Request Arguments:|Contract Call:|Docs:|Details:|Version:/i)[0]
    .trim();
  if (
    !firstLine ||
    firstLine.length > 160 ||
    /0x[0-9a-f]{66,}/i.test(firstLine)
  )
    return "The request could not be completed. See technical details for more information.";
  return firstLine;
}
