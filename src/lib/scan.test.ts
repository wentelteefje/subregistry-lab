import { LimitExceededRpcError } from "viem";
import { describe, expect, it } from "vitest";
import { scanRanges } from "./scan";
describe("historical scan fallback", () => {
  it("retries rejected ranges in smaller contiguous chunks without gaps", async () => {
    const calls: [bigint, bigint][] = [];
    const result = await scanRanges(
      async (from, to) => {
        if (to - from >= 1000n) throw new Error("block range limit exceeded");
        calls.push([from, to]);
        return [from];
      },
      1n,
      20_000n,
    );
    expect(result.length).toBe(calls.length);
    expect(calls[0][0]).toBe(1n);
    expect(calls.at(-1)![1]).toBe(20_000n);
    for (let i = 1; i < calls.length; i++)
      expect(calls[i][0]).toBe(calls[i - 1][1] + 1n);
  });
  it("stops instead of swallowing a non-range RPC failure", async () => {
    let calls = 0;
    await expect(
      scanRanges(
        async () => {
          calls++;
          throw new Error("offline");
        },
        0n,
        20_000n,
      ),
    ).rejects.toThrow("offline");
    expect(calls).toBe(1);
  });
});

it("stops immediately when the provider explicitly rate limits a scan", async () => {
  let requests = 0;
  await expect(
    scanRanges(
      async () => {
        requests++;
        throw Error("429 rate limit exceeded");
      },
      0n,
      100000n,
    ),
  ).rejects.toThrow("rate limit");
  expect(requests).toBe(1);
});

it("chunks a JSON-RPC -32005 log-range limit instead of treating it as throttling", async () => {
  const error = new LimitExceededRpcError(
    new Error("query returned more than 10000 results"),
  );
  const ranges: [bigint, bigint][] = [];
  const logs = await scanRanges(
    async (from, to) => {
      if (to - from >= 1000n) throw error;
      ranges.push([from, to]);
      return [from];
    },
    0n,
    3000n,
  );
  expect(logs.length).toBeGreaterThan(1);
  expect(ranges[0][0]).toBe(0n);
  expect(ranges.at(-1)![1]).toBe(3000n);
});
