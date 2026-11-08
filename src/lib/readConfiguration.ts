import { withRpcSignal } from "./rpcPool";
/** Read-only ENSv2 configuration inspection, independent of wallets and lab sessions. */
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { normalize, packetToBytes } from "viem/ens";
import type { Deployment } from "../config/deployments";
import { registryAbi } from "../config/abis";
import { readResolverRecords } from "./resolverRecords";
import {
  readNameResolution,
  type NameResolution,
  type ResolverName,
} from "./resolverDiscovery";
import { labelhashId } from "./names";
import type { LabelState } from "./inspection";
import { errorSummary } from "./errors";
import { readRegistryState, type Subname } from "./readRegistryState";
import type { SetupView } from "./diagramModel";

export function normalizeInspectionName(input: string): string {
  const text = input.trim().replace(/\.$/, "");
  if (text.toLowerCase() === "eth")
    throw Error("Enter a parent below .eth, for example wallet.eth.");
  if (!text) throw Error("Enter a parent name, for example wallet.eth.");
  let name: string;
  try {
    name = normalize(text.includes(".") ? text : `${text}.eth`);
  } catch {
    throw Error("Enter a valid ENS name.");
  }
  const labels = name.split(".");
  if (labels.length < 2 || labels.at(-1) !== "eth")
    throw Error("Enter a name ending in .eth.");
  if (labels.length > 10) throw Error("Inspect names with at most 10 labels.");
  if (
    labels.some(
      (label) =>
        !label ||
        /^\[0x/i.test(label) ||
        new TextEncoder().encode(label).length > 255,
    ) ||
    packetToBytes(name).length > 255
  )
    throw Error("This name is too long or contains an unsupported label.");
  return name;
}
export type ConfigurationSnapshot = {
  name: string;
  chainId: number;
  block: bigint;
  scanFrom: bigint;
  status:
    | "registered"
    | "reserved"
    | "unregistered"
    | "no-registry"
    | "unsupported-registry";
  atName: string;
  atRegistry: Address;
  state?: LabelState;
  childRegistry?: Address;
  directResolver?: Address;
  effectiveResolver?: Address;
  resolverSource?: string;
  subnames?: Subname[];
  subnamesError?: string;
  recordLinksError?: string;
  resolution?: NameResolution;
  resolutionError?: string;
  resolverNames?: ResolverName[];
  resolverNamesError?: string;
  detail?: string;
  setup: SetupView;
};
const pointer = (address: Address) =>
  address.toLowerCase() === zeroAddress ? undefined : address;

export async function readConfiguration(
  client: PublicClient,
  scanClient: PublicClient,
  name: string,
  network: Deployment,
  signal?: AbortSignal,
): Promise<ConfigurationSnapshot> {
  client = withRpcSignal(client, signal);
  scanClient = withRpcSignal(scanClient, signal);
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const labels = name.split(".").slice(0, -1).reverse();
  let registry: Address = network.addresses.ETHRegistry;
  let resolver: Address | undefined, resolverSource: string | undefined;
  const result: ConfigurationSnapshot = {
    name,
    chainId: network.id,
    block,
    scanFrom: BigInt(network.factoryDeployBlock),
    status: "registered",
    atName: name,
    atRegistry: registry,
    setup: { parentName: name, parentNote: "inspected name" },
  };
  const finish = async (snapshot: ConfigurationSnapshot) => {
    try {
      snapshot.resolution = await readNameResolution(
        client,
        name,
        network,
        block,
      );
      signal?.throwIfAborted();
      const resolution = snapshot.resolution;
      if (!resolution) return snapshot;
      snapshot.resolutionError = resolution.error;
      snapshot.effectiveResolver = resolution.resolver;
      snapshot.resolverSource = resolution.foundAt;
      if (
        snapshot.status === "no-registry" ||
        snapshot.status === "unregistered" ||
        snapshot.status === "unsupported-registry"
      ) {
        snapshot.setup = {
          parentName: name,
          parentNote:
            snapshot.status === "unsupported-registry"
              ? "registry interface unavailable"
              : "no registry entry",
          inheritedResolver: resolution.resolver,
          resolverAncestor: resolution.foundAt,
        };
      }
      const diagramResolver =
        snapshot.setup.resolver ?? snapshot.setup.inheritedResolver;
      if (
        diagramResolver &&
        diagramResolver.toLowerCase() !== resolution.resolver.toLowerCase()
      ) {
        snapshot.resolutionError =
          "Universal Resolver routing differs from the registry pointers shown. Resolver-linked names are listed separately and are not attached to this diagram.";
      }
      if (!resolution.permissioned) return snapshot;
      const records = (snapshot.setup.resolverRecords ??= {});
      const links = (records[resolution.resolver.toLowerCase()] ??= {});
      if (resolution.recordId !== undefined) {
        links[name] =
          resolution.source === "linked" ? resolution.recordId : "0";
        links[""] = resolution.defaultId ?? null;
      }
    } catch (error) {
      signal?.throwIfAborted();
      snapshot.resolutionError = errorSummary(error);
    }
    return snapshot;
  };
  for (let index = 0; index < labels.length; index++) {
    signal?.throwIfAborted();
    const label = labels[index],
      atName = `${labels
        .slice(0, index + 1)
        .reverse()
        .join(".")}.eth`;
    Object.assign(result, { atName, atRegistry: registry });
    let state: LabelState, subregistry: Address, ownResolver: Address;
    try {
      [state, subregistry, ownResolver] = (await client.multicall({
        allowFailure: false,
        blockNumber: block,
        contracts: [
          {
            address: registry,
            abi: registryAbi,
            functionName: "getState",
            args: [labelhashId(label)],
          },
          {
            address: registry,
            abi: registryAbi,
            functionName: "getSubregistry",
            args: [label],
          },
          {
            address: registry,
            abi: registryAbi,
            functionName: "getResolver",
            args: [label],
          },
        ],
      })) as [LabelState, Address, Address];
    } catch (error) {
      signal?.throwIfAborted();
      if (
        error instanceof BaseError &&
        error.walk(
          (e) =>
            e instanceof ContractFunctionRevertedError ||
            e instanceof ContractFunctionZeroDataError,
        )
      )
        return finish({
          ...result,
          status: "unsupported-registry",
          detail: errorSummary(error),
        });
      throw error;
    }
    if (state.status === 0)
      return finish({
        ...result,
        status: "unregistered",
        state,
        effectiveResolver: resolver,
        resolverSource,
      });
    if (pointer(ownResolver)) {
      resolver = ownResolver;
      resolverSource = atName;
    }
    if (index < labels.length - 1) {
      if (!pointer(subregistry))
        return finish({
          ...result,
          status: "no-registry",
          state,
          effectiveResolver: resolver,
          resolverSource,
        });
      registry = subregistry;
      continue;
    }
    Object.assign(result, {
      state,
      status: state.status === 1 ? "reserved" : "registered",
      childRegistry: pointer(subregistry),
      directResolver: pointer(ownResolver),
      effectiveResolver: resolver,
      resolverSource,
    });
    result.setup = {
      parentName: name,
      parentNote: state.status === 1 ? "reserved name" : "inspected name",
      parentOwner: state.latestOwner,
      userRegistry: pointer(subregistry),
      resolver: pointer(ownResolver),
      inheritedResolver: !pointer(ownResolver) ? resolver : undefined,
      resolverAncestor: resolverSource,
    };
    if (result.childRegistry) {
      try {
        await client.readContract({
          address: result.childRegistry,
          abi: registryAbi,
          functionName: "roleCount",
          args: [0n],
          blockNumber: block,
        });
        result.subnames = await readRegistryState(
          client,
          scanClient,
          result.childRegistry,
          result.scanFrom,
          signal,
          block,
          500,
          (message) => {
            result.subnamesError = [result.subnamesError, message]
              .filter(Boolean)
              .join(" ");
          },
        );
      } catch (error) {
        signal?.throwIfAborted();
        result.subnamesError = errorSummary(error);
      }
      // Only inspect pointers here; child registries are never scanned until
      // the user navigates into that label. Playground reads remain unchanged.
      const currentLabels = (result.subnames ?? []).filter(
        (sub) => sub.registered || sub.status === 1,
      );
      for (let offset = 0; offset < currentLabels.length; offset += 100) {
        signal?.throwIfAborted();
        const batch = currentLabels.slice(offset, offset + 100);
        try {
          const pointers = await client.multicall({
            allowFailure: true,
            blockNumber: block,
            batchSize: 0,
            contracts: batch.map((sub) => ({
              address: result.childRegistry!,
              abi: registryAbi,
              functionName: "getSubregistry" as const,
              args: [sub.label] as const,
            })),
          });
          batch.forEach((sub, index) => {
            const value = pointers[index];
            if (value.status === "success") sub.subregistry = value.result;
            else sub.subregistryError = errorSummary(value.error);
          });
        } catch (error) {
          signal?.throwIfAborted();
          batch.forEach((sub) => {
            sub.subregistryError = errorSummary(error);
          });
        }
      }
      result.setup.subnames = (result.subnames ?? [])
        .filter((sub) => sub.registered || sub.status === 1)
        .map((sub) => ({
          label: sub.label,
          status: sub.status === 1 ? ("reserved" as const) : undefined,
          neverExpires: sub.neverExpires,
          resolver: sub.resolver,
          childRegistry: Boolean(sub.subregistry && pointer(sub.subregistry)),
        }));
    } else result.subnames = [];
  }
  signal?.throwIfAborted();
  try {
    result.setup.resolverRecords = await readResolverRecords(
      client,
      { ...result.setup, subnames: result.setup.subnames?.slice(0, 25) },
      block,
    );
    if (
      Object.values(result.setup.resolverRecords).some((records) =>
        Object.values(records).includes(null),
      )
    )
      result.recordLinksError = "Some resolver record links could not be read.";
  } catch (error) {
    signal?.throwIfAborted();
    result.recordLinksError = errorSummary(error);
  }
  return finish(result);
}
