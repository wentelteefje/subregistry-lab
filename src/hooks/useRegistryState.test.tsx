import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeployment } from "../config/deployments";
import { useRegistryState } from "./useRegistryState";
const mock = vi.hoisted(() => ({
  logs: vi.fn(),
  multicall: vi.fn(),
  head: vi.fn(async () => 1000n),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ getLogs: mock.logs }),
}));
vi.mock("wagmi", () => ({
  usePublicClient: () => ({
    getBlockNumber: mock.head,
    getLogs: mock.logs,
    multicall: mock.multicall,
  }),
}));
vi.mock("./useDeployment", () => ({
  useDeployment: () => getDeployment(11155111),
}));
const oldRegistry = "0x1111111111111111111111111111111111111111";
const newRegistry = "0x2222222222222222222222222222222222222222";
let result: ReturnType<typeof useRegistryState>;
let renderer: ReactTestRenderer;
let cache: QueryClient;
function Subject({
  registry,
}: {
  registry: typeof oldRegistry | typeof newRegistry;
}) {
  const value = useRegistryState(registry, 100n);
  useLayoutEffect(() => {
    result = value;
  }, [value]);
  return null;
}
const render = (registry: typeof oldRegistry | typeof newRegistry) => (
  <QueryClientProvider client={cache}>
    <Subject registry={registry} />
  </QueryClientProvider>
);
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  cache = new QueryClient();
  mock.logs.mockReset();
  mock.multicall.mockReset();
  mock.multicall.mockResolvedValue([
    { status: 2, expiry: 2000n, latestOwner: oldRegistry },
    newRegistry,
  ]);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  cache.clear();
});
describe("registry-scoped subname reads", () => {
  it("restores greg from the original registry and pins state reads to the scanned block", async () => {
    mock.logs.mockResolvedValue([{ args: { label: "greg" } }]);
    await act(async () => {
      renderer = create(render(oldRegistry));
    });
    await settle();
    expect(result.subnames[0].label).toBe("greg");
    expect(mock.logs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: oldRegistry,
        fromBlock: 100n,
        toBlock: 1000n,
      }),
    );
    expect(mock.multicall).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 1000n, allowFailure: false }),
    );
  });
  it("never shows the old registry's labels while another registry loads", async () => {
    mock.logs.mockResolvedValue([{ args: { label: "greg" } }]);
    await act(async () => {
      renderer = create(render(oldRegistry));
    });
    await settle();
    expect(result.subnames).toHaveLength(1);
    let finish!: (logs: unknown[]) => void;
    mock.logs.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => renderer.update(render(newRegistry)));
    await settle();
    expect(result.subnames).toEqual([]);
    expect(result.loading).toBe(true);
    await act(async () => finish([]));
    await settle();
    expect(result.subnames).toEqual([]);
    expect(result.error).toBeUndefined();
  });
  it("surfaces RPC failures rather than reporting a successful empty scan", async () => {
    mock.logs.mockRejectedValue(Error("RPC rate limited"));
    await act(async () => {
      renderer = create(render(oldRegistry));
    });
    await settle();
    expect(result.error).toContain("rate limited");
    expect(result.loading).toBe(false);
  });
});
