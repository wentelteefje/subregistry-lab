import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { fallback, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

/** Sepolia-only: ENSv2 test deployments live there. */
export const wagmiConfig = getDefaultConfig({
  appName: "ENSv2 Subregistry Lab",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "SUBREGISTRY_LAB_INJECTED_ONLY",
  chains: [sepolia, mainnet],
  transports: {
    [mainnet.id]: fallback([http("https://ethereum-rpc.publicnode.com"), http("https://eth.drpc.org")]),
    [sepolia.id]: fallback([
      http("https://sepolia.drpc.org"),
      http("https://ethereum-sepolia-rpc.publicnode.com"),
    ]),
  },
});
