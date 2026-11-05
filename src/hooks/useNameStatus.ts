/**
 * Live reads for the selected parent name: expiry, current subregistry and
 * resolver, and whether the connected account holds the roles needed to
 * (re)configure it. On-chain truth for the inspect step.
 */

import { useReadContracts } from "wagmi";
import { zeroAddress, type Abi, type Address } from "viem";
import { registryAbi } from "../config/abis";
import { useDeployment } from "./useDeployment";
import { labelhashId } from "../lib/names";
import { ROLE_SET_SUBREGISTRY } from "../lib/roles";

export type NameStatus = {
  loading: boolean;
  expiry?: bigint;
  owner?: Address;
  /** address(0) when none is set. */
  subregistry?: Address;
  hasSubregistry: boolean;
  resolver?: Address;
  /** Connected account may call setSubregistry on this name. */
  canConfigure: boolean;
  isOwner: boolean;
  refetch: () => void;
};

export function useNameStatus(parentLabel?: string, account?: Address): NameStatus {
  const network = useDeployment();
  const deployments = network.addresses;
  const anyId = parentLabel ? labelhashId(parentLabel) : undefined;
  const enabled = Boolean(parentLabel && account);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: enabled
      ? [
          {
            // status/expiry/latestOwner in one call (deployed registries
            // have no getOwner view)
            address: deployments.ETHRegistry,
            abi: registryAbi as Abi,
            functionName: "getState",
            args: [anyId!],
          },
          {
            address: deployments.ETHRegistry,
            abi: registryAbi as Abi,
            functionName: "getSubregistry",
            args: [parentLabel!],
          },
          {
            address: deployments.ETHRegistry,
            abi: registryAbi as Abi,
            functionName: "getResolver",
            args: [parentLabel!],
          },
          {
            address: deployments.ETHRegistry,
            abi: registryAbi as Abi,
            functionName: "getResource",
            args: [anyId!],
          },
        ]
      : [],
    query: { enabled },
  });

  const state = data?.[0]?.result as
    | { status: number; expiry: bigint; latestOwner: Address }
    | undefined;
  const expiry = state?.expiry;
  const owner = state?.latestOwner;
  const subregistry = data?.[1]?.result as Address | undefined;
  const resolver = data?.[2]?.result as Address | undefined;
  const resource = data?.[3]?.result as bigint | undefined;

  const isOwner = Boolean(
    owner && account && owner.toLowerCase() === account.toLowerCase(),
  );

  // The owner's roles move with the token on transfer (PermissionedRegistry
  // calls _transferRoles in its transfer hook), but third-party grants don't,
  // and roles can be revoked, so canConfigure always comes from a live
  // hasRoles read rather than being inferred from ownership.
  const { data: roleData, refetch: refetchRoles } = useReadContracts({
    contracts:
      enabled && resource !== undefined
        ? [
            {
              address: deployments.ETHRegistry,
              abi: registryAbi as Abi,
              functionName: "hasRoles",
              args: [resource, ROLE_SET_SUBREGISTRY, account!],
            },
          ]
        : [],
    query: { enabled: enabled && resource !== undefined },
  });
  const hasRoleDirectly = Boolean(roleData?.[0]?.result);

  return {
    loading: isLoading,
    expiry,
    owner,
    subregistry,
    hasSubregistry: Boolean(subregistry && subregistry !== zeroAddress),
    resolver,
    canConfigure: hasRoleDirectly,
    isOwner,
    refetch: () => { void refetch(); void refetchRoles(); },
  };
}
