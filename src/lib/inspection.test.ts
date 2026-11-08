import { describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  encodeEventTopics,
  parseAbi,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import { packetToBytes } from "viem/ens";
import { getDeployment } from "../config/deployments";
import { resolverInspectionAbi } from "../config/abis";
import {
  candidateProfiles,
  inspectScan,
  profileAbi,
  readInspection,
  readProfile,
  recordSource,
  type InspectionClient,
} from "./inspection";
const ok = (value: bigint) => ({ ok: true as const, value });
const address = "0x1111111111111111111111111111111111111111" as const;
const owner = "0x2222222222222222222222222222222222222222" as const;
const network = getDeployment(11155111);
const head = BigInt(network.factoryDeployBlock) + 100n;
const implementation =
  `0x${network.addresses.PermissionedResolverImpl.slice(2).padStart(64, "0")}` as Hex;
function client(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    rpc: {
      getBlockNumber: vi.fn(async () => head),
      getStorageAt: vi.fn(async () => implementation),
      getLogs: vi.fn(async () => []),
      request: vi.fn(async () => []),
      readContract: vi.fn(async (params: Record<string, unknown>) => {
        calls.push(params);
        if (params.functionName === "getRecordId") return 0n;
        if (params.functionName === "getState")
          return {
            status: 2,
            expiry: 1234n,
            latestOwner: owner,
            tokenId: 7n,
            resource: 9n,
          };
        if (
          params.functionName === "roles" ||
          params.functionName === "roleCount"
        )
          return 17n;
        if (
          params.functionName === "getResolver" ||
          params.functionName === "getSubregistry"
        )
          return zeroAddress;
        throw new Error("unhandled read");
      }),
      ...overrides,
    } as unknown as InspectionClient,
  };
}
describe("inspection read semantics", () => {
  it("uses a name-specific bundle as a whole, without per-field default fallback", () => {
    expect(recordSource(ok(3n), ok(8n))).toEqual({
      source: "direct",
      recordId: 3n,
    });
    expect(recordSource(ok(0n), ok(8n))).toEqual({
      source: "default",
      recordId: 8n,
    });
    expect(recordSource(ok(0n), ok(0n))).toEqual({
      source: "none",
      recordId: 0n,
    });
    expect(recordSource({ ok: false, error: "offline" }, ok(8n))).toEqual({
      source: "unavailable",
    });
    expect(recordSource(ok(0n), { ok: false, error: "offline" })).toEqual({
      source: "unavailable",
    });
  });
  it("reads tuple ownership and role scopes from a labelhash at a single block", async () => {
    const { rpc, calls } = client();
    const result = await readInspection(
      rpc,
      { kind: "label", registry: address, label: "greg" },
      11155111,
      owner,
    );
    expect(result.state).toMatchObject({
      ok: true,
      value: { latestOwner: owner, tokenId: 7n },
    });
    expect(calls.every((call) => call.blockNumber === head)).toBe(true);
    const roles = calls.filter((call) => call.functionName === "roles");
    expect(roles.some((call) => (call.args as bigint[])[0] === 0n)).toBe(true);
    expect(roles.some((call) => (call.args as bigint[])[0] > 0n)).toBe(true);
  });
  it("does not scan logs or probe records after proving both record links are zero", async () => {
    const { rpc } = client();
    const result = await readInspection(
      rpc,
      { kind: "name", resolver: address, name: "greg.lab.eth" },
      11155111,
    );
    expect(result.source).toBe("none");
    expect(result.records).toEqual([]);
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });
  it("does not call an unknown resolver an empty PermissionedResolver", async () => {
    const { rpc } = client({ getStorageAt: vi.fn(async () => undefined) });
    const result = await readInspection(
      rpc,
      { kind: "name", resolver: address, name: "greg.lab.eth" },
      11155111,
    );
    expect(result.compatible).toBe(false);
    expect(result.history?.complete).toBe(false);
    expect(result.records?.every((record) => record.error)).toBe(true);
  });
  it("confirms event-discovered custom keys through current resolver state", async () => {
    const args = {
      recordId: 1n,
      keyHash: "com.custom",
      key: "com.custom",
      value: "old value",
    };
    const topics = encodeEventTopics({
      abi: resolverInspectionAbi,
      eventName: "TextUpdated",
      args,
    });
    const log = {
      address,
      blockNumber: head,
      logIndex: 0,
      data: encodeAbiParameters(
        [{ type: "string" }, { type: "string" }],
        [args.key, args.value],
      ),
      topics,
    };
    const read = vi.fn(async (params: Record<string, unknown>) => {
      if (params.functionName === "getRecordId")
        return (params.args as string[])[0] === `0x${"0".repeat(64)}` ? 0n : 1n;
      const payload = (params.args as Hex[])[1];
      const decoded = decodeFunctionData({ abi: profileAbi, data: payload });
      if (decoded.functionName === "hasAddr")
        return encodeFunctionResult({
          abi: profileAbi,
          functionName: "hasAddr",
          result: false,
        });
      if (decoded.functionName === "text")
        return encodeFunctionResult({
          abi: profileAbi,
          functionName: "text",
          result: decoded.args[1] === "com.custom" ? "current value" : "",
        });
      if (decoded.functionName === "name")
        return encodeFunctionResult({
          abi: profileAbi,
          functionName: "name",
          result: "",
        });
      return encodeFunctionResult({
        abi: profileAbi,
        functionName: "contenthash",
        result: "0x",
      });
    });
    const { rpc } = client({
      readContract: read,
      getLogs: vi.fn(async () => [
        { blockNumber: BigInt(network.factoryDeployBlock) + 1n },
      ]),
      request: vi.fn(async () => [log]),
    });
    const result = await readInspection(
      rpc,
      { kind: "name", resolver: address, name: "greg.lab.eth" },
      11155111,
    );
    expect(result.history?.complete).toBe(true);
    expect(rpc.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "eth_getLogs",
        params: [
          expect.objectContaining({
            topics: [expect.any(Array), `0x${"0".repeat(63)}1`],
          }),
        ],
      }),
    );
    expect(
      result.records?.find((record) => record.profile.key === "com.custom")
        ?.value,
    ).toBe("current value");
    expect(
      read.mock.calls.every(([params]) => params.blockNumber === head),
    ).toBe(true);
  });
  it("does not mistake a default EVM address for an explicitly set ETH record", async () => {
    const { rpc } = client({
      readContract: vi.fn(async () =>
        encodeFunctionResult({
          abi: profileAbi,
          functionName: "hasAddr",
          result: false,
        }),
      ),
    });
    const result = await readProfile(
      rpc,
      address,
      "greg.lab.eth",
      { kind: "address", key: "60" },
      head,
    );
    expect(result.unset).toBe(true);
    expect(rpc.readContract).toHaveBeenCalledTimes(1);
  });
  it("encodes DNS full names inside resolve, and treats an emptied text value as unset", async () => {
    const read = vi.fn(async () =>
      encodeFunctionResult({
        abi: profileAbi,
        functionName: "text",
        result: "",
      }),
    );
    const { rpc } = client({ readContract: read });
    const result = await readProfile(
      rpc,
      address,
      "greg.lab.eth",
      { kind: "text", key: "url" },
      head,
    );
    expect(result.unset).toBe(true);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        address,
        functionName: "resolve",
        args: [toHex(packetToBytes("greg.lab.eth")), expect.any(String)],
        blockNumber: head,
      }),
    );
  });
  it("keeps keys scoped to the effective record and remembers explicit interface deletion", () => {
    const profiles = candidateProfiles(
      [
        { eventName: "TextUpdated", args: { recordId: 4n, key: "secret" } },
        { eventName: "TextUpdated", args: { recordId: 2n, key: "custom" } },
        {
          eventName: "InterfaceUpdated",
          args: { recordId: 2n, interfaceId: "0x01ffc9a7", implementer: owner },
        },
        {
          eventName: "InterfaceUpdated",
          args: {
            recordId: 2n,
            interfaceId: "0x01ffc9a7",
            implementer: zeroAddress,
          },
        },
      ],
      2n,
    );
    expect(profiles).toEqual([
      { kind: "text", key: "custom" },
      { kind: "interface", key: "0x01ffc9a7", explicitInterface: zeroAddress },
    ]);
  });
  it("marks a resolved interface as derived after its explicit implementer was cleared", async () => {
    const { rpc } = client({
      readContract: vi.fn(async () =>
        encodeFunctionResult({
          abi: profileAbi,
          functionName: "interfaceImplementer",
          result: owner,
        }),
      ),
    });
    const result = await readProfile(
      rpc,
      address,
      "greg.lab.eth",
      { kind: "interface", key: "0x01ffc9a7", explicitInterface: zeroAddress },
      head,
    );
    expect(result.value).toBe(owner);
    expect(result.derived).toBe(true);
    expect(result.unset).toBe(false);
  });
  it("uses the standard profile selectors only inside the resolver envelope", () => {
    expect(
      encodeFunctionResult({
        abi: parseAbi(["function text(bytes32,string) view returns(string)"]),
        functionName: "text",
        result: "value",
      }),
    ).toMatch(/^0x/);
    const payload = encodeFunctionData({
      abi: profileAbi,
      functionName: "addr",
      args: [`0x${"0".repeat(64)}`, 60n],
    });
    expect(payload.slice(0, 10)).toBe("0xf1cb7e06");
  });
});
describe("bounded history scans", () => {
  it("retains successful ranges and flags incomplete history", async () => {
    const read = vi.fn(async (from: bigint, to: bigint) => {
      if (to - from > 499n || from >= 500n)
        throw Error("block range limit exceeded");
      return [from];
    });
    const result = await inspectScan(read, 0n, 1000n);
    expect(result.logs).toEqual([0n]);
    expect(result.complete).toBe(false);
    expect(result.through).toBe(499n);
  });
  it("chunks a factory range rejected by the RPC and stops once a proxy is found", async () => {
    const read = vi.fn(async (from: bigint, to: bigint) => {
      if (to - from > 9998n) throw Error("block range limit exceeded");
      return from === 9999n ? [{ blockNumber: 12000n }] : [];
    });
    const result = await inspectScan(read, 0n, 50000n, undefined, true);
    expect(result.logs).toEqual([{ blockNumber: 12000n }]);
    expect(read.mock.calls).toEqual([
      [0n, 50000n],
      [0n, 9998n],
      [9999n, 19997n],
    ]);
  });
  it("stops when the query is cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const read = vi.fn();
    await expect(inspectScan(read, 0n, 100n, abort.signal)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});

it("does not retry throttled resolver-history ranges in smaller chunks", async () => {
  const read = vi.fn(async () => {
    throw Error("429 rate limit exceeded");
  });
  const result = await inspectScan(read, 1n, 100000n);
  expect(result.complete).toBe(false);
  expect(read).toHaveBeenCalledTimes(1);
});
