import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConfigurationInspection,
  type InspectionRequest,
} from "./useConfigurationInspection";
import type { ConfigurationSnapshot } from "../lib/readConfiguration";
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  registrar: vi.fn(),
  client: vi.fn(({ chainId }) => ({ chainId })),
  scan: vi.fn(({ chain }) => ({ chainId: chain.id })),
}));
vi.mock("wagmi", () => ({
  usePublicClient: mock.client,
  useWalletClient: () => {
    throw Error("wallet forbidden");
  },
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: mock.scan,
}));
vi.mock("../lib/readConfiguration", () => ({ readConfiguration: mock.read }));
vi.mock("../lib/discoverRegistrar", () => ({
  discoverRegistrar: mock.registrar,
}));
let renderer: ReactTestRenderer,
  result: ReturnType<typeof useConfigurationInspection>,
  cache: QueryClient;
function Subject({
  target,
  active = true,
}: {
  target?: InspectionRequest;
  active?: boolean;
}) {
  const value = useConfigurationInspection(target, active);
  useLayoutEffect(() => {
    result = value;
  }, [value]);
  return null;
}
const render = (target?: InspectionRequest, active = true) => (
  <QueryClientProvider client={cache}>
    <Subject target={target} active={active} />
  </QueryClientProvider>
);
const target = { name: "wallet.eth", chainId: 1 as const };
const snapshot: ConfigurationSnapshot = {
  name: "wallet.eth",
  chainId: 1,
  block: 100n,
  scanFrom: 1n,
  status: "registered",
  atName: "wallet.eth",
  atRegistry: "0x1111111111111111111111111111111111111111",
  childRegistry: "0x2222222222222222222222222222222222222222",
  setup: { parentName: "wallet.eth" },
  subnames: [],
};
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  cache = new QueryClient();
  mock.read.mockReset().mockResolvedValue(snapshot);
  mock.registrar.mockReset().mockResolvedValue(null);
  mock.client.mockClear();
  mock.scan.mockClear();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  cache.clear();
});
describe("wallet-independent inspection queries", () => {
  it("performs no reads until a parent is submitted", async () => {
    await act(async () => {
      renderer = create(render());
    });
    await settle();
    expect(mock.read).not.toHaveBeenCalled();
    expect(mock.registrar).not.toHaveBeenCalled();
  });
  it("uses the submitted chain for every client and query, with no polling", async () => {
    await act(async () => {
      renderer = create(render(target));
    });
    await settle();
    await settle();
    expect(mock.client).toHaveBeenCalledWith({ chainId: 1 });
    expect(mock.read.mock.calls[0][0]).toEqual({ chainId: 1 });
    expect(mock.read.mock.calls[0][3].id).toBe(1);
    expect(mock.registrar.mock.calls[0][3].id).toBe(1);
    expect(mock.registrar.mock.calls[0][7]).toBe(100n);
    for (const query of cache.getQueryCache().getAll())
      expect(
        (query.options as { refetchInterval?: unknown }).refetchInterval,
      ).toBeUndefined();
  });
  it("keeps the diagram's snapshot when optional registrar discovery fails", async () => {
    mock.registrar.mockRejectedValue(Error("rate limited"));
    await act(async () => {
      renderer = create(render(target));
    });
    await settle();
    await settle();
    expect(result.query.data).toBeDefined();
    expect(result.registrar.error?.message).toBe("rate limited");
    expect(result.query.error).toBeNull();
  });
  it("clears another name's data immediately and never fetches a hidden target", async () => {
    await act(async () => {
      renderer = create(render(target));
    });
    await settle();
    mock.read.mockImplementation(() => new Promise(() => {}));
    await act(async () =>
      renderer.update(render({ name: "other.eth", chainId: 11155111 }, false)),
    );
    await settle();
    expect(result.query.data).toBeUndefined();
    expect(mock.read).toHaveBeenCalledTimes(1);
  });
});

it("retains 35 inspected names and reuses them without scanning again until Refresh", async () => {
  mock.read.mockImplementation(async (_client, _scan, name) => ({ ...snapshot, name, childRegistry: undefined }));
  await act(async () => { renderer = create(render({name:"name0.eth",chainId:1})); });
  await settle();
  for(let i=1;i<35;i++) {
    await act(async () => renderer.update(render({name:`name${i}.eth`,chainId:1})));
    await settle();
  }
  expect(mock.read).toHaveBeenCalledTimes(35);
  for(let i=0;i<35;i++) {
    await act(async () => renderer.update(render({name:`name${i}.eth`,chainId:1})));
    await settle();
  }
  expect(mock.read).toHaveBeenCalledTimes(35);
  expect(cache.getQueryCache().findAll({queryKey:["inspect-configuration"]})).toHaveLength(35);
  await act(async () => result.refresh());
  await settle();
  expect(mock.read).toHaveBeenCalledTimes(36);
});
