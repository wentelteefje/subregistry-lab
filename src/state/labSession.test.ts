import { describe, expect, it, vi } from "vitest";
import {
  labReducer,
  sessionKey,
  loadState,
  hasUnfinishedSetup,
  savedSetupAddresses,
} from "./labSession";
const wallet = "0x1111111111111111111111111111111111111111";
describe("deployment-scoped sessions", () => {
  it("keeps mainnet, current Sepolia, and legacy keys distinct", () => {
    expect(sessionKey(wallet, "lab", 1)).not.toBe(
      sessionKey(wallet, "lab", 11155111),
    );
    expect(sessionKey(wallet, "lab")).not.toBe(`${wallet}:lab`);
  });
  it("normalizes an interrupted wallet prompt on reload without blocking configuration", () => {
    let state = labReducer(
      { sessions: {} },
      { type: "select-name", wallet, parentLabel: "one", chainId: 1 },
    );
    state = labReducer(state, {
      type: "step-state",
      sequenceId: "setup",
      stepId: "deploy-registry",
      state: { status: "wallet" },
    });
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(state) });
    try {
      const session = loadState().sessions[state.activeKey!];
      expect(session.sequences.setup["deploy-registry"].status).toBe("failed");
      expect(hasUnfinishedSetup(session)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps each subname resolver discoverable across resets and other subname deployments", () => {
    let state = labReducer(
      { sessions: {} },
      { type: "select-name", wallet, parentLabel: "one", chainId: 1 },
    );
    state = labReducer(state, {
      type: "cache-own-resolver",
      name: "alice.one.eth",
      address: wallet,
    });
    state = labReducer(state, { type: "reset-setup" });
    state = labReducer(state, {
      type: "cache-own-resolver",
      name: "bob.one.eth",
      address: "0x2222222222222222222222222222222222222222",
    });
    expect(
      state.sessions[state.activeKey!].ownResolvers?.["alice.one.eth"],
    ).toBe(wallet);
    expect(
      Object.keys(state.sessions[state.activeKey!].ownResolvers!),
    ).toHaveLength(2);
  });
  it("refuses to discard or mutate a setup while its receipt is unknown", () => {
    let state = labReducer(
      { sessions: {} },
      { type: "select-name", wallet, parentLabel: "one", chainId: 1 },
    );
    state = labReducer(state, {
      type: "set-preset",
      presetId: "fully-controlled",
    });
    state = labReducer(state, {
      type: "step-state",
      sequenceId: "setup",
      stepId: "deploy-registry",
      state: { status: "mining", txHash: "0x123" },
    });
    for (const action of [
      { type: "reset-setup" },
      { type: "reset-session" },
      { type: "set-preset", presetId: "unruggable" },
    ] as const)
      expect(labReducer(state, action)).toEqual(state);
  });
  it("persists an asynchronous result to its originating session", () => {
    let state = labReducer(
      { sessions: {} },
      { type: "select-name", wallet, parentLabel: "one", chainId: 1 },
    );
    const first = state.activeKey!;
    state = labReducer(state, {
      type: "select-name",
      wallet,
      parentLabel: "two",
      chainId: 11155111,
    });
    const active = state.activeKey;
    state = labReducer(state, {
      type: "step-state",
      sessionKey: first,
      sequenceId: "setup",
      stepId: "deploy",
      state: { status: "mining", txHash: "0x123" },
    });
    expect(state.activeKey).toBe(active);
    expect(state.sessions[first].sequences.setup.deploy.txHash).toBe("0x123");
    expect(state.sessions[active!].sequences.setup).toBeUndefined();
  });
});

it("retains a setup salt through reload and changes it only after explicit reset", () => {
  let state = labReducer(
    { sessions: {} },
    {
      type: "select-name",
      wallet: "0x1111111111111111111111111111111111111111",
      parentLabel: "lab",
      chainId: 1,
    },
  );
  state = labReducer(state, { type: "prepare-setup", nonce: "first" });
  state = JSON.parse(JSON.stringify(state));
  state = labReducer(state, { type: "prepare-setup", nonce: "second" });
  expect(state.sessions[state.activeKey!].setupNonce).toBe("first");
  state = labReducer(state, { type: "reset-setup" });
  state = labReducer(state, { type: "prepare-setup", nonce: "third" });
  expect(state.sessions[state.activeKey!].setupNonce).toBe("third");
});

it("freezes configuration after a partial setup even between wallet requests", () => {
  let state = labReducer(
    { sessions: {} },
    {
      type: "select-name",
      wallet: "0x1111111111111111111111111111111111111111",
      parentLabel: "lab",
      chainId: 1,
    },
  );
  state = labReducer(state, {
    type: "set-preset",
    presetId: "fully-controlled",
  });
  state = labReducer(state, {
    type: "step-state",
    sequenceId: "setup",
    stepId: "deploy-registry",
    state: { status: "done", confirmed: true, txHash: `0x${"11".repeat(32)}` },
  });
  expect(
    labReducer(state, { type: "set-preset", presetId: "standard-rentable" }),
  ).toEqual(state);
  expect(
    labReducer(state, { type: "set-deploy-resolver", value: false }),
  ).toEqual(state);
  const reset = labReducer(state, { type: "reset-setup" });
  expect(
    labReducer(reset, { type: "set-preset", presetId: "standard-rentable" })
      .sessions[state.activeKey!].presetId,
  ).toBe("standard-rentable");
});

describe("adopting a registry after a replacement", () => {
  const oldRegistry = "0x2222222222222222222222222222222222222222" as const;
  const replacement = "0x3333333333333333333333333333333333333333" as const;
  function prepared() {
    let state = labReducer(
      { sessions: {} },
      { type: "select-name", wallet, parentLabel: "lab", chainId: 1 },
    );
    state = labReducer(state, {
      type: "patch-addresses",
      patch: {
        userRegistry: replacement,
        resolver: wallet,
        registrar: replacement,
      },
    });
    state = labReducer(state, {
      type: "prepare-setup",
      nonce: "original-salt",
    });
    state = labReducer(state, {
      type: "set-registry-deploy-block",
      block: 900n,
    });
    state = labReducer(state, {
      type: "step-state",
      sequenceId: "setup",
      stepId: "deploy-registry",
      state: {
        status: "done",
        confirmed: true,
        context: { userRegistry: replacement },
      },
    });
    state = labReducer(state, {
      type: "step-state",
      sequenceId: "setup",
      stepId: "deploy-registrar",
      state: {
        status: "done",
        confirmed: true,
        context: { registrar: replacement },
      },
    });
    return state;
  }
  it("atomically clears the replacement block and registrar without discarding deployment recovery", () => {
    const before = prepared();
    const after = labReducer(before, {
      type: "adopt-registry",
      registry: oldRegistry,
    });
    const session = after.sessions[after.activeKey!];
    expect(session.addresses).toEqual({
      userRegistry: oldRegistry,
      resolver: wallet,
    });
    expect(session.registryDeployBlock).toBeUndefined();
    expect(session.setupNonce).toBe("original-salt");
    expect(session.sequences).toEqual(
      before.sessions[before.activeKey!].sequences,
    );
    expect(savedSetupAddresses(session)).toEqual({
      userRegistry: replacement,
      resolver: wallet,
      registrar: replacement,
    });
  });
  it("uses a known factory deployment block instead of the previous registry's block", () => {
    const state = labReducer(prepared(), {
      type: "adopt-registry",
      registry: oldRegistry,
      deployBlock: 100n,
    });
    expect(state.sessions[state.activeKey!].registryDeployBlock).toBe("100");
  });
  it.each(["setup", "playground", "relink"])(
    "refuses adoption while %s has an unknown receipt",
    (sequenceId) => {
      const state = labReducer(prepared(), {
        type: "step-state",
        sequenceId,
        stepId: "pending",
        state: { status: "mining", txHash: "0x123" },
      });
      expect(
        labReducer(state, { type: "adopt-registry", registry: oldRegistry }),
      ).toEqual(state);
    },
  );
});

it("never treats an adopted registry as the result of a rejected deployment", () => {
  let state = labReducer(
    { sessions: {} },
    { type: "select-name", wallet, parentLabel: "lab", chainId: 1 },
  );
  state = labReducer(state, {
    type: "prepare-setup",
    nonce: "keep-original-salt",
  });
  state = labReducer(state, {
    type: "step-state",
    sequenceId: "setup",
    stepId: "deploy-registry",
    state: {
      status: "failed",
      transaction: { from: wallet, to: wallet, nonce: 1, input: "0x1234" },
    },
  });
  state = labReducer(state, { type: "adopt-registry", registry: wallet });
  const session = state.sessions[state.activeKey!];
  expect(session.registrySelection).toBe("adopted");
  expect(savedSetupAddresses(session).userRegistry).toBeUndefined();
  expect(savedSetupAddresses(session).registrar).toBeUndefined();
  expect(session.setupNonce).toBe("keep-original-salt");
});

it("archives registry A across Replace, registry B, session reset and reload", () => {
  const registryA = "0x2222222222222222222222222222222222222222" as const;
  const registryB = "0x3333333333333333333333333333333333333333" as const;
  let state = labReducer(
    { sessions: {} },
    { type: "select-name", wallet, parentLabel: "lab", chainId: 1 },
  );
  for (const [registry, block] of [
    [registryA, "100"],
    [registryB, "900"],
  ] as const) {
    state = labReducer(state, {
      type: "patch-addresses",
      patch: { userRegistry: registry },
    });
    state = labReducer(state, {
      type: "step-state",
      sequenceId: "setup",
      stepId: "deploy-registry",
      state: {
        status: "done",
        confirmed: true,
        context: { userRegistry: registry },
        blockNumber: block,
      },
    });
    state = labReducer(state, { type: "reset-setup" });
  }
  state = labReducer(state, { type: "reset-session" });
  const archive = Object.values(state.registryHistory!)[0];
  expect(archive[registryA].deployBlock).toBe("100");
  expect(archive[registryB].deployBlock).toBe("900");
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(state) });
  try {
    expect(loadState().registryHistory).toEqual(state.registryHistory);
  } finally {
    vi.unstubAllGlobals();
  }
});
