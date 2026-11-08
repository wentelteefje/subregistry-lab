import { useChainId } from "wagmi";
import { getDeployment } from "../config/deployments";

export function useDeployment() {
  const chainId = useChainId();
  return getDeployment(chainId === 1 ? 1 : 11155111);
}
