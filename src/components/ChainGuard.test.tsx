import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { ChainGuard, useIsReady } from "./ChainGuard";

const wallet = vi.hoisted(() => ({ connected: false, chainId: 1, configured: 1 }));
// Deliberately expose no switching hook: this component only guards readiness.
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: wallet.connected, chainId: wallet.chainId }),
  useChainId: () => wallet.configured,
}));
let renderer: ReactTestRenderer;
function GuardHarness() {
  const ready = useIsReady();
  return <><button disabled={!ready}>Send transaction</button><ChainGuard /></>;
}
afterEach(async () => { await act(async () => renderer?.unmount()); });
it.each([
  [false, 1, 1, false, false],
  [true, 1, 1, true, false],
  [true, 11155111, 11155111, true, false],
  [true, 10, 11155111, false, true],
  [true, 10, 10, false, true],
  [true, 1, 11155111, false, true],
])("gates transactions for connected=%s, wallet=%s, configured=%s", async (connected, chainId, configured, ready, warning) => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(wallet, { connected, chainId, configured });
  await act(async () => { renderer = create(<GuardHarness />); });
  expect(renderer.root.findByType("button").props.disabled).toBe(!ready);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(warning ? 1 : 0);
  expect(renderer.root.findAllByType("select")).toHaveLength(0);
});
