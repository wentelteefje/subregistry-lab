import { useAccount, useChainId } from "wagmi";

export function useIsReady(): boolean {
  const { isConnected, chainId } = useAccount();
  const configured = useChainId();
  return isConnected && chainId === configured && (chainId === 1 || chainId === 11155111);
}

/** The header's RainbowKit selector handles network changes for every wallet. */
export function ChainGuard() {
  const { isConnected } = useAccount();
  const ready = useIsReady();
  if (!isConnected || ready) return null;

  return (
    <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      Choose Ethereum or Sepolia using the network button next to your wallet.
      If your wallet cannot switch networks here, switch in your wallet.
    </p>
  );
}
