import { describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionZeroDataError,
  zeroAddress,
  type PublicClient,
} from "viem";
import { getDeployment } from "../config/deployments";
import {
  readConfiguration,
  normalizeInspectionName,
} from "./readConfiguration";
import { readRegistryState } from "./readRegistryState";
const network = getDeployment(11155111),
  head = BigInt(network.factoryDeployBlock) + 1000n;
const child = "0x1111111111111111111111111111111111111111",
  deep = "0x2222222222222222222222222222222222222222",
  owner = "0x3333333333333333333333333333333333333333",
  shared = "0x4444444444444444444444444444444444444444";
const state = {
  status: 2,
  expiry: 9999999999n,
  latestOwner: owner,
  tokenId: 1n,
  resource: 2n,
};
function fixture() {
  const logs = vi.fn(async () => []);
  const multi = vi.fn(
    async ({
      contracts,
    }: {
      contracts: { address: string; functionName: string }[];
    }): Promise<unknown[]> => {
      if (contracts[0].functionName === "getSubregistry")
        return contracts.map(() => ({
          status: "success",
          result: zeroAddress,
        }));
      if (contracts[0].functionName === "getRecordId")
        return contracts.map(() => ({ status: "success", result: 0n }));
      return contracts[0].address === network.addresses.ETHRegistry
        ? [state, child, shared]
        : [state, deep, zeroAddress];
    },
  );
  const getBlockNumber = vi.fn(async () => head);
  const client = {
    multicall: multi,
    getBlockNumber,
    getLogs: logs,
    readContract: vi.fn(async () => 0n),
  } as unknown as PublicClient;
  return { client, multi, logs, getBlockNumber };
}
describe("read-only configuration walks", () => {
  it("normalizes shorthand and ENS names while rejecting unsupported input before reads", () => {
    expect(normalizeInspectionName(" RaFFY.ETH ")).toBe("raffy.eth");
    expect(normalizeInspectionName("wallet")).toBe("wallet.eth");
    expect(normalizeInspectionName("team.wallet.eth.")).toBe("team.wallet.eth");
    for (const value of [
      "",
      "eth",
      "wallet.com",
      "bad name.eth",
      "[0x1234].eth",
      `${"a.".repeat(10)}eth`,
    ])
      expect(() => normalizeInspectionName(value)).toThrow();
  });
  it("walks deep registered parents and separates exact from ancestor resolver pointers", async () => {
    const { client, multi } = fixture();
    const result = await readConfiguration(
      client,
      client,
      "team.wallet.eth",
      network,
    );
    expect(result.status).toBe("registered");
    expect(result.atRegistry).toBe(child);
    expect(result.childRegistry).toBe(deep);
    expect(result.directResolver).toBeUndefined();
    expect(result.effectiveResolver).toBe(shared);
    expect(result.resolverSource).toBe("wallet.eth");
    expect(result.setup.resolver).toBeUndefined();
    expect(result.setup.inheritedResolver).toBe(shared);
    expect(result.setup.parentOwner).toBe(owner);
    expect(
      multi.mock.calls.every(
        ([params]) => (params as { blockNumber?: bigint }).blockNumber === head,
      ),
    ).toBe(true);
  });
  it("does not label an unregistered or expired ancestor as an empty registered parent", async () => {
    const { client, multi, logs } = fixture();
    multi.mockResolvedValueOnce([
      { ...state, status: 0 },
      zeroAddress,
      zeroAddress,
    ]);
    const result = await readConfiguration(
      client,
      client,
      "team.wallet.eth",
      network,
    );
    expect(result.status).toBe("unregistered");
    expect(result.atName).toBe("wallet.eth");
    expect(logs).not.toHaveBeenCalled();
  });
  it("distinguishes an absent intermediate registry from a parent with no subregistry", async () => {
    const { client, multi } = fixture();
    multi.mockResolvedValueOnce([state, zeroAddress, shared]);
    expect(
      (await readConfiguration(client, client, "team.wallet.eth", network))
        .status,
    ).toBe("no-registry");
    multi.mockResolvedValueOnce([state, zeroAddress, shared]);
    const selected = await readConfiguration(
      client,
      client,
      "wallet.eth",
      network,
    );
    expect(selected.status).toBe("registered");
    expect(selected.childRegistry).toBeUndefined();
    expect(selected.subnames).toEqual([]);
  });
  it("preserves known parent metadata when label history fails", async () => {
    const { client, logs } = fixture();
    logs.mockRejectedValue(Error("RPC rate limited"));
    const result = await readConfiguration(
      client,
      client,
      "wallet.eth",
      network,
    );
    expect(result.status).toBe("registered");
    expect(result.childRegistry).toBe(child);
    expect(result.subnames).toBeUndefined();
    expect(result.subnamesError).toContain("rate");
  });
  it("reports unsupported registry interfaces separately from transport failure", async () => {
    const { client, multi } = fixture();
    multi.mockRejectedValueOnce(
      new BaseError("unsupported", {
        cause: new ContractFunctionZeroDataError({ functionName: "getState" }),
      }),
    );
    expect(
      (await readConfiguration(client, client, "wallet.eth", network)).status,
    ).toBe("unsupported-registry");
    multi.mockRejectedValueOnce(Error("RPC offline"));
    await expect(
      readConfiguration(client, client, "wallet.eth", network),
    ).rejects.toThrow("RPC offline");
  });
  it("batches large child registries and uses the caller's pinned block", async () => {
    const logs = vi.fn(async () =>
      Array.from({ length: 205 }, (_, index) => ({
        args: { label: `label${index}` },
      })),
    );
    const multicall = vi.fn(
      async ({ contracts }: { contracts: { functionName: string }[] }) =>
        contracts.map((call) =>
          call.functionName === "getState" ? state : shared,
        ),
    );
    const getBlockNumber = vi.fn();
    const client = {
      getLogs: logs,
      multicall,
      getBlockNumber,
    } as unknown as PublicClient;
    const subs = await readRegistryState(
      client,
      client,
      child,
      head - 100n,
      undefined,
      head,
    );
    expect(subs).toHaveLength(205);
    expect(
      multicall.mock.calls.map(([params]) => params.contracts.length),
    ).toEqual([200, 200, 10]);
    expect(getBlockNumber).not.toHaveBeenCalled();
  });
});

it("traverses reserved ancestors and preserves a reserved target's pointers", async () => {
  const { client, multi } = fixture();
  multi.mockResolvedValueOnce([{ ...state, status: 1 }, child, shared]);
  multi.mockResolvedValueOnce([{ ...state, status: 1 }, deep, zeroAddress]);
  const result = await readConfiguration(
    client,
    client,
    "team.wallet.eth",
    network,
  );
  expect(result.status).toBe("reserved");
  expect(result.childRegistry).toBe(deep);
  expect(result.effectiveResolver).toBe(shared);
});
it("does not confuse a viem transport BaseError with an unsupported registry", async () => {
  const { client, multi } = fixture();
  multi.mockRejectedValueOnce(new BaseError("RPC rate limited"));
  await expect(
    readConfiguration(client, client, "wallet.eth", network),
  ).rejects.toThrow("RPC rate limited");
});

it("finds reserved-only labels from LabelReserved events", async () => {
  const logs = vi.fn(async ({ events }: { events: { name: string }[] }) =>
    events.some((event) => event.name === "LabelReserved")
      ? [{ args: { label: "reserved" } }]
      : [],
  );
  const multicall = vi.fn(
    async ({ contracts }: { contracts: { functionName: string }[] }) =>
      contracts.map((call) =>
        call.functionName === "getState" ? { ...state, status: 1 } : shared,
      ),
  );
  const client = { getLogs: logs, multicall } as unknown as PublicClient;
  const subs = await readRegistryState(
    client,
    client,
    child,
    head - 10n,
    undefined,
    head,
  );
  expect(subs[0]).toMatchObject({
    label: "reserved",
    status: 1,
    registered: false,
  });
});
it("caps broad registry inspection before issuing per-label state reads", async () => {
  const logs = vi.fn(async () =>
    Array.from({ length: 501 }, (_, index) => ({
      args: { label: `name${index}` },
    })),
  );
  const multicall = vi.fn();
  const client = { getLogs: logs, multicall } as unknown as PublicClient;
  await expect(
    readRegistryState(client, client, child, head - 10n, undefined, head, 500),
  ).rejects.toThrow("Inspection limit");
  expect(multicall).not.toHaveBeenCalled();
});
it("does not restart a throttled log scan on another RPC", async () => {
  const scan = {
    getLogs: vi.fn(async () => {
      throw Error("429 rate limit exceeded");
    }),
  } as unknown as PublicClient;
  const primary = { getLogs: vi.fn() } as unknown as PublicClient;
  await expect(
    readRegistryState(primary, scan, child, head - 100n, undefined, head),
  ).rejects.toThrow("rate limit");
  expect(scan.getLogs).toHaveBeenCalledTimes(1);
  expect(primary.getLogs).not.toHaveBeenCalled();
});
it("keeps unsupported child registries distinct from successfully empty registries", async () => {
  const { client } = fixture();
  vi.mocked(client.readContract).mockRejectedValue(
    Error("No registry interface"),
  );
  const result = await readConfiguration(client, client, "wallet.eth", network);
  expect(result.subnames).toBeUndefined();
  expect(result.subnamesError).toContain("No registry interface");
});

it("reports undecodable registry history instead of a verified empty registry", async () => {
  const { client, logs } = fixture();
  logs.mockResolvedValue([
    { args: {}, topics: [`0x${"0".repeat(64)}`] },
  ] as never);
  const result = await readConfiguration(client, client, "wallet.eth", network);
  expect(result.subnamesError).toContain("could not be decoded");
});

it.each(["no-registry", "unregistered"])(
  "inspects wildcard records while retaining the true %s registry status",
  async (status) => {
    const { client, multi, logs } = fixture();
    multi.mockImplementation(async ({ contracts }) => {
      if (contracts[0].functionName === "getState")
        return [state, status === "no-registry" ? zeroAddress : child, shared];
      if (contracts[0].functionName === "supportsInterface")
        return [
          { status: "success", result: true },
          { status: "success", result: 21n },
          { status: "success", result: 0n },
        ];
      return [];
    });
    if (status === "unregistered")
      multi
        .mockResolvedValueOnce([state, child, shared])
        .mockResolvedValueOnce([
          { ...state, status: 0 },
          zeroAddress,
          zeroAddress,
        ]);
    vi.mocked(client.readContract).mockResolvedValue([
      shared,
      `0x${"0".repeat(64)}`,
      5n,
    ] as never);
    const result = await readConfiguration(
      client,
      client,
      "team.wallet.eth",
      network,
    );
    expect(result.status).toBe(status);
    expect(result.resolution).toMatchObject({
      wildcard: true,
      foundAt: "wallet.eth",
      source: "linked",
      recordId: "21",
    });
    expect(result.setup).toMatchObject({
      parentName: "team.wallet.eth",
      parentNote: "no registry entry",
      inheritedResolver: shared,
    });
    expect(result.setup.userRegistry).toBeUndefined();
    expect(result.resolverNames).toBeUndefined();
    expect(logs).not.toHaveBeenCalled();
  },
);

it("checks child pointers at the snapshot without scanning deeper registries", async () => {
  const { client, logs, multi } = fixture();
  logs.mockResolvedValue([{ args: { label: "stockduel" } }] as never);
  multi.mockImplementation(async ({ contracts }) => {
    if (contracts[0].functionName === "getSubregistry")
      return [{ status: "success", result: deep }];
    if (contracts[0].functionName === "getRecordId")
      return contracts.map(() => ({ status: "success", result: 0n }));
    if (contracts[0].address === network.addresses.ETHRegistry)
      return [state, child, shared];
    return [state, shared];
  });
  const result = await readConfiguration(client, client, "wallet.eth", network);
  expect(result.subnames?.[0].subregistry).toBe(deep);
  expect(result.setup.subnames?.[0].childRegistry).toBe(true);
  expect(logs.mock.calls).toHaveLength(1);
  expect(logs.mock.calls[0]).toMatchObject([{ address: child }]);
  const probe = multi.mock.calls.find(
    ([call]) => call.contracts[0].functionName === "getSubregistry",
  );
  expect(probe?.[0]).toMatchObject({ blockNumber: head, allowFailure: true });
});

it.each([false, true])(
  "keeps label data when child pointer lookup fails (whole RPC: %s)",
  async (whole) => {
    const { client, logs, multi } = fixture();
    logs.mockResolvedValue([{ args: { label: "stockduel" } }] as never);
    multi.mockImplementation(async ({ contracts }) => {
      if (contracts[0].functionName === "getSubregistry") {
        if (whole) throw Error("RPC offline");
        return [{ status: "failure", error: Error("unsupported pointer") }];
      }
      if (contracts[0].functionName === "getRecordId")
        return contracts.map(() => ({ status: "success", result: 0n }));
      if (contracts[0].address === network.addresses.ETHRegistry)
        return [state, child, shared];
      return [state, shared];
    });
    const result = await readConfiguration(
      client,
      client,
      "wallet.eth",
      network,
    );
    expect(result.subnames?.[0].registered).toBe(true);
    expect(result.subnames?.[0].subregistry).toBeUndefined();
    expect(result.subnames?.[0].subregistryError).toContain(
      whole ? "offline" : "unsupported",
    );
    expect(result.subnamesError).toBeUndefined();
  },
);
