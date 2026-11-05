import { describe, expect, it } from "vitest";
import { labReducer, sessionKey } from "./labSession";
const wallet = "0x1111111111111111111111111111111111111111";
describe("deployment-scoped sessions", () => {
  it("keeps mainnet, current Sepolia, and legacy keys distinct", () => {
    expect(sessionKey(wallet, "lab", 1)).not.toBe(
      sessionKey(wallet, "lab", 11155111),
    );
    expect(sessionKey(wallet, "lab")).not.toBe(`${wallet}:lab`);
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
