import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import solc from 'solc';

// The deployment metadata embeds the complete, audited source dependencies.
const commit = '4f47cbcc11462fb413196e6b5c0f8090247a6c08';
const path = `https://raw.githubusercontent.com/ensdomains/contracts-v2/${commit}/contracts/deployments/mainnet/ETHRegistrar.json`;
const artifact = process.env.ENS_ARTIFACT_PATH
  ? JSON.parse(await fs.readFile(process.env.ENS_ARTIFACT_PATH, 'utf8'))
  : await (await fetch(path, { signal: AbortSignal.timeout(60000) })).json();
const metadata = JSON.parse(artifact.metadata);
const sources = Object.fromEntries(Object.entries(metadata.sources).map(([name, source]) => {
  if (!source.content) throw new Error(`Missing embedded source: ${name}`);
  return [name, { content: source.content }];
}));
const source = await fs.readFile('contracts/SimpleSubnameRegistrar.sol', 'utf8');
sources['contracts/SimpleSubnameRegistrar.sol'] = { content: source };
const settings = {
  optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
  remappings: [
    '@openzeppelin/contracts/=project/lib/openzeppelin-contracts/contracts/',
    '@ensdomains/contracts-v2/=project/src/',
  ],
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
};
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
const errors = output.errors?.filter(error => error.severity === 'error') ?? [];
if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
const contract = output.contracts['contracts/SimpleSubnameRegistrar.sol'].SimpleSubnameRegistrar;
const result = {
  contractName: 'SimpleSubnameRegistrar', abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  provenance: { compiler: solc.version(), settings, dependencies: path, sourceSha256: createHash('sha256').update(source).digest('hex') },
};
await fs.writeFile('src/config/artifacts/SimpleSubnameRegistrar.json', JSON.stringify(result, null, 2) + '\n');
console.log(`Built SimpleSubnameRegistrar using ${solc.version()}`);
