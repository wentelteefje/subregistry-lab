import { publicRpcTransport } from "../lib/rpcPool";
/** Block-pinned, registry-scoped reads. A failed scan is never an empty registry. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { createPublicClient, type Address } from "viem";
import { useDeployment } from "./useDeployment";
import { readRegistryState } from "../lib/readRegistryState";
export { readRegistryState, type Subname } from "../lib/readRegistryState";

export function useRegistryState(
  registry?: Address,
  fromBlock?: bigint,
  refreshVersion = 0,
) {
  const network = useDeployment();
  const client = usePublicClient({ chainId: network.id });
  const scanClient = useMemo(
    () =>
      createPublicClient({
        chain: network.chain,
        transport: publicRpcTransport(network.id),
      }),
    [network],
  );
  const query = useQuery({
    queryKey: [
      "registry-state",
      network.id,
      registry?.toLowerCase(),
      fromBlock?.toString(),
      refreshVersion,
    ],
    enabled: Boolean(registry && client),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      readRegistryState(
        client!,
        scanClient,
        registry!,
        fromBlock ?? BigInt(network.factoryDeployBlock),
        signal,
      ),
  });
  return {
    subnames: query.data ?? [],
    loading: Boolean(
      registry && client && (query.isPending || query.isFetching),
    ),
    error: query.error?.message,
    refresh: () => void query.refetch(),
  };
}
