import { publicRpcTransport } from "../lib/rpcPool";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { createPublicClient, type Address } from "viem";
import { useDeployment } from "./useDeployment";
import { discoverRegistrar } from "../lib/discoverRegistrar";
export function useRegistrarDiscovery(
  registry?: Address,
  fromBlock?: bigint,
  cached?: Address,
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
      "registrar-discovery",
      network.id,
      registry?.toLowerCase(),
      fromBlock?.toString(),
      cached?.toLowerCase(),
    ],
    enabled: Boolean(registry && client),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      discoverRegistrar(
        client!,
        scanClient,
        registry!,
        network,
        fromBlock,
        cached,
        signal,
      ),
  });
  return {
    registrar: query.data ?? undefined,
    loading: Boolean(
      registry && client && (query.isPending || query.isFetching),
    ),
    error: query.error?.message,
  };
}
