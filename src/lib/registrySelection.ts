import { registryHistoryKey, type LabState } from "../state/labSession";
import { isAddress, decodeFunctionData, type Address } from "viem";
import type { Deployment } from "../config/deployments";
import { registryAbi } from "../config/abis";
import { labelhashId } from "./names";
import type { SessionData, StepState, LabAction } from "../state/labSession";

/** Recover the selected registry from the actual saved relink calldata. */
export function relinkTarget(
  step: StepState | undefined,
  parentLabel: string,
  network: Deployment,
): Address | undefined {
  if (
    step?.transaction?.to?.toLowerCase() !==
    network.addresses.ETHRegistry.toLowerCase()
  )
    return;
  try {
    const call = decodeFunctionData({
      abi: registryAbi,
      data: step.transaction.input,
    });
    if (
      call.functionName === "setSubregistry" &&
      call.args[0] === labelhashId(parentLabel)
    )
      return call.args[1];
  } catch {
    /* An older journal may lack its original request. */
  }
}

/** Receipt-confirmed local deployments remain discoverable when the log RPC fails. */
export function confirmedRegistryDeployments(
  sessions: SessionData[],
  wallet: string,
  chainId: number,
) {
  return sessions
    .filter((s) => s.chainId === chainId && s.wallet === wallet.toLowerCase())
    .flatMap((s) => {
      const step = s.sequences.setup?.["deploy-registry"];
      return step?.confirmed &&
        !step.reverted &&
        !step.cancelled &&
        step.context?.userRegistry &&
        step.blockNumber
        ? [
            {
              address: step.context.userRegistry,
              blockNumber: BigInt(step.blockNumber),
            },
          ]
        : [];
    });
}

export function recoveredRegistryAdoption(
  step: StepState,
  parentLabel: string,
  network: Deployment,
): LabAction | undefined {
  if (!step.confirmed || step.reverted || step.cancelled) return;
  const registry = relinkTarget(step, parentLabel, network);
  if (registry)
    return {
      type: "adopt-registry",
      registry,
      deployBlock: step.registryDeployBlock
        ? BigInt(step.registryDeployBlock)
        : undefined,
    };
}

export function rememberedRegistries(
  state: LabState,
  wallet: string,
  chainId: number,
) {
  const entries =
    state.registryHistory?.[registryHistoryKey(wallet, chainId)] ?? {};
  return Object.entries(entries).flatMap(([address, entry]) =>
    isAddress(address, { strict: false })
      ? [
          {
            address: address as Address,
            blockNumber:
              typeof entry?.deployBlock === "string" &&
              /^\d+$/.test(entry.deployBlock)
                ? BigInt(entry.deployBlock)
                : undefined,
          },
        ]
      : [],
  );
}

/** All restore paths check the target before asking the wallet to sign. */
export async function verifyRestoreTarget(
  client: Pick<import("viem").PublicClient, "readContract">,
  registry: Address,
  parentLabel: string,
  wallet: Address,
  network: Deployment,
) {
  const [parent, label] = await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "getParent",
  });
  if (parent.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
    if (
      parent.toLowerCase() !== network.addresses.ETHRegistry.toLowerCase() ||
      label !== parentLabel
    )
      throw Error(
        "This registry records a different parent name. It was not re-linked.",
      );
  } else {
    const controls = await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "hasRootRoles",
      args: [1n << 8n, wallet],
    });
    if (controls !== true)
      throw Error(
        "This registry has no parent metadata and this wallet cannot configure its parent. It was not re-linked.",
      );
  }
}
