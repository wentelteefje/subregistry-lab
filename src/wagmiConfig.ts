import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { publicRpcTransport } from "./lib/rpcPool";
import { mainnet, sepolia } from "wagmi/chains";

/** ENSv2 deployments on Ethereum and Sepolia. */
export const wagmiConfig = getDefaultConfig({
  appName: "ENSv2 Subregistry Lab",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "SUBREGISTRY_LAB_INJECTED_ONLY",
  chains: [sepolia, mainnet],
  transports: {
    [mainnet.id]: publicRpcTransport(mainnet.id),
    [sepolia.id]: publicRpcTransport(sepolia.id),
  },
});
