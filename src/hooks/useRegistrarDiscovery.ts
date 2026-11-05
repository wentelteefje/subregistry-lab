import { scanRanges } from "../lib/scan";
/**
 * Discover the registrar of a UserRegistry from chain instead of relying on
 * session memory: scan EACRolesChanged for ROOT_RESOURCE (0) grants, then
 * keep the accounts that CURRENTLY hold ROLE_REGISTRAR and are contracts
 * (the owner wallet also holds registrar rights but isn't a registrar).
 */

import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import {
  createPublicClient,
  http,
  type Abi,
  type AbiEvent,
  type Address,
} from "viem";

import { registryAbi, simpleRegistrarAbi } from "../config/abis";
import { useDeployment } from "./useDeployment";
import { ROLE_REGISTRAR } from "../lib/roles";

const rolesChangedEvent = (registryAbi as Abi).find(
  (e) => e.type === "event" && e.name === "EACRolesChanged",
) as AbiEvent;

/** First contract account currently holding root ROLE_REGISTRAR (undefined = none). */
export function useRegistrarDiscovery(
  registry?: Address,
  fromBlock?: bigint,
  skip?: boolean,
) {
  const network = useDeployment();
  const deployments = network.addresses;
  const ETH_REGISTRY_DEPLOY_BLOCK = BigInt(network.registryDeployBlock);
  const LOG_SCAN_RPC = network.logScanRpc;
  const client = usePublicClient();
  const scanClient = useMemo(
    () => createPublicClient({ chain: network.chain, transport: http(LOG_SCAN_RPC) }),
    [network, LOG_SCAN_RPC],
  );
  const [registrar, setRegistrar] = useState<Address>();

  useEffect(() => {
    if (!registry || !client || skip) return;
    let cancelled = false;

    (async () => {
      try {
        const params = {
          address: registry,
          event: rolesChangedEvent,
          args: { resource: 0n }, // ROOT_RESOURCE grants only
          fromBlock: fromBlock ?? ETH_REGISTRY_DEPLOY_BLOCK,
          toBlock: "latest",
        } as const;
        const head = await client.getBlockNumber();
        const query = (fromBlock: bigint, toBlock: bigint) => scanClient.getLogs({ ...params, fromBlock, toBlock });
        let logs;
        try { logs = await scanRanges(query, params.fromBlock, head, () => cancelled); }
        catch { logs = await scanRanges((fromBlock, toBlock) => client.getLogs({ ...params, fromBlock, toBlock }), params.fromBlock, head, () => cancelled); }

        const accounts = [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...new Set(logs.map((l: any) => (l.args.account as string).toLowerCase())),
        ] as Address[];

        for (const account of accounts) {
          const holds = (await client.readContract({
            address: registry,
            abi: registryAbi as Abi,
            functionName: "hasRootRoles",
            args: [ROLE_REGISTRAR, account],
          })) as boolean;
          if (!holds) continue;
          // Registrars are contracts; the owner wallet is not.
          const code = await client.getCode({ address: account });
          if (code && code !== "0x") {
            try {
              const [target, token] = await Promise.all([
                client.readContract({ address: account, abi: simpleRegistrarAbi, functionName: "REGISTRY" }),
                client.readContract({ address: account, abi: simpleRegistrarAbi, functionName: "PAYMENT_TOKEN" }),
              ]);
              if (target.toLowerCase() !== registry.toLowerCase() || token.toLowerCase() !== deployments.PaymentToken.toLowerCase()) continue;
              if (!cancelled) setRegistrar(account);
              return;
            } catch { /* A role-holding smart account is not necessarily a registrar. */ }
          }
        }
        if (!cancelled) setRegistrar(undefined);
      } catch {
        // discovery is best-effort; the playground just won't offer paid mode
        if (!cancelled) setRegistrar(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [registry, client, scanClient, fromBlock, skip, deployments, ETH_REGISTRY_DEPLOY_BLOCK]);

  return registrar;
}
