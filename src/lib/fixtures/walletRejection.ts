/** Legacy viem error shape: an unbroken ABI payload embedded in a saved step. */
export const walletRejectionDump = [
  "User rejected the request.",
  "Request Arguments:",
  "  chain: Sepolia (id: 11155111)",
  "  from: 0x1111111111111111111111111111111111111111",
  "  to: 0xda70306c98e97ece36f997a21368e53298572991",
  `  data: 0x5d84121a${"00".repeat(8000)}`,
  "  nonce: 177",
  "Contract Call:",
  "  function: deployProxy(address implementation, uint256 salt, bytes data)",
  `  args: (0x9bd8a88719068d09ecee662f36c0e3856708366a, 4038595380606888555066479770520733909978376185318364488696399094749575245391, 0x${"11".repeat(4000)})`,
  "Docs: https://viem.sh/docs/contract/writeContract",
  "Details: User rejected the request.",
  "Version: viem@2.46.3",
].join("\n");
