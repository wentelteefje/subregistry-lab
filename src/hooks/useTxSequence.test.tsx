import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from "viem";
import { verifiableFactoryAbi } from "../config/abis";
import { getDeployment } from "../config/deployments";
import { prepareTransaction } from "../lib/sequence";
import { buildSetupSteps } from "../lib/steps";
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
    getBlockNumber: vi.fn(),
    getCode: vi.fn(),
    getLogs: vi.fn(),
    simulateContract: vi.fn(),
    getTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  },
  wallet: {
    getChainId: vi.fn(),
    request: vi.fn(),
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
    abi: [
      {
        type: "function",
        name: id,
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
      },
    ],
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
  harness.client.getCode.mockReset().mockResolvedValue("0x");
  harness.client.getLogs.mockReset().mockResolvedValue([]);
  harness.client.getBlockNumber.mockReset().mockResolvedValue(12n);
  harness.wallet.request.mockReset().mockResolvedValue("0x5");
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
  it("persists and enforces the nonce before a private transaction is sent", async () => {
    harness.client.getTransaction.mockRejectedValue(new Error("not public"));
    harness.client.waitForTransactionReceipt.mockRejectedValueOnce(
      new Error("timeout"),
    );
    await mount();
    await act(async () => {
      await current.run([step("private")], ctx);
    });
    expect(current.steps.private.transaction?.nonce).toBe(5);
    expect(current.steps.private.transaction?.input).toMatch(/^0x/);
    expect(harness.wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 5 }),
    );
  });
  it("pins post-receipt reads so a lagging latest response cannot report failure", async () => {
    harness.client.readContract.mockImplementation(async ({ blockNumber }) =>
      blockNumber === 12n ? 1n : 0n,
    );
    await mount();
    const plan = {
      ...step("pinned"),
      verify: async (read: import("../lib/steps").ReadFn) => ({
        ok:
          (await read({
            address: account,
            abi: [],
            functionName: "value",
            args: [],
          })) === 1n,
        detail: "verified",
      }),
    };
    await act(async () => {
      await current.run([plan], ctx);
    });
    expect(current.status).toBe("done");
    expect(harness.client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 12n }),
    );
  });
  it("retains a confirmed verification failure for a same-intent retry without another send", async () => {
    await mount();
    let ok = false;
    const plan = {
      ...step("retry"),
      verify: async () => ({ ok, detail: "verify" }),
    };
    await act(async () => {
      await current.run([plan], ctx);
    });
    ok = true;
    await act(async () => {
      current.reset();
      await current.run([plan], ctx);
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(1);
    expect(current.status).toBe("done");
  });
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

describe("reviewed setup deployment recovery", () => {
  async function recoveredDeployment(
    mismatch = false,
    override?: () => void | Promise<void>,
  ) {
    const network = getDeployment(1);
    const predicted = "0x2222222222222222222222222222222222222222" as const;
    const context = {
      ...ctx,
      setupNonce: "review-recovery",
      expectedAddresses: { userRegistry: predicted },
    };
    const deploy = buildSetupSteps("fully-controlled", 1)[0];
    const action = deploy.build(context);
    if (action.type !== "write") throw new Error("expected factory call");
    const salt = action.args[1] as bigint;
    const tx = prepareTransaction(action, account, 5);
    harness.client.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "predictProxyAddress" ? predicted : true,
    );
    harness.client.getCode.mockResolvedValue("0x6000");
    harness.client.getLogs.mockResolvedValue([
      {
        transactionHash: hash,
        args: {
          sender: account,
          salt,
          implementation: network.addresses.UserRegistryImpl,
          proxyAddress: predicted,
        },
      },
    ]);
    harness.client.getTransaction.mockResolvedValue({
      ...tx,
      input: mismatch ? "0x1234" : tx.input,
      value: 0n,
    });
    harness.client.getBlockNumber.mockResolvedValue(27000000n);
    harness.client.waitForTransactionReceipt.mockResolvedValue({
      ...receipt,
      logs: [
        {
          address: network.addresses.VerifiableFactory,
          topics: encodeEventTopics({
            abi: verifiableFactoryAbi,
            eventName: "ProxyDeployed",
            args: { sender: account, proxyAddress: predicted },
          }),
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "address" }],
            [salt, network.addresses.UserRegistryImpl],
          ),
        },
      ],
    });
    await override?.();
    await mount();
    let result;
    await act(async () => {
      result = await current.run([deploy], context);
    });
    return { result, predicted };
  }
  it("recovers a mined factory request whose hash was lost without opening the wallet again", async () => {
    const { result, predicted } = await recoveredDeployment();
    expect(result).toMatchObject({ userRegistry: predicted });
    expect(harness.wallet.writeContract).not.toHaveBeenCalled();
    expect(harness.client.simulateContract).not.toHaveBeenCalled();
  });
  it("refuses to adopt code when the original calldata does not match", async () => {
    const { result } = await recoveredDeployment(true);
    expect(result).toBeUndefined();
    expect(current.error).toContain("does not match");
    expect(harness.wallet.writeContract).not.toHaveBeenCalled();
  });
  it("sends normally when no code exists at the predicted address", async () => {
    const { result, predicted } = await recoveredDeployment(false, () => {
      harness.client.getCode.mockResolvedValue("0x");
    });
    expect(result).toMatchObject({ userRegistry: predicted });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(1);
    expect(harness.client.getLogs).not.toHaveBeenCalled();
  });
  it("halts when code exists but no matching deployment log can be recovered", async () => {
    const { result } = await recoveredDeployment(false, () => {
      harness.client.getLogs.mockResolvedValue([]);
    });
    expect(result).toBeUndefined();
    expect(current.error).toContain("could not be recovered");
    expect(harness.wallet.writeContract).not.toHaveBeenCalled();
  });
  it("stops on prediction transport failure before opening the wallet", async () => {
    const { result } = await recoveredDeployment(false, () => {
      harness.client.readContract.mockRejectedValueOnce(
        new Error("RPC offline"),
      );
    });
    expect(result).toBeUndefined();
    expect(current.error).toContain("RPC offline");
    expect(harness.wallet.writeContract).not.toHaveBeenCalled();
  });
  for (const change of [
    { from: "0x5555555555555555555555555555555555555555" },
    { value: 1n },
  ])
    it(`rejects a recovered transaction with a different ${"from" in change ? "sender" : "ETH value"}`, async () => {
      const { result } = await recoveredDeployment(false, async () => {
        const original = await harness.client.getTransaction();
        harness.client.getTransaction.mockResolvedValue({
          ...original,
          ...change,
        });
      });
      expect(result).toBeUndefined();
      expect(current.error).toContain("does not match");
      expect(harness.wallet.writeContract).not.toHaveBeenCalled();
    });
  it("shows one wallet request after explicit run and waits for its receipt before the next", async () => {
    let complete!: (value: TransactionReceipt) => void;
    const pending = new Promise<TransactionReceipt>((resolve) => {
      complete = resolve;
    });
    harness.client.waitForTransactionReceipt.mockReturnValueOnce(pending);
    await mount();
    expect(harness.wallet.writeContract).not.toHaveBeenCalled();
    let running!: ReturnType<SequenceHandle["run"]>;
    await act(async () => {
      running = current.run([step("first"), step("second")], ctx);
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(receipt);
      await running;
    });
    expect(harness.wallet.writeContract).toHaveBeenCalledTimes(2);
  });
});
