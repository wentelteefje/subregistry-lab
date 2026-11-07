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
        return {
          ...result,
          status: "unsupported-registry",
          detail: errorSummary(error),
        };
      throw error;
    }
    if (state.status === 0)
      return {
        ...result,
        status: "unregistered",
        state,
        effectiveResolver: resolver,
        resolverSource,
      };
    if (pointer(ownResolver)) {
      resolver = ownResolver;
      resolverSource = atName;
    }
    if (index < labels.length - 1) {
      if (!pointer(subregistry))
        return {
          ...result,
          status: "no-registry",
          state,
          effectiveResolver: resolver,
          resolverSource,
        };
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
          (message) => { result.subnamesError = [result.subnamesError, message].filter(Boolean).join(" "); },
        );
      } catch (error) {
        signal?.throwIfAborted();
        result.subnamesError = errorSummary(error);
      }
      result.setup.subnames = (result.subnames ?? [])
        .filter((sub) => sub.registered || sub.status === 1)
        .map((sub) => ({
          label: sub.label,
          status: sub.status === 1 ? ("reserved" as const) : undefined,
          neverExpires: sub.neverExpires,
          resolver: sub.resolver,
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
  return result;
}
