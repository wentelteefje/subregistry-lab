import { describe, expect, it } from "vitest";
import { decodeFunctionData, toHex, type Abi } from "viem";
import { packetToBytes } from "viem/ens";
import * as local from "./abis";
import mainEthRegistry from "./artifacts/mainnet-ETHRegistry.abi.json";
import testEthRegistry from "./artifacts/sepolia-ETHRegistry.abi.json";
import mainRegistry from "./artifacts/mainnet-UserRegistryImpl.abi.json";
import testRegistry from "./artifacts/sepolia-UserRegistryImpl.abi.json";
import mainResolver from "./artifacts/mainnet-PermissionedResolverImpl.abi.json";
import testResolver from "./artifacts/sepolia-PermissionedResolverImpl.abi.json";
import mainFactory from "./artifacts/mainnet-VerifiableFactory.abi.json";
import testFactory from "./artifacts/sepolia-VerifiableFactory.abi.json";
import { buildSetupSteps, buildSetAddrStep, buildFaucetStep, type StepCtx } from "../lib/steps";
import { ALL_ROLES } from "../lib/roles";
import { getDeployment } from "./deployments";
const shape = (value: unknown) => JSON.stringify(value, (key, value) => ["internalType", "name"].includes(key) ? undefined : value);
describe("deployment ABI compatibility", () => {
  for (const [name, abi, snapshots] of [
    ["registry", local.registryAbi, [mainRegistry, testRegistry, mainEthRegistry, testEthRegistry]],
    ["registry init", local.userRegistryInitAbi, [mainRegistry, testRegistry]],
    ["resolver init", local.resolverInitAbi, [mainResolver, testResolver]],
    ["resolver", local.resolverAbi, [mainResolver, testResolver]],
    ["resolver inspection", local.resolverInspectionAbi, [mainResolver, testResolver]],
    ["factory", local.verifiableFactoryAbi, [mainFactory, testFactory]],
  ] as const) it(`${name} matches both deployed snapshots, including event indexing`, () => {
    for (const snapshot of snapshots) for (const entry of abi) {
      expect((snapshot as Abi).some(item => "name" in item && item.name === entry.name && shape(item) === shape(entry))).toBe(true);
    }
  });
  for (const chainId of [1, 11155111]) it(`encodes grant-array initializers for ${chainId}`, () => {
    const ctx: StepCtx = { account: "0x1111111111111111111111111111111111111111", parentLabel: "lab", ownerInitBitmap: ALL_ROLES, deployResolver: true };
    const plan = buildSetupSteps("fully-controlled", chainId);
    for (const [id, abi] of [["deploy-registry", local.userRegistryInitAbi], ["deploy-resolver", local.resolverInitAbi]] as const) {
      const action = plan.find(step => step.id === id)!.build(ctx);
      if (action.type !== "write") throw new Error("Expected proxy write");
      expect(action.address).toBe(getDeployment(chainId).addresses.VerifiableFactory);
      const call = decodeFunctionData({ abi, data: action.args[2] as `0x${string}` });
      expect(call.args[0]).toEqual([{ account: ctx.account, roleBitmap: ALL_ROLES }]);
      if (id === "deploy-resolver") expect(call.args[1]).toEqual([]);
    }
  });
  it("rejects faucet transactions on Mainnet", () => {
    expect(() => buildFaucetStep({chainId:1, account:"0x1111111111111111111111111111111111111111",amount:1n})).toThrow("only available on Sepolia");
  });
  it("writes ETH records using a DNS name and coin type 60", () => {
    const [step] = buildSetAddrStep({ resolver: "0x1111111111111111111111111111111111111111", node: `0x${"00".repeat(32)}`, fqdn: "alice.lab.eth", addr: "0x2222222222222222222222222222222222222222" });
    const action = step.build({} as StepCtx);
    expect(action.type === "write" && action.functionName).toBe("setAddress");
    expect(action.args.slice(0, 2)).toEqual([toHex(packetToBytes("alice.lab.eth")), 60n]);
  });
});
