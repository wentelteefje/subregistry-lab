import { publicRpcTransport } from "../lib/rpcPool";
/**
 * Scans the ETHRegistry for .eth names owned by the connected wallet.
 *
 * Public RPC pool with bounded, resumable adaptive scans for each event type.
 * Incremental via a per-wallet localStorage cache; current ownership is
 * confirmed on-chain afterwards (transfers away / expiry make log-derived
 * candidacy stale).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { createPublicClient, type Abi, type AbiEvent, type Address, type PublicClient, parseAbi } from "viem";

import { registryAbi } from "../config/abis";
import { type Deployment } from "../config/deployments";
import { useDeployment } from "./useDeployment";
import { classifyError } from "../lib/errors";
import { scanRanges } from "../lib/scan";
import {
  cacheCandidates,
  emptyCache,
  mergeCache,
  type LabelRegisteredLike,
  type ScanCache,
  type TransferSingleLike,
} from "../lib/logs";
import { labelhashId } from "../lib/names";

export type OwnedName = {
  label: string;
  name: string; // label.eth
  expiry: bigint;
  status: "active" | "grace" | "expired";
};

export type OwnedNamesResult = {
  names: OwnedName[];
  loading: boolean;
  /** 0..1 scan progress while loading. */
  progress: number;
  error?: string;
  refresh: () => void;
};

const CACHE_PREFIX = "subregistry-lab:scan:v1:";

function loadCache(wallet: string, network: Deployment): ScanCache {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + network.deploymentSet + ":" + wallet.toLowerCase());
    if (raw) {
      const parsed = JSON.parse(raw) as ScanCache;
      if (parsed.version === 1) return parsed;
    }
  } catch {
    // fall through to fresh cache
  }
  return emptyCache(wallet, BigInt(network.registryDeployBlock));
}

function saveCache(cache: ScanCache, network: Deployment): void {
  try {
    localStorage.setItem(CACHE_PREFIX + network.deploymentSet + ":" + cache.wallet, JSON.stringify(cache));
  } catch {
    // non-fatal
  }
}

const transferSingleEvent = (registryAbi as Abi).find(
  (e) => e.type === "event" && e.name === "TransferSingle",
) as AbiEvent;
const labelRegisteredEvent = (registryAbi as Abi).find(
  (e) => e.type === "event" && e.name === "LabelRegistered",
) as AbiEvent;

/** One getLogs pass over [from, to]; throws on RPC rejection. */
async function fetchSpan(
  client: PublicClient,
  network: Deployment,
  wallet: Address,
  from: bigint,
  to: bigint,
): Promise<{ transfers: TransferSingleLike[]; labels: LabelRegisteredLike[] }> {
  const [transferLogs, labelLogs] = await Promise.all([
    client.getLogs({
      address: network.addresses.ETHRegistry,
      event: transferSingleEvent,
      args: { to: wallet },
      fromBlock: from,
      toBlock: to,
    }),
    client.getLogs({
      address: network.addresses.ETHRegistry,
      event: labelRegisteredEvent,
      fromBlock: from,
      toBlock: to,
    }),
  ]);
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transfers: transferLogs.map((l: any) => ({
      to: l.args.to as string,
      id: l.args.id as bigint,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labels: labelLogs.map((l: any) => ({
      tokenId: l.args.tokenId as bigint,
      label: l.args.label as string,
      expiry: l.args.expiry as bigint,
    })),
  };
}

/** Grace period is a registrar-level concept; used only for a UI hint. */
const registrarGraceAbi = parseAbi(["function GRACE_PERIOD() view returns (uint64)"]);

export function useOwnedNames(wallet?: Address): OwnedNamesResult {
  const network = useDeployment();
  const client = usePublicClient();
  const scanClient = useMemo(
    () =>
      createPublicClient({
        chain: network.chain,
        transport: publicRpcTransport(network.id),
      }),
    [network],
  );
  const [names, setNames] = useState<OwnedName[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const scanning = useRef(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!wallet || !client || scanning.current) return;
    scanning.current = true;
    setLoading(true);
    setError(undefined);

    let cancelled = false;

    (async () => {
      try {
        let cache = loadCache(wallet, network);
        const head = await client.getBlockNumber();
        const from = BigInt(cache.lastScannedBlock) + 1n;

        if (from <= head) {
          await scanRanges(async (start, end) => {
            const span = await fetchSpan(scanClient, network, wallet, start, end);
            if (cancelled) throw Error("Log scan cancelled");
            cache = mergeCache(cache, span.transfers, span.labels, end);
            saveCache(cache, network);
            setProgress(0.9);
            return [];
          }, from, head, () => cancelled);
        }

        // Confirm current ownership + expiry on-chain for each candidate.
        // (getState carries status/expiry/latestOwner in one call; the
        // deployed registries have no getOwner view.)
        const graceSeconds = await client.readContract({ address: network.addresses.ETHRegistrar, abi: registrarGraceAbi, functionName: "GRACE_PERIOD" });
        const candidates = cacheCandidates(cache);
        const now = BigInt(Math.floor(Date.now() / 1000));
        const confirmed: OwnedName[] = [];
        for (const candidate of candidates) {
          const state = (await client.readContract({
            address: network.addresses.ETHRegistry,
            abi: registryAbi as Abi,
            functionName: "getState",
            args: [labelhashId(candidate.label)],
          })) as { status: number; expiry: bigint; latestOwner: Address };
          const isLatestOwner =
            state.latestOwner.toLowerCase() === wallet.toLowerCase();
          if (!isLatestOwner) continue;
          if (state.status === 2) {
            confirmed.push({
              label: candidate.label,
              name: `${candidate.label}.eth`,
              expiry: state.expiry,
              status: "active",
            });
          } else if (
            state.expiry > 0n &&
            state.expiry <= now &&
            state.expiry + graceSeconds > now
          ) {
            // expired but within the registrar grace window: still theirs to renew
            confirmed.push({
              label: candidate.label,
              name: `${candidate.label}.eth`,
              expiry: state.expiry,
              status: "grace",
            });
          }
        }
        if (!cancelled) {
          setNames(confirmed.sort((a, b) => a.label.localeCompare(b.label)));
          setProgress(1);
        }
      } catch (err) {
        if (!cancelled) setError(classifyError(err).message);
      } finally {
        scanning.current = false;
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      scanning.current = false;
    };
  }, [wallet, client, scanClient, nonce, network]);

  return { names, loading, progress, error, refresh };
}
