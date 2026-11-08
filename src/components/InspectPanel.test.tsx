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

it("shows wildcard routing and resolver-name browsing without registry ownership or write actions", async () => {
  const resolver = "0x1111111111111111111111111111111111111111";
  mock.snapshot = {
    name: "time-q.paperseal-demo.eth",
    chainId: 11155111,
    block: 12081440n,
    scanFrom: 1n,
    status: "no-registry",
    atName: "paperseal-demo.eth",
    atRegistry: resolver,
    effectiveResolver: resolver,
    resolverSource: "paperseal-demo.eth",
    state: {
      status: 2,
      expiry: 9999999999n,
      latestOwner: resolver,
      tokenId: 1n,
      resource: 1n,
    },
    resolution: {
      resolver,
      foundAt: "paperseal-demo.eth",
      wildcard: true,
      wildcardSupported: true,
      permissioned: true,
      source: "linked",
      recordId: "21",
      defaultId: "0",
    },
    resolverNames: [
      { name: "deep.time-q.paperseal-demo.eth", resolver, recordId: "22" },
    ],
    setup: {
      parentName: "time-q.paperseal-demo.eth",
      parentNote: "no registry entry",
      inheritedResolver: resolver,
      resolverRecords: {
        [resolver]: {
          "time-q.paperseal-demo.eth": "21",
          "deep.time-q.paperseal-demo.eth": "22",
          "": "0",
        },
      },
    },
  };
  await mount();
  await act(async () =>
    renderer.root
      .findByType("input")
      .props.onChange({ target: { value: "time-q.paperseal-demo.eth" } }),
  );
  await act(async () =>
    renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain("Wildcard resolver found at paperseal-demo.eth");
  expect(text).toContain("Name-specific record bundle #21");
  expect(text).toContain("Browse resolver-linked names");
  expect(text).not.toContain("Parent owner");
  expect(text).not.toContain("9999999999");
  expect(
    renderer.root
      .findAllByType("button")
      .some((button) =>
        button.children.join(" ").includes("deep.time-q.paperseal-demo.eth"),
      ),
  ).toBe(true);
});

it("explores one level only on click and returns to the parent with its filter", async () => {
  const registry = "0x1111111111111111111111111111111111111111",
    child = "0x2222222222222222222222222222222222222222";
  const parent: ConfigurationSnapshot = {
    name: "gamebox.eth",
    chainId: 11155111,
    block: 100n,
    scanFrom: 1n,
    status: "registered",
    atName: "gamebox.eth",
    atRegistry: registry,
    childRegistry: registry,
    subnames: [
      {
        label: "stockduel",
        registered: true,
        status: 2,
        owner: registry,
        resolver: registry,
        expiry: 9999999999n,
        neverExpires: false,
        subregistry: child,
      },
    ],
    setup: { parentName: "gamebox.eth", userRegistry: registry },
  };
  mock.snapshot = parent;
  await mount();
  await act(async () =>
    renderer.root
      .findByType("input")
      .props.onChange({ target: { value: "gamebox.eth" } }),
  );
  await act(async () =>
    renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
  expect(mock.read.mock.lastCall?.[0]).toEqual({
    name: "gamebox.eth",
    chainId: 11155111,
  });
  const filter = renderer.root
    .findAllByType("input")
    .find((input) => input.props.className?.includes("ml-2"))!;
  await act(async () => filter.props.onChange({ target: { value: "stock" } }));
  expect(JSON.stringify(renderer.toJSON())).toContain("Child registry");
  const explore = renderer.root.findByProps({
    "aria-label": "Explore subregistry of stockduel.gamebox.eth",
  });
  await act(async () => explore.props.onClick());
  expect(mock.read.mock.lastCall?.[0]).toEqual({
    name: "stockduel.gamebox.eth",
    chainId: 11155111,
  });
  mock.snapshot = {
    ...parent,
    name: "stockduel.gamebox.eth",
    childRegistry: registry,
    subnames: [],
    setup: { parentName: "stockduel.gamebox.eth", userRegistry: registry },
  };
  await act(async () =>
    renderer.update(
      <QueryClientProvider client={cache}>
        <Subject />
      </QueryClientProvider>,
    ),
  );
  expect(JSON.stringify(renderer.toJSON())).toContain("pointer differs");
  await act(async () =>
    renderer.root
      .findByType("select")
      .props.onChange({ target: { value: "1" } }),
  );
  expect(mock.read.mock.lastCall?.[0]).toEqual({
    name: "stockduel.gamebox.eth",
    chainId: 11155111,
  });
  const trail = renderer.root.findByProps({
    "aria-label": "Registry exploration path",
  });
  await act(async () => trail.findByType("button").props.onClick());
  expect(mock.read.mock.lastCall?.[0]).toEqual({
    name: "gamebox.eth",
    chainId: 11155111,
  });
  mock.snapshot = parent;
  await act(async () =>
    renderer.update(
      <QueryClientProvider client={cache}>
        <Subject />
      </QueryClientProvider>,
    ),
  );
  expect(
    renderer.root
      .findAllByType("input")
      .find((input) => input.props.className?.includes("ml-2"))?.props.value,
  ).toBe("stock");
});

it("disables exploration for ambiguous on-chain labels and exposes unknown pointers", async () => {
  const registry = "0x1111111111111111111111111111111111111111";
  mock.snapshot = {
    name: "gamebox.eth",
    chainId: 11155111,
    block: 100n,
    scanFrom: 1n,
    status: "registered",
    atName: "gamebox.eth",
    atRegistry: registry,
    childRegistry: registry,
    subnames: [
      {
        label: "a.b",
        registered: true,
        resolver: registry,
        owner: registry,
        expiry: 99n,
        neverExpires: false,
        subregistry: registry,
      },
      {
        label: "unknown",
        registered: true,
        resolver: registry,
        owner: registry,
        expiry: 99n,
        neverExpires: false,
        subregistryError: "RPC offline",
      },
    ],
    setup: { parentName: "gamebox.eth", userRegistry: registry },
  };
  await mount();
  await act(async () =>
    renderer.root
      .findByType("input")
      .props.onChange({ target: { value: "gamebox.eth" } }),
  );
  await act(async () =>
    renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
  expect(
    renderer.root.findByProps({
      "aria-label": "Explore subregistry of a.b.gamebox.eth",
    }).props.disabled,
  ).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("RPC offline");
  expect(JSON.stringify(renderer.toJSON())).toContain("not verified");
});
