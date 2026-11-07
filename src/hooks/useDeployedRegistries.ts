import { withRpcSignal } from "../lib/rpcPool";
import { publicRpcTransport } from "../lib/rpcPool";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, type Address } from "viem";
import { scanRanges } from "../lib/scan";
import { verifiableFactoryAbi } from "../config/abis";
import { useDeployment } from "./useDeployment";
export type DeployedProxy = { address: Address; blockNumber: bigint };
export type DeployedRegistry = DeployedProxy;
const event = verifiableFactoryAbi.find(
  (e) => e.type === "event" && e.name === "ProxyDeployed",
)!;
export function useDeployedProxies(
  wallet?: Address,
  implementation?: Address,
  refreshVersion?: string,
) {
  const network = useDeployment();
  const client = useMemo(
    () =>
      createPublicClient({
        chain: network.chain,
        transport: publicRpcTransport(network.id),
      }),
    [network],
  );
  const query = useQuery({
    queryKey: [
      "deployed-proxies",
      network.id,
      wallet?.toLowerCase(),
      implementation?.toLowerCase(),
      refreshVersion,
    ],
    enabled: Boolean(wallet && implementation),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const readClient = withRpcSignal(client, signal);
      const head = await readClient.getBlockNumber({ cacheTime: 0 });
      const logs = await scanRanges(
        (fromBlock, toBlock) =>
          readClient.getLogs({
            address: network.addresses.VerifiableFactory,
            event,
            args: { sender: wallet! },
            fromBlock,
            toBlock,
          }),
        BigInt(network.factoryDeployBlock),
        head,
        () => signal.aborted,
        `${network.deploymentSet}:deployed:${wallet!.toLowerCase()}`,
      );
      signal.throwIfAborted();
      const implementations = [
        implementation!,
        ...(implementation!.toLowerCase() ===
        network.addresses.UserRegistryImpl.toLowerCase()
          ? network.previousRegistryImplementations
          : []),
      ].map((value) => value.toLowerCase());
      return logs
        .filter(
          (log) =>
            log.args.implementation &&
            implementations.includes(log.args.implementation.toLowerCase()),
        )
        .map((log) => ({
          address: log.args.proxyAddress!,
          blockNumber: log.blockNumber!,
        }))
        .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1));
    },
  });
  return {
    proxies: query.data ?? [],
    error: query.error?.message,
    loading: Boolean(
      wallet && implementation && (query.isPending || query.isFetching),
    ),
    refresh: () => void query.refetch(),
  };
}
export function useDeployedRegistries(
  wallet?: Address,
  refreshVersion?: string,
) {
  const network = useDeployment();
  const { proxies, ...rest } = useDeployedProxies(
    wallet,
    network.addresses.UserRegistryImpl,
    refreshVersion,
  );
  return { registries: proxies, ...rest };
}
export function useDeployedResolvers(wallet?: Address) {
  const network = useDeployment();
  const { proxies, ...rest } = useDeployedProxies(
    wallet,
    network.addresses.PermissionedResolverImpl,
  );
  return { resolvers: proxies, ...rest };
}
