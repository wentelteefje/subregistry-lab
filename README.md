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

Mainnet uses the active ENSv2 deployments and their Universal Resolver. Mainnet transactions spend real ETH and USDC.

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

- `src/config/deployments.ts` pins the addresses, artifact commits, independent registry/factory scan blocks, payment token, and scan configuration for each network to the [ENS deployment docs](https://docs.ens.domains/learn/deployments/).
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

The sidebar switches between **Deployment & configuration** and **Playground** (a two-item navigation above the content on mobile). Saved contracts and setup transactions stay in the deployment view after completion or reload. Both views stay mounted when switching, preserving drafts and active transactions. A successful setup opens the playground only after the linked registry is verified; ordinary background reads never switch views.

Pending transactions appear above the active view. Receipt checks restore captured deployment results. For a wallet speed-up or cancellation after refresh, paste the replacement hash from wallet activity: recovery requires a mined transaction from the same wallet using the original nonce. A consumed nonce alone does not discard an unknown transaction. Confirmed transactions that fail read-back are kept distinct from pending transactions, so they do not block unrelated actions or automatically charge again.

The wallet's pending nonce and exact request are saved before submission, and that nonce is included in the wallet request. This lets a mined replacement be recovered even when the original transaction never appeared in the public mempool. A sender-level lock prevents concurrent lab flows from selecting the same nonce. Verification reads use an explicit block at or after the transaction's receipt block.

Paid registration and renewal are separate choices. A confirmed payment with a failed read-back is retained; starting another paid action requires acknowledging that previous payment. Interrupted unsigned wallet prompts are marked failed on reload rather than blocking setup indefinitely. Previously deployed own resolvers are saved per subname and reused when switching back.

Setup review lists every planned transaction before any wallet request. Expand **Transaction details** for the network, sender, target, function signature, named arguments, nested proxy initializer, raw calldata (or CREATE initcode), byte hash and copyable RPC request JSON. Fees and the pending nonce are assigned at submission. **Start setup transactions** explicitly starts the sequence; already-satisfied actions are checked and skipped.

A setup's deployment salt persists across refreshes. Factory address prediction makes most dependent setup calls inspectable in advance, and deployment receipts must match those predictions. The registrar uses CREATE, so its authorization call becomes fully inspectable only after the registrar address is confirmed. Pending and confirmed requests show their recorded data; failed attempts show the next request and retain the previous attempt separately. Configuration is frozen once setup begins; use Replace with a new setup to reconfigure.

Review diagrams show labelled Alice/Bob configuration examples; setup does not register these names. The compact routing diagram uses local labels in the registry and fully qualified names in resolvers. Click a contract’s **Inspect** header for contract details, a registry label for ownership/expiry/permissions, or a resolver name for its records. A read-only drawer overlays the page on desktop and becomes a bottom sheet on mobile. It shows the pinned block, separates label and root permissions, and offers copyable identifiers, explorer links and manual profile lookup. Profile keys come from resolver events and their values are checked on-chain; incomplete history and unavailable reads are disclosed. The responsive diagram retains the grid background, keeps linked resolvers visible even before records are set, and omits record boxes and unattached placeholders.

Wallet cancellations show a short summary with a Resume action. Full diagnostics, including legacy saved viem errors, are available only in a collapsed, height-limited disclosure that wraps calldata. Existing saved errors are formatted at render time without clearing the session.

Registry restoration keeps browsing metadata separate from the saved deployment journal. **Refresh registries** updates discovery and the live parent pointer; receipt-confirmed deployments remain listed if the history RPC fails. **Re-link** requires a wallet transaction, while **Open playground** adopts a registry that is already linked. Adoption restores the target’s factory deployment block (or clears an unknown hint), validates its registrar independently, and preserves the original setup receipts and salt. An adopted registry is never treated as a replacement deployment result. Failed relinks remain visible after reload, and failed subname reads show an unavailable count instead of zero. The Playground always shows its linked registry address. Resolver-link polling pauses while the Playground is hidden.

Saved registry addresses and known factory deployment blocks persist per wallet and deployment set across replacements, session resets and reloads. If an older registry predates this local history and the RPC scan cannot find it, use **Restore a registry by address**. Both restore paths check the recorded parent before opening the wallet; an unparented registry also requires the wallet’s parent-setting permission. The app never sends a restoration transaction automatically.

**Inspect a name** is an independent read-only workspace available without a wallet. Enter a `.eth` parent (including deeper registered or reserved parents), choose Ethereum or Sepolia, and submit. Its network selector does not switch your wallet or change a saved setup. The view reads owners, expiry, registries, labels and resolver pointers at a pinned block; contract/name details remain clickable and contain no transaction controls. Inspection refreshes explicitly, pauses when hidden, paginates diagrams to 25 labels, and limits state enumeration to 500 historical labels. Reserved labels are discovered from `LabelReserved` as well as `LabelRegistered`; inactive labels are kept outside the live routing diagram. Registrar discovery is optional and identifies lab-compatible registrars only. Failed/unsupported reads are disclosed instead of displaying an empty configuration.

### Public RPC reliability and inspection snapshots

Normal reads and all history scanners share a paced public RPC pool per chain (`src/lib/rpcPool.ts`). Ethereum uses Tenderly, PublicNode, and dRPC; Sepolia uses Tenderly, PublicNode, and [1RPC's public endpoint](https://docs.1rpc.io/overview/supported-networks). No API key or subscription is required. Each endpoint is attempted once per logical request; HTTP and outer transport retries are disabled. Throttled providers cool down with exponential backoff (and readable `Retry-After` headers), and connection/state failures move to another provider. Log requests verify that the provider has reached the requested end block. No health polling is used.

History scans adapt only to range-limit errors, retain completed chunks during failover, and stop after 96 scan attempts or a 60-second scan budget (shared across resolver creation/history scans). Exact bounded log responses are deduplicated and cached in memory for 60 seconds (up to 512 entries, excluding responses over 5,000 logs). Label and root-role discovery share the same history filter. Bounded in-memory scan checkpoints last one hour and resume completed chunks, re-reading a 64-block near-head overlap on refresh. Partial scans are identified explicitly; an incomplete list never becomes a verified zero count. RPC connection details in **Inspect a name** show provider failures, cooldown times, attempts, and recovered requests.

Inspection results stay cached for the browser session, and inactive drawer results remain cached for 30 minutes, including runs of 30+ names. Submitting a previously inspected name reuses its snapshot; **Refresh configuration** reads a new snapshot. Drawers opened from Inspect use that snapshot's block. If public providers no longer serve its historical state, refresh the configuration rather than interpreting the error as missing records. Failed manual lookups and unavailable profiles are visible and retryable. Session caches clear on a page reload; history is not persisted as authoritative chain state.
