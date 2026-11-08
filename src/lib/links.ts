/** External link builders: ENS Explorer + Sepolia Etherscan. */

export function explorerName(name: string, chainId = 11155111): string {
  return `https://${chainId === 1 ? "explorer.ens.domains" : "sepolia.explorer.ens.domains"}/${name}`;
}

export function explorerRegistry(name: string, chainId = 11155111): string {
  return `https://${chainId === 1 ? "explorer.ens.domains" : "sepolia.explorer.ens.domains"}/${name}/registry`;
}

export function etherscanAddress(address: string, chainId = 11155111): string {
  return `https://${chainId === 1 ? "etherscan.io" : "sepolia.etherscan.io"}/address/${address}`;
}

export function etherscanTx(hash: string, chainId = 11155111): string {
  return `https://${chainId === 1 ? "etherscan.io" : "sepolia.etherscan.io"}/tx/${hash}`;
}
