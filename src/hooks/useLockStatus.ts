import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { registryAbi } from "../config/abis";
import { DANGEROUS_ROOT_BITMAP } from "../lib/presets";
import { ROLE_SET_SUBREGISTRY, adminOf } from "../lib/roles";
import { labelhashId } from "../lib/names";
import { useDeployment } from "./useDeployment";

/** One live definition for the diagram and the lock panel, including legacy capability detection. */
export function useLockStatus(registry?: Address, parentLabel?: string) {
  const network = useDeployment();
  const bitmap = ROLE_SET_SUBREGISTRY | adminOf(ROLE_SET_SUBREGISTRY);
  const { data, refetch, isPending } = useReadContracts({
    contracts:
      registry && parentLabel
        ? ([
            {
              address: registry,
              abi: registryAbi,
              functionName: "roleCount",
              args: [0n],
            },
            {
              address: registry,
              abi: registryAbi,
              functionName: "isEmancipated",
              args: [],
            },
            {
              address: network.addresses.ETHRegistry,
              abi: registryAbi,
              functionName: "roleCount",
              args: [labelhashId(parentLabel)],
            },
          ] as const)
        : [],
    query: { enabled: Boolean(registry && parentLabel) },
  });
  const roots = data?.[0]?.result;
  const links = data?.[2]?.result;
  return {
    supported:
      data?.[0]?.status === "success" && data?.[1]?.status === "success",
    loading: isPending,
    registryLocked:
      roots !== undefined &&
      (roots & (DANGEROUS_ROOT_BITMAP * 15n)) === 0n &&
      data?.[1]?.result === true,
    linkLocked: links !== undefined && (links & (bitmap * 15n)) === 0n,
    refetch,
  };
}
