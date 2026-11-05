import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { getPreset, DANGEROUS_ROOT_BITMAP, MAX_EXPIRY } from "./presets";
import {
  buildDirectRegisterStep,
  buildLockParentLinkStep,
  buildRegistrarRegisterSteps,
  buildRevokeRegistryRolesStep,
  buildSetupSteps,
  buildSwitchResolverSteps,
  type StepCtx,
} from "./steps";
import { ALL_ROLES, ROLE_SET_SUBREGISTRY, adminOf } from "./roles";
import { labelhashId } from "./names";
import { getDeployment } from "../config/deployments";
const deployments = getDeployment().addresses;

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const REGISTRY = "0x2222222222222222222222222222222222222222" as Address;
const RESOLVER = "0x3333333333333333333333333333333333333333" as Address;
const REGISTRAR = "0x4444444444444444444444444444444444444444" as Address;

function baseCtx(overrides: Partial<StepCtx> = {}): StepCtx {
  return {
    account: ACCOUNT,
    parentLabel: "nick",
    ownerInitBitmap: getPreset("fully-controlled").ownerInitBitmap,
    deployResolver: true,
    ...overrides,
  };
}

describe("buildSetupSteps", () => {
  it("has the full ordered step list", () => {
    expect(buildSetupSteps("standard-rentable").map((s) => s.id)).toEqual([
      "deploy-registry",
      "deploy-resolver",
      "link",
      "set-parent-resolver",
      "set-parent",
      "deploy-registrar",
      "grant-registrar",
    ]);
  });

  it("set-parent-resolver points the parent name at the setup's resolver", async () => {
    const step = buildSetupSteps("fully-controlled").find(
      (s) => s.id === "set-parent-resolver",
    )!;
    const ctx = baseCtx({ resolver: RESOLVER });
    const action = step.build(ctx);
    if (action.type !== "write") throw new Error("expected write");
    expect(action.address).toBe(deployments.ETHRegistry);
    expect(action.functionName).toBe("setResolver");
    expect(action.args[1]).toBe(RESOLVER);

    const good = await step.verify!(async () => RESOLVER, ctx);
    expect(good.ok).toBe(true);
    const bad = await step.verify!(async () => REGISTRAR, ctx);
    expect(bad.ok).toBe(false);
  });

  it("set-parent-resolver is skipped only when the setup has no resolver at all", () => {
    const step = buildSetupSteps("fully-controlled").find(
      (s) => s.id === "set-parent-resolver",
    )!;
    // "none" picked: no deploy, no reuse
    expect(step.skipIf!(baseCtx({ deployResolver: false }))).toBe(true);
    // fresh deploy: resolver lands in ctx before this step runs
    expect(step.skipIf!(baseCtx({ deployResolver: true }))).toBe(false);
    // reusing an existing resolver
    expect(step.skipIf!(baseCtx({ deployResolver: false, resolver: RESOLVER }))).toBe(
      false,
    );
  });

  it("set-parent records the ETHRegistry as parent and verifies via getParent", async () => {
    const step = buildSetupSteps("fully-controlled").find((s) => s.id === "set-parent")!;
    const ctx = baseCtx({ userRegistry: REGISTRY });
    const action = step.build(ctx);
    if (action.type !== "write") throw new Error("expected write");
    expect(action.address).toBe(REGISTRY);
    expect(action.functionName).toBe("setParent");
    expect(action.args).toEqual([deployments.ETHRegistry, "nick"]);

    const good = await step.verify!(async () => [deployments.ETHRegistry, "nick"], ctx);
    expect(good.ok).toBe(true);
    const bad = await step.verify!(async () => [deployments.ETHRegistry, "other"], ctx);
    expect(bad.ok).toBe(false);
  });

  it("registrar steps skip when no registrar params in ctx", () => {
    const steps = buildSetupSteps("fully-controlled");
    const ctx = baseCtx(); // no registrarParams
    expect(steps.find((s) => s.id === "deploy-registrar")!.skipIf!(ctx)).toBe(true);
    expect(steps.find((s) => s.id === "grant-registrar")!.skipIf!(ctx)).toBe(true);
    expect(steps.find((s) => s.id === "deploy-registry")!.skipIf).toBeUndefined();
  });

  it("resolver step skips when deployResolver=false", () => {
    const steps = buildSetupSteps("fully-controlled");
    expect(steps.find((s) => s.id === "deploy-resolver")!.skipIf!(baseCtx({ deployResolver: false }))).toBe(true);
  });

  it("deploy-registry targets the factory with fresh salts per build", () => {
    const step = buildSetupSteps("fully-controlled")[0];
    const a = step.build(baseCtx());
    const b = step.build(baseCtx());
    if (a.type !== "write" || b.type !== "write") throw new Error("expected writes");
    expect(a.address).toBe(deployments.VerifiableFactory);
    expect(a.functionName).toBe("deployProxy");
    // args: [impl, salt, initData] - salt differs between attempts
    expect(a.args[0]).toBe(deployments.UserRegistryImpl);
    expect(a.args[1]).not.toBe(b.args[1]);
  });

  it("link step threads the deployed registry through ctx", () => {
    const step = buildSetupSteps("fully-controlled").find((s) => s.id === "link")!;
    const action = step.build(baseCtx({ userRegistry: REGISTRY }));
    if (action.type !== "write") throw new Error("expected write");
    expect(action.address).toBe(deployments.ETHRegistry);
    expect(action.functionName).toBe("setSubregistry");
    expect(action.args[1]).toBe(REGISTRY);
  });

  it("link verify reads back the subregistry pointer", async () => {
    const step = buildSetupSteps("fully-controlled").find((s) => s.id === "link")!;
    const read = async () => REGISTRY;
    const res = await step.verify!(read, baseCtx({ userRegistry: REGISTRY }));
    expect(res.ok).toBe(true);
    const bad = await step.verify!(async () => RESOLVER, baseCtx({ userRegistry: REGISTRY }));
    expect(bad.ok).toBe(false);
  });

  it("grant step grants the preset bitmap to the deployed registrar", () => {
    const preset = getPreset("standard-rentable");
    const ctx = baseCtx({
      userRegistry: REGISTRY,
      registrar: REGISTRAR,
      registrarParams: {
        pricePerYear: preset.registrar!.pricePerYear,
        minDuration: preset.registrar!.minDuration,
        beneficiary: ACCOUNT,
        grantBitmap: preset.registrar!.grantBitmap,
      },
    });
    const step = buildSetupSteps(preset).find((s) => s.id === "grant-registrar")!;
    const action = step.build(ctx);
    if (action.type !== "write") throw new Error("expected write");
    expect(action.address).toBe(REGISTRY);
    expect(action.args).toEqual([preset.registrar!.grantBitmap, REGISTRAR]);
  });
});

describe("action builders", () => {
  it("direct register passes max expiry through", () => {
    const [step] = buildDirectRegisterStep({
      userRegistry: REGISTRY,
      label: "perma",
      owner: ACCOUNT,
      resolver: RESOLVER,
      roleBitmap: 1n,
      expiry: MAX_EXPIRY,
    });
    const action = step.build({} as StepCtx);
    if (action.type !== "write") throw new Error("expected write");
    expect(action.functionName).toBe("register");
    expect(action.args[5]).toBe(MAX_EXPIRY);
  });

  it("registrar approval checks live allowance rather than a stale UI value", async () => {
    const params = {
      registrar: REGISTRAR,
      userRegistry: REGISTRY,
      label: "alice",
      owner: ACCOUNT,
      resolver: RESOLVER,
      duration: 365n * 86400n,
      price: 5_000_000n,
      currentAllowance: 0n,
    };
    const short = buildRegistrarRegisterSteps(params);
    expect((await short[0].verify!(async () => 0n, {} as StepCtx)).ok).toBe(false);
    const covered = buildRegistrarRegisterSteps({ ...params, currentAllowance: 5_000_000n });
    expect((await covered[0].verify!(async () => 5_000_000n, {} as StepCtx)).ok).toBe(true);
  });

  it("revoke-registry-roles revokes the dangerous bitmap from the account", () => {
    const [step] = buildRevokeRegistryRolesStep({ userRegistry: REGISTRY, account: ACCOUNT });
    const action = step.build({} as StepCtx);
    if (action.type !== "write") throw new Error("expected write");
    expect(action.functionName).toBe("revokeRootRoles");
    expect(action.args).toEqual([DANGEROUS_ROOT_BITMAP, ACCOUNT]);
  });

  it("lock-parent-link uses the pre-read resource, not the canonical id", () => {
    const resource = 777n;
    const [step] = buildLockParentLinkStep({
      parentLabel: "nick",
      parentResource: resource,
      account: ACCOUNT,
    });
    const action = step.build({} as StepCtx);
    if (action.type !== "write") throw new Error("expected write");
    expect(action.functionName).toBe("revokeRoles");
    expect(action.args[0]).toBe(resource);
    expect(action.args[1]).toBe(ROLE_SET_SUBREGISTRY | adminOf(ROLE_SET_SUBREGISTRY));
  });

  it("lock verify reports ok only when roles are gone", async () => {
    const [step] = buildRevokeRegistryRolesStep({ userRegistry: REGISTRY, account: ACCOUNT });
    const read = (roles: bigint, counts: bigint, emancipated: boolean) => async ({ functionName }: { functionName: string }) => functionName === "roles" ? roles : functionName === "roleCount" ? counts : emancipated;
    expect((await step.verify!(read(0n, 0n, true), {} as StepCtx)).ok).toBe(true);
    // Only one dangerous role remains: the old all-bits boolean test falsely succeeded.
    expect((await step.verify!(read(ROLE_SET_SUBREGISTRY, ROLE_SET_SUBREGISTRY, false), {} as StepCtx)).ok).toBe(false);
    // Another account still holds a dangerous role.
    expect((await step.verify!(read(0n, ROLE_SET_SUBREGISTRY, false), {} as StepCtx)).ok).toBe(false);
  });
});

describe("buildSwitchResolverSteps", () => {
  const SUB_RESOLVER = "0x5555555555555555555555555555555555555555" as Address;
  const params = {
    userRegistry: REGISTRY,
    parentLabel: "nick",
    label: "alice",
    owner: ACCOUNT,
  };

  it("deploys a resolver for the subname owner, then points the subname at it", () => {
    expect(buildSwitchResolverSteps(params).map((s) => s.id)).toEqual([
      "deploy-sub-resolver",
      "set-sub-resolver",
    ]);
  });

  it("deploy targets the factory with the resolver impl and a fresh salt per build", () => {
    const [deploy] = buildSwitchResolverSteps(params);
    const a = deploy.build({} as StepCtx);
    const b = buildSwitchResolverSteps(params)[0].build({} as StepCtx);
    if (a.type !== "write" || b.type !== "write") throw new Error("expected writes");
    expect(a.address).toBe(deployments.VerifiableFactory);
    expect(a.functionName).toBe("deployProxy");
    expect(a.args[0]).toBe(deployments.PermissionedResolverImpl);
    expect(a.args[1]).not.toBe(b.args[1]);
  });

  it("deploy verify requires the captured address and the owner's root roles", async () => {
    const [deploy] = buildSwitchResolverSteps(params);
    const noAddr = await deploy.verify!(async () => true, {} as StepCtx);
    expect(noAddr.ok).toBe(false);

    const ctx = { subResolver: SUB_RESOLVER } as StepCtx;
    const calls: unknown[] = [];
    const good = await deploy.verify!(async (req: unknown) => {
      calls.push(req);
      return true;
    }, ctx);
    expect(good.ok).toBe(true);
    const req = calls[0] as { address: Address; functionName: string; args: unknown[] };
    expect(req.address).toBe(SUB_RESOLVER);
    expect(req.functionName).toBe("hasRootRoles");
    expect(req.args).toEqual([ALL_ROLES, ACCOUNT]);

    const bad = await deploy.verify!(async () => false, ctx);
    expect(bad.ok).toBe(false);
  });

  it("set-sub-resolver writes the deployed address for the label's token id", () => {
    const [, set] = buildSwitchResolverSteps(params);
    const action = set.build({ subResolver: SUB_RESOLVER } as StepCtx);
    if (action.type !== "write") throw new Error("expected write");
    expect(action.address).toBe(REGISTRY);
    expect(action.functionName).toBe("setResolver");
    expect(action.args).toEqual([labelhashId("alice"), SUB_RESOLVER]);
  });

  it("set-sub-resolver verify compares the on-chain pointer case-insensitively", async () => {
    const [, set] = buildSwitchResolverSteps(params);
    const ctx = { subResolver: SUB_RESOLVER } as StepCtx;
    const upper = SUB_RESOLVER.toUpperCase().replace("0X", "0x") as Address;
    expect((await set.verify!(async () => upper, ctx)).ok).toBe(true);
    expect((await set.verify!(async () => RESOLVER, ctx)).ok).toBe(false);
  });
});
