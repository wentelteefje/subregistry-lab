/** Shared, read-oriented public RPC pool. No health polling or nested retries. */
import { createTransport, createPublicClient, custom, http, type PublicClient, type Transport } from "viem";
import { classifyError, isRateLimitError } from "./errors";

export type RpcRequest = { method: string; params?: unknown; signal?: AbortSignal };
type Endpoint = { url: string; request: (args: RpcRequest) => Promise<unknown> };
export type RpcFailure = "rate-limit" | "range" | "revert" | "snapshot" | "invalid" | "transient" | "behind" | "unsupported" | "queue-timeout";
export function rpcFailure(error: unknown): RpcFailure {
  const seen = new Set<unknown>();
  let value = error;
  const parts: string[] = [];
  while (value && !seen.has(value)) {
    seen.add(value);
    const e = value as { code?: number; status?: number; message?: string; details?: string; cause?: unknown };
    if (e.status === 429) return "rate-limit";
    parts.push(e.message ?? "", e.details ?? "");
    if (e.code === -32601) return "unsupported";
    if (e.code === 3 || e.code === 4001) return "revert";
    value = e.cause;
  }
  const text = parts.join(" ");
  if (isRateLimitError(error)) return "rate-limit";
  if (/execution reverted|revert opcode/i.test(text)) return "revert";
  if (/provider is behind|header not found|unknown block/i.test(text)) return "behind";
  if (/method not found|method.*not supported/i.test(text)) return "unsupported";
  if (/missing trie|historical state|state.*unavailable|archive requests|pruned/i.test(text)) return "snapshot";
  if (classifyError(error).kind === "rpc-range") return "range";
  if (/invalid (params|argument)/i.test(text)) return "invalid";
  return "transient";
}
function retryAfter(error: unknown, now: number): number {
  let value = error;
  const seen = new Set<unknown>();
  while (value && !seen.has(value)) {
    seen.add(value);
    const e = value as { headers?: Headers; cause?: unknown };
    const raw = e.headers?.get?.("retry-after");
    if (raw) {
      const milliseconds = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
      if (Number.isFinite(milliseconds)) return Math.max(0, milliseconds);
    }
    value = e.cause;
  }
  return 0;
}
export type RpcHealth = {
  attempts: number;
  failovers: number;
  endpoints: { host: string; cooldownUntil: number; lastError?: string }[];
};
export class RpcPoolError extends Error {
  readonly failures: { host: string; kind: RpcFailure; message: string }[];
  constructor(failures: RpcPoolError["failures"]) {
    const old = failures.some((f) => f.kind === "snapshot");
    const behind = failures.some((f) => f.kind === "behind");
    const queued = failures.some((f) => f.kind === "queue-timeout");
    super(queued ? "The RPC request queue timed out. Wait for the current reads to finish, then retry." : behind ? "Public RPCs have not reached the snapshot block. Retry shortly." : old
      ? "This snapshot could not be served by the public RPCs. Refresh the configuration to read a newer block."
      : "Public RPCs are unavailable or cooling down. Wait briefly, then retry. See RPC connection details.");
    this.name = "RpcPoolError";
    this.failures = failures;
  }
}

export function createRpcPool(
  endpoints: Endpoint[],
  options: { now?: () => number; pause?: (ms: number) => Promise<void>; spacing?: number; concurrency?: number } = {},
) {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const states = endpoints.map((endpoint) => ({ ...endpoint, cooldownUntil: 0, lastError: undefined as string | undefined, head: 0n, headAt: 0, nextStart: 0, failures: 0, unavailableThrough: -1n, stateRetryAt: 0 }));
  const listeners = new Set<() => void>();
  // Exact bounded historical requests only; never cache latest/pending reads or failures.
  const logCache = new Map<string, { expires: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  let attempts = 0, failovers = 0, active = 0;
  const waiters: (() => void)[] = [];
  let snapshot: RpcHealth;
  const publish = () => {
    snapshot = { attempts, failovers, endpoints: states.map((s) => ({ host: new URL(s.url).host, cooldownUntil: s.cooldownUntil, lastError: s.lastError })) };
    listeners.forEach((fn) => fn());
  };
  publish();
  const execute = async (args: RpcRequest): Promise<unknown> => {
    const started = now();
    args.signal?.throwIfAborted();
    if (active >= (options.concurrency ?? 3)) await new Promise<void>((resolve, reject) => {
      const remove = () => {
        clearTimeout(timer);
        args.signal?.removeEventListener("abort", abort);
        const index = waiters.indexOf(resume);
        if (index >= 0) waiters.splice(index, 1);
      };
      const resume = () => { remove(); resolve(); };
      const abort = () => { remove(); reject(args.signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => {
        remove();
        reject(new RpcPoolError([{ host: "request queue", kind: "queue-timeout", message: "Queue wait exceeded 25 seconds" }]));
      }, 25_000);
      waiters.push(resume);
      args.signal?.addEventListener("abort", abort, { once: true });
    });
    else active++;
    try {
      const failures: RpcPoolError["failures"] = [];
      for (const state of states) {
        args.signal?.throwIfAborted();
        if (now() - started > 25_000) {
          failures.push({host: "request queue", kind: "queue-timeout", message: "Request deadline reached"});
          break;
        }
        if (state.cooldownUntil > now()) continue;
        const host = new URL(state.url).host;
        const send = async (payload: RpcRequest) => {
          // Reserve a start time before yielding so concurrent callers are paced.
          const at = Math.max(now(), state.nextStart);
          state.nextStart = at + (options.spacing ?? 200);
          if (at > now()) await pause(at - now());
          args.signal?.throwIfAborted();
          if (state.cooldownUntil > now()) throw new CoolingDownError();
          attempts++;
          return state.request({ ...payload, signal: args.signal });
        };
        try {
          const params = args.params as unknown[] | undefined;
          const tag = params?.at(-1);
          const isStateRead = ["eth_call", "eth_getStorageAt", "eth_getCode", "eth_getBalance", "eth_getTransactionCount"].includes(args.method);
          if (isStateRead && typeof tag === "string" && /^0x[0-9a-f]+$/i.test(tag) && BigInt(tag) <= state.unavailableThrough && state.stateRetryAt > now()) {
            failures.push({ host, kind: "snapshot", message: "Historical state unavailable on this provider" });
            continue;
          }
          if (args.method === "eth_getLogs") {
            const filter = (args.params as { toBlock?: string }[] | undefined)?.[0];
            if (filter?.toBlock?.startsWith("0x")) {
              const end = BigInt(filter.toBlock);
              // A lagging node can silently return [] beyond its own head.
              if (state.headAt === 0 || now() - state.headAt > 2_000) {
                state.head = BigInt(String(await send({ method: "eth_blockNumber" })));
                state.headAt = now();
              }
              if (state.head < end) throw Error("RPC header not found: provider is behind the requested block");
            }
          }
          const result = await send(args);
          state.failures = 0;
          state.lastError = undefined;
          if (failures.length) failovers++;
          publish();
          return result;
        } catch (error) {
          args.signal?.throwIfAborted();
          if (error instanceof CoolingDownError) continue;
          const kind = rpcFailure(error);
          if (kind === "range" || kind === "revert" || kind === "invalid") throw error;
          state.failures++;
          state.lastError = kind === "snapshot" ? "Historical state unavailable" : kind === "behind" ? "Provider behind snapshot block" : kind === "unsupported" ? "Method unavailable" : kind === "rate-limit" ? "Rate limited" : "Connection failed";
          if (kind === "snapshot") {
            const tag = (args.params as unknown[] | undefined)?.at(-1);
            if (typeof tag === "string" && /^0x[0-9a-f]+$/i.test(tag)) {
              state.unavailableThrough = BigInt(tag) > state.unavailableThrough ? BigInt(tag) : state.unavailableThrough;
              state.stateRetryAt = now() + 30_000;
            }
          }
          state.cooldownUntil = ["snapshot", "behind", "unsupported"].includes(kind) ? 0 : now() + (kind === "rate-limit" ? Math.max(retryAfter(error, now()), Math.min(300_000, 15_000 * 2 ** Math.min(state.failures - 1, 5))) : 5_000);
          failures.push({ host, kind, message: state.lastError });
          publish();
        }
      }
      if (!failures.length) failures.push(...states.map((s) => ({ host: new URL(s.url).host, kind: "transient" as const, message: s.lastError ?? "Cooling down" })));
      throw new RpcPoolError(failures);
    } finally {
      const next = waiters.shift();
      if (next) next(); else active--;
    }
  };
  const request = (args: RpcRequest): Promise<unknown> => {
    args.signal?.throwIfAborted();
    const filter = args.method === "eth_getLogs" ? (args.params as { toBlock?: string }[] | undefined)?.[0] : undefined;
    const key = filter?.toBlock?.startsWith("0x") ? JSON.stringify({method: args.method, params: args.params}) : undefined;
    if (!key) return execute(args);
    const cached = logCache.get(key);
    if (cached && cached.expires > now()) return Promise.resolve(cached.value);
    const running = args.signal ? undefined : pending.get(key);
    if (running) return running;
    const promise = execute(args).then((value) => {
      if (Array.isArray(value) && value.length > 5000) return value;
      if (logCache.size >= 512) logCache.delete(logCache.keys().next().value!);
      logCache.set(key, { value, expires: now() + 60_000 });
      return value;
    }).finally(() => { if (!args.signal) pending.delete(key); });
    if (!args.signal) pending.set(key, promise);
    return promise;
  };
  return { request, getSnapshot: () => snapshot, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}

class CoolingDownError extends Error {}

/** Bind cancellation to public reads without cancelling other queries sharing the pool. */
export function withRpcSignal<T extends object>(client: T, signal?: AbortSignal): T {
  const base = client as unknown as PublicClient;
  if (!signal || !base.transport?.key?.startsWith("public-pool-")) return client;
  return createPublicClient({
    chain: base.chain,
    batch: { multicall: true },
    transport: custom({request: (args) => base.transport.request({ ...args, signal })}, { retryCount: 0 }),
  }) as unknown as T;
}

/** Compose deadline and caller cancellation: supplying a signal directly to
 * viem HTTP otherwise replaces its internal timeout controller. */
export function httpRpcEndpoint(url: string, timeout = 6_000): Endpoint {
  return { url, request: (args) => {
    const deadline = AbortSignal.timeout(timeout);
    const signal = args.signal ? AbortSignal.any([args.signal, deadline]) : deadline;
    const transport = http(url, { retryCount: 0, timeout: 0, fetchOptions: { signal } })({});
    return transport.request({ method: args.method, params: args.params } as Parameters<typeof transport.request>[0]);
  } };
}

export const publicRpcUrls = {
  1: ["https://mainnet.gateway.tenderly.co", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  11155111: ["https://sepolia.gateway.tenderly.co", "https://ethereum-sepolia-rpc.publicnode.com", "https://public.1rpc.io/sepolia"],
} as const;
const pools = new Map<number, ReturnType<typeof createRpcPool>>();
export function getRpcPool(chainId: number) {
  let pool = pools.get(chainId);
  if (!pool) {
    const urls = publicRpcUrls[chainId as keyof typeof publicRpcUrls];
    if (!urls) throw Error(`Unsupported RPC network: ${chainId}`);
    pool = createRpcPool(urls.map((url) => httpRpcEndpoint(url)));
    pools.set(chainId, pool);
  }
  return pool;
}
export function publicRpcTransport(chainId: number): Transport {
  return () => createTransport({
    key: `public-pool-${chainId}`,
    name: "Public RPC pool",
    type: "http",
    retryCount: 0,
    request: getRpcPool(chainId).request as Parameters<typeof createTransport>[0]["request"],
  });
}
