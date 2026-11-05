import { useReadContracts } from "wagmi";
import { type Address, parseAbi } from "viem";
import { resolverAbi } from "../config/abis";

const interfaceAbi = parseAbi(["function supportsInterface(bytes4) view returns (bool)"]);
/** PermissionedResolver setters apply across names: only offer writes with live authorization. */
export function useResolverAccess(resolver?: Address, account?: Address) {
  const { data } = useReadContracts({
    contracts: resolver && account ? [
      {address: resolver, abi: interfaceAbi, functionName: "supportsInterface", args: ["0xb4436dde"]},
      {address: resolver, abi: resolverAbi, functionName: "hasRootRoles", args: [1n, account]},
    ] as const : [],
    query: { enabled: Boolean(resolver && account) },
  });
  return data?.[0]?.result === true && data?.[1]?.result === true;
}
