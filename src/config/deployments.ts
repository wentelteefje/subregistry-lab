import { mainnet, sepolia } from "viem/chains";

// Addresses and ABI provenance: https://docs.ens.domains/learn/deployments/
const mainnetDeployment = {
  "id": 1,
  "chain": mainnet,
  "deploymentSet": "mainnet:4f47cbcc11462fb413196e6b5c0f8090247a6c08",
  "artifactCommit": "4f47cbcc11462fb413196e6b5c0f8090247a6c08",
  "addresses": {
    "ETHRegistry": "0xf60aba43e1f7f3dab1186ff03b561401c9df85e2",
    "ETHRegistrar": "0xd6d8369e55c94ae8afa714e6cf7ab5be54d5cc81",
    "StandardRentPriceOracle": "0x76f29609a363a8a1a2a6abe2e859c0f8916af469",
    "VerifiableFactory": "0x77510ba162dfea3d8989e3f0928a691b345730d2",
    "UserRegistryImpl": "0xfaa23592aca10a6d8875b18ea86954e8eb6d8d72",
    "PermissionedResolverImpl": "0x565b0f456a04ac9b48758190e90030623cff57c5",
    "UniversalResolverV2": "0x06fdd07f007adac667177b46ab2eb9a75132cfd5",
    "PaymentToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  },
  "registryDeployBlock": 26105621,
  "factoryDeployBlock": 26105299,
  "logScanRpc": "https://ethereum-rpc.publicnode.com",
  "previousRegistryImplementations": ["0x664814f5bd5e6e617742029fa781bbee6c230dc0", "0x75ff9adbcfce2469b097ac68f6ae650eae1351bb"],
  "canMint": false
} as const;
const sepoliaDeployment = {
  "id": 11155111,
  "chain": sepolia,
  "deploymentSet": "sepolia:07e55a056f5b6a9c90119f501bdd05714e67dddd",
  "artifactCommit": "07e55a056f5b6a9c90119f501bdd05714e67dddd",
  "addresses": {
    "ETHRegistry": "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
    "ETHRegistrar": "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
    "StandardRentPriceOracle": "0x8196665d4ca7488b6474a9ec8e7d2719fb42263a",
    "VerifiableFactory": "0xda70306c98e97ece36f997a21368e53298572991",
    "UserRegistryImpl": "0x9bd8a88719068d09ecee662f36c0e3856708366a",
    "PermissionedResolverImpl": "0x115eb53f0c60696633855f90b138178fb40b2b2c",
    "UniversalResolverV2": "0x24e1d8e068620b647ca097f961a61055f4f42d72",
    "PaymentToken": "0x240b0316df57887dbbe58b586508b19e633a14aa"
  },
  "registryDeployBlock": 11820399,
  "factoryDeployBlock": 11820318,
  "logScanRpc": "https://sepolia.gateway.tenderly.co",
  "previousRegistryImplementations": ["0x624a25d67b59d587752ebec8dded8827dae52050", "0xa80338aaa8d23831cea25e858d1774534abb0263"],
  "canMint": true
} as const;

export const networks = { 1: mainnetDeployment, 11155111: sepoliaDeployment } as const;
export type Deployment = (typeof networks)[keyof typeof networks];
export const LOG_CHUNK_SIZE = 9_999n;
export function getDeployment(chainId = 11155111): Deployment {
  if (chainId !== 1 && chainId !== 11155111) throw new Error(`Unsupported network: ${chainId}`);
  return networks[chainId];
}
