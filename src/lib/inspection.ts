import { withRpcSignal } from "./rpcPool";
/** Read-only, block-pinned data for diagram inspectors. No wallet client is used. */
import {
  decodeEventLog,
  decodeFunctionResult,
  formatLog,
  padHex,
  toEventSelector,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  toHex,
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { scanDetailed, type ScanBudget } from "./scan";
import { namehash, packetToBytes } from "viem/ens";
import {
  registryAbi,
  resolverAbi,
  resolverInspectionAbi,
  verifiableFactoryAbi,
} from "../config/abis";
import { getDeployment } from "../config/deployments";
import type { InspectionTarget } from "../diagram/types";
import { labelhashId } from "./names";
import { errorSummary } from "./errors";

export type InspectionClient = Pick<
  PublicClient,
  "readContract" | "getBlockNumber" | "getStorageAt" | "getLogs" | "request"
>;
export type ReadValue<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
export type LabelState = {
  status: number;
  expiry: bigint;
  latestOwner: Address;
  tokenId: bigint;
  resource: bigint;
};
export type Profile = {
  kind:
    | "address"
    | "text"
    | "data"
    | "abi"
    | "interface"
    | "contenthash"
    | "name";
  key: string;
  explicitInterface?: Address;
};
export type InspectedRecord = {
  profile: Profile;
  value?: string;
  raw?: Hex;
  unset?: boolean;
  error?: string;
  derived?: boolean;
};
export type InspectionData = {
  target: InspectionTarget;
  block: bigint;
  implementation?: ReadValue<Address | undefined>;
  state?: ReadValue<LabelState>;
  resolver?: ReadValue<Address>;
  subregistry?: ReadValue<Address>;
  ownerRoles?: ReadValue<bigint>;
  ownerRootRoles?: ReadValue<bigint>;
  accountRoles?: ReadValue<bigint>;
  rootCounts?: ReadValue<bigint>;
  parent?: ReadValue<readonly [Address, string]>;
  emancipated?: ReadValue<boolean>;
  compatible?: boolean;
  directId?: ReadValue<bigint>;
  defaultId?: ReadValue<bigint>;
  source?: "direct" | "default" | "none" | "unavailable";
  recordId?: bigint;
  records?: InspectedRecord[];
  history?: { complete: boolean; from: bigint; through: bigint; note?: string };
};

// These signatures are payloads for resolve(bytes,bytes), not callable methods
// on PermissionedResolver. Every profile is decoded independently.
export const profileAbi = parseAbi([
  "function addr(bytes32 node,uint256 coinType) view returns (bytes)",
  "function hasAddr(bytes32 node,uint256 coinType) view returns (bool)",
  "function text(bytes32 node,string key) view returns (string)",
  "function data(bytes32 node,string key) view returns (bytes)",
  "function contenthash(bytes32 node) view returns (bytes)",
  "function name(bytes32 node) view returns (string)",
  "function ABI(bytes32 node,uint256 contentTypes) view returns (uint256,bytes)",
  "function interfaceImplementer(bytes32 node,bytes4 interfaceID) view returns (address)",
]);
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const commonProfiles: Profile[] = [
  { kind: "address", key: "60" },
  { kind: "address", key: "2147483648" },
  ...["avatar", "url", "description", "email"].map((key) => ({
    kind: "text" as const,
    key,
  })),
  { kind: "contenthash", key: "" },
  { kind: "name", key: "" },
];
export const profileKey = (profile: Profile) =>
  `${profile.kind}:${profile.key}`;
export function recordSource(
  direct: ReadValue<bigint>,
  fallback: ReadValue<bigint>,
) {
  if (!direct.ok) return { source: "unavailable" as const };
  if (direct.value !== 0n)
    return { source: "direct" as const, recordId: direct.value };
  if (!fallback.ok) return { source: "unavailable" as const };
  return fallback.value !== 0n
    ? { source: "default" as const, recordId: fallback.value }
    : { source: "none" as const, recordId: 0n };
}
function checkSignal(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

/** Keep successful chunks if a later range fails; never equate a failed scan to empty. */
export async function inspectScan<T>(
  fetchLogs: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  head: bigint,
  signal?: AbortSignal,
  stopWhenFound = false,
  budget?: ScanBudget,
  resumeKey?: string,
) {
  return scanDetailed(fetchLogs, from, head, () => Boolean(signal?.aborted), stopWhenFound, budget, resumeKey);
}

export function candidateProfiles(
  events: { eventName: string; args: Record<string, unknown> }[],
  recordId: bigint,
): Profile[] {
  const found = new Map<string, Profile>();
  for (const { eventName, args } of events) {
    if (args.recordId !== recordId) continue;
    let profile: Profile | undefined;
    if (eventName === "AddressUpdated")
      profile = { kind: "address", key: String(args.coinType) };
    if (eventName === "TextUpdated")
      profile = { kind: "text", key: String(args.key) };
    if (eventName === "DataUpdated")
      profile = { kind: "data", key: String(args.key) };
    if (eventName === "ABIUpdated")
      profile = { kind: "abi", key: String(args.contentType) };
    if (eventName === "InterfaceUpdated")
      profile = {
        kind: "interface",
        key: String(args.interfaceId),
        explicitInterface: args.implementer as Address,
      };
    if (eventName === "ContenthashUpdated")
      profile = { kind: "contenthash", key: "" };
    if (eventName === "NameUpdated") profile = { kind: "name", key: "" };
    if (profile) found.set(profileKey(profile), profile);
  }
  return [...found.values()];
}

export async function readProfile(
  client: InspectionClient,
  resolver: Address,
  name: string,
  profile: Profile,
  block: bigint,
): Promise<InspectedRecord> {
  const node = namehash(name);
  const call = async (
    functionName:
      | "addr"
      | "hasAddr"
      | "text"
      | "data"
      | "ABI"
      | "interfaceImplementer"
      | "contenthash"
      | "name",
    args: readonly unknown[],
  ) => {
    const payload = encodeFunctionData({
      abi: profileAbi as Abi,
      functionName,
      args,
    });
    const raw = await client.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "resolve",
      args: [toHex(packetToBytes(name)), payload],
      blockNumber: block,
    });
    return {
      value: decodeFunctionResult({
        abi: profileAbi as Abi,
        functionName,
        data: raw,
      }),
      raw,
    };
  };
  try {
    if (profile.kind === "address") {
      const exact = await call("hasAddr", [node, BigInt(profile.key)]);
      if (exact.value !== true) return { profile, unset: true, raw: exact.raw };
    }
    const functionName =
      profile.kind === "address"
        ? "addr"
        : profile.kind === "abi"
          ? "ABI"
          : profile.kind === "interface"
            ? "interfaceImplementer"
            : profile.kind;
    const args = [
      node,
      ...(["address", "abi"].includes(profile.kind)
        ? [BigInt(profile.key)]
        : ["text", "data", "interface"].includes(profile.kind)
          ? [profile.key]
          : []),
    ];
    const { value, raw } = await call(functionName, args);
    const decoded =
      profile.kind === "abi" ? (value as readonly [bigint, Hex])[1] : value;
    const unset = decoded === "" || decoded === "0x" || decoded === zeroAddress;
    return {
      profile,
      value: String(decoded),
      raw,
      unset,
      derived:
        profile.kind === "interface" &&
        (!profile.explicitInterface ||
          profile.explicitInterface.toLowerCase() === zeroAddress),
    };
  } catch (error) {
    return { profile, error: errorSummary(error) };
  }
}

// Successful creation lookups are shared across names in the same resolver.
// Weak client scope keeps tests, networks and independent runtimes isolated.
const creationBlocks = new WeakMap<object, Map<string, { block: bigint; expires: number }>>();
export async function readInspection(
  client: InspectionClient,
  target: InspectionTarget,
  chainId: number,
  account?: Address,
  signal?: AbortSignal,
  manualProfiles: Profile[] = [],
  pinnedBlock?: bigint,
): Promise<InspectionData> {
  const creationClient = client;
  client = withRpcSignal(client, signal);
  const budget = { remaining: 96, started: Date.now() };
  const network = getDeployment(chainId);
  const block = pinnedBlock ?? await client.getBlockNumber({ cacheTime: 0 });
  const address =
    target.kind === "label"
      ? target.registry
      : target.kind === "name"
        ? target.resolver
        : target.address;
  const read = async <T>(
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<ReadValue<T>> => {
    checkSignal(signal);
    try {
      return {
        ok: true,
        value: (await client.readContract({
          address,
          abi,
          functionName,
          args,
          blockNumber: block,
        })) as T,
      };
    } catch (error) {
      checkSignal(signal);
      return { ok: false, error: errorSummary(error) };
    }
  };
  const result: InspectionData = { target, block };
  if (target.kind === "label") {
    const anyId = labelhashId(target.label);
    const [state, resolver, subregistry] = await Promise.all([
      read<LabelState>(registryAbi, "getState", [anyId]),
      read<Address>(registryAbi, "getResolver", [target.label]),
      read<Address>(registryAbi, "getSubregistry", [target.label]),
    ]);
    Object.assign(result, { state, resolver, subregistry });
    if (state.ok && state.value.latestOwner !== zeroAddress) {
      [result.ownerRoles, result.ownerRootRoles] = await Promise.all([
        read<bigint>(registryAbi, "roles", [anyId, state.value.latestOwner]),
        read<bigint>(registryAbi, "roles", [0n, state.value.latestOwner]),
      ]);
    }
    if (account)
      result.accountRoles = await read<bigint>(registryAbi, "roles", [
        anyId,
        account,
      ]);
    return result;
  }
  try {
    const slot = await client.getStorageAt({
      address,
      slot: IMPLEMENTATION_SLOT,
      blockNumber: block,
    });
    const raw = slot && `0x${slot.slice(-40)}`;
    result.implementation = {
      ok: true,
      value:
        raw && isAddress(raw) && raw !== zeroAddress
          ? getAddress(raw)
          : undefined,
    };
  } catch (error) {
    result.implementation = { ok: false, error: errorSummary(error) };
  }
  if (target.kind === "registry") {
    [result.parent, result.emancipated, result.rootCounts] = await Promise.all([
      read<readonly [Address, string]>(registryAbi, "getParent"),
      read<boolean>(registryAbi, "isEmancipated"),
      read<bigint>(registryAbi, "roleCount", [0n]),
    ]);
    if (account)
      result.accountRoles = await read<bigint>(registryAbi, "roles", [
        0n,
        account,
      ]);
    return result;
  }
  // Event enumeration is tied to the verified, pinned implementation. Foreign
  // resolvers can still be probed but must not be called an empty known schema.
  result.compatible =
    result.implementation.ok &&
    result.implementation.value?.toLowerCase() ===
      network.addresses.PermissionedResolverImpl.toLowerCase();
  result.defaultId = await read<bigint>(resolverInspectionAbi, "getRecordId", [
    zeroHash,
  ]);
  if (target.kind === "resolver") {
    result.rootCounts = await read<bigint>(resolverInspectionAbi, "roleCount", [
      0n,
    ]);
    if (account)
      result.accountRoles = await read<bigint>(resolverInspectionAbi, "roles", [
        0n,
        account,
      ]);
    return result;
  }
  result.directId = await read<bigint>(resolverInspectionAbi, "getRecordId", [
    namehash(target.name),
  ]);
  Object.assign(result, recordSource(result.directId, result.defaultId));
  if (result.compatible && result.source === "none") {
    result.records = [];
    return result;
  }

  let profiles = [...commonProfiles, ...manualProfiles];
  if (result.compatible && result.recordId && result.recordId !== 0n) {
    const lower = BigInt(network.factoryDeployBlock);
    let from = lower,
      creationFound = false;
    const event = verifiableFactoryAbi.find(
      (entry) => entry.type === "event" && entry.name === "ProxyDeployed",
    )!;
    const creations = creationBlocks.get(creationClient) ?? new Map<string, { block: bigint; expires: number }>();
    creationBlocks.set(creationClient, creations);
    const creationKey = `${network.deploymentSet}:${address.toLowerCase()}`;
    const known = creations.get(creationKey);
    if (known && known.expires > Date.now() && known.block <= block) {
      from = known.block;
      creationFound = true;
    }
    try {
      const { logs: deployments } = creationFound ? { logs: [] } : await inspectScan(
        (fromBlock, toBlock) =>
          client.getLogs({
            address: network.addresses.VerifiableFactory,
            event,
            args: { proxyAddress: address },
            fromBlock,
            toBlock,
          }),
        lower,
        block,
        signal,
        true,
        budget,
        `${network.deploymentSet}:proxy:${address.toLowerCase()}`,
      );
      if (deployments.length && deployments[0].blockNumber !== null) {
        from = deployments[0].blockNumber;
        creationFound = true;
        if (creations.size >= 512) creations.delete(creations.keys().next().value!);
        creations.set(creationKey, { block: from, expires: Date.now() + (block - from >= 64n ? 30 * 60_000 : 60_000) });
      }
    } catch {
      checkSignal(signal);
    }
    const events = resolverInspectionAbi.filter(
      (entry) => entry.type === "event" && !["Linked"].includes(entry.name),
    );
    const scan = await inspectScan(
      (fromBlock, toBlock) =>
        client
          .request({
            method: "eth_getLogs",
            params: [
              {
                address,
                topics: [
                  events.map((event) => toEventSelector(event)),
                  padHex(toHex(result.recordId!)),
                ],
                fromBlock: toHex(fromBlock),
                toBlock: toHex(toBlock),
              },
            ],
          })
          .then((logs) => logs.map((log) => formatLog(log))),
      from,
      block,
      signal,
      false,
      budget,
      `${network.deploymentSet}:records:${address.toLowerCase()}:${result.recordId}:${from}`,
    );
    let undecodable = 0;
    const decoded = scan.logs
      .sort(
        (a, b) =>
          Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) ||
          (a.logIndex ?? 0) - (b.logIndex ?? 0),
      )
      .flatMap((log) => {
        try {
          const decoded = decodeEventLog({
            abi: resolverInspectionAbi,
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]],
          });
          return [
            {
              eventName: decoded.eventName,
              args: decoded.args as Record<string, unknown>,
            },
          ];
        } catch {
          undecodable++;
          return [];
        }
      });
    profiles = [...profiles, ...candidateProfiles(decoded, result.recordId)];
    result.history = {
      from,
      through: scan.through,
      complete: scan.complete && creationFound && undecodable === 0,
      note:
        ([scan.note, undecodable ? `${undecodable} history events could not be decoded.` : undefined].filter(Boolean).join(" ") || undefined) ??
        (!creationFound
          ? "The deployment block could not be confirmed. Earlier keys may be missing."
          : undefined),
    };
  } else {
    result.history = {
      from: BigInt(network.factoryDeployBlock),
      through: block,
      complete: false,
      note: result.compatible
        ? "The record link could not be read. Only common and manually requested profiles can be inspected."
        : "Resolver implementation is unrecognized. Only common and manually requested profiles can be inspected.",
    };
  }
  const unique = [
    ...new Map(
      profiles.map((profile) => [profileKey(profile), profile]),
    ).values(),
  ];
  result.records = [];
  for (let index = 0; index < unique.length; index += 3) {
    checkSignal(signal);
    result.records.push(
      ...(await Promise.all(
        unique
          .slice(index, index + 3)
          .map((profile) =>
            readProfile(client, address, target.name, profile, block),
          ),
      )),
    );
  }
  return result;
}
