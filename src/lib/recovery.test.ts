import { describe, expect, it, vi } from "vitest";
import type { TransactionReceipt } from "viem";
import { recoverPending, type RecoveryIO } from "./recovery";
import { getDeployment } from "../config/deployments";
import { isPendingTransaction, type StepState } from "../state/labSession";
const account = "0x1111111111111111111111111111111111111111" as const;
const target = "0x2222222222222222222222222222222222222222" as const;
const original = `0x${"ab".repeat(32)}` as const;
const replacement = `0x${"cd".repeat(32)}` as const;
const transaction: NonNullable<StepState["transaction"]> = {
  from: account,
  to: target,
  nonce: 5,
  input: "0x1234" as const,
};
const step: StepState = { status: "failed", txHash: original, transaction };
const receipt = {
  status: "success",
  transactionHash: replacement,
  blockNumber: 12n,
  logs: [],
} as unknown as TransactionReceipt;
function fixture() {
  return {
    receipt: vi.fn(async (hash) => (hash === replacement ? receipt : null)),
    transaction: vi.fn(async () => transaction),
    minedNonce: vi.fn(async () => 6),
  } satisfies RecoveryIO;
}
describe("recovery of a missing or replaced hash", () => {
  it("recovers a private transaction using pre-send metadata without fetching the original hash", async () => {
    const io = fixture();
    await recoverPending(step, replacement, account, getDeployment(), io);
    expect(io.transaction).toHaveBeenCalledTimes(1);
    expect(io.transaction).toHaveBeenCalledWith(replacement);
  });
  it("recovers a mined speed-up with identical calldata", async () => {
    const result = await recoverPending(
      step,
      replacement,
      account,
      getDeployment(),
      fixture(),
    );
    expect(result.txHash).toBe(replacement);
    expect(result.confirmed).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(isPendingTransaction(result)).toBe(false);
  });
  it("releases a nonce-proven cancellation without treating it as the original action", async () => {
    const io = fixture();
    io.transaction.mockResolvedValue({ ...transaction, input: "0x" });
    const result = await recoverPending(
      step,
      replacement,
      account,
      getDeployment(),
      io,
    );
    expect(result.cancelled).toBe(true);
    expect(result.context).toBeUndefined();
    expect(isPendingTransaction(result)).toBe(false);
  });
  it("does not discard an unknown transaction merely because a nonce advanced", async () => {
    const result = await recoverPending(
      step,
      undefined,
      account,
      getDeployment(),
      fixture(),
    );
    expect(isPendingTransaction(result)).toBe(true);
  });
  it("does not treat a changed ETH value as the original request", async () => {
    const io = fixture();
    io.transaction.mockResolvedValue({ ...transaction, value: "1" });
    const result = await recoverPending(
      step,
      replacement,
      account,
      getDeployment(),
      io,
    );
    expect(result.cancelled).toBe(true);
  });
  it("rejects another nonce even when it belongs to the same wallet", async () => {
    const io = fixture();
    io.transaction.mockResolvedValue({ ...transaction, nonce: 6 });
    await expect(
      recoverPending(step, replacement, account, getDeployment(), io),
    ).rejects.toThrow("original nonce");
  });
  it("rejects a replacement that has not consumed the mined nonce", async () => {
    const io = fixture();
    io.minedNonce.mockResolvedValue(5);
    await expect(
      recoverPending(step, replacement, account, getDeployment(), io),
    ).rejects.toThrow("not been mined");
  });
});
