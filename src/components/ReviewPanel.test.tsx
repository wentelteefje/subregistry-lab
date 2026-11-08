import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../state/labSession";
import { getDeployment } from "../config/deployments";
import { prepareTransaction } from "../lib/sequence";
import type { StepCtx, StepDef } from "../lib/steps";
import type { StepState } from "../state/labSession";
import { walletRejectionDump } from "../lib/fixtures/walletRejection";
import { ReviewPanel } from "./ReviewPanel";
const harness = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  chainId: 1,
  wallet: {} as object | undefined,
  session: {} as ReturnType<typeof newSession>,
  error: undefined as string | undefined,
  recordReads: vi.fn(),
  run: vi.fn(),
  refetch: vi.fn(),
  steps: {} as Record<string, StepState>,
}));
vi.mock("wagmi", () => ({
  useChainId: () => harness.chainId,
  useAccount: () => ({ address: harness.address, chainId: harness.chainId }),
  useWalletClient: () => ({ data: harness.wallet }),
}));
vi.mock("../state/LabContext", () => ({
  useLab: () => ({ session: harness.session }),
}));
vi.mock("../hooks/useTxSequence", () => ({
  useTxSequence: () => ({
    status: "idle",
    steps: harness.steps,
    error: harness.error,
    run: harness.run,
  }),
}));
vi.mock("../hooks/useNameStatus", () => ({
  useNameStatus: () => ({ refetch: harness.refetch }),
}));
vi.mock("../hooks/useSetupPrediction", () => ({
  useSetupPrediction: () => ({
    data: {
      userRegistry: "0x2222222222222222222222222222222222222222",
      resolver: "0x3333333333333333333333333333333333333333",
    },
  }),
}));
vi.mock("../hooks/useResolverRecords", () => ({
  useResolverRecords: () => {
    harness.recordReads();
    return { data: {} };
  },
}));
vi.mock("../diagram", () => ({ ConfigDiagram: () => null }));
vi.mock("./ChainGuard", () => ({ useIsReady: () => true }));
let renderer: ReactTestRenderer;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  harness.session = {
    ...newSession(harness.address, "lab", 1),
    presetId: "fully-controlled",
    setupNonce: "review",
  };
  harness.chainId = 1;
  harness.wallet = {};
  harness.run.mockReset();
  harness.steps = {};
  harness.error = undefined;
  harness.recordReads.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
});
async function mount() {
  await act(async () => {
    renderer = create(<ReviewPanel onComplete={() => {}} />);
  });
}
const start = () =>
  renderer.root
    .findAllByType("button")
    .find((button) => button.children.includes("Start setup transactions"))!;
describe("setup review", () => {
  it("shows every transaction and its detail toggle without starting a wallet flow", async () => {
    await mount();
    expect(renderer.root.findAllByType("li")).toHaveLength(5);
    expect(renderer.root.findAllByType("summary")).toHaveLength(5);
    expect(harness.run).not.toHaveBeenCalled();
    const details = renderer.root.findAllByType("details")[0];
    await act(async () =>
      details.props.onToggle({ currentTarget: { open: true } }),
    );
    expect(JSON.stringify(renderer.toJSON())).toContain("Raw calldata");
    expect(harness.run).not.toHaveBeenCalled();
    await act(async () => start().props.onClick());
    expect(harness.run).toHaveBeenCalledTimes(1);
    const [plan, ctx] = harness.run.mock.calls[0] as [StepDef[], StepCtx];
    expect(ctx.chainId).toBe(1);
    expect(ctx.userRegistry).toBeUndefined(); // a prediction is not a deployed registry
    expect(ctx.expectedAddresses?.userRegistry).toBeDefined();
    expect(ctx.reviewedRequests?.[plan[0].id]).toBe(
      prepareTransaction(plan[0].build(ctx), ctx.account, 0).input,
    );
  });
  it("disables execution when account/session network differs, and keeps inspection on the session chain", async () => {
    harness.chainId = 11155111;
    await mount();
    expect(start().props.disabled).toBe(true);
    await act(async () => start().props.onClick());
    expect(harness.run).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain(
      getDeployment(1).chain.name,
    );
  });
  it("disables execution until the wallet client is available", async () => {
    harness.wallet = undefined;
    await mount();
    expect(start().props.disabled).toBe(true);
    expect(harness.run).not.toHaveBeenCalled();
  });
});

it("includes the next request in the review guard when resuming a cancelled attempt", async () => {
  harness.steps = {
    "deploy-registry": {
      status: "failed",
      cancelled: true,
      confirmed: true,
      txHash: `0x${"11".repeat(32)}`,
      transaction: {
        from: harness.address,
        to: harness.address,
        input: "0x",
        value: "0",
        nonce: 4,
      },
    },
  };
  await mount();
  const retry = renderer.root
    .findAllByType("button")
    .find((button) => button.children.includes("Resume from failed step"))!;
  await act(async () => retry.props.onClick());
  const [plan, context] = harness.run.mock.calls[0] as [StepDef[], StepCtx];
  expect(context.reviewedRequests?.["deploy-registry"]).toBe(
    prepareTransaction(plan[0].build(context), context.account, 0).input,
  );
  expect(context.reviewedRequests?.["deploy-registry"]).not.toBe("0x");
});

it("renders a saved wallet cancellation once, with the raw dump only in a bounded disclosure", async () => {
  harness.error = "You cancelled the transaction in your wallet.";
  harness.steps = {
    "deploy-registry": { status: "failed", detail: walletRejectionDump },
  };
  await mount();
  const alerts = renderer.root.findAllByProps({ role: "alert" });
  expect(alerts).toHaveLength(1);
  expect(alerts[0].children.join("")).toBe(
    "Request cancelled in your wallet. Resume when you’re ready.",
  );
  const diagnostic = renderer.root.findByType("pre");
  expect(diagnostic.children.join("")).toBe(walletRejectionDump);
  expect(diagnostic.props.className).toContain("max-h-40");
  expect(diagnostic.props.className).toContain("overflow-auto");
  expect(diagnostic.props.className).toContain("break-all");
  expect(diagnostic.parent?.type).toBe("details");
  expect(diagnostic.parent?.props.open).toBeUndefined();
  expect(harness.steps["deploy-registry"].detail).toBe(walletRejectionDump);
  expect(harness.recordReads).not.toHaveBeenCalled(); // illustration never reads example records on-chain
  expect(JSON.stringify(renderer.toJSON())).toContain("Configuration example.");
  const retry = renderer.root
    .findAllByType("button")
    .find((button) => button.children.includes("Resume from failed step"))!;
  await act(async () => retry.props.onClick());
  expect(harness.run).toHaveBeenCalledTimes(1);
});

it("keeps a sequence-level unknown error bounded even without a failed step", async () => {
  harness.error = `RPC error 0x${"ab".repeat(8000)}`;
  await mount();
  expect(
    renderer.root.findByProps({ role: "alert" }).children.join("").length,
  ).toBeLessThanOrEqual(160);
  expect(renderer.root.findByType("pre").parent?.type).toBe("details");
});

it("does not label mined reverts or cancellations as verification failures", async () => {
  harness.steps = {
    "deploy-registry": {
      status: "failed",
      confirmed: true,
      reverted: true,
      txHash: `0x${"11".repeat(32)}`,
      detail: walletRejectionDump,
    },
  };
  await mount();
  const output = JSON.stringify(renderer.toJSON());
  expect(output).toContain("Transaction reverted on-chain");
  expect(output).not.toContain(
    "Transaction mined; its result was not verified",
  );
});

it("shows a new sequence error even when a stale failed step already has a message", async () => {
  harness.steps = {
    "deploy-registry": { status: "failed", detail: walletRejectionDump },
  };
  harness.error =
    "Another transaction flow is active. Wait for it to finish before resuming.";
  await mount();
  const alerts = renderer.root
    .findAllByProps({ role: "alert" })
    .map((node) => node.children.join(""));
  expect(alerts).toHaveLength(2);
  expect(alerts).toContain(harness.error);
  expect(alerts).toContain(
    "Request cancelled in your wallet. Resume when you’re ready.",
  );
});

it("resumes the captured setup contracts rather than an adopted registry", async () => {
  const original = "0x4444444444444444444444444444444444444444" as const;
  const adopted = "0x5555555555555555555555555555555555555555" as const;
  harness.session.addresses = { userRegistry: adopted };
  harness.session.sequences.setup = {
    "deploy-registry": {
      status: "done",
      confirmed: true,
      context: { userRegistry: original },
    },
  };
  await mount();
  await act(async () => start().props.onClick());
  expect(harness.run.mock.calls[0][1].userRegistry).toBe(original);
});

it("does not reuse an adopted registry when the first deployment was rejected", async () => {
  harness.session.addresses = {
    userRegistry: "0x5555555555555555555555555555555555555555",
  };
  harness.session.registrySelection = "adopted";
  harness.session.sequences.setup = {
    "deploy-registry": {
      status: "failed",
      transaction: {
        from: harness.address,
        to: harness.address,
        nonce: 1,
        input: "0x1234",
      },
    },
  };
  await mount();
  await act(async () => start().props.onClick());
  expect(harness.run.mock.calls[0][1].userRegistry).toBeUndefined();
});
