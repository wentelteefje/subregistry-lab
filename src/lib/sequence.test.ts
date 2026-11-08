import { describe, expect, it, vi } from "vitest";
import type { TransactionReceipt } from "viem";
import { executeSequence, type SequenceIO } from "./sequence";
import type { StepCtx, StepDef } from "./steps";
import type { StepState } from "../state/labSession";

const account = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const resolver = "0x2222222222222222222222222222222222222222" as const;
const ctx: StepCtx = {
  account,
  parentLabel: "lab",
  ownerInitBitmap: 0n,
  deployResolver: true,
};
function fixture() {
  const states: Record<string, StepState> = {};
  const io: SequenceIO = {
    assertIdentity: vi.fn(async () => {}),
    read: vi.fn(async () => 0n),
    send: vi.fn(async () => hash),
    receipt: vi.fn(
      async () =>
        ({ status: "success", blockNumber: 10n }) as TransactionReceipt,
    ),
    getState: (id) => states[id],
    setState: (id, state) => {
      states[id] = state;
    },
    patch: vi.fn(),
  };
  const step: StepDef = {
    id: "write",
    title: "write",
    explain: "write",
    preflight: false,
    build: () => ({
      type: "write",
      address: account,
      abi: [],
      functionName: "test",
      args: [1n],
    }),
  };
  return { states, io, step };
}
describe("transaction recovery", () => {
  it("recovers a pending receipt after a timeout without a second send", async () => {
    const { states, io, step } = fixture();
    vi.mocked(io.receipt).mockRejectedValueOnce(new Error("RPC timeout"));
    await expect(executeSequence([step], ctx, io)).rejects.toThrow(
      "RPC timeout",
    );
    expect(states.write.txHash).toBe(hash);
    await executeSequence([step], ctx, io);
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(states.write.status).toBe("done");
  });
  it("stores a speed-up replacement even when receipt waiting subsequently times out", async () => {
    const { states, io, step } = fixture();
    const replacement = `0x${"cd".repeat(32)}` as const;
    io.receipt = async (_hash, onReplaced) => {
      onReplaced?.({ hash: replacement, cancelled: false });
      throw new Error("timeout");
    };
    await expect(executeSequence([step], ctx, io)).rejects.toThrow("timeout");
    expect(states.write.txHash).toBe(replacement);
  });
  it("confirmed verification failures do not remain pending and do not reread their receipts", async () => {
    const { states, io, step } = fixture();
    step.verify = async () => ({ ok: false, detail: "Mismatch" });
    await expect(executeSequence([step], ctx, io)).rejects.toThrow("Mismatch");
    expect(states.write.confirmed).toBe(true);
    await expect(executeSequence([step], ctx, io)).rejects.toThrow("Mismatch");
    expect(io.receipt).toHaveBeenCalledTimes(1);
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("distinguishes pending resolver deployments for different subnames", async () => {
    const { io, step } = fixture();
    step.intentSeed = "alice.lab.eth-own-resolver";
    step.build = () => ({
      type: "write",
      address: account,
      abi: [],
      functionName: "deployProxy",
      args: [resolver, 42n, "0x"],
    });
    vi.mocked(io.receipt).mockRejectedValueOnce(new Error("timeout"));
    await expect(executeSequence([step], ctx, io)).rejects.toThrow();
    await expect(
      executeSequence(
        [{ ...step, intentSeed: "bob.lab.eth-own-resolver" }],
        ctx,
        io,
      ),
    ).rejects.toThrow("Previous transaction recovered");
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("archives a recovered deployment under its original subname when the requested target changed", async () => {
    const { states, io, step } = fixture();
    step.capture = "subResolver";
    step.targetName = "alice.lab.eth";
    step.intentSeed = "alice.lab.eth";
    step.build = () => ({
      type: "write",
      address: account,
      abi: [],
      functionName: "deployProxy",
      args: [resolver, 1n, "0x"],
    });
    step.onReceipt = () => ({
      subResolver: resolver,
      subResolverName: "alice.lab.eth",
    });
    vi.mocked(io.receipt).mockRejectedValueOnce(new Error("timeout"));
    await expect(executeSequence([step], ctx, io)).rejects.toThrow();
    const bob = {
      ...step,
      targetName: "bob.lab.eth",
      intentSeed: "bob.lab.eth",
      onReceipt: () => ({
        subResolver: resolver,
        subResolverName: "bob.lab.eth",
      }),
    };
    await expect(executeSequence([bob], ctx, io)).rejects.toThrow(
      "Previous transaction recovered",
    );
    expect(states.write.context?.subResolverName).toBe("alice.lab.eth");
  });
  it("keeps a reverted hash visible while allowing a new submission", async () => {
    const { states, io, step } = fixture();
    vi.mocked(io.receipt).mockResolvedValueOnce({
      status: "reverted",
      blockNumber: 10n,
    } as TransactionReceipt);
    await expect(executeSequence([step], ctx, io)).rejects.toThrow(
      "Transaction reverted",
    );
    expect(states.write.txHash).toBe(hash);
    expect(states.write.reverted).toBe(true);
    await executeSequence([step], ctx, io);
    expect(io.send).toHaveBeenCalledTimes(2);
    expect(states.write.status).toBe("done");
  });
  it("does not trust a persisted done marker without on-chain readback", async () => {
    const { io, step } = fixture();
    const verify = vi.fn().mockResolvedValue({ ok: true, detail: "verified" });
    step.verify = verify;
    await executeSequence([step], ctx, io);
    verify.mockResolvedValue({ ok: false, detail: "changed" });
    await expect(executeSequence([step], ctx, io)).rejects.toThrow("changed");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("allows a repeated action after synchronous reset", async () => {
    const { states, io, step } = fixture();
    await executeSequence([step], ctx, io);
    delete states.write;
    await executeSequence([step], ctx, io);
    expect(io.send).toHaveBeenCalledTimes(2);
  });
  it("replays deployment context from its receipt when resuming a switch", async () => {
    const { io, step } = fixture();
    step.onReceipt = () => ({ subResolver: resolver });
    await executeSequence([step], ctx, io);
    const result = await executeSequence([step], ctx, io);
    expect(result.subResolver).toBe(resolver);
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("stops before the next transaction when account/network identity changes", async () => {
    const { io, step } = fixture();
    vi.mocked(io.assertIdentity)
      .mockResolvedValueOnce()
      .mockRejectedValue(new Error("network changed"));
    await expect(executeSequence([step], ctx, io)).rejects.toThrow(
      "network changed",
    );
    expect(io.send).not.toHaveBeenCalled();
  });
  it("stops on a preflight RPC error instead of submitting a write", async () => {
    const { io, step } = fixture();
    step.preflight = true;
    step.verify = async () => {
      throw new Error("RPC unavailable");
    };
    await expect(executeSequence([step], ctx, io)).rejects.toThrow(
      "RPC unavailable",
    );
    expect(io.send).not.toHaveBeenCalled();
  });
  it("blocks irreversible writes when the permission guard fails", async () => {
    const { io, step } = fixture();
    step.guard = async () => {
      throw new Error("Other assignees remain");
    };
    await expect(executeSequence([step], ctx, io)).rejects.toThrow(
      "Other assignees remain",
    );
    expect(io.send).not.toHaveBeenCalled();
  });
  it("settles the old receipt before allowing a different operation with different arguments", async () => {
    const { io, step } = fixture();
    vi.mocked(io.receipt).mockRejectedValueOnce(new Error("timeout"));
    await expect(executeSequence([step], ctx, io)).rejects.toThrow();
    const changed = {
      ...step,
      build: () => ({ ...step.build(ctx), args: [2n] }),
    };
    await expect(executeSequence([changed], ctx, io)).rejects.toThrow(
      "Previous transaction recovered",
    );
    expect(io.send).toHaveBeenCalledTimes(1);
  });
});

it("refuses a write when its encoded data differs from the reviewed request", async () => {
  const { io, step } = fixture();
  step.build = () => ({
    type: "write",
    address: account,
    abi: [
      {
        type: "function",
        name: "set",
        stateMutability: "nonpayable",
        inputs: [{ name: "value", type: "uint256" }],
        outputs: [],
      },
    ],
    functionName: "set",
    args: [2n],
  });
  await expect(
    executeSequence(
      [step],
      { ...ctx, reviewedRequests: { write: "0xdeadbeef" } },
      io,
    ),
  ).rejects.toThrow("differs from the reviewed calldata");
  expect(io.send).not.toHaveBeenCalled();
});

it("adopts a recovered identical deployment without submitting a second transaction", async () => {
  const { io, step, states } = fixture();
  const transaction = {
    from: account,
    to: account,
    nonce: 4,
    input: "0x1234" as const,
  };
  io.recover = vi.fn(async () => ({ txHash: hash, transaction }));
  step.capture = "userRegistry";
  step.onReceipt = () => ({ userRegistry: resolver });
  const result = await executeSequence([step], ctx, io);
  expect(result.userRegistry).toBe(resolver);
  expect(states.write.confirmed).toBe(true);
  expect(io.send).not.toHaveBeenCalled();
});

it("persists a relink target's deployment block separately from its receipt block",async()=>{
  const {io,step,states}=fixture();
  step.registryDeployBlock="2";
  await executeSequence([step],ctx,io);
  expect(states.write.registryDeployBlock).toBe("2");
  expect(states.write.blockNumber).toBe("10");
});
