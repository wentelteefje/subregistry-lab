import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { networks } from "../config/deployments";

export function useIsReady(): boolean {
  const { isConnected, chainId } = useAccount();
  const configured = useChainId();
  return isConnected && chainId === configured && (chainId === 1 || chainId === 11155111);
}

export function ChainGuard() {
  const { isConnected, chainId: walletChain } = useAccount();
  const configured = useChainId();
  const chainId = configured === 1 ? 1 : 11155111;
  const { switchChain, isPending, error } = useSwitchChain();
  return <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3">
    <label className="text-sm">Network <select aria-label="Network" className="ml-2 rounded border p-2" value={chainId} disabled={isPending} onChange={event => switchChain({ chainId: Number(event.target.value) as 1 | 11155111 })}>
      {Object.values(networks).map(network => <option key={network.id} value={network.id}>{network.chain.name}</option>)}
    </select></label>
    {isConnected && walletChain !== chainId && <span className="text-sm text-amber-800">Switch your wallet to the selected network to enable actions.</span>}
    {error && <span className="text-sm text-red-700">{error.message}</span>}
  </div>;
}
