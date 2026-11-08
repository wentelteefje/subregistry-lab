import { withRpcSignal } from "../lib/rpcPool";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import type { InspectionTarget } from "../diagram/types";
import {
  profileKey,
  readInspection,
  readProfile,
  type Profile,
  type InspectedRecord,
} from "../lib/inspection";

export function useInspection(
  target: InspectionTarget,
  chainId: number,
  account?: Address,
  profiles: Profile[] = [],
  active = true,
  snapshotBlock?: bigint,
) {
  const client = usePublicClient({ chainId });
  const base = useQuery({
    queryKey: ["diagram-inspection", chainId, target, account?.toLowerCase(), ...(snapshotBlock === undefined ? [] : [snapshotBlock.toString()])],
    enabled: Boolean(active && client),
    staleTime: snapshotBlock === undefined ? 60_000 : Infinity,
    gcTime: 30 * 60_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: ({ signal }) => {
      if (!client)
        throw new Error("A read-only network connection is unavailable.");
      return readInspection(client, target, chainId, account, signal, [], snapshotBlock);
    },
  });
  const block = base.data?.block;
  const manual = useQuery<InspectedRecord[]>({
    queryKey: [
      "diagram-inspection-profiles",
      chainId,
      target,
      block?.toString(),
      profiles,
    ],
    enabled: Boolean(
      active &&
        client &&
        block !== undefined &&
        target.kind === "name" &&
        profiles.length,
    ),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === chainId &&
      JSON.stringify(previousQuery.queryKey[2]) === JSON.stringify(target) &&
      previousQuery.queryKey[3] === block?.toString()
        ? previous
        : undefined,
    queryFn: async ({ signal }) => {
      if (!client || block === undefined || target.kind !== "name") return [];
      const records = [];
      for (const profile of profiles) {
        signal.throwIfAborted();
        records.push(
          await readProfile(
            withRpcSignal(client, signal),
            target.resolver,
            target.name,
            {
              ...profile,
              explicitInterface: base.data?.records?.find(
                (record) => profileKey(record.profile) === profileKey(profile),
              )?.profile.explicitInterface,
            },
            block,
          ),
        );
      }
      return records;
    },
  });
  const records = [
    ...new Map(
      [...(base.data?.records ?? []), ...(manual.data ?? [])].map((record) => [
        profileKey(record.profile),
        record,
      ]),
    ).values(),
  ];
  return {
    ...base,
    data: base.data ? { ...base.data, records } : undefined,
    isFetching: base.isFetching || manual.isFetching,
    manualPending: manual.isFetching,
    manualError: manual.error,
    retryManual: () => void manual.refetch(),
  };
}
