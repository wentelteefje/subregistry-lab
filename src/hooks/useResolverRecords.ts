import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { type SetupView } from "../lib/diagramModel";
import {
  readResolverRecords,
  resolverRecordEntries,
} from "../lib/resolverRecords";
export type { ResolverRecords } from "../lib/resolverRecords";
export function useResolverRecords(
  setup: SetupView | undefined,
  chainId: number,
  active = true,
) {
  const client = usePublicClient({ chainId });
  const entries = resolverRecordEntries(setup);
  return useQuery({
    queryKey: ["resolver-record-links", chainId, entries],
    enabled: Boolean(active && client && entries.length),
    staleTime: 5000,
    refetchInterval: active ? 30_000 : false,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: () =>
      client && setup
        ? readResolverRecords(client, setup)
        : Promise.resolve({}),
  });
}
