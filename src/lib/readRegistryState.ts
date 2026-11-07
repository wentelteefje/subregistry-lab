import { withRpcSignal } from "./rpcPool";
import { registryHistoryEvents, registryHistoryError } from "./registryHistory";
import { type Address, type PublicClient } from "viem";
import { registryAbi } from "../config/abis";
import { scanRanges, IncompleteScanError } from "./scan";
import { labelhashId } from "./names";
import { MAX_EXPIRY } from "./presets";
export type Subname = {
  label: string;
  expiry: bigint;
  neverExpires: boolean;
  owner: Address;
  registered: boolean;
  status?: number;
  resolver: Address;
};


export async function readRegistryState(
  client: PublicClient,
  scanClient: PublicClient,
  registry: Address,
  fromBlock: bigint,
  signal?: AbortSignal,
  pinnedBlock?: bigint,
  maxLabels?: number,
  onIncomplete?: (message: string) => void,
): Promise<Subname[]> {
  client = withRpcSignal(client, signal);
  scanClient = withRpcSignal(scanClient, signal);
  const head = pinnedBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const logsAt = (rpc: PublicClient, fromBlock: bigint, toBlock: bigint) =>
    rpc.getLogs({
      address: registry,
      events: registryHistoryEvents,
      fromBlock,
      toBlock,
    });
  let logs;
  try {
    logs = await scanRanges((from, to) => logsAt(scanClient, from, to), fromBlock, head, () => Boolean(signal?.aborted), client.chain ? `${client.chain.id}:registry-history:${registry.toLowerCase()}:${fromBlock}` : undefined);
  } catch (error) {
    if (!onIncomplete || !(error instanceof IncompleteScanError) || !error.logs.length) throw error;
    onIncomplete(error.message);
    logs = error.logs as Awaited<ReturnType<typeof logsAt>>;
  }
  signal?.throwIfAborted();
  const decodingError = registryHistoryError(logs);
  if (decodingError) {
    if (!onIncomplete) throw Error(decodingError);
    onIncomplete(decodingError);
  }
  const labels = [
    ...new Set(
      logs
        .map((log) => "label" in log.args ? log.args.label : undefined)
        .filter((label): label is string => typeof label === "string"),
    ),
  ];
  if (!labels.length) return [];
  if (maxLabels !== undefined && labels.length > maxLabels)
    throw Error(
      `Inspection limit: ${labels.length} historical labels found (maximum ${maxLabels}). Inspect a more specific parent.`,
    );
  // One multicall batch rather than two sequential RPC calls for every label.
  const values: unknown[] = [];
  for (let offset = 0; offset < labels.length; offset += 100) {
    signal?.throwIfAborted();
    values.push(
      ...(await client.multicall({
        batchSize: 0,
        allowFailure: false,
        blockNumber: head,
        contracts: labels.slice(offset, offset + 100).flatMap((label) => [
          {
            address: registry,
            abi: registryAbi,
            functionName: "getState" as const,
            args: [labelhashId(label)] as const,
          },
          {
            address: registry,
            abi: registryAbi,
            functionName: "getResolver" as const,
            args: [label] as const,
          },
        ]),
      })),
    );
  }
  signal?.throwIfAborted();
  return labels
    .map((label, index) => {
      const state = values[index * 2] as {
        status: number;
        expiry: bigint;
        latestOwner: Address;
      };
      const resolver = values[index * 2 + 1] as Address;
      return {
        label,
        expiry: state.expiry,
        neverExpires: state.expiry === MAX_EXPIRY,
        owner: state.latestOwner,
        registered: state.status === 2,
        status: state.status,
        resolver,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
