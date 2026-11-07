import { withRpcSignal } from "./rpcPool";
import { registryHistoryEvents, registryHistoryError } from "./registryHistory";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Address,
  type PublicClient,
} from "viem";
import { registryAbi, simpleRegistrarAbi } from "../config/abis";
import type { Deployment } from "../config/deployments";
import { ROLE_REGISTRAR } from "./roles";
import { scanRanges } from "./scan";
export async function discoverRegistrar(
  client: PublicClient,
  scanClient: PublicClient,
  registry: Address,
  network: Deployment,
  fromBlock?: bigint,
  cached?: Address,
  signal?: AbortSignal,
  pinnedBlock?: bigint,
) {
  client = withRpcSignal(client, signal);
  scanClient = withRpcSignal(scanClient, signal);
  const head = pinnedBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const matches = async (account: Address) => {
    signal?.throwIfAborted();
    const holds = await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "hasRootRoles",
      args: [ROLE_REGISTRAR, account],
      blockNumber: head,
    });
    if (!holds) return false;
    const code = await client.getCode({
      address: account,
      blockNumber: head,
    });
    if (!code || code === "0x") return false;
    try {
      const [target, token] = await Promise.all([
        client.readContract({
          address: account,
          abi: simpleRegistrarAbi,
          functionName: "REGISTRY",
          blockNumber: head,
        }),
        client.readContract({
          address: account,
          abi: simpleRegistrarAbi,
          functionName: "PAYMENT_TOKEN",
          blockNumber: head,
        }),
      ]);
      return (
        target.toLowerCase() === registry.toLowerCase() &&
        token.toLowerCase() === network.addresses.PaymentToken.toLowerCase()
      );
    } catch (error) {
      if (
        error instanceof BaseError &&
        error.walk(
          (e) =>
            e instanceof ContractFunctionRevertedError ||
            e instanceof ContractFunctionZeroDataError,
        )
      )
        return false;
      throw error;
    }
  };
  if (cached && (await matches(cached))) return cached;
  const fetch = (rpc: PublicClient, fromBlock: bigint, toBlock: bigint) =>
    rpc.getLogs({
      address: registry,
      events: registryHistoryEvents,
      fromBlock,
      toBlock,
    });
  const start = fromBlock ?? BigInt(network.factoryDeployBlock);
  const logs = await scanRanges((from, to) => fetch(scanClient, from, to), start, head, () => Boolean(signal?.aborted), client.chain ? `${client.chain.id}:registry-history:${registry.toLowerCase()}:${start}` : undefined);
  const decodingError = registryHistoryError(logs);
  if (decodingError) throw Error(decodingError);
  const accounts = [
    ...new Set(
      logs.flatMap((log) => {
        const args = log.args;
        return "account" in args && args.account && (args.resource === undefined || args.resource === 0n)
          ? [args.account.toLowerCase() as Address]
          : [];
      }),
    ),
  ];
  for (const account of accounts) if (await matches(account)) return account;
  return null;
}
