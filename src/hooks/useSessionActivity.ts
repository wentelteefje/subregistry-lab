import { useSyncExternalStore } from "react";
import { isRunning, subscribeRuns } from "../lib/inflight";
import { useLab } from "../state/LabContext";

/** Activity belongs to the session, including sequences in a hidden view. */
export function useSessionActivity() {
  const { session, state } = useLab();
  const activity = useSyncExternalStore(subscribeRuns, () =>
    (isRunning(`${state.activeKey}:setup`) ? 1 : 0) |
    (isRunning(`${state.activeKey}:playground`) ? 2 : 0) |
    (isRunning(`${state.activeKey}:lock`) ? 4 : 0) |
    (isRunning(`sender:${session?.chainId}:${session?.wallet}`) ? 8 : 0),
  );
  return {
    setup: Boolean(activity & 1),
    playground: Boolean(activity & 2),
    lock: Boolean(activity & 4),
    senderBusy: Boolean(activity),
  };
}
