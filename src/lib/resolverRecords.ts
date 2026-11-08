import {
  isAddress,
  zeroAddress,
  zeroHash,
  type Address,
  type PublicClient,
} from "viem";
import { namehash } from "viem/ens";
import { resolverAbi } from "../config/abis";
import { classifyResolver, type SetupView } from "./diagramModel";
export type ResolverRecords = Record<string, Record<string, string | null>>;
export function resolverRecordEntries(setup: SetupView | undefined) {
  const names = new Map<string, Set<string>>();
  const add = (address: string | undefined, name: string) => {
    if (
      !address ||
      !isAddress(address, { strict: false }) ||
      address.toLowerCase() === zeroAddress
    )
      return;
    const key = address.toLowerCase();
    if (!names.has(key)) names.set(key, new Set([""]));
    names.get(key)!.add(name);
  };
  const shared = setup?.resolver ?? setup?.inheritedResolver;
  if (setup && !setup.illustrative) {
    add(shared, setup.parentName);
    for (const sub of setup.subnames ?? [])
      add(
        classifyResolver(sub.resolver, shared) === "foreign"
          ? sub.resolver
          : shared,
        `${sub.label}.${setup.parentName}`,
      );
  }
  return [...names].flatMap(([address, values]) =>
    [...values].map((name) => ({ address: address as Address, name })),
  );
}
export async function readResolverRecords(
  client: PublicClient,
  setup: SetupView,
  blockNumber?: bigint,
): Promise<ResolverRecords> {
  const entries = resolverRecordEntries(setup);
  if (!entries.length) return {};
  const results = await client.multicall({
    allowFailure: true,
    batchSize: 0,
    blockNumber,
    contracts: entries.map(({ address, name }) => ({
      address,
      abi: resolverAbi,
      functionName: "getRecordId" as const,
      args: [name ? namehash(name) : zeroHash],
    })),
  });
  const records: ResolverRecords = {};
  entries.forEach(({ address, name }, index) => {
    (records[address] ??= {})[name] =
      results[index].status === "success"
        ? String(results[index].result)
        : null;
  });
  return records;
}
