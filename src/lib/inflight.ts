/** Shared across component instances so a remount cannot start a duplicate run. */
const active = new Set<string>();
const listeners = new Set<() => void>();
export const subscribeRuns = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const isRunning = (key: string) => active.has(key);
export function acquireRun(key: string): (() => void) | undefined {
  if (active.has(key)) return;
  active.add(key);
  for (const listener of listeners) listener();
  return () => {
    active.delete(key);
    for (const listener of listeners) listener();
  };
}
