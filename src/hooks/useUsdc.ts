/** Test-USDC balance/allowance reads (faucet mint runs through the tx runner). */

import { useReadContract } from "wagmi";
import type { Abi, Address } from "viem";
import { erc20Abi } from "../config/abis";
import { useDeployment } from "./useDeployment";

export function useUsdc(account?: Address, spender?: Address) {
  const network = useDeployment();
  const deployments = network.addresses;
  const balance = useReadContract({
    address: deployments.PaymentToken,
    abi: erc20Abi as Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(account) },
  });

  const allowance = useReadContract({
    address: deployments.PaymentToken,
    abi: erc20Abi as Abi,
    functionName: "allowance",
    args: account && spender ? [account, spender] : undefined,
    query: { enabled: Boolean(account && spender) },
  });

  return {
    balance: (balance.data as bigint | undefined) ?? 0n,
    allowance: (allowance.data as bigint | undefined) ?? 0n,
    refetch: () => {
      void balance.refetch();
      void allowance.refetch();
    },
  };
}
