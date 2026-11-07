import { packetToBytes } from "viem/ens";
/**
 * Pure transaction-plan builders. A StepDef describes one transaction:
 * how to build it, how to extract results from its receipt, and how to
 * verify the on-chain outcome afterwards. The runner (useTxSequence) walks
 * the list; everything here is deterministic and unit-testable.
 */

import {
  encodeFunctionData,
  toHex,
  encodeAbiParameters,
  decodeFunctionResult,
  keccak256,
  parseEventLogs,
  zeroAddress,
  type Abi,
  type Address,
  type TransactionReceipt,
} from "viem";
import registrarArtifact from "../config/artifacts/SimpleSubnameRegistrar.json";
import {
  erc20Abi,
  registryAbi,
  resolverInitAbi,
  resolverAbi,
  simpleRegistrarAbi,
  userRegistryInitAbi,
  verifiableFactoryAbi,
} from "../config/abis";
import { getDeployment } from "../config/deployments";
import { labelhashId } from "./names";
import { deriveSalt } from "./salt";
import { ALL_ROLES } from "./roles";
import {
  DANGEROUS_ROOT_BITMAP,
  MAX_EXPIRY,
  getPreset,
  type Preset,
  type PresetId,
} from "./presets";
import { ROLE_SET_SUBREGISTRY, adminOf } from "./roles";

export type WriteAction = {
  type: "write";
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
};

export type DeployAction = {
  type: "deploy";
  abi: Abi;
  bytecode: `0x${string}`;
  args: readonly unknown[];
};

export type StepAction = WriteAction | DeployAction;

/** Minimal read interface so verify() is stubbable in tests. */
export type ReadFn = (params: {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  blockNumber?: bigint;
}) => Promise<unknown>;

export type StepCtx = {
  chainId?: number;
  setupNonce?: string;
  expectedAddresses?: { userRegistry?: Address; resolver?: Address };
  reviewedRequests?: Record<string, `0x${string}`>;
  account: Address;
  parentLabel: string;
  ownerInitBitmap: bigint;
  deployResolver: boolean;
  existingResolver?: Address;
  registrarParams?: {
    pricePerYear: bigint;
    minDuration: bigint;
    beneficiary: Address;
    grantBitmap: bigint;
  };
  // Filled in by onReceipt patches while the sequence runs:
  userRegistry?: Address;
  resolver?: Address;
  registrar?: Address;
  /** A subname's own resolver, cached by full name for switch-flow recovery. */
  subResolver?: Address;
  subResolverName?: string;
};

export type StepDef = {
  id: string;
  title: string;
  /** One-liner for non-coders, shown under the title. */
  explain: string;
  skipIf?: (ctx: StepCtx) => boolean;
  build: (ctx: StepCtx) => StepAction;
  onReceipt?: (receipt: TransactionReceipt, ctx: StepCtx) => Partial<StepCtx>;
  preflight?: boolean;
  intentSeed?: string;
  targetName?: string;
  registryDeployBlock?: string;
  capture?: "userRegistry" | "resolver" | "registrar" | "subResolver";
  needs?: ("userRegistry" | "resolver" | "registrar")[];
  guard?: (read: ReadFn, ctx: StepCtx) => Promise<void>;
  verify?: (
    read: ReadFn,
    ctx: StepCtx,
  ) => Promise<{ ok: boolean; detail: string }>;
};

const registrarAbi = registrarArtifact.abi as Abi;
const registrarBytecode = registrarArtifact.bytecode as `0x${string}`;

function parseProxyAddress(receipt: TransactionReceipt): Address {
  const [log] = parseEventLogs({
    abi: verifiableFactoryAbi,
    eventName: "ProxyDeployed",
    logs: receipt.logs,
  });
  if (!log) throw new Error("ProxyDeployed event not found in receipt");
  return log.args.proxyAddress;
}

function checkedProxyAddress(
  receipt: TransactionReceipt,
  expected?: Address,
): Address {
  const actual = parseProxyAddress(receipt);
  if (expected && actual.toLowerCase() !== expected.toLowerCase())
    throw new Error(
      `Deployed address ${actual} differs from reviewed address ${expected}. Stop and inspect the transaction.`,
    );
  return actual;
}

/** The main setup sequence for a preset. */
export function buildSetupSteps(
  preset: Preset | PresetId,
  chainId = 11155111,
): StepDef[] {
  const deployments = getDeployment(chainId).addresses;
  const p = typeof preset === "string" ? getPreset(preset) : preset;

  const steps: StepDef[] = [
    {
      id: "deploy-registry",
      capture: "userRegistry",
      intentSeed: "registry",
      title: "Deploy your subname registry",
      explain:
        "Creates a fresh UserRegistry contract that will hold your subnames.",
      build: (ctx) => ({
        type: "write",
        address: deployments.VerifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "deployProxy",
        args: [
          deployments.UserRegistryImpl,
          deriveSalt(ctx.parentLabel, ctx.setupNonce),
          encodeFunctionData({
            abi: userRegistryInitAbi,
            functionName: "initialize",
            args: [[{ account: ctx.account, roleBitmap: ctx.ownerInitBitmap }]],
          }),
        ],
      }),
      onReceipt: (receipt, ctx) => ({
        userRegistry: checkedProxyAddress(
          receipt,
          ctx.expectedAddresses?.userRegistry,
        ),
      }),
      verify: async (read, ctx) => {
        if (!ctx.userRegistry)
          return { ok: false, detail: "No registry address captured" };
        const ok = (await read({
          address: ctx.userRegistry,
          abi: registryAbi,
          functionName: "hasRootRoles",
          args: [ctx.ownerInitBitmap, ctx.account],
        })) as boolean;
        return {
          ok,
          detail: ok
            ? `Registry live at ${ctx.userRegistry}; you hold the configured roles`
            : "Registry deployed but your roles are missing",
        };
      },
    },
    {
      id: "deploy-resolver",
      capture: "resolver",
      intentSeed: "resolver",
      title: "Deploy a resolver",
      explain:
        "Creates a resolver contract so your subnames can hold address records.",
      skipIf: (ctx) => !ctx.deployResolver,
      build: (ctx) => ({
        type: "write",
        address: deployments.VerifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "deployProxy",
        args: [
          deployments.PermissionedResolverImpl,
          deriveSalt(`${ctx.parentLabel}-resolver`, ctx.setupNonce),
          encodeFunctionData({
            abi: resolverInitAbi,
            functionName: "initialize",
            args: [[{ account: ctx.account, roleBitmap: ALL_ROLES }], []],
          }),
        ],
      }),
      onReceipt: (receipt, ctx) => ({
        resolver: checkedProxyAddress(receipt, ctx.expectedAddresses?.resolver),
      }),
      verify: async (read, ctx) => {
        if (!ctx.resolver)
          return { ok: false, detail: "No resolver address captured" };
        const ok = await read({
          address: ctx.resolver,
          abi: resolverAbi,
          functionName: "hasRootRoles",
          args: [ALL_ROLES, ctx.account],
        });
        return { ok: Boolean(ok), detail: "Resolver administrator verified" };
      },
    },
    {
      id: "link",
      needs: ["userRegistry"],
      title: "Point your name at the new registry",
      explain:
        "Tells the .eth registry that subnames of your name live in your new registry.",
      build: (ctx) => ({
        type: "write",
        address: deployments.ETHRegistry,
        abi: registryAbi,
        functionName: "setSubregistry",
        args: [labelhashId(ctx.parentLabel), ctx.userRegistry],
      }),
      verify: async (read, ctx) => {
        const linked = (await read({
          address: deployments.ETHRegistry,
          abi: registryAbi,
          functionName: "getSubregistry",
          args: [ctx.parentLabel],
        })) as Address;
        const ok =
          linked.toLowerCase() === (ctx.userRegistry ?? "").toLowerCase();
        return {
          ok,
          detail: ok
            ? `${ctx.parentLabel}.eth now points at ${linked}`
            : `Link mismatch: registry reports ${linked}`,
        };
      },
    },
    {
      id: "set-parent-resolver",
      needs: ["resolver"],
      title: "Point your name at the resolver",
      explain:
        "Sets your name's resolver on the .eth registry. The app treats whatever the parent points at as the setup's shared resolver, so this keeps parent and subnames in sync.",
      // Only skipped when this setup has no resolver at all; reusing an
      // already-linked resolver auto-skips via the pre-run verify.
      skipIf: (ctx) => !ctx.deployResolver && !ctx.resolver,
      build: (ctx) => ({
        type: "write",
        address: deployments.ETHRegistry,
        abi: registryAbi,
        functionName: "setResolver",
        args: [labelhashId(ctx.parentLabel), ctx.resolver],
      }),
      verify: async (read, ctx) => {
        const linked = (await read({
          address: deployments.ETHRegistry,
          abi: registryAbi,
          functionName: "getResolver",
          args: [ctx.parentLabel],
        })) as Address;
        const ok = linked.toLowerCase() === (ctx.resolver ?? "").toLowerCase();
        return {
          ok,
          detail: ok
            ? `${ctx.parentLabel}.eth records live at ${linked}`
            : `Resolver mismatch: registry reports ${linked}`,
        };
      },
    },
    {
      id: "set-parent",
      needs: ["userRegistry"],
      title: "Record the parent pointer",
      explain:
        "Stores which name this registry serves (metadata used by explorers and indexers; resolution doesn't depend on it, but it can't be set anymore after locking).",
      build: (ctx) => ({
        type: "write",
        address: ctx.userRegistry!,
        abi: registryAbi,
        functionName: "setParent",
        args: [deployments.ETHRegistry, ctx.parentLabel],
      }),
      verify: async (read, ctx) => {
        const [parent, label] = (await read({
          address: ctx.userRegistry!,
          abi: registryAbi,
          functionName: "getParent",
          args: [],
        })) as [Address, string];
        const ok =
          parent.toLowerCase() === deployments.ETHRegistry.toLowerCase() &&
          label === ctx.parentLabel;
        return {
          ok,
          detail: ok
            ? `Registry knows it serves ${ctx.parentLabel}.eth`
            : `getParent() reports (${parent}, "${label}")`,
        };
      },
    },
    {
      id: "deploy-registrar",
      needs: ["userRegistry"],
      capture: "registrar",
      intentSeed: "registrar",
      title: "Deploy the subname registrar",
      explain: "Creates the contract that sells subnames for USDC.",
      skipIf: (ctx) => !ctx.registrarParams,
      build: (ctx) => ({
        type: "deploy",
        abi: registrarAbi,
        bytecode: registrarBytecode,
        args: [
          ctx.userRegistry,
          deployments.PaymentToken,
          ctx.registrarParams!.beneficiary,
          ctx.registrarParams!.pricePerYear,
          ctx.registrarParams!.minDuration,
        ],
      }),
      onReceipt: (receipt) => {
        if (!receipt.contractAddress)
          throw new Error("No contract address in deploy receipt");
        return { registrar: receipt.contractAddress };
      },
    },
    {
      id: "grant-registrar",
      needs: ["userRegistry", "registrar"],
      title: "Authorize the registrar",
      explain:
        "Allows the registrar contract to register and renew subnames in your registry.",
      skipIf: (ctx) => !ctx.registrarParams,
      build: (ctx) => ({
        type: "write",
        address: ctx.userRegistry!,
        abi: registryAbi,
        functionName: "grantRootRoles",
        args: [ctx.registrarParams!.grantBitmap, ctx.registrar],
      }),
      verify: async (read, ctx) => {
        const ok = (await read({
          address: ctx.userRegistry!,
          abi: registryAbi,
          functionName: "hasRootRoles",
          args: [ctx.registrarParams!.grantBitmap, ctx.registrar],
        })) as boolean;
        return {
          ok,
          detail: ok
            ? "Registrar can now register and renew subnames"
            : "Registrar roles missing after grant",
        };
      },
    },
  ];

  // Presets without a registrar simply skip those steps via skipIf.
  void p;
  return steps;
}

/** Direct owner registration of a subname (no registrar, no payment). */
export function buildDirectRegisterStep(params: {
  chainId?: number;
  userRegistry: Address;
  label: string;
  owner: Address;
  resolver: Address;
  roleBitmap: bigint;
  expiry: bigint; // absolute unix timestamp, or MAX_EXPIRY for "never"
}): StepDef[] {
  return [
    {
      id: "direct-register",
      preflight: false,
      title: `Register ${params.label}`,
      explain:
        params.expiry === MAX_EXPIRY
          ? "Registers the subname with a never-expiring lifetime."
          : "Registers the subname until the chosen expiry date.",
      build: () => ({
        type: "write",
        address: params.userRegistry,
        abi: registryAbi,
        functionName: "register",
        args: [
          params.label,
          params.owner,
          zeroAddress,
          params.resolver,
          params.roleBitmap,
          params.expiry,
        ],
      }),
      verify: async (read) => {
        const state = (await read({
          address: params.userRegistry,
          abi: registryAbi,
          functionName: "getState",
          args: [labelhashId(params.label)],
        })) as { latestOwner: Address; status: number; expiry: bigint };
        const [resolver, subregistry, roles] = await Promise.all([
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "getResolver",
            args: [params.label],
          }),
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "getSubregistry",
            args: [params.label],
          }),
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "roles",
            args: [labelhashId(params.label), params.owner],
          }),
        ]);
        const ok =
          state.status === 2 &&
          state.expiry === params.expiry &&
          state.latestOwner.toLowerCase() === params.owner.toLowerCase() &&
          String(resolver).toLowerCase() === params.resolver.toLowerCase() &&
          String(subregistry).toLowerCase() === zeroAddress &&
          ((roles as bigint) & params.roleBitmap) === params.roleBitmap;
        return {
          ok,
          detail: ok
            ? `${params.label} registered to ${state.latestOwner}`
            : `Owner is ${state.latestOwner}`,
        };
      },
    },
  ];
}

/** Paid registration through the SimpleSubnameRegistrar: approve (if needed) + register. */
export function buildRegistrarRegisterSteps(params: {
  chainId?: number;
  registrar: Address;
  userRegistry: Address;
  label: string;
  owner: Address;
  resolver: Address;
  duration: bigint; // seconds
  price: bigint; // USDC 6-decimals, pre-read via getPrice
  currentAllowance: bigint;
  payer?: Address;
  renewFromExpiry?: bigint;
}): StepDef[] {
  const deployments = getDeployment(params.chainId).addresses;
  return [
    {
      id: "approve-usdc",
      title: "Approve USDC",
      explain:
        "Allows the registrar to take the registration fee from your wallet.",
      verify: async (read) => {
        const allowance = await read({
          address: deployments.PaymentToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [params.payer ?? params.owner, params.registrar],
        });
        return {
          ok: (allowance as bigint) >= params.price,
          detail: "Payment allowance verified",
        };
      },
      build: () => ({
        type: "write",
        address: deployments.PaymentToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [params.registrar, params.price],
      }),
    },
    {
      id: "registrar-register",
      preflight: false,
      title: `${params.renewFromExpiry === undefined ? "Register" : "Renew"} ${params.label} (paid)`,
      explain: "Registers the subname through the registrar, paying the fee.",
      build: () => ({
        type: "write",
        address: params.registrar,
        abi: simpleRegistrarAbi,
        functionName:
          params.renewFromExpiry === undefined ? "register" : "renew",
        args:
          params.renewFromExpiry === undefined
            ? [params.label, params.owner, params.resolver, params.duration]
            : [params.label, params.duration],
      }),
      verify: async (read) => {
        const state = (await read({
          address: params.userRegistry,
          abi: registryAbi,
          functionName: "getState",
          args: [labelhashId(params.label)],
        })) as { latestOwner: Address; status: number; expiry: bigint };
        const resolver =
          params.renewFromExpiry === undefined
            ? await read({
                address: params.userRegistry,
                abi: registryAbi,
                functionName: "getResolver",
                args: [params.label],
              })
            : undefined;
        const expectedExpiry =
          params.renewFromExpiry === undefined
            ? 0n
            : params.renewFromExpiry + params.duration;
        const ok =
          state.status === 2 &&
          state.expiry >= expectedExpiry &&
          state.latestOwner.toLowerCase() === params.owner.toLowerCase() &&
          (params.renewFromExpiry !== undefined ||
            String(resolver).toLowerCase() === params.resolver.toLowerCase());
        return {
          ok,
          detail: ok
            ? `${params.label} registered to ${state.latestOwner}`
            : `Owner is ${state.latestOwner}`,
        };
      },
    },
  ];
}

/** Lock step 1: give up dangerous root roles on the UserRegistry. */
export function buildRevokeRegistryRolesStep(params: {
  chainId?: number;
  userRegistry: Address;
  account: Address;
}): StepDef[] {
  return [
    {
      id: "revoke-registry-roles",
      title: "Give up dangerous registry roles",
      explain:
        "Revokes your own delete/renew/re-point/upgrade permissions on the registry. Irreversible.",
      guard: async (read) => {
        const [roles, counts] = await Promise.all([
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "roles",
            args: [0n, params.account],
          }),
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "roleCount",
            args: [0n],
          }),
        ]);
        if (
          ((counts as bigint) & (DANGEROUS_ROOT_BITMAP * 15n)) !==
          ((roles as bigint) & DANGEROUS_ROOT_BITMAP)
        ) {
          throw new Error(
            "Other accounts hold lock permissions. Revoke those grants before removing your own admin roles.",
          );
        }
      },
      build: () => ({
        type: "write",
        address: params.userRegistry,
        abi: registryAbi,
        functionName: "revokeRootRoles",
        args: [DANGEROUS_ROOT_BITMAP, params.account],
      }),
      verify: async (read) => {
        const [roles, emancipated, counts] = await Promise.all([
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "roles",
            args: [0n, params.account],
          }),
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "isEmancipated",
            args: [],
          }),
          read({
            address: params.userRegistry,
            abi: registryAbi,
            functionName: "roleCount",
            args: [0n],
          }),
        ]);
        // roleCount uses four-bit counters; expand the bitmap to cover every counter bit.
        const mask = DANGEROUS_ROOT_BITMAP * 15n;
        const empty = ((roles as bigint) & DANGEROUS_ROOT_BITMAP) === 0n;
        const noAssignees = ((counts as bigint) & mask) === 0n;
        return {
          ok: empty && Boolean(emancipated) && noAssignees,
          detail:
            empty && noAssignees && emancipated
              ? "Registry lock verified across all root assignees"
              : "Root permissions remain; all holders must revoke them before the registry is locked",
        };
      },
    },
  ];
}

/**
 * Lock step 2: give up the permission to re-point the parent name's
 * subregistry link. The EAC resource for the name must be read first
 * (it embeds a version counter; the canonical id is NOT the resource).
 */
export function buildLockParentLinkStep(params: {
  chainId?: number;
  parentLabel: string;
  parentResource: bigint; // pre-read via ETHRegistry.getResource(labelhashId(label))
  account: Address;
}): StepDef[] {
  const deployments = getDeployment(params.chainId).addresses;
  const bitmap = ROLE_SET_SUBREGISTRY | adminOf(ROLE_SET_SUBREGISTRY);
  return [
    {
      id: "lock-parent-link",
      title: "Lock your name's registry pointer",
      explain:
        "Revokes your permission to change which registry your .eth name points at. Irreversible.",
      guard: async (read) => {
        const [roles, counts] = await Promise.all([
          read({
            address: deployments.ETHRegistry,
            abi: registryAbi,
            functionName: "roles",
            args: [params.parentResource, params.account],
          }),
          read({
            address: deployments.ETHRegistry,
            abi: registryAbi,
            functionName: "roleCount",
            args: [params.parentResource],
          }),
        ]);
        if (
          ((counts as bigint) & (bitmap * 15n)) !==
          ((roles as bigint) & bitmap)
        ) {
          throw new Error(
            "Other accounts hold lock permissions. Revoke those grants before removing your own admin roles.",
          );
        }
      },
      build: () => ({
        type: "write",
        address: deployments.ETHRegistry,
        abi: registryAbi,
        functionName: "revokeRoles",
        args: [params.parentResource, bitmap, params.account],
      }),
      verify: async (read) => {
        const [roles, counts] = await Promise.all([
          read({
            address: deployments.ETHRegistry,
            abi: registryAbi,
            functionName: "roles",
            args: [params.parentResource, params.account],
          }),
          read({
            address: deployments.ETHRegistry,
            abi: registryAbi,
            functionName: "roleCount",
            args: [params.parentResource],
          }),
        ]);
        const empty = ((roles as bigint) & bitmap) === 0n;
        const noAssignees = ((counts as bigint) & (bitmap * 15n)) === 0n;
        return {
          ok: empty && noAssignees,
          detail:
            empty && noAssignees
              ? "Parent resource permissions removed; keep the parent name renewed"
              : "Link permissions remain on this resource; other assignees may need to revoke theirs",
        };
      },
    },
  ];
}

/** Re-link a previously deployed registry to the parent name. */
export function buildRelinkStep(params: {
  chainId?: number;
  parentLabel: string;
  registry: Address;
  registryDeployBlock?: bigint;
}): StepDef[] {
  const deployments = getDeployment(params.chainId).addresses;
  return [
    {
      id: "relink",
      registryDeployBlock: params.registryDeployBlock?.toString(),
      title: `Re-link registry ${params.registry.slice(0, 6)}…`,
      explain:
        "Points your name back at this registry. Its subnames resolve again; the currently linked registry keeps its subnames and can be re-linked later too.",
      build: () => ({
        type: "write",
        address: deployments.ETHRegistry,
        abi: registryAbi,
        functionName: "setSubregistry",
        args: [labelhashId(params.parentLabel), params.registry],
      }),
      verify: async (read) => {
        const linked = (await read({
          address: deployments.ETHRegistry,
          abi: registryAbi,
          functionName: "getSubregistry",
          args: [params.parentLabel],
        })) as Address;
        const ok = linked.toLowerCase() === params.registry.toLowerCase();
        return {
          ok,
          detail: ok
            ? `${params.parentLabel}.eth now points at ${linked}`
            : `Link is ${linked}`,
        };
      },
    },
  ];
}

/**
 * A subname owner leaves the shared resolver: deploy their own
 * PermissionedResolver proxy, then point the subname at it.
 */
export function buildSwitchResolverSteps(params: {
  chainId?: number;
  userRegistry: Address;
  parentLabel: string;
  label: string;
  /** Subname owner: becomes the new resolver's admin. */
  owner: Address;
}): StepDef[] {
  const deployments = getDeployment(params.chainId).addresses;
  const fqdnStr = `${params.label}.${params.parentLabel}.eth`;
  return [
    {
      id: "deploy-sub-resolver",
      capture: "subResolver",
      intentSeed: fqdnStr,
      targetName: fqdnStr,
      title: `Deploy an own resolver for ${fqdnStr}`,
      explain: "Creates a fresh resolver administered by the subname's owner.",
      build: () => ({
        type: "write",
        address: deployments.VerifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "deployProxy",
        args: [
          deployments.PermissionedResolverImpl,
          deriveSalt(`${fqdnStr}-own-resolver`),
          encodeFunctionData({
            abi: resolverInitAbi,
            functionName: "initialize",
            args: [[{ account: params.owner, roleBitmap: ALL_ROLES }], []],
          }),
        ],
      }),
      onReceipt: (receipt) => ({
        subResolver: parseProxyAddress(receipt),
        subResolverName: fqdnStr,
      }),
      verify: async (read, ctx) => {
        if (!ctx.subResolver)
          return { ok: false, detail: "No resolver address captured" };
        const ok = (await read({
          address: ctx.subResolver,
          abi: registryAbi,
          functionName: "hasRootRoles",
          args: [ALL_ROLES, params.owner],
        })) as boolean;
        return {
          ok,
          detail: ok
            ? `Resolver live at ${ctx.subResolver}; owner holds all roles`
            : "Resolver deployed but owner roles are missing",
        };
      },
    },
    {
      id: "set-sub-resolver",
      title: `Point ${fqdnStr} at it`,
      explain:
        "The subname's records move to its own resolver; the shared resolver no longer serves it.",
      build: (ctx) => ({
        type: "write",
        address: params.userRegistry,
        abi: registryAbi,
        functionName: "setResolver",
        args: [labelhashId(params.label), ctx.subResolver],
      }),
      verify: async (read, ctx) => {
        const linked = (await read({
          address: params.userRegistry,
          abi: registryAbi,
          functionName: "getResolver",
          args: [params.label],
        })) as Address;
        const ok =
          linked.toLowerCase() === (ctx.subResolver ?? "").toLowerCase();
        return {
          ok,
          detail: ok
            ? `${fqdnStr} now resolves via ${linked}`
            : `Resolver is ${linked}`,
        };
      },
    },
  ];
}

/** Faucet: mint USDC to the connected wallet. */
export function buildFaucetStep(params: {
  account: Address;
  amount: bigint;
  chainId?: number;
}): StepDef[] {
  const network = getDeployment(params.chainId);
  if (!network.canMint)
    throw new Error("The faucet is only available on Sepolia");
  const deployments = network.addresses;
  return [
    {
      id: "faucet",
      title: "Mint USDC",
      explain: "MockUSDC on Sepolia has an open mint for testing.",
      build: () => ({
        type: "write",
        address: deployments.PaymentToken,
        abi: erc20Abi,
        functionName: "mint",
        args: [params.account, params.amount],
      }),
    },
  ];
}

/** setAddr on the setup's resolver for a subname. */
export function buildSetAddrStep(params: {
  chainId?: number;
  resolver: Address;
  node: `0x${string}`;
  fqdn: string;
  addr: Address;
}): StepDef[] {
  return [
    {
      id: "set-addr",
      title: `Set address record for ${params.fqdn}`,
      explain: "Stores the ETH address this subname should resolve to.",
      build: () => ({
        type: "write",
        address: params.resolver,
        abi: resolverAbi,
        functionName: "setAddress",
        args: [toHex(packetToBytes(params.fqdn)), 60n, params.addr],
      }),
      verify: async (read) => {
        const data = encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "addr",
              stateMutability: "view",
              inputs: [{ type: "bytes32" }],
              outputs: [{ type: "address" }],
            },
          ],
          functionName: "addr",
          args: [params.node],
        });
        const result = await read({
          address: params.resolver,
          abi: resolverAbi,
          functionName: "resolve",
          args: [toHex(packetToBytes(params.fqdn)), data],
        });
        const addr = decodeFunctionResult({
          abi: [
            {
              type: "function",
              name: "addr",
              stateMutability: "view",
              inputs: [{ type: "bytes32" }],
              outputs: [{ type: "address" }],
            },
          ],
          functionName: "addr",
          data: result as `0x${string}`,
        });
        return {
          ok: addr.toLowerCase() === params.addr.toLowerCase(),
          detail: "Address record verified",
        };
      },
    },
  ];
}

/** Stable identity for a requested write, independent of its transaction hash. */
export function actionIntent(action: StepAction): string {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }],
      [
        JSON.stringify(action, (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ],
    ),
  );
}
