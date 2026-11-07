import { useSyncExternalStore } from "react";
import { getRpcPool } from "../lib/rpcPool";

export function RpcConnectionStatus({ chainId }: { chainId: number }) {
  const pool = getRpcPool(chainId);
  const health = useSyncExternalStore(pool.subscribe, pool.getSnapshot);
  const failures = health.endpoints.filter((endpoint) => endpoint.lastError);
  return (
    <details className="rounded-lg border border-ens-border p-3 text-xs">
      <summary className="cursor-pointer">
        RPC connection · {failures.length ? `${failures.length} provider(s) failed recently; automatic fallbacks enabled` : "3 public providers · automatic fallback"}
      </summary>
      <p className="mt-2">{health.attempts} HTTP attempts · {health.failovers} recovered requests this session. No background connection polling.</p>
      <ul className="mt-2 space-y-1">
        {health.endpoints.map((endpoint) => <li key={endpoint.host}>{endpoint.host}: {endpoint.lastError ? `${endpoint.lastError}. ${endpoint.cooldownUntil > 0 ? `Retry eligible after ${new Date(endpoint.cooldownUntil).toLocaleTimeString()}.` : "Other methods remain eligible for requests."}` : "Available for requests"}</li>)}
      </ul>
    </details>
  );
}
