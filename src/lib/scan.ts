import { classifyError } from "./errors";

/** Try a full scan, then adapt to providers that limit historical log ranges. */
export async function scanRanges<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, head: bigint, cancelled = () => false): Promise<T[]> {
  if (head < from) return [];
  try { return await fetch(from, head); } catch (error) {
    if (head - from < 500n) throw error;
  }
  const logs: T[] = [];
  let size = 9_999n;
  while (from <= head) {
    if (cancelled()) throw new Error("Log scan cancelled");
    const to = from + size - 1n < head ? from + size - 1n : head;
    try {
      logs.push(...await fetch(from, to));
      from = to + 1n;
    } catch (error) {
      if (classifyError(error).kind !== "rpc-range" || size <= 500n) throw error;
      size /= 2n;
    }
  }
  return logs;
}
