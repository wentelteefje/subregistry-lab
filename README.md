# ENSv2 Subregistry Lab

A browser playground for experimenting with **ENSv2 subname registry setups on Sepolia and Ethereum Mainnet**, no coding required. It automates the steps from the ENSv2 ["For Contract Developers"](https://docs.ens.domains/contracts/ensv2/tutorial-contract-developers) guide behind a wallet UI.

## What you can do

1. **Connect** a wallet and select a network.
2. **Pick a .eth name you own** (auto-detected, with expiry shown).
3. **Choose a configuration:**
   - **Fully controlled**: you keep every permission (default for experimenting).
   - **Standard rentable**: also deploys the guide's SimpleSubnameRegistrar so anyone can register subnames for a fee in USDC (a faucet is available on Sepolia).
   - **Unruggable, unexpiring**: subnames registered with a never-expiring lifetime and minimal permissions, plus an optional lock step that irreversibly removes your own dangerous roles.
4. **Execute**: the app walks through the transactions one by one (deploy registry → deploy resolver → link name → point the name at the resolver → deploy registrar → grant roles), verifying each result on-chain.
5. **Playground**: register subnames (free as owner, or paid via the registrar), set address records, run live resolve checks, and watch the setup diagram update.
6. **Experiment freely**: re-running the setup replaces the registry linked to your name. Old registries keep their subnames and can be re-adopted later.

Explorer and Etherscan links follow the selected network.

Mainnet uses the documented prelaunch ENSv2 deployments and its explicit Universal Resolver. Canonical Mainnet wallets still use ENSv1 until the protocol cutover; owning a v1 name does not make it available in this v2 wizard. Mainnet transactions spend real ETH and USDC.

A registry lock is verified across all root assignees. The parent-link lock applies only to its current registration: keep the parent `.eth` renewed. Standard safe transfers also require contract-level emancipation.

## Getting Sepolia prerequisites

- Sepolia ETH for gas: any Sepolia faucet.
- A .eth name on the ENSv2 Sepolia deployment: register one in the [ENS Explorer](https://sepolia.explorer.ens.domains).
- Test USDC (only for the rentable preset): the app has a mint button.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest unit tests (pure logic: bitmaps, plans, parsing)
npm run build      # type check + production build to dist/
```

Optional `.env` (see `.env.example`): `VITE_WALLETCONNECT_PROJECT_ID` for WalletConnect wallets; injected wallets (MetaMask etc.) work without it.

## Deployment

Static site; `netlify.toml` is included:

```sh
netlify deploy --prod    # or connect the repo in the Netlify UI
```

## Configuration

- `src/config/deployments.ts` pins the addresses, artifact commits, independent registry/factory scan blocks, payment token, and RPC for each network to the [ENS deployment docs](https://docs.ens.domains/learn/deployments/).
- Mainnet artifact commit: `4f47cbcc11462fb413196e6b5c0f8090247a6c08`; Sepolia: `07e55a056f5b6a9c90119f501bdd05714e67dddd`. Reviewed against `post-audit-2` at `28d9a96378f7b8d8f5cda1b054161d63d280bc9f`.
- Run `npm run generate:abis` with Node 22.6+ to refresh the checked-in ABI snapshots and typed surfaces. It verifies deployment addresses and matching network interfaces. ABI tests check signatures, outputs, mutability, and event indexing.
- The bundled registrar is built from `contracts/SimpleSubnameRegistrar.sol` with pinned `solc` 0.8.25 using `npm run build:registrar`. Dependencies come from the embedded sources in the pinned ETHRegistrar deployment metadata; compiler settings and source hash are recorded in the generated artifact. Both regeneration commands require network access.
- Mainnet payment is USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, 6 decimals); Sepolia uses the documented MockUSDC. The faucet is guarded in both the UI and transaction builder.
- Sessions and scan cursors include network and deployment identity. Legacy storage is retained but never reused for the new deployments. History recognizes known earlier implementations deployed through the selected factory.

## Architecture notes

- `src/lib/` is pure, unit-tested logic: role bitmaps (`roles.ts`), presets (`presets.ts`), transaction plans (`steps.ts`), log-scan helpers (`logs.ts`), diagram model (`diagramModel.ts`).
- `src/hooks/useTxSequence.ts` runs the plans: simulate → wallet → mine → verify (read-back), with resume support after rejections or refreshes.
- Session state (selected name, deployed addresses, progress) persists in localStorage; all chain state is re-read live, on-chain truth wins.

## Fork integration tests

Install Foundry's `anvil` and run `npm run test:fork`. This starts local forks at finalized blocks on ports 18545 and 18546. It verifies proxy initialization, direct/paid registrations, renewal, resolver writes and v2 resolution, resolver switching, interrupted deployment recovery, and both locks against the actual deployments. Upstream public RPCs are read-only; every transaction goes to localhost. Test-only impersonation provisions the parent name and USDC.

Set `ENS_FORK_RPC_MAINNET` and `ENS_FORK_RPC_SEPOLIA` to override the public upstream endpoints if they throttle or reject historical state reads. The regular unit suite runs independently with `npm test`.

Pending transactions appear above the wizard. Receipt checks restore captured deployment results. For a wallet speed-up or cancellation after refresh, paste the replacement hash from wallet activity: recovery requires a mined transaction from the same wallet using the original nonce. A consumed nonce alone does not discard an unknown transaction. Confirmed transactions that fail read-back are kept distinct from pending transactions, so they do not block unrelated actions or automatically charge again.
