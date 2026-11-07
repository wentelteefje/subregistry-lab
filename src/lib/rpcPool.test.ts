import { createPublicClient, createTransport } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createRpcPool, rpcFailure, RpcPoolError, withRpcSignal, httpRpcEndpoint } from "./rpcPool";
import { scanRanges, scanDetailed, IncompleteScanError } from "./scan";

const endpoint = (host: string, request = vi.fn<({ method, params }: { method: string; params?: unknown }) => Promise<unknown>>().mockResolvedValue("0x64")) => ({ url: `https://${host}.example`, request });
const options = { spacing: 0 };
describe("public RPC failover", () => {
  it("cools a throttled provider and uses a different provider for subsequent names", async () => {
    let now = 100;
    const a = endpoint("a", vi.fn().mockRejectedValue({ status: 429 })), b = endpoint("b");
    const pool = createRpcPool([a,b], { ...options, now: () => now });
    for (let i = 0; i < 35; i++) await expect(pool.request({ method: "eth_call", params: [i] })).resolves.toBe("0x64");
    expect(a.request).toHaveBeenCalledTimes(1);
    expect(b.request).toHaveBeenCalledTimes(35);
    expect(pool.getSnapshot().attempts).toBe(36);
    now += 16_000;
    await pool.request({ method: "eth_call" });
    expect(a.request).toHaveBeenCalledTimes(2);
  });
  it("does not retry deterministic reverts or range errors on every endpoint", async () => {
    for (const error of [Error("execution reverted"), Error("block range limit exceeded")]) {
      const a = endpoint("a", vi.fn().mockRejectedValue(error)), b = endpoint("b");
      await expect(createRpcPool([a,b], options).request({ method: "eth_call" })).rejects.toBe(error);
      expect(a.request).toHaveBeenCalledTimes(1);
      expect(b.request).not.toHaveBeenCalled();
    }
  });
  it("never accepts empty logs from a node behind the snapshot", async () => {
    const a = endpoint("behind", vi.fn().mockResolvedValue("0x10"));
    const b = endpoint("current", vi.fn().mockImplementation(async ({method}) => method === "eth_blockNumber" ? "0x64" : []));
    const pool = createRpcPool([a,b], options);
    await expect(pool.request({ method: "eth_getLogs", params: [{toBlock:"0x50", fromBlock:"0x1"}] })).resolves.toEqual([]);
    expect(a.request).toHaveBeenCalledTimes(1);
    expect(a.request.mock.calls[0][0].method).toBe("eth_blockNumber");
    expect(pool.getSnapshot().failovers).toBe(1);
  });
  it("reports provider exhaustion and fails quickly while all providers cool down", async () => {
    const a = endpoint("a", vi.fn().mockRejectedValue(Error("offline"))), b = endpoint("b", vi.fn().mockRejectedValue(Error("429")));
    const pool = createRpcPool([a,b], options);
    const error = await pool.request({ method: "eth_call" }).catch(e => e);
    expect(error).toBeInstanceOf(RpcPoolError);
    expect((error as RpcPoolError).failures).toHaveLength(2);
    await expect(pool.request({method:"eth_call"})).rejects.toThrow("cooling down");
    expect(a.request).toHaveBeenCalledTimes(1);
    expect(b.request).toHaveBeenCalledTimes(1);
  });
  it("shares exact historical log requests, but never caches latest reads or failures", async () => {
    const a = endpoint("a", vi.fn().mockImplementation(async ({ method }) => method === "eth_blockNumber" ? "0x64" : []));
    const pool = createRpcPool([a], options);
    const args = {method:"eth_getLogs", params:[{fromBlock:"0x1", toBlock:"0x64"}]};
    await Promise.all(Array.from({length:35}, () => pool.request(args)));
    expect(a.request).toHaveBeenCalledTimes(2); // head check + one shared log read
    await pool.request(args);
    expect(a.request).toHaveBeenCalledTimes(2);
    await pool.request({method:"eth_blockNumber"});
    await pool.request({method:"eth_blockNumber"});
    expect(a.request).toHaveBeenCalledTimes(4);
  });
  it("limits concurrency and drains the queue without dropping requests", async () => {
    let active = 0, maximum = 0;
    const a = endpoint("a", vi.fn().mockImplementation(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return "ok";
    }));
    const pool = createRpcPool([a], {...options, concurrency:2});
    const results = await Promise.all(Array.from({length:35}, () => pool.request({method:"eth_call"})));
    expect(results).toHaveLength(35);
    expect(maximum).toBe(2);
  });
  it("paces starts even when callers arrive concurrently", async () => {
    let now = 100;
    const starts: number[] = [];
    const a = endpoint("a", vi.fn().mockImplementation(async () => { starts.push(now); return "ok"; }));
    const pool = createRpcPool([a], { spacing:200, concurrency:1, now:()=>now, pause:async (ms)=>{ now += ms; } });
    await Promise.all(Array.from({length:4}, () => pool.request({method:"eth_call"})));
    expect(starts).toEqual([100,300,500,700]);
  });
});

describe("history request budgets", () => {
  it("keeps completed chunks and uses failover only for the failed chunk", async () => {
    const successRanges: [string,string][] = [];
    const a = endpoint("a", vi.fn().mockImplementation(async ({method,params}) => {
      if(method === "eth_blockNumber") return "0xffff";
      const f = params[0];
      if(BigInt(f.toBlock)-BigInt(f.fromBlock)>9998n) throw Error("block range limit exceeded");
      if(BigInt(f.fromBlock)>0n) throw Error("429 too many requests");
      successRanges.push([f.fromBlock,f.toBlock]); return [f.fromBlock];
    }));
    const b = endpoint("b", vi.fn().mockImplementation(async ({method,params}) => {
      if(method === "eth_blockNumber") return "0xffff";
      const f=params[0]; successRanges.push([f.fromBlock,f.toBlock]); return [f.fromBlock];
    }));
    const pool = createRpcPool([a,b], options);
    const logs = await scanRanges(async (from,to) => await pool.request({method:"eth_getLogs",params:[{fromBlock:`0x${from.toString(16)}`,toBlock:`0x${to.toString(16)}`} ]}) as string[], 0n, 20000n);
    expect(logs).toHaveLength(3);
    expect(successRanges.map(([from]) => BigInt(from))).toEqual([0n,9999n,19998n]);
  });
  it("retains partial progress and reports scan-budget exhaustion", async () => {
    const fetch = vi.fn(async (from:bigint,to:bigint) => {
      if(to-from>9n) throw Error("block range limit exceeded");
      return [from];
    });
    const result = await scanDetailed(fetch,0n,100n,()=>false,false,10);
    expect(result.complete).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.through).toBeLessThan(100n);
    expect(result.note).toContain("budget");
  });
  it("attaches successful chunks and the missing range to thrown errors", async () => {
    let chunks = 0;
    const result = await scanRanges(async (from,to) => {
      if(to-from>9998n) throw Error("block range limit exceeded");
      if(chunks++) throw Error("offline");
      return [from];
    },0n,20000n).catch(e=>e);
    expect(result).toBeInstanceOf(IncompleteScanError);
    expect(result.logs).toEqual([0n]);
    expect(result.through).toBe(9998n);
    expect(result.head).toBe(20000n);
  });
});

it("separates throttling, pruning and log ranges in nested errors", () => {
  expect(rpcFailure({cause:{status:429}})).toBe("rate-limit");
  expect(rpcFailure(Error("Archive requests are not supported"))).toBe("snapshot");
  expect(rpcFailure(Error("header not found"))).toBe("behind");
  expect(rpcFailure({code:-32005,message:"query returned more than 10000 results"})).toBe("range");
});

it("honors Retry-After when the provider exposes it", async () => {
  const a=endpoint("a",vi.fn().mockRejectedValue({status:429,headers:new Headers({"Retry-After":"120"})}));
  const b=endpoint("b");
  const pool=createRpcPool([a,b],{...options,now:()=>1000});
  await pool.request({method:"eth_call"});
  expect(pool.getSnapshot().endpoints[0].cooldownUntil).toBe(121000);
});

it("fails over unsupported methods and leaves a pruned provider eligible for latest reads", async () => {
  const a=endpoint("a",vi.fn().mockImplementation(async ({method,params})=>{
    if(method==="unsupported") throw {code:-32601,message:"method not found"};
    if(params?.[1]==="0x10") throw Error("missing trie node");
    return "latest";
  }));
  const b=endpoint("b");
  const pool=createRpcPool([a,b],options);
  await expect(pool.request({method:"unsupported"})).resolves.toBe("0x64");
  await expect(pool.request({method:"eth_call",params:[{},"0x10"]})).resolves.toBe("0x64");
  await expect(pool.request({method:"eth_call",params:[{},"latest"]})).resolves.toBe("latest");
  expect(pool.getSnapshot().endpoints[0].cooldownUntil).toBe(0);
});

it("drops an aborted queued read without sending it or occupying a slot", async () => {
  let finish!: (value:string)=>void;
  const a=endpoint("a",vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue("ok"));
  const pool=createRpcPool([a],{...options,concurrency:1});
  const first=pool.request({method:"eth_call"});
  const controller=new AbortController();
  const second=pool.request({method:"eth_call",signal:controller.signal}).catch(e=>e);
  controller.abort();
  expect(((await second) as Error).name).toBe("AbortError");
  finish("first");
  expect(await first).toBe("first");
  expect(await pool.request({method:"eth_call"})).toBe("ok");
  expect(a.request).toHaveBeenCalledTimes(2);
});

it("resumes checkpoints after the short RPC cache expires, even at a newer head", async () => {
  let now=1000;
  const clock=vi.spyOn(Date,"now").mockImplementation(()=>now);
  const calls:bigint[]=[];
  let fail=true;
  const fetch=async(from:bigint,to:bigint)=>{
    calls.push(from);
    if(to-from>9998n) throw Error("block range limit exceeded");
    if(fail && from===19998n) throw Error("offline");
    return [from];
  };
  try {
    const first=await scanDetailed(fetch,0n,40000n,()=>false,false,96,"resume-after-ttl");
    expect(first.through).toBe(19997n);
    now+=70_000;
    calls.length=0; fail=false;
    const second=await scanDetailed(fetch,0n,40010n,()=>false,false,96,"resume-after-ttl");
    expect(second.complete).toBe(true);
    expect(calls[0]).toBe(19998n);
    expect(second.logs).toEqual([0n,9999n,19998n,29997n,39996n]);
  } finally { clock.mockRestore(); }
});

it("carries query cancellation through the real viem client and transport wrappers", async () => {
  let seenSignal:AbortSignal|undefined;
  const a=endpoint("a",vi.fn().mockImplementation((args)=>new Promise((_resolve,reject)=>{
    seenSignal=args.signal;
    args.signal.addEventListener("abort",()=>reject(args.signal.reason),{once:true});
  })));
  const b=endpoint("b");
  const pool=createRpcPool([a,b],options);
  const client=createPublicClient({transport:()=>createTransport({key:"public-pool-test",name:"test",type:"http",retryCount:0,request:pool.request as Parameters<typeof createTransport>[0]["request"]})});
  const controller=new AbortController();
  const read=withRpcSignal(client,controller.signal).getBlockNumber({cacheTime:0}).catch(e=>e);
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(seenSignal).toBe(controller.signal);
  controller.abort();
  const error = await read;
  expect(error.walk((cause: Error) => cause === controller.signal.reason)).toBe(controller.signal.reason);
  expect(b.request).not.toHaveBeenCalled();
  expect(pool.getSnapshot().endpoints[0].cooldownUntil).toBe(0);
});

it("reports queue timeouts without claiming providers are cooling down", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value:string)=>void;
    const a=endpoint("a",vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})));
    const pool=createRpcPool([a],{...options,concurrency:1});
    const first=pool.request({method:"eth_call"});
    const second=pool.request({method:"eth_call"}).catch(e=>e);
    await vi.advanceTimersByTimeAsync(25_001);
    const error=await second as RpcPoolError;
    expect(error.message).toContain("queue timed out");
    expect(error.failures[0].kind).toBe("queue-timeout");
    finish("ok"); await first;
    expect(a.request).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it("times out an unresponsive HTTP provider even when caller cancellation is supplied", async () => {
  const seen:string[]=[];
  const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async (input,init)=>{
    seen.push(String(input));
    if(String(input).includes("hung.example")) return new Promise((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true});
    });
    return new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:"0x64"}),{headers:{"Content-Type":"application/json"}});
  });
  try {
    const controller=new AbortController();
    const pool=createRpcPool([httpRpcEndpoint("https://hung.example",10),httpRpcEndpoint("https://healthy.example",100)],options);
    await expect(pool.request({method:"eth_blockNumber",signal:controller.signal})).resolves.toBe("0x64");
    expect(controller.signal.aborted).toBe(false);
    expect(seen).toEqual(["https://hung.example/","https://healthy.example/"]);
    expect(pool.getSnapshot().failovers).toBe(1);
  } finally { fetch.mockRestore(); }
});
