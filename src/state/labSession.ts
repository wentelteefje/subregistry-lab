import { getDeployment } from "../config/deployments";
/**
 * Lab session state: everything the app must remember across refreshes that
 * is NOT readable from the chain (which name is being worked on, addresses
 * this app deployed, tx progress). Chain state itself always comes from
 * wagmi reads; on-chain truth wins over anything stored here.
 *
 * Sessions are keyed per wallet+parentLabel so switching names never
 * clobbers a previous experiment.
 */

import type { Address } from "viem";
import type { PresetId } from "../lib/presets";

export type StepStatus =
  | "queued"
  | "wallet"
  | "mining"
  | "verifying"
  | "done"
  | "skipped"
  | "failed";

export type StepState = {
  status: StepStatus;
  txHash?: `0x${string}`;
  detail?: string;
  /** Full diagnostic, shown only in a bounded technical disclosure. */
  technicalDetail?: string;
  errorKind?: string;
  intent?: string;
  reverted?: boolean;
  confirmed?: boolean;
  cancelled?: boolean;
  blockNumber?: string;
  title?: string;
  capture?: "userRegistry" | "resolver" | "registrar" | "subResolver";
  targetName?: string;
  /** Factory deployment block of a relink target; never the relink receipt block. */
  registryDeployBlock?: string;
  transaction?: {
    nonce: number;
    from: Address;
    to: Address | null;
    input: `0x${string}`;
    value?: string;
  };
  context?: {
    userRegistry?: Address;
    resolver?: Address;
    registrar?: Address;
    subResolver?: Address;
    subResolverName?: string;
  };
};

export type SessionData = {
  chainId: number;
  deploymentSet: string;
  wallet: string;
  parentLabel: string;
  presetId?: PresetId;
  deployResolver: boolean;
  /** Stable deployment salt seed for the reviewed setup, retained across reloads. */
  setupNonce?: string;
  /** Custom subname-owner role bitmap (overrides the preset default), as string. */
  subnameRoleBitmap?: string;
  registrarParams?: {
    pricePerYear: string; // bigints as strings for JSON round-tripping
    minDuration: string;
    beneficiary: Address;
  };
  addresses: {
    userRegistry?: Address;
    resolver?: Address;
    registrar?: Address;
  };
  ownResolvers?: Record<string, Address>;
  /** Block of the registry deploy tx, for cheap subname log scans. */
  registryDeployBlock?: string;
  registrySelection?: "setup" | "adopted";
  /** sequenceId -> stepId -> state */
  sequences: Record<string, Record<string, StepState>>;
};

export type LabState = {
  activeKey?: string;
  sessions: Record<string, SessionData>;
  registryHistory?: Record<string, Record<string, { deployBlock?: string }>>;
};

export function sessionKey(
  wallet: string,
  parentLabel: string,
  chainId = 11155111,
): string {
  return `${getDeployment(chainId).deploymentSet}:${wallet.toLowerCase()}:${parentLabel.toLowerCase()}`;
}

export function newSession(
  wallet: string,
  parentLabel: string,
  chainId = 11155111,
): SessionData {
  return {
    chainId,
    deploymentSet: getDeployment(chainId).deploymentSet,
    wallet: wallet.toLowerCase(),
    parentLabel: parentLabel.toLowerCase(),
    deployResolver: true,
    addresses: {},
    sequences: {},
  };
}

export type LabAction =
  | {
      type: "select-name";
      wallet: string;
      parentLabel: string;
      chainId?: number;
    }
  | { type: "prepare-setup"; nonce: string }
  | { type: "set-preset"; presetId: PresetId }
  | { type: "set-deploy-resolver"; value: boolean }
  | { type: "set-subname-bitmap"; bitmap?: bigint }
  | {
      type: "set-registrar-params";
      params?: {
        pricePerYear: bigint;
        minDuration: bigint;
        beneficiary: Address;
      };
    }
  | {
      type: "remember-registries";
      registries: { address: Address; deployBlock?: bigint }[];
    }
  | { type: "patch-addresses"; patch: Partial<SessionData["addresses"]> }
  | { type: "set-registry-deploy-block"; block: bigint }
  | { type: "adopt-registry"; registry: Address; deployBlock?: bigint }
  | { type: "step-state"; sequenceId: string; stepId: string; state: StepState }
  | { type: "reset-sequence"; sequenceId: string }
  | { type: "cache-own-resolver"; name: string; address: Address }
  | { type: "reset-setup" }
  | { type: "reset-session" }
  | { type: "deselect" };

export function isPendingTransaction(step: StepState): boolean {
  return Boolean(
    step.txHash &&
      !step.confirmed &&
      !step.reverted &&
      !step.cancelled &&
      step.status !== "done",
  );
}

export function hasStartedSetup(session?: SessionData): boolean {
  return Object.values(session?.sequences.setup ?? {}).some(
    (step) =>
      Boolean(step.transaction || step.txHash || step.confirmed) ||
      step.status === "wallet",
  );
}

export function hasUnfinishedSetup(session?: SessionData): boolean {
  return Object.values(session?.sequences.setup ?? {}).some(
    (step) => isPendingTransaction(step) || step.status === "wallet",
  );
}

export function hasUnfinishedTransactions(session?: SessionData): boolean {
  return Object.values(session?.sequences ?? {}).some((steps) =>
    Object.values(steps).some(
      (step) => isPendingTransaction(step) || step.status === "wallet",
    ),
  );
}

/** Setup receipt captures stay isolated from the registry selected for browsing. */
export function savedSetupAddresses(
  session: SessionData,
): SessionData["addresses"] {
  const steps = session.sequences.setup ?? {};
  return {
    userRegistry: steps["deploy-registry"]?.context?.userRegistry,
    resolver:
      steps["deploy-resolver"]?.context?.resolver ?? session.addresses.resolver,
    registrar: steps["deploy-registrar"]?.context?.registrar,
  };
}

export function registryHistoryKey(wallet: string, chainId: number) {
  return `${getDeployment(chainId).deploymentSet}:${wallet.toLowerCase()}`;
}
function rememberRegistry(
  state: LabState,
  session: SessionData,
  address: Address,
  block?: bigint,
): LabState {
  const key = registryHistoryKey(session.wallet, session.chainId);
  const existing = state.registryHistory?.[key] ?? {};
  return {
    ...state,
    registryHistory: {
      ...state.registryHistory,
      [key]: {
        ...existing,
        [address.toLowerCase()]: {
          deployBlock:
            block?.toString() ?? existing[address.toLowerCase()]?.deployBlock,
        },
      },
    },
  };
}
function archiveSessionRegistry(
  state: LabState,
  session?: SessionData,
): LabState {
  if (!session) return state;
  const step = session.sequences.setup?.["deploy-registry"];
  if (
    step?.confirmed &&
    !step.reverted &&
    !step.cancelled &&
    step.context?.userRegistry &&
    step.blockNumber
  )
    state = rememberRegistry(
      state,
      session,
      step.context.userRegistry,
      BigInt(step.blockNumber),
    );
  if (session.addresses.userRegistry)
    state = rememberRegistry(
      state,
      session,
      session.addresses.userRegistry,
      session.registrySelection === "adopted" && session.registryDeployBlock
        ? BigInt(session.registryDeployBlock)
        : undefined,
    );
  return state;
}

export type ScopedLabAction = LabAction & { sessionKey?: string };

function withActive(
  state: LabState,
  update: (session: SessionData) => SessionData,
): LabState {
  if (!state.activeKey) return state;
  const current = state.sessions[state.activeKey];
  if (!current) return state;
  return {
    ...state,
    sessions: { ...state.sessions, [state.activeKey]: update(current) },
  };
}

export function labReducer(state: LabState, action: ScopedLabAction): LabState {
  if (action.sessionKey && action.sessionKey !== state.activeKey) {
    if (!state.sessions[action.sessionKey]) return state;
    const updated = labReducer(
      { ...state, activeKey: action.sessionKey },
      { ...action, sessionKey: undefined },
    );
    return { ...updated, activeKey: state.activeKey };
  }
  const selected = state.activeKey
    ? state.sessions[state.activeKey]
    : undefined;
  const editsConfiguration = [
    "set-preset",
    "set-registrar-params",
    "set-deploy-resolver",
    "set-subname-bitmap",
  ].includes(action.type);
  const discardsSetup = ["reset-setup", "reset-session"].includes(action.type);
  if (
    (hasStartedSetup(selected) && editsConfiguration) ||
    (hasUnfinishedSetup(selected) && discardsSetup)
  )
    return state;
  switch (action.type) {
    case "select-name": {
      const key = sessionKey(action.wallet, action.parentLabel, action.chainId);
      return {
        ...state,
        activeKey: key,
        sessions: {
          ...state.sessions,
          [key]:
            state.sessions[key] ??
            newSession(action.wallet, action.parentLabel, action.chainId),
        },
      };
    }
    case "deselect":
      return { ...state, activeKey: undefined };
    case "prepare-setup":
      return withActive(state, (s) => ({
        ...s,
        setupNonce: s.setupNonce ?? action.nonce,
      }));
    case "set-preset":
      return withActive(state, (s) => ({ ...s, presetId: action.presetId }));
    case "set-deploy-resolver":
      return withActive(state, (s) => ({ ...s, deployResolver: action.value }));
    case "set-subname-bitmap":
      return withActive(state, (s) => ({
        ...s,
        subnameRoleBitmap: action.bitmap?.toString(),
      }));
    case "set-registrar-params":
      return withActive(state, (s) => ({
        ...s,
        registrarParams: action.params
          ? {
              pricePerYear: action.params.pricePerYear.toString(),
              minDuration: action.params.minDuration.toString(),
              beneficiary: action.params.beneficiary,
            }
          : undefined,
      }));
    case "remember-registries":
      if (!selected) return state;
      return action.registries.reduce(
        (result, entry) =>
          rememberRegistry(result, selected, entry.address, entry.deployBlock),
        state,
      );
    case "adopt-registry":
      if (hasUnfinishedTransactions(selected)) return state;
      state = archiveSessionRegistry(state, selected);
      if (selected)
        state = rememberRegistry(
          state,
          selected,
          action.registry,
          action.deployBlock,
        );
      return withActive(state, (s) => ({
        ...s,
        // Preserve setup receipts/salt for the retained deployment workspace.
        // They are planning context, never metadata for this selected registry.
        addresses: {
          userRegistry: action.registry,
          resolver: s.addresses.resolver,
        },
        registryDeployBlock:
          action.deployBlock?.toString() ??
          state.registryHistory?.[registryHistoryKey(s.wallet, s.chainId)]?.[
            action.registry.toLowerCase()
          ]?.deployBlock,
        registrySelection: "adopted",
      }));
    case "patch-addresses":
      return withActive(state, (s) => ({
        ...s,
        addresses: { ...s.addresses, ...action.patch },
        registrySelection: action.patch.userRegistry
          ? "setup"
          : s.registrySelection,
      }));
    case "set-registry-deploy-block":
      return withActive(state, (s) => ({
        ...s,
        registryDeployBlock: action.block.toString(),
      }));
    case "step-state":
      return withActive(state, (s) => ({
        ...s,
        sequences: {
          ...s.sequences,
          [action.sequenceId]: {
            ...s.sequences[action.sequenceId],
            [action.stepId]: action.state,
          },
        },
      }));
    case "reset-sequence":
      return withActive(state, (s) => {
        const sequences = { ...s.sequences };
        delete sequences[action.sequenceId];
        return { ...s, sequences };
      });
    case "cache-own-resolver":
      return withActive(state, (s) => ({
        ...s,
        ownResolvers: {
          ...s.ownResolvers,
          [action.name.toLowerCase()]: action.address,
        },
      }));
    case "reset-setup":
      state = archiveSessionRegistry(state, selected);
      // Fresh reconfiguration: forget the previous run's steps, the deployed
      // registry/registrar, and any custom role bitmap (the new preset's
      // default applies). The resolver choice is per-account and survives;
      // linkLocked refers to the parent name, not the registry.
      return withActive(state, (s) => {
        const sequences = { ...s.sequences };
        delete sequences["setup"];
        return {
          ...s,
          sequences,
          addresses: { resolver: s.addresses.resolver },
          setupNonce: undefined,
          registryDeployBlock: undefined,
          registrySelection: undefined,
          subnameRoleBitmap: undefined,
        };
      });
    case "reset-session":
      state = archiveSessionRegistry(state, selected);
      return withActive(state, (s) =>
        newSession(s.wallet, s.parentLabel, s.chainId),
      );
    default:
      return state;
  }
}

const STORAGE_KEY = "subregistry-lab:sessions:v2";

export function loadState(): LabState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LabState;
      if (
        !parsed ||
        typeof parsed.sessions !== "object" ||
        parsed.sessions === null
      )
        return { sessions: {} };
      const sessions = Object.fromEntries(
        Object.entries(parsed.sessions).filter(([key, session]) => {
          if (
            !session ||
            ![1, 11155111].includes(session.chainId) ||
            typeof session.wallet !== "string" ||
            typeof session.parentLabel !== "string" ||
            !session.addresses ||
            !session.sequences
          )
            return false;
          return (
            key ===
              sessionKey(
                session.wallet,
                session.parentLabel,
                session.chainId,
              ) &&
            session.deploymentSet ===
              getDeployment(session.chainId).deploymentSet
          );
        }),
      );
      for (const session of Object.values(sessions))
        for (const steps of Object.values(session.sequences)) {
          delete steps["sequence-error"];
          for (const step of Object.values(steps)) {
            if (step.status === "wallet" && !step.txHash) {
              step.status = "failed";
              step.detail =
                "Wallet request interrupted by reload. Check wallet activity and close the old prompt before retrying.";
            }
          }
        }
      return {
        sessions,
        registryHistory:
          parsed.registryHistory && typeof parsed.registryHistory === "object"
            ? parsed.registryHistory
            : undefined,
        activeKey:
          parsed.activeKey && sessions[parsed.activeKey]
            ? parsed.activeKey
            : undefined,
      };
    }
  } catch {
    // corrupt storage: start fresh
  }
  return { sessions: {} };
}

export function saveState(state: LabState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full/unavailable: session just won't persist
  }
}
