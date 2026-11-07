import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeployment } from "../config/deployments";
import { useRegistrarDiscovery } from "./useRegistrarDiscovery";
const oldRegistry = "0x1111111111111111111111111111111111111111" as const;
const newRegistry = "0x2222222222222222222222222222222222222222" as const;
const cached = "0x3333333333333333333333333333333333333333" as const;
const mock = vi.hoisted(() => ({ read: vi.fn(), logs: vi.fn() }));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ getLogs: mock.logs }),
}));
vi.mock("wagmi", () => ({
  usePublicClient: () => ({
    getBlockNumber: async () => 1000n,
    readContract: mock.read,
    getCode: async () => "0x1234",
    getLogs: mock.logs,
  }),
}));
vi.mock("./useDeployment", () => ({
  useDeployment: () => getDeployment(11155111),
}));
let result: ReturnType<typeof useRegistrarDiscovery>;
let renderer: ReactTestRenderer;
let cache: QueryClient;
function Subject({
  registry,
}: {
  registry: typeof oldRegistry | typeof newRegistry;
}) {
  const value = useRegistrarDiscovery(registry, 100n, cached);
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
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  cache = new QueryClient();
  mock.logs.mockReset().mockResolvedValue([]);
  mock.read
    .mockReset()
    .mockImplementation(async ({ functionName }) =>
      functionName === "hasRootRoles"
        ? true
        : functionName === "REGISTRY"
          ? oldRegistry
          : getDeployment(11155111).addresses.PaymentToken,
    );
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  cache.clear();
});
describe("registrar restoration", () => {
  it("never reuses the replacement's registrar for another registry", async () => {
    await act(async () => {
      renderer = create(render(oldRegistry));
    });
    await settle();
    expect(result.registrar).toBe(cached);
    await act(async () => renderer.update(render(newRegistry)));
    await settle();
    expect(result.registrar).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(mock.logs).toHaveBeenCalledWith(
      expect.objectContaining({ address: newRegistry }),
    );
  });
  it("reports failed registrar verification as unknown rather than no registrar", async () => {
    mock.read.mockRejectedValue(Error("RPC rate limited"));
    await act(async () => {
      renderer = create(render(oldRegistry));
    });
    await settle();
    expect(result.registrar).toBeUndefined();
    expect(result.error).toBe("RPC rate limited");
  });
});

it("keeps getter transport failures distinct from an incompatible registrar", async () => {
  const { BaseError } = await import("viem");
  mock.read.mockImplementation(async ({ functionName }) => {
    if (functionName === "hasRootRoles") return true;
    throw new BaseError("RPC rate limited");
  });
  await act(async () => {
    renderer = create(render(oldRegistry));
  });
  await settle();
  expect(result.error).toContain("RPC rate limited");
});
