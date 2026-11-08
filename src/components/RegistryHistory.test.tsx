import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import {
  registryHistoryKey,
  newSession,
  type SessionData,
} from "../state/labSession";
import { getDeployment } from "../config/deployments";
import { registryAbi } from "../config/abis";
import { labelhashId } from "../lib/names";
import { RegistryHistory } from "./RegistryHistory";
const oldRegistry = "0x1111111111111111111111111111111111111111" as const;
const newRegistry = "0x2222222222222222222222222222222222222222" as const;
const mock = vi.hoisted(() => ({
  session: undefined as SessionData | undefined,
  registries: [] as { address: `0x${string}`; blockNumber: bigint }[],
  error: undefined as string | undefined,
  refresh: vi.fn(),
  run: vi.fn(),
  dispatch: vi.fn(),
  busy: false,
  archive: {} as Record<string, Record<string, { deployBlock?: string }>>,
  verify: vi.fn(),
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: oldRegistry }),
  usePublicClient: () => ({ readContract: mock.verify }),
}));
vi.mock("../hooks/useDeployment", () => ({
  useDeployment: () => getDeployment(11155111),
}));
vi.mock("../hooks/useSessionActivity", () => ({
  useSessionActivity: () => ({ senderBusy: mock.busy }),
}));
vi.mock("../hooks/useDeployedRegistries", () => ({
  useDeployedRegistries: () => ({
    registries: mock.registries,
    error: mock.error,
    loading: false,
    refresh: mock.refresh,
  }),
}));
vi.mock("../hooks/useNameStatus", () => ({
  useNameStatus: () => ({
    subregistry: newRegistry,
    canConfigure: true,
    refetch: vi.fn(),
  }),
}));
vi.mock("../hooks/useTxSequence", () => ({
  useTxSequence: () => ({
    reset: vi.fn(),
    run: mock.run,
    steps: mock.session?.sequences.relink ?? {},
    status: "idle",
  }),
}));
vi.mock("../state/LabContext", () => ({
  useLab: () => ({
    session: mock.session,
    state: {
      activeKey: "test",
      sessions: { test: mock.session },
      registryHistory: mock.archive,
    },
    dispatch: mock.dispatch,
  }),
}));
vi.mock("./ChainGuard", () => ({ useIsReady: () => true }));
vi.mock("./TxStepper", () => ({
  TxStepper: ({ steps }: { steps: Record<string, { detail?: string }> }) => (
    <p>
      {Object.values(steps)
        .map((step) => step.detail)
        .join(" ")}
    </p>
  ),
}));
let renderer: ReactTestRenderer;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.session = {
    ...newSession(oldRegistry, "lab", 11155111),
    addresses: { userRegistry: newRegistry },
    sequences: {},
  };
  mock.registries = [{ address: oldRegistry, blockNumber: 100n }];
  mock.archive = {};
  mock.verify
    .mockReset()
    .mockResolvedValue([getDeployment(11155111).addresses.ETHRegistry, "lab"]);
  mock.error = undefined;
  mock.busy = false;
  mock.dispatch.mockReset();
  mock.run.mockReset();
  mock.refresh.mockClear();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
});
const button = (name: string) =>
  renderer.root.findAllByType("button").find((b) => b.children.includes(name))!;
describe("registry restoration history", () => {
  it("adopts a verified relink atomically using the target's original factory block", async () => {
    mock.run.mockResolvedValue({});
    const adopted = vi.fn();
    await act(async () => {
      renderer = create(<RegistryHistory onAdopt={adopted} />);
    });
    await act(async () => button("Re-link").props.onClick());
    expect(mock.dispatch).toHaveBeenCalledWith({
      type: "adopt-registry",
      sessionKey: "test",
      registry: oldRegistry,
      deployBlock: 100n,
    });
    expect(adopted).toHaveBeenCalledOnce();
  });
  it("does not adopt when the wallet/RPC request fails", async () => {
    mock.run.mockResolvedValue(undefined);
    await act(async () => {
      renderer = create(<RegistryHistory />);
    });
    await act(async () => button("Re-link").props.onClick());
    expect(
      mock.dispatch.mock.calls.some(
        ([action]) => action.type === "adopt-registry",
      ),
    ).toBe(false);
  });
  it("shows history errors and a refresh control even when no results were returned", async () => {
    mock.registries = [];
    mock.error = "rate limited";
    await act(async () => {
      renderer = create(<RegistryHistory />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "Could not refresh deployment history",
    );
    await act(async () => button("Refresh registries").props.onClick());
    expect(mock.refresh).toHaveBeenCalledOnce();
  });
  it("retains a failed relink's explanation after a reload", async () => {
    mock.session!.sequences.relink = {
      relink: {
        status: "failed",
        detail: "Rate limit prevented the request",
        transaction: {
          nonce: 1,
          from: oldRegistry,
          to: getDeployment(11155111).addresses.ETHRegistry,
          input: encodeFunctionData({
            abi: registryAbi,
            functionName: "setSubregistry",
            args: [labelhashId("lab"), oldRegistry],
          }),
        },
      },
    };
    await act(async () => {
      renderer = create(<RegistryHistory />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "Rate limit prevented the request",
    );
  });
});

it("keeps registry A restorable after replacement B and a history RPC failure", async () => {
  mock.registries = [];
  mock.error = "rate limited";
  mock.archive = {
    [registryHistoryKey(oldRegistry, 11155111)]: {
      [oldRegistry]: { deployBlock: "100" },
    },
  };
  mock.session!.sequences.setup = {
    "deploy-registry": {
      status: "done",
      confirmed: true,
      context: { userRegistry: newRegistry },
      blockNumber: "900",
    },
  };
  await act(async () => {
    renderer = create(<RegistryHistory />);
  });
  expect(button("Re-link").props.disabled).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain("block 100");
});
it("can restore a missing registry by address after checking its recorded parent", async () => {
  mock.registries = [];
  mock.run.mockResolvedValue({});
  await act(async () => {
    renderer = create(<RegistryHistory />);
  });
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Registry address to restore" })
      .props.onChange({ target: { value: oldRegistry } }),
  );
  await act(async () => button("Re-link by address").props.onClick());
  expect(mock.verify).toHaveBeenCalledWith(
    expect.objectContaining({
      address: oldRegistry,
      functionName: "getParent",
    }),
  );
  expect(mock.dispatch).toHaveBeenCalledWith({
    type: "adopt-registry",
    sessionKey: "test",
    registry: oldRegistry,
    deployBlock: undefined,
  });
});

it("checks list-row targets too, and never opens the wallet for another name's registry", async () => {
  mock.verify.mockResolvedValue([
    getDeployment(11155111).addresses.ETHRegistry,
    "another-name",
  ]);
  await act(async () => {
    renderer = create(<RegistryHistory />);
  });
  await act(async () => button("Re-link").props.onClick());
  expect(mock.run).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("different parent name");
});
it("rejects an unparented registry when this wallet cannot control its parent", async () => {
  mock.verify.mockImplementation(async ({ functionName }) =>
    functionName === "getParent"
      ? ["0x0000000000000000000000000000000000000000", ""]
      : false,
  );
  await act(async () => {
    renderer = create(<RegistryHistory />);
  });
  await act(async () => button("Re-link").props.onClick());
  expect(mock.run).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain(
    "cannot configure its parent",
  );
});
