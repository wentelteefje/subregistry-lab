import { describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionZeroDataError,
  toHex,
  zeroAddress,
  zeroHash,
  type PublicClient,
} from "viem";
import { namehash, packetToBytes } from "viem/ens";
import { getDeployment } from "../config/deployments";
import {
  decodeResolverName,
  discoverResolverNames,
  readNameResolution,
  type NameResolution,
} from "./resolverDiscovery";
const network = getDeployment(11155111),
  block = 12081440n;
const resolver = "0xeF882e399948Da185884f363167E2a105e502A79",
  other = "0x1111111111111111111111111111111111111111";
const parent = "paperseal-demo.eth",
  name = `time-q.${parent}`;
const link = (name: string, recordId = 21n) => ({
  args: { name: toHex(packetToBytes(name)), node: namehash(name), recordId },
});
const ok = (result: unknown) => ({ status: "success", result });
const failed = () => ({ status: "failure", error: Error("RPC unavailable") });
const resolution: NameResolution = {
  resolver,
  foundAt: parent,
  wildcard: false,
  permissioned: true,
  source: "linked",
  recordId: "1",
  defaultId: "0",
};
function fixture() {
  const readContract = vi.fn(async () => [resolver, namehash(name), 7n]);
  const multicall = vi.fn(async () => [ok(true), ok(21n), ok(0n), ok(true)]);
  const getLogs = vi.fn(async () => [link(name)]);
  const client = {
    readContract,
    multicall,
    getLogs,
    getCode: vi.fn(async () => undefined),
  } as unknown as PublicClient;
  return { client, readContract, multicall, getLogs };
}
describe("wildcard routing", () => {
  it("finds a resolver above an unregistered name and pins every call", async () => {
    const { client, readContract, multicall } = fixture();
    expect(
      await readNameResolution(client, name, network, block),
    ).toMatchObject({
      resolver,
      foundAt: parent,
      wildcard: true,
      source: "linked",
      recordId: "21",
      defaultId: "0",
    });
    expect(readContract.mock.calls[0]).toMatchObject([{ blockNumber: block }]);
    expect(multicall.mock.calls[0]).toMatchObject([{ blockNumber: block }]);
  });
  it.each([
    [0n, 5n, "default", "5"],
    [0n, 0n, "none", "0"],
    [21n, 5n, "linked", "21"],
  ])(
    "keeps whole-bundle fallback distinct (%s, %s)",
    async (direct, fallback, source, id) => {
      const { client, multicall } = fixture();
      multicall.mockResolvedValue([ok(true), ok(direct), ok(fallback)]);
      expect(
        await readNameResolution(client, name, network, block),
      ).toMatchObject({ source, recordId: id });
    },
  );
  it("does not call a custom resolver's failed ID probes an empty record", async () => {
    const { client, multicall } = fixture();
    multicall.mockResolvedValue([ok(false), failed(), failed()] as never);
    expect(
      await readNameResolution(client, name, network, block),
    ).toMatchObject({ permissioned: false, source: "unknown" });
  });
  it("reports capability and record-link failures visibly", async () => {
    const { client, multicall } = fixture();
    multicall.mockResolvedValueOnce([failed(), failed(), failed()] as never);
    expect(
      (await readNameResolution(client, name, network, block))?.error,
    ).toContain("capabilities");
    multicall.mockResolvedValueOnce([ok(true), failed(), ok(0n)] as never);
    expect(
      await readNameResolution(client, name, network, block),
    ).toMatchObject({
      source: "unknown",
      error: expect.stringContaining("could not be read"),
    });
  });
  it("does not invent a wildcard route when UR reports no resolver", async () => {
    const { client, readContract, multicall } = fixture();
    readContract.mockResolvedValue([zeroAddress, zeroHash, 0n]);
    expect(
      await readNameResolution(client, name, network, block),
    ).toBeUndefined();
    expect(multicall).not.toHaveBeenCalled();
  });
});
describe("resolver name discovery", () => {
  it("discovers full names without manufacturing registry labels; validates current links and routing", async () => {
    const { client, getLogs, multicall } = fixture();
    getLogs.mockResolvedValue([
      link(name),
      link(name, 22n),
      link(`unlink.${parent}`, 0n),
      link(`shadowed.${parent}`),
      link(`token.${parent}`),
      link("outside.eth"),
    ]);
    multicall.mockResolvedValue([
      ok(22n),
      ok([resolver, zeroHash, 7n]),
      ok(0n),
      ok([resolver, zeroHash, 7n]),
      ok(9n),
      ok([other, zeroHash, 0n]),
    ]);
    const result = await discoverResolverNames(
      client,
      client,
      parent,
      resolution,
      network,
      block,
      new Set([`token.${parent}`]),
    );
    expect(result).toEqual({
      names: [{ name, resolver, recordId: "22" }],
      error: undefined,
    });
    expect(getLogs.mock.calls[0]).toMatchObject([
      { fromBlock: BigInt(network.factoryDeployBlock), toBlock: block },
    ]);
    expect(multicall.mock.calls[0]).toMatchObject([
      { blockNumber: block, contracts: expect.any(Array) },
    ]);
  });
  it("shows incomplete discovery instead of silently reporting no names on RPC failure", async () => {
    const { client, getLogs } = fixture();
    getLogs.mockRejectedValue(Error("429 rate limit"));
    const result = await discoverResolverNames(
      client,
      client,
      parent,
      resolution,
      network,
      block,
      new Set(),
    );
    expect(result.names).toEqual([]);
    expect(result.error).toContain("incomplete");
    expect(result.error).toContain("rate limit");
  });
  it("retains verified names when another current-state probe fails", async () => {
    const { client, getLogs, multicall } = fixture();
    getLogs.mockResolvedValue([link(name), link(`failed.${parent}`)]);
    multicall.mockResolvedValue([
      ok(21n),
      ok([resolver, zeroHash, 7n]),
      ok(1n),
      failed(),
    ] as never);
    const result = await discoverResolverNames(
      client,
      client,
      parent,
      resolution,
      network,
      block,
      new Set(),
    );
    expect(result.names).toHaveLength(1);
    expect(result.error).toContain(`failed.${parent}`);
  });
  it("validates DNS bytes and namehashes instead of trusting arbitrary emitted names", async () => {
    const { client, getLogs, multicall } = fixture();
    getLogs.mockResolvedValue([
      { args: { ...link(name).args, node: zeroHash } },
      { args: { ...link(name).args, name: "0x0178" } },
    ]);
    const result = await discoverResolverNames(
      client,
      client,
      parent,
      resolution,
      network,
      block,
      new Set(),
    );
    expect(result.error).toContain("2 resolver name events");
    expect(multicall).not.toHaveBeenCalled();
    expect(decodeResolverName(toHex(packetToBytes(name)))).toBe(name);
    for (const value of [
      "0x0178",
      "0x01780000",
      "0x03612e6200",
      "0x01ff00",
    ] as const)
      expect(() => decodeResolverName(value)).toThrow();
  });
  it("propagates cancellation without turning it into an empty successful list", async () => {
    const { client, getLogs, multicall } = fixture();
    const controller = new AbortController();
    getLogs.mockImplementation(async () => {
      controller.abort();
      return [link(name)];
    });
    await expect(
      discoverResolverNames(
        client,
        client,
        parent,
        resolution,
        network,
        block,
        new Set(),
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(multicall).not.toHaveBeenCalled();
  });
});

it("warns about resolvers that predate the scan boundary or cannot verify it", async () => {
  const { client, multicall } = fixture();
  vi.mocked(client.getCode).mockResolvedValue("0x1234");
  multicall.mockResolvedValue([ok(21n), ok([resolver, zeroHash, 7n])]);
  expect(
    (
      await discoverResolverNames(
        client,
        client,
        parent,
        resolution,
        network,
        block,
        new Set(),
      )
    ).error,
  ).toContain("predates");
  vi.mocked(client.getCode).mockRejectedValue(
    Error("historical state unavailable"),
  );
  expect(
    (
      await discoverResolverNames(
        client,
        client,
        parent,
        resolution,
        network,
        block,
        new Set(),
      )
    ).error,
  ).toContain("Earlier names may be missing");
});

it("ignores valid default-bundle Linked events without a malformed-name warning", async () => {
  const { client, getLogs, multicall } = fixture();
  getLogs.mockResolvedValue([
    { args: { name: "0x00", node: zeroHash, recordId: 1n } },
  ]);
  expect(
    await discoverResolverNames(
      client,
      client,
      parent,
      resolution,
      network,
      block,
      new Set(),
    ),
  ).toEqual({ names: [], error: undefined });
  expect(multicall).not.toHaveBeenCalled();
});

it("reports deterministic unsupported ERC165 probes without a retryable RPC error", async () => {
  const { client, multicall } = fixture();
  const error = new BaseError("not implemented", {
    cause: new ContractFunctionZeroDataError({
      functionName: "supportsInterface",
    }),
  });
  multicall.mockResolvedValue([
    { status: "failure", error },
    failed(),
    failed(),
    ok(false),
  ] as never);
  expect(await readNameResolution(client, name, network, block)).toMatchObject({
    source: "unknown",
    permissioned: false,
    wildcardSupported: false,
  });
  expect(
    (await readNameResolution(client, name, network, block))?.error,
  ).toBeUndefined();
});
