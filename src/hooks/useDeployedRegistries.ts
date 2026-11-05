import { scanRanges } from "../lib/scan";
/**
 * Proxies the connected wallet deployed through the VerifiableFactory.
 * Provenance is on-chain: ProxyDeployed has the sender indexed, and the
 * implementation field separates registries from resolvers.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  http,
  type Abi,
  type AbiEvent,
  type Address,
} from "viem";

import { verifiableFactoryAbi } from "../config/abis";
import { useDeployment } from "./useDeployment";
import { classifyError } from "../lib/errors";

export type DeployedProxy = {
  address: Address;
  blockNumber: bigint;
};

/** @deprecated alias kept for existing imports */
export type DeployedRegistry = DeployedProxy;

const proxyDeployedEvent = (verifiableFactoryAbi as Abi).find(
  (e) => e.type === "event" && e.name === "ProxyDeployed",
) as AbiEvent;

/** All proxies of a given implementation the wallet deployed via the factory. */
export function useDeployedProxies(wallet?: Address, implementation?: Address) {
  const network = useDeployment();
  const deployments = network.addresses;
  const LOG_SCAN_RPC = network.logScanRpc;
  const scanClient = useMemo(
    () => createPublicClient({ chain: network.chain, transport: http(LOG_SCAN_RPC) }),
    [network, LOG_SCAN_RPC],
  );
  const [proxies, setProxies] = useState<DeployedProxy[]>([]);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!wallet || !implementation) return;
    let cancelled = false;

    (async () => {
      try {
        const head = await scanClient.getBlockNumber();
        const logs = await scanRanges((fromBlock, toBlock) => scanClient.getLogs({
          address: deployments.VerifiableFactory,
          event: proxyDeployedEvent,
          args: { sender: wallet },
          fromBlock, toBlock,
        }), BigInt(network.factoryDeployBlock), head, () => cancelled);
        const found = logs
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((l: any) =>
            [implementation, ...(implementation.toLowerCase() === deployments.UserRegistryImpl.toLowerCase() ? network.previousRegistryImplementations : [])]
              .some(candidate => candidate.toLowerCase() === (l.args.implementation as string).toLowerCase()),
          )
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((l: any) => ({
            address: l.args.proxyAddress as Address,
            blockNumber: l.blockNumber as bigint,
          }));
        // newest first
        found.sort((a: DeployedProxy, b: DeployedProxy) =>
          a.blockNumber > b.blockNumber ? -1 : 1,
        );
        if (!cancelled) {
          setProxies(found);
          setError(undefined);
        }
      } catch (err) {
        if (!cancelled) setError(classifyError(err).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet, implementation, scanClient, nonce, network, deployments]);

  return { proxies, error, refresh };
}

/** UserRegistry proxies deployed by the wallet. */
export function useDeployedRegistries(wallet?: Address) {
  const deployments = useDeployment().addresses;
  const { proxies, error, refresh } = useDeployedProxies(
    wallet,
    deployments.UserRegistryImpl,
  );
  return { registries: proxies, error, refresh };
}

/** PermissionedResolver proxies deployed by the wallet. */
export function useDeployedResolvers(wallet?: Address) {
  const deployments = useDeployment().addresses;
  const { proxies, error, refresh } = useDeployedProxies(
    wallet,
    deployments.PermissionedResolverImpl,
  );
  return { resolvers: proxies, error, refresh };
}
