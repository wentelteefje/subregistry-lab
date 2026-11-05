import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionReceipt } from "viem";
import {
  labReducer,
  type LabState,
  type ScopedLabAction,
} from "../state/labSession";
import { useTxSequence, type SequenceHandle } from "./useTxSequence";
import type { StepCtx, StepDef } from "../lib/steps";

const harness = vi.hoisted(() => ({
  state: { sessions: {} } as LabState,
  listeners: new Set<() => void>(),
  client: {
    chain: { id: 1 },
    readContract: vi.fn(),
    simulateContract: vi.fn(),
    getTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  },
  wallet: {
    getChainId: vi.fn(),
    writeContract: vi.fn(),
    deployContract: vi.fn(),
  },
}));
vi.mock("wagmi", () => ({
  usePublicClient: () => harness.client,
  useWalletClient: () => ({ data: harness.wallet }),
}));
vi.mock("../wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@wagmi/core", () => ({
  getAccount: () => ({
    chainId: 1,
    address: "0x1111111111111111111111111111111111111111",
  }),
}));
vi.mock("../state/LabContext", async () => {
  const React = await import("react");
  return {
    useLab: () => {
      const state = React.useSyncExternalStore(
        (listener) => {
          harness.listeners.add(listener);
          return () => {
            harness.listeners.delete(listener);
          };
        },
        () => harness.state,
      );
      return {
        state,
        session: state.activeKey ? state.sessions[state.activeKey] : undefined,
        getState: () => harness.state,
        dispatch: (action: ScopedLabAction) => {
          harness.state = labReducer(harness.state, action);
          for (const listener of harness.listeners) listener();
        },
      };
    },
  };
});
const account = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const receipt = {
  status: "success",
  transactionHash: hash,
  blockNumber: 12n,
} as TransactionReceipt;
const ctx: StepCtx = {
  chainId: 1,
  account,
  parentLabel: "lab",
  deployResolver: false,
  ownerInitBitmap: 0n,
};
const step = (id: string): StepDef => ({
  id,
  title: id,
  explain: id,
  preflight: false,
  build: () => ({
    type: "write",
    address: account,
    abi: [],
    functionName: id,
    args: [],
  }),
});
let current: SequenceHandle;
let renderer: ReactTestRenderer;
function Probe() {
  const handle = useTxSequence("playground");
  useLayoutEffect(() => {
    current = handle;
  }, [handle]);
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(<Probe />);
  });
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  harness.state = labReducer(
    { sessions: {} },
    { type: "select-name", wallet: account, parentLabel: "lab", chainId: 1 },
  );
  harness.client.readContract.mockReset().mockResolvedValue(0n);
  harness.client.simulateContract
    .mockReset()
    .mockImplementation(async (request) => ({ request }));
  harness.client.getTransaction
    .mockReset()
    .mockResolvedValue({ nonce: 5, from: account, to: account, input: "0x" });
  harness.client.waitForTransactionReceipt
    .mockReset()
    .mockResolvedValue(receipt);
  harness.wallet.getChainId.mockReset().mockResolvedValue(1);
  harness.wallet.writeContract.mockReset().mockResolvedValue(hash);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
});
describe("useTxSequence lifecycle", () => {
  it("reset and run in the same event submits a second intentional action", async () => {
    await mount();
    await act(async () => {
      await current.run([step("first")], ctx);
    });
    await act(async () => {
      current.reset();
      await current.run([step("first")], ctx);
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(2);
  });
  it("a confirmed verification failure does not strand a different action", async () => {
    await mount();
    const bad = {
      ...step("first"),
      verify: async () => ({ ok: false, detail: "Mismatch" }),
    };
    await act(async () => {
      await current.run([bad], ctx);
    });
    expect(current.steps.first.confirmed).toBe(true);
    await act(async () => {
      current.reset();
      await current.run([step("second")], ctx);
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(2);
    expect(current.status).toBe("done");
  });
  it("rechecks an unmount after an asynchronous wallet chain lookup", async () => {
    let checked!: (chainId: number) => void;
    harness.wallet.getChainId.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          checked = resolve;
        }),
    );
    await mount();
    let oldRun: Promise<StepCtx | undefined>;
    await act(async () => {
      oldRun = current.run([step("first")], ctx);
    });
    await act(async () => renderer.unmount());
    await mount();
    await act(async () => {
      checked(1);
      await oldRun;
    });
    expect(harness.wallet.writeContract).not.toHaveBeenCalled();
  });
  it("blocks the remounted instance and aborts the old run before its next write", async () => {
    let mined!: (receipt: TransactionReceipt) => void;
    harness.client.waitForTransactionReceipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          mined = resolve;
        }),
    );
    await mount();
    let oldRun: Promise<StepCtx | undefined>;
    await act(async () => {
      oldRun = current.run([step("first"), step("second")], ctx);
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
    await mount();
    expect(current.status).toBe("running");
    await act(async () => {
      await current.run([step("first"), step("second")], ctx);
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(1);
    await act(async () => {
      mined(receipt);
      await oldRun;
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(1);
    await act(async () => {
      await current.run([step("first"), step("second")], ctx);
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(2);
    expect(harness.client.waitForTransactionReceipt).toHaveBeenCalledTimes(2);
  });
});
