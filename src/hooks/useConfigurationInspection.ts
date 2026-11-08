import { discoverResolverNames } from "../lib/resolverDiscovery";
import { errorSummary } from "../lib/errors";
import { withRpcSignal, publicRpcTransport } from "../lib/rpcPool";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { getDeployment } from "../config/deployments";
import { readConfiguration } from "../lib/readConfiguration";
import { discoverRegistrar } from "../lib/discoverRegistrar";
export type InspectionRequest = { name: string; chainId: 1 | 11155111 };
export function useConfigurationInspection(
  target: InspectionRequest | undefined,
  active: boolean,
) {
  const network = getDeployment(target?.chainId);
  const client = usePublicClient({ chainId: network.id });
  const cache = useQueryClient();
  const scanClient = useMemo(
    () =>
      createPublicClient({
        chain: network.chain,
        transport: publicRpcTransport(network.id),
      }),
    [network],
  );
  const query = useQuery({
    queryKey: ["inspect-configuration", target?.chainId, target?.name],
    enabled: Boolean(active && target && client),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      readConfiguration(client!, scanClient, target!.name, network, signal),
  });
  const snapshot = query.data;
  const registrar = useQuery({
    queryKey: [
      "inspect-registrar",
      target?.chainId,
      target?.name,
      snapshot?.block.toString(),
      snapshot?.childRegistry,
    ],
    enabled: Boolean(
      active &&
      client &&
      (snapshot?.status === "registered" || snapshot?.status === "reserved") &&
      snapshot.childRegistry &&
      !query.isFetching,
    ),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      discoverRegistrar(
        client!,
        scanClient,
        snapshot!.childRegistry!,
        network,
        snapshot!.scanFrom,
        undefined,
        signal,
        snapshot!.block,
      ),
  });
  const resolution = snapshot?.resolution;
  const discovery = useQuery({
    queryKey: [
      "inspect-resolver-names",
      target?.chainId,
      target?.name,
      snapshot?.block.toString(),
      resolution?.resolver,
    ],
    enabled: Boolean(
      active &&
      client &&
      snapshot &&
      resolution?.permissioned &&
      resolution.wildcardSupported !== false &&
      !query.isFetching,
    ),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      discoverResolverNames(
        withRpcSignal(client!, signal),
        withRpcSignal(scanClient, signal),
        snapshot!.name,
        resolution!,
        network,
        snapshot!.block,
        new Set(
          (snapshot!.subnames ?? [])
            .filter((sub) => sub.registered || sub.status === 1)
            .map((sub) => `${sub.label}.${snapshot!.name}`),
        ),
        signal,
      ),
  });
  const discoveredNames = discovery.data?.names;
  const diagramResolver =
    snapshot?.setup.resolver ?? snapshot?.setup.inheritedResolver;
  const sameResolver =
    diagramResolver?.toLowerCase() === resolution?.resolver.toLowerCase();
  const enrichedSnapshot =
    snapshot && (discovery.data || discovery.error)
      ? {
          ...snapshot,
          resolverNames: discoveredNames,
          resolverNamesError: discovery.error
            ? errorSummary(discovery.error)
            : discovery.data?.error,
          setup:
            sameResolver && resolution
              ? {
                  ...snapshot.setup,
                  resolverNames: discoveredNames?.map((entry) => entry.name),
                  resolverRecords: {
                    ...snapshot.setup.resolverRecords,
                    [resolution.resolver.toLowerCase()]: {
                      ...snapshot.setup.resolverRecords?.[
                        resolution.resolver.toLowerCase()
                      ],
                      ...Object.fromEntries(
                        (discoveredNames ?? []).map((entry) => [
                          entry.name,
                          entry.recordId,
                        ]),
                      ),
                    },
                  },
                }
              : snapshot.setup,
        }
      : snapshot;
  useEffect(() => {
    if (active || !target) return;
    void cache.cancelQueries({
      queryKey: ["inspect-configuration", target.chainId, target.name],
      exact: true,
    });
    void cache.cancelQueries({
      queryKey: ["inspect-registrar", target.chainId, target.name],
    });
    void cache.cancelQueries({
      queryKey: ["inspect-resolver-names", target.chainId, target.name],
    });
  }, [active, target, cache]);
  const refresh = async () => {
    if (!active || !target) return;
    void cache.invalidateQueries({
      queryKey: ["inspect-registrar", target.chainId, target.name],
      refetchType: "none",
    });
    void cache.invalidateQueries({
      queryKey: ["inspect-resolver-names", target.chainId, target.name],
      refetchType: "none",
    });
    const previousBlock = snapshot?.block;
    const updated = await query.refetch();
    if (!updated.error && updated.data?.block === previousBlock && snapshot) {
      // A same-block refetch can be batched by React without an enabled-state
      // transition, so explicitly retry the independently cached follow-ups.
      if (snapshot.childRegistry) void registrar.refetch();
      if (resolution?.permissioned && resolution.wildcardSupported !== false)
        void discovery.refetch();
      // A retry within the same block must also retry this name's failed drawer reads.
      void cache.invalidateQueries({
        predicate: (entry) => {
          const [kind, chainId, inspected, , block] = entry.queryKey;
          if (
            kind !== "diagram-inspection" ||
            chainId !== target.chainId ||
            block !== previousBlock?.toString()
          )
            return false;
          const item = inspected as {
            kind: string;
            name?: string;
            registry?: string;
            address?: string;
          };
          return item.kind === "name"
            ? item.name === target.name ||
                Boolean(item.name?.endsWith(`.${target.name}`))
            : item.kind === "label"
              ? item.registry?.toLowerCase() ===
                snapshot.childRegistry?.toLowerCase()
              : [
                  snapshot.childRegistry,
                  snapshot.directResolver,
                  snapshot.effectiveResolver,
                ].some(
                  (address) =>
                    address?.toLowerCase() === item.address?.toLowerCase(),
                );
        },
      });
    }
  };
  return { query, registrar, discovery, snapshot: enrichedSnapshot, refresh };
}
