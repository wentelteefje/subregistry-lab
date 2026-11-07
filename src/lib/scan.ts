import { classifyError, errorSummary } from "./errors";

export class IncompleteScanError<T = unknown> extends Error {
  readonly logs: T[];
  readonly through: bigint;
  readonly head: bigint;
  constructor(logs: T[], through: bigint, head: bigint, reason: unknown) {
    super(`History incomplete: scanned through block ${through} of ${head}. ${errorSummary(reason)}`);
    this.name = "IncompleteScanError";
    this.logs = logs;
    this.through = through;
    this.head = head;
  }
}

export type ScanBudget = { remaining: number; started: number };
type Checkpoint = { chunks: { from: bigint; to: bigint; logs: unknown[] }[]; size: bigint; expires: number };
const checkpoints = new Map<string, Checkpoint>();

/** Only range errors shrink chunks. Provider failover happens inside each request,
 * so a connection failure never restarts already successful chunks. */
export async function scanDetailed<T>(
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  head: bigint,
  cancelled = () => false,
  stopWhenFound = false,
  budget: number | ScanBudget = 96,
  resumeKey?: string,
) {
  if (head < from) return { logs: [] as T[], complete: true, through: head, note: undefined };
  const logs: T[] = [];
  let cursor = from, size = head - from + 1n;
  const limits = typeof budget === "number" ? { remaining: budget, started: Date.now() } : budget;
  let checkpoint: Checkpoint | undefined;
  if (resumeKey) {
    const saved = checkpoints.get(resumeKey);
    checkpoint = saved && saved.expires > Date.now() ? saved : { chunks: [], size, expires: 0 };
    // Re-read the near-head overlap on every refresh; never reuse future chunks.
    const reusable = checkpoint.chunks.filter((chunk) => chunk.to <= head - 64n);
    for (const chunk of reusable) {
      if (chunk.from !== cursor) break;
      logs.push(...chunk.logs as T[]);
      cursor = chunk.to + 1n;
    }
    size = checkpoint.size;
    checkpoint.expires = Date.now() + 60 * 60_000;
    if (checkpoints.size >= 128 && !checkpoints.has(resumeKey)) checkpoints.delete(checkpoints.keys().next().value!);
    checkpoints.set(resumeKey, checkpoint);
  }
  while (cursor <= head) {
    if (cancelled()) throw new Error("Log scan cancelled");
    const to = cursor + size - 1n < head ? cursor + size - 1n : head;
    try {
      if (limits.remaining-- <= 0 || Date.now() - limits.started > 60_000)
        throw Error("Scan request budget reached. Retry to resume cached chunks.");
      const chunk = await fetch(cursor, to);
      if (cancelled()) throw new Error("Log scan cancelled");
      logs.push(...chunk);
      if (checkpoint && to <= head - 64n && logs.length <= 20_000) {
        const last = checkpoint.chunks.at(-1);
        if (!last || last.to + 1n === cursor) checkpoint.chunks.push({ from: cursor, to, logs: chunk });
      }
      cursor = to + 1n;
      if (stopWhenFound && logs.length) break;
    } catch (error) {
      if (cancelled()) throw new Error("Log scan cancelled");
      if (classifyError(error).kind === "rpc-range" && size > 1n && limits.remaining > 0) {
        size = size > 9_999n ? 9_999n : (size / 2n || 1n);
        if (checkpoint) checkpoint.size = size;
        continue;
      }
      return { logs, complete: false, through: cursor - 1n, note: errorSummary(error) };
    }
  }
  return { logs, complete: cursor > head, through: cursor - 1n, note: undefined as string | undefined };
}
export async function scanRanges<T>(
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  head: bigint,
  cancelled = () => false,
  resumeKey?: string,
): Promise<T[]> {
  const result = await scanDetailed(fetch, from, head, cancelled, false, 96, resumeKey);
  if (!result.complete) throw new IncompleteScanError(result.logs, result.through, head, result.note);
  return result.logs;
}
