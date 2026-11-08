import { describe, expect, it } from "vitest";
import { decodeFunctionData, type Hex } from "viem";
import { getDeployment } from "../config/deployments";
import { verifiableFactoryAbi } from "../config/abis";
import { inspectStep } from "./inspect";
import { prepareTransaction } from "./sequence";
import { buildSetupSteps, type StepCtx } from "./steps";
import { ALL_ROLES, ROLE_REGISTRAR, ROLE_RENEW } from "./roles";
const account = "0x1111111111111111111111111111111111111111" as const;
const ctx: StepCtx = {
  chainId: 1,
  setupNonce: "review-stable",
  account,
  parentLabel: "lab",
  deployResolver: true,
  ownerInitBitmap: ALL_ROLES,
  userRegistry: "0x2222222222222222222222222222222222222222",
  resolver: "0x3333333333333333333333333333333333333333",
  registrar: "0x4444444444444444444444444444444444444444",
  registrarParams: {
    pricePerYear: 5000000n,
    minDuration: 86400n,
    beneficiary: account,
    grantBitmap: ROLE_REGISTRAR | ROLE_RENEW,
  },
};
describe("transaction inspection", () => {
  for (const chainId of [1, 11155111])
    it(`uses execution's exact data and target for every setup action on ${chainId}`, () => {
      const context = { ...ctx, chainId };
      for (const step of buildSetupSteps("standard-rentable", chainId)) {
        const inspection = inspectStep(step, context);
        const sent = prepareTransaction(step.build(context), account, 12);
        expect(inspection.error).toBeUndefined();
        expect(inspection.data).toBe(sent.input);
        expect(inspection.to).toBe(sent.to);
        expect(inspection.request?.chainId).toBe(
          chainId === 1 ? "0x1" : "0xaa36a7",
        );
      }
    });
  it("keeps proxy salt and calldata stable across repeated builds and reload", () => {
    const step = buildSetupSteps("fully-controlled")[0];
    const first = inspectStep(step, ctx);
    expect(inspectStep(step, { ...ctx }).data).toBe(first.data);
    expect(
      inspectStep(buildSetupSteps("fully-controlled")[0], { ...ctx }).data,
    ).toBe(first.data);
    expect(
      inspectStep(step, { ...ctx, setupNonce: "new-review" }).data,
    ).not.toBe(first.data);
  });
  it("decodes the nested grant initializer with full accounts and role masks", () => {
    const info = inspectStep(buildSetupSteps("fully-controlled", 1)[0], ctx);
    expect(info.initializer?.contract).toBe("UserRegistry");
    expect(JSON.stringify(info.initializer)).toContain(account);
    expect(JSON.stringify(info.initializer)).toContain("ALL_ROLES");
    const decoded = decodeFunctionData({
      abi: verifiableFactoryAbi,
      data: info.data!,
    });
    expect(String(decoded.args[0]).toLowerCase()).toBe(
      getDeployment(1).addresses.UserRegistryImpl,
    );
  });
  it("shows missing deployment dependencies without encoding fake addresses", () => {
    const step = buildSetupSteps("standard-rentable", 1).find(
      (step) => step.id === "grant-registrar",
    )!;
    const info = inspectStep(step, { ...ctx, registrar: undefined });
    expect(info.missing.join()).toContain("Registrar address");
    expect(info.data).toBeUndefined();
    expect(info.request).toBeUndefined();
    expect(info.error).toBeUndefined();
  });
  it("uses recorded calldata and arguments instead of a changed draft", () => {
    const step = buildSetupSteps("fully-controlled", 1)[0];
    const transaction = prepareTransaction(step.build(ctx), account, 7);
    const info = inspectStep(
      step,
      { ...ctx, setupNonce: "changed", ownerInitBitmap: 0n },
      { status: "done", confirmed: true, transaction },
    );
    expect(info.source).toBe("recorded");
    expect(info.data).toBe(transaction.input);
    expect(info.nonce).toBe(7);
    expect(JSON.stringify(info.initializer)).toContain("ALL_ROLES");
  });
  it("does not invent a draft for a legacy hash without its request", () => {
    const info = inspectStep(buildSetupSteps("fully-controlled")[0], ctx, {
      status: "done",
      txHash: `0x${"11".repeat(32)}` as Hex,
    });
    expect(info.source).toBe("unrecorded");
    expect(info.data).toBeUndefined();
    expect(info.args).toBeUndefined();
  });
  it("distinguishes CREATE initcode from calldata and omits to in its RPC request", () => {
    const step = buildSetupSteps("standard-rentable", 1).find(
      (step) => step.id === "deploy-registrar",
    )!;
    const info = inspectStep(step, ctx);
    expect(info.kind).toBe("create");
    expect(info.to).toBeNull();
    expect(info.request).not.toHaveProperty("to");
    expect(info.signature).toContain("constructor");
    expect(JSON.stringify(info.args)).toContain("5000000");
  });
});

it("shows the next request after rejection, revert or cancellation and retains the old attempt separately", () => {
  const step = buildSetupSteps("fully-controlled", 1)[0];
  const oldTransaction = prepareTransaction(
    step.build({ ...ctx, setupNonce: "old-attempt" }),
    account,
    1,
  );
  for (const flags of [
    {},
    { txHash: `0x${"11".repeat(32)}` as Hex, reverted: true, confirmed: true },
    { txHash: `0x${"11".repeat(32)}` as Hex, cancelled: true, confirmed: true },
  ]) {
    const info = inspectStep(step, ctx, {
      status: "failed",
      transaction: oldTransaction,
      ...flags,
    });
    expect(info.source).toBe("draft");
    expect(info.data).toBe(
      prepareTransaction(step.build(ctx), account, 0).input,
    );
    expect(info.data).not.toBe(oldTransaction.input);
    expect(info.previousAttempt?.transaction?.input).toBe(oldTransaction.input);
  }
  const legacyRetry = inspectStep(step, ctx, {
    status: "failed",
    reverted: true,
    confirmed: true,
    txHash: `0x${"22".repeat(32)}` as Hex,
  });
  expect(legacyRetry.source).toBe("draft");
  expect(legacyRetry.data).toBeDefined();
});

it("does not show a random salt as reviewed data before the setup is prepared", () => {
  const info = inspectStep(buildSetupSteps("fully-controlled", 1)[0], {
    ...ctx,
    setupNonce: undefined,
  });
  expect(info.args).toBeUndefined();
  expect(info.data).toBeUndefined();
  expect(info.missing.join()).toContain("Stable deployment salt");
});
