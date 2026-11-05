import fs from 'node:fs/promises';
import { networks } from '../src/config/deployments.ts';
const selections = {
  registryAbi: ['UserRegistryImpl', ['getSubregistry','getResolver','getState','getExpiry','getResource','getTokenId','roles','hasRoles','hasRootRoles','grantRootRoles','revokeRootRoles','grantRoles','revokeRoles','register','renew','setSubregistry','setResolver','setParent','getParent','LabelRegistered','TransferSingle','SubregistryUpdated','ExpiryUpdated','EACRolesChanged','isEmancipated','roleCount']],
  userRegistryInitAbi: ['UserRegistryImpl', ['initialize']],
  resolverInitAbi: ['PermissionedResolverImpl', ['initialize']],
  resolverAbi: ['PermissionedResolverImpl', ['setAddress','setText','resolve','hasRootRoles']],
  verifiableFactoryAbi: ['VerifiableFactory', ['deployProxy','ProxyDeployed']],
};
const snapshots = {};
for (const network of Object.values(networks)) {
  snapshots[network.id] = {};
  for (const name of new Set([...Object.values(selections).map(([file]) => file), "ETHRegistry"])) {
    const url = `https://raw.githubusercontent.com/ensdomains/contracts-v2/${network.artifactCommit}/contracts/deployments/${network.id === 1 ? 'mainnet' : 'sepolia'}/${name}.json`;
    const artifact = await (await fetch(url, { signal: AbortSignal.timeout(60000) })).json();
    if (artifact.address.toLowerCase() !== network.addresses[name].toLowerCase()) throw new Error(`Deployment address drift: ${url}`);
    snapshots[network.id][name] = artifact.abi;
    await fs.writeFile(`src/config/artifacts/${network.id === 1 ? 'mainnet' : 'sepolia'}-${name}.abi.json`, JSON.stringify(artifact.abi, null, 2) + '\n');
  }
}
const old = await fs.readFile('src/config/abis.ts', 'utf8');
let generated = '// Generated from the docs-pinned deployment artifacts. Run npm run generate:abis.\n';
for (const [key, [file, names]] of Object.entries(selections)) {
  const select = id => snapshots[id][file].filter(entry => names.includes(entry.name) && ['function','event'].includes(entry.type));
  const abi = select(1);
  // Internal Solidity type names and output names do not affect encoding.
  const shape = entries => JSON.stringify(entries.map(entry => ({
    name: entry.name,
    encodedShape: JSON.parse(JSON.stringify(entry, (key, value) => ['internalType','name'].includes(key) ? undefined : value)),
  })));
  if (key === "registryAbi") for (const id of [1, 11155111]) {
    const eth = snapshots[id].ETHRegistry.filter(entry => names.includes(entry.name) && ['function','event'].includes(entry.type));
    if (shape(abi) !== shape(eth)) throw new Error(`ETHRegistry ABI drift on ${id}`);
  }
  if (shape(abi) !== shape(select(11155111))) throw new Error(`Network ABI drift: ${key}; generate separate network interfaces`);
  generated += `export const ${key} = ${JSON.stringify(abi, null, 2)} as const;\n\n`;
}
await fs.writeFile('src/config/abis.ts', generated + old.slice(old.indexOf('/** ERC20')));
