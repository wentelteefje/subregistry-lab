/** Resolver routing and name discovery are independent of registry membership. */
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  hexToBytes,
  parseAbi,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { namehash, normalize, packetToBytes } from "viem/ens";
import type { Deployment } from "../config/deployments";
import { resolverInspectionAbi } from "../config/abis";
import { errorSummary } from "./errors";
import { scanDetailed } from "./scan";

export const routingAbi = parseAbi([
  "function findResolver(bytes name) view returns (address resolver,bytes32 node,uint256 offset)",
]);
export const PERMISSIONED_RESOLVER_INTERFACE = "0x8c2427cc";
export type NameResolution = {
  resolver: Address;
  foundAt: string;
  wildcard: boolean;
  wildcardSupported?: boolean;
  permissioned: boolean;
  source: "linked" | "default" | "none" | "unknown";
  recordId?: string;
  defaultId?: string;
  error?: string;
};
export type ResolverName = {
  name: string;
  resolver: Address;
  recordId: string;
};

/** Reject compressed, malformed, ambiguous and non-normalized DNS names. */
export function decodeResolverName(hex: Hex): string {
  const bytes = hexToBytes(hex),
    labels: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (!length) {
      if (offset !== bytes.length) throw Error("Trailing DNS bytes");
      const name = labels.join(".");
      if (
        name &&
        (normalize(name) !== name ||
          toHex(packetToBytes(name)) !== hex.toLowerCase())
      )
        throw Error("Invalid DNS name");
      return name;
    }
    if (offset + length >= bytes.length) throw Error("Invalid DNS label");
    labels.push(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.slice(offset, offset + length),
      ),
    );
    offset += length;
  }
  throw Error("Missing DNS terminator");
}

export async function readNameResolution(
  client: PublicClient,
  name: string,
  network: Deployment,
  block: bigint,
): Promise<NameResolution | undefined> {
  const dns = toHex(packetToBytes(name));
  const [resolver, , rawOffset] = await client.readContract({
    address: network.addresses.UniversalResolverV2,
    abi: routingAbi,
    functionName: "findResolver",
    args: [dns],
    blockNumber: block,
  });
  if (resolver.toLowerCase() === zeroAddress) return;
  const offset = Number(rawOffset);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= hexToBytes(dns).length
  )
    throw Error("Invalid resolver routing offset");
  const foundAt = decodeResolverName(toHex(hexToBytes(dns).slice(offset)));
  const result: NameResolution = {
    resolver,
    foundAt,
    wildcard: offset > 0,
    permissioned: false,
    source: "unknown",
  };
  const probes = await client.multicall({
    allowFailure: true,
    blockNumber: block,
    contracts: [
      {
        address: resolver,
        abi: resolverInspectionAbi,
        functionName: "supportsInterface",
        args: [PERMISSIONED_RESOLVER_INTERFACE],
      },
      {
        address: resolver,
        abi: resolverInspectionAbi,
        functionName: "getRecordId",
        args: [namehash(name)],
      },
      {
        address: resolver,
        abi: resolverInspectionAbi,
        functionName: "getRecordId",
        args: [zeroHash],
      },
      {
        address: resolver,
        abi: resolverInspectionAbi,
        functionName: "supportsInterface",
        args: ["0x9061b923"],
      },
    ],
  });
  result.wildcardSupported =
    probes[3]?.status === "success" ? probes[3].result === true : undefined;
  if (probes[0].status !== "success") {
    if (
      probes[0].error instanceof BaseError &&
      probes[0].error.walk(
        (error) =>
          error instanceof ContractFunctionRevertedError ||
          error instanceof ContractFunctionZeroDataError,
      )
    )
      return result;
    result.error = `Resolver capabilities could not be read. ${errorSummary(probes[0].error)}`;
    return result;
  }
  result.permissioned = probes[0].result === true;
  if (!result.permissioned) return result;
  if (probes[1].status !== "success" || probes[2].status !== "success") {
    result.error =
      "The resolver's name-specific or default record link could not be read.";
    return result;
  }
  const direct = probes[1].result,
    fallback = probes[2].result;
  result.defaultId = String(fallback);
  result.recordId = String(direct || fallback);
  result.source = direct ? "linked" : fallback ? "default" : "none";
  return result;
}

export async function discoverResolverNames(
  client: PublicClient,
  scanClient: PublicClient,
  parent: string,
  resolution: NameResolution,
  network: Deployment,
  block: bigint,
  registeredNames: Set<string>,
  signal?: AbortSignal,
): Promise<{ names: ResolverName[]; error?: string }> {
  const address = resolution.resolver;
  const event = resolverInspectionAbi.find(
    (entry) => entry.type === "event" && entry.name === "Linked",
  )!;
  const notes: string[] = [];
  const from = BigInt(network.factoryDeployBlock);
  if (from > block)
    return {
      names: [],
      error: "This snapshot predates the configured deployment history.",
    };
  try {
    const previousCode = await client.getCode({
      address,
      blockNumber: from - 1n,
    });
    if (previousCode && previousCode !== "0x")
      notes.push(
        "This resolver predates the current factory. Earlier resolver name history has not been scanned; the list may be incomplete.",
      );
  } catch (error) {
    signal?.throwIfAborted();
    notes.push(
      `The resolver's earlier history boundary could not be checked. Earlier names may be missing. ${errorSummary(error)}`,
    );
  }
  // Avoid spending the bounded scan budget on millions of pre-deployment blocks.
  const scan = await scanDetailed(
    (fromBlock, toBlock) =>
      scanClient.getLogs({ address, event, fromBlock, toBlock }),
    from,
    block,
    () => Boolean(signal?.aborted),
    false,
    96,
    `${network.deploymentSet}:resolver-links:${address.toLowerCase()}:${from}`,
  );
  signal?.throwIfAborted();
  if (!scan.complete)
    notes.push(
      `Resolver name history is incomplete. ${scan.note ?? "Refresh to resume discovery."}`,
    );
  const candidates = new Map<string, string>();
  let invalid = 0,
    limited = false;
  for (const log of scan.logs) {
    try {
      const { name: dns, node } = log.args;
      if (typeof dns !== "string" || typeof node !== "string")
        throw Error("Undecoded Linked event");
      const name = decodeResolverName(dns);
      if (!name && node.toLowerCase() === zeroHash) continue;
      if (!name || namehash(name) !== node.toLowerCase())
        throw Error("Namehash mismatch");
      if (!name.endsWith(`.${parent}`) || registeredNames.has(name)) continue;
      if (candidates.size >= 500 && !candidates.has(node)) {
        limited = true;
        continue;
      }
      candidates.set(node, name);
    } catch {
      invalid++;
    }
  }
  if (invalid)
    notes.push(
      `${invalid} resolver name events were skipped because their names are unsupported or could not be validated.`,
    );
  if (limited)
    notes.push(
      "Resolver discovery is limited to 500 candidate names. Inspect a more specific parent.",
    );
  const names: ResolverName[] = [];
  const entries = [...candidates.entries()];
  for (let offset = 0; offset < entries.length; offset += 25) {
    signal?.throwIfAborted();
    const batch = entries.slice(offset, offset + 25);
    try {
      // History supplies candidates only: current links and UR routing decide
      // whether each name is still served here (including child overrides).
      const values = await client.multicall({
        allowFailure: true,
        blockNumber: block,
        batchSize: 0,
        contracts: batch.flatMap(([node, name]) => [
          {
            address,
            abi: resolverInspectionAbi,
            functionName: "getRecordId" as const,
            args: [node as Hex],
          },
          {
            address: network.addresses.UniversalResolverV2,
            abi: routingAbi,
            functionName: "findResolver" as const,
            args: [toHex(packetToBytes(name))],
          },
        ]),
      });
      batch.forEach(([, name], index) => {
        const record = values[index * 2],
          route = values[index * 2 + 1];
        if (record.status !== "success" || route.status !== "success") {
          notes.push(
            `Current routing or record link could not be verified for ${name}.`,
          );
          return;
        }
        const id = record.result as bigint;
        const [resolver] = route.result as readonly [Address, Hex, bigint];
        if (id !== 0n && resolver.toLowerCase() === address.toLowerCase())
          names.push({ name, resolver: address, recordId: String(id) });
      });
    } catch (error) {
      signal?.throwIfAborted();
      notes.push(
        `Resolver names could not all be verified. ${errorSummary(error)}`,
      );
      break;
    }
  }
  return {
    names: names.sort((a, b) => a.name.localeCompare(b.name)),
    error: notes.length ? [...new Set(notes)].slice(0, 4).join(" ") : undefined,
  };
}
