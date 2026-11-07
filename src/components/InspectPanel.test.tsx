import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectPanel, type InspectionFormState } from "./InspectPanel";
import type { ConfigurationSnapshot } from "../lib/readConfiguration";
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  snapshot: undefined as ConfigurationSnapshot | undefined,
  refresh: vi.fn(),
}));
vi.mock("../hooks/useConfigurationInspection", () => ({
  useConfigurationInspection: (...args: unknown[]) => {
    mock.read(...args);
    return {
      query: { data: mock.snapshot, isPending: false, isFetching: false },
      registrar: { data: null, isPending: false },
      refresh: mock.refresh,
    };
  },
}));
vi.mock("wagmi", () => ({
  useWalletClient: () => {
    throw Error("wallet access forbidden");
  },
  useAccount: () => {
    throw Error("account access forbidden");
  },
}));
vi.mock("../state/LabContext", () => ({
  useLab: () => {
    throw Error("session access forbidden");
  },
}));
vi.mock("../hooks/useTxSequence", () => ({
  useTxSequence: () => {
    throw Error("transaction flow forbidden");
  },
}));
const cache = new QueryClient();
let renderer: ReactTestRenderer;
function Subject() {
  const [state, onChange] = useState<InspectionFormState>({
    draft: "",
    chainId: 11155111,
  });
  return <InspectPanel active state={state} onChange={onChange} />;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.read.mockClear();
  mock.refresh.mockClear();
  mock.snapshot = undefined;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  cache.clear();
});
async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={cache}>
        <Subject />
      </QueryClientProvider>,
    );
  });
}
describe("disconnected read-only inspection", () => {
  it("submits a normalized parent on an independently selected network, without touching the wallet or session", async () => {
    await mount();
    expect(mock.read.mock.lastCall?.[0]).toBeUndefined();
    await act(async () => {
      renderer.root
        .findByType("input")
        .props.onChange({ target: { value: "Other.ETH" } });
      renderer.root
        .findByType("select")
        .props.onChange({ target: { value: "1" } });
    });
    expect(mock.read.mock.lastCall?.[0]).toBeUndefined();
    await act(async () =>
      renderer.root
        .findByType("form")
        .props.onSubmit({ preventDefault: vi.fn() }),
    );
    expect(mock.read.mock.lastCall?.[0]).toEqual({
      name: "other.eth",
      chainId: 1,
    });
  });
  it("shows validation errors before submitting any RPC request", async () => {
    await mount();
    await act(async () =>
      renderer.root
        .findByType("input")
        .props.onChange({ target: { value: "invalid.com" } }),
    );
    await act(async () =>
      renderer.root
        .findByType("form")
        .props.onSubmit({ preventDefault: vi.fn() }),
    );
    expect(renderer.root.findByProps({ role: "alert" })).toBeDefined();
    expect(mock.read.mock.lastCall?.[0]).toBeUndefined();
  });
  it("renders someone else's registered configuration without any write controls", async () => {
    mock.snapshot = {
      name: "other.eth",
      chainId: 1,
      block: 100n,
      scanFrom: 1n,
      status: "registered",
      atName: "other.eth",
      atRegistry: "0x1111111111111111111111111111111111111111",
      state: {
        status: 2,
        expiry: 9999999999n,
        latestOwner: "0x2222222222222222222222222222222222222222",
        tokenId: 1n,
        resource: 2n,
      },
      subnames: [],
      setup: { parentName: "other.eth", parentNote: "inspected name" },
    };
    await mount();
    await act(async () =>
      renderer.root
        .findByType("input")
        .props.onChange({ target: { value: "other.eth" } }),
    );
    await act(async () =>
      renderer.root
        .findByType("form")
        .props.onSubmit({ preventDefault: vi.fn() }),
    );
    const labels = renderer.root
      .findAllByType("button")
      .map((button) => button.children.join(" "));
    expect(labels).not.toContain("Register");
    expect(
      labels.some((label) => /execute|re-link|deploy|lock/i.test(label)),
    ).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "no configured subregistry",
    );
  });
});
