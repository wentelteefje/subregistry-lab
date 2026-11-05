import { scanRanges } from "../lib/scan";
/**
 * Subnames registered in a UserRegistry: LabelRegistered logs (full-range
 * via the scan RPC, wagmi transport as fallback), states via getState.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import {
  createPublicClient,
  http,
  type Abi,
  type AbiEvent,
  type Address,
} from "viem";

import { registryAbi } from "../config/abis";
import { useDeployment } from "./useDeployment";
import { classifyError } from "../lib/errors";
import { labelhashId } from "../lib/names";
import { MAX_EXPIRY } from "../lib/presets";

export type Subname = {
  label: string;
  expiry: bigint;
  neverExpires: boolean;
  owner: Address;
  registered: boolean;
  /** The subname's resolver pointer (zero address = none). */
  resolver: Address;
};

const labelRegisteredEvent = (registryAbi as Abi).find(
  (e) => e.type === "event" && e.name === "LabelRegistered",
) as AbiEvent;

export function useRegistryState(registry?: Address, fromBlock?: bigint) {
  const network = useDeployment();
  const deployments = network.addresses;
  const ETH_REGISTRY_DEPLOY_BLOCK = BigInt(network.registryDeployBlock);
  const LOG_SCAN_RPC = network.logScanRpc;
  const client = usePublicClient();
  const scanClient = useMemo(
    () => createPublicClient({ chain: network.chain, transport: http(LOG_SCAN_RPC) }),
    [network, LOG_SCAN_RPC],
  );
  const [subnames, setSubnames] = useState<Subname[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!registry || !client) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    (async () => {
      try {
        const params = {
          address: registry,
          event: labelRegisteredEvent,
          fromBlock: fromBlock ?? ETH_REGISTRY_DEPLOY_BLOCK,
          toBlock: "latest",
        } as const;
        const head = await client.getBlockNumber();
        const query = (fromBlock: bigint, toBlock: bigint) => scanClient.getLogs({ ...params, fromBlock, toBlock });
        let logs;
        try { logs = await scanRanges(query, params.fromBlock, head, () => cancelled); }
        catch { logs = await scanRanges((fromBlock, toBlock) => client.getLogs({ ...params, fromBlock, toBlock }), params.fromBlock, head, () => cancelled); }

        const labels = [
          ...new Set(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            logs.map((l: any) => l.args.label as string),
          ),
        ];
        const results: Subname[] = [];
        for (const label of labels) {
          const [state, resolver] = await Promise.all([
            client.readContract({
              address: registry,
              abi: registryAbi as Abi,
              functionName: "getState",
              args: [labelhashId(label)],
            }) as Promise<{
              status: number;
              expiry: bigint;
              latestOwner: Address;
              tokenId: bigint;
              resource: bigint;
            }>,
            client.readContract({
              address: registry,
              abi: registryAbi as Abi,
              functionName: "getResolver",
              args: [label],
            }) as Promise<Address>,
          ]);
          results.push({
            label,
            expiry: state.expiry,
            neverExpires: state.expiry === MAX_EXPIRY,
            owner: state.latestOwner,
            registered: state.status === 2,
            resolver,
          });
        }
        if (!cancelled) {
          setSubnames(results.sort((a, b) => a.label.localeCompare(b.label)));
        }
      } catch (err) {
        if (!cancelled) setError(classifyError(err).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [registry, client, scanClient, fromBlock, nonce, network, deployments, ETH_REGISTRY_DEPLOY_BLOCK]);

  return { subnames, loading, error, refresh };
}
