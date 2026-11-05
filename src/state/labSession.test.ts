import { describe, expect, it } from "vitest";
import { labReducer, sessionKey } from "./labSession";
const wallet = "0x1111111111111111111111111111111111111111";
describe("deployment-scoped sessions", () => {
  it("keeps mainnet, current Sepolia, and legacy keys distinct", () => {
    expect(sessionKey(wallet, "lab", 1)).not.toBe(sessionKey(wallet, "lab", 11155111));
    expect(sessionKey(wallet, "lab")).not.toBe(`${wallet}:lab`);
  });
  it("persists an asynchronous result to its originating session", () => {
    let state = labReducer({ sessions: {} }, { type: "select-name", wallet, parentLabel: "one", chainId: 1 });
    const first = state.activeKey!;
    state = labReducer(state, { type: "select-name", wallet, parentLabel: "two", chainId: 11155111 });
    const active = state.activeKey;
    state = labReducer(state, { type: "step-state", sessionKey: first, sequenceId: "setup", stepId: "deploy", state: { status: "mining", txHash: "0x123" } });
    expect(state.activeKey).toBe(active);
    expect(state.sessions[first].sequences.setup.deploy.txHash).toBe("0x123");
    expect(state.sessions[active!].sequences.setup).toBeUndefined();
  });
});
