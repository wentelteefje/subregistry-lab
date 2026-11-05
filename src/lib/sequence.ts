import type { Address, TransactionReceipt } from "viem";
import type { StepState } from "../state/labSession";
import { actionIntent, type ReadFn, type StepAction, type StepCtx, type StepDef } from "./steps";

export type SequenceIO = {
  read: ReadFn;
  assertIdentity: () => Promise<void>;
  send: (action: StepAction) => Promise<`0x${string}`>;
  receipt: (hash: `0x${string}`) => Promise<TransactionReceipt>;
  getState: (id: string) => StepState | undefined;
  setState: (id: string, state: StepState) => void;
  patch: (patch: Partial<StepCtx>, receipt: TransactionReceipt) => void;
};

/** Receipt-first recovery prevents a refresh or RPC failure from duplicating a write. */
export async function executeSequence(plan: StepDef[], initial: StepCtx, io: SequenceIO): Promise<StepCtx> {
  let ctx = { ...initial };
  for (const step of plan) {
    await io.assertIdentity();
    if (step.skipIf?.(ctx)) {
      io.setState(step.id, { status: "skipped" });
      continue;
    }
    const action = step.build(ctx);
    // Salts identify individual deployments, not the user's requested operation.
    const normalized = action.type === "write" && action.functionName === "deployProxy"
      ? { ...action, args: [action.args[0], 0n, action.args[2]] } : action;
    const intent = actionIntent(normalized);
    const prior = io.getState(step.id);
    if (prior?.txHash && !prior.reverted && prior.intent !== intent && prior.status !== "done") {
      // Time-dependent inputs (such as an absolute expiry) may change after refresh.
      // Settle the old transaction without interpreting it as the newly requested write.
      const receipt = await io.receipt(prior.txHash);
      if (receipt.status === "success") {
        if (step.onReceipt) io.patch(step.onReceipt(receipt, ctx), receipt);
        io.setState(step.id, { ...prior, status: "done", detail: "Previous transaction confirmed; review its result before submitting another action" });
      } else {
        io.setState(step.id, { ...prior, status: "failed", reverted: true, detail: "Previous transaction reverted" });
      }
      throw new Error("Previous transaction recovered. Review its result and retry the requested action if needed.");
    }
    let txHash = prior?.intent === intent && !prior.reverted ? prior.txHash : undefined;
    let reverted = false;
    let context = prior?.intent === intent ? prior.context : undefined;
    try {
      if (!txHash && step.preflight !== false && step.verify) {
        // Read failures must stop writes, rather than silently bypassing checks.
        const pre = await step.verify(io.read, ctx);
        if (pre.ok) {
          io.setState(step.id, { status: "done", intent, detail: `Already done: ${pre.detail}` });
          continue;
        }
      }
      if (!txHash) {
        await step.guard?.(io.read, ctx);
        io.setState(step.id, { status: "wallet", intent });
        await io.assertIdentity();
        txHash = await io.send(action);
      }
      io.setState(step.id, { status: "mining", intent, txHash, context });
      const receipt = await io.receipt(txHash);
      if (receipt.status !== "success") {
        // An explicitly reverted transaction can be retried; a timeout cannot.
        reverted = true;
        throw new Error("Transaction reverted; retry to submit a new transaction");
      }
      if (step.onReceipt) {
        const patch = step.onReceipt(receipt, ctx);
        ctx = { ...ctx, ...patch };
        if (patch.subResolver) context = { subResolver: patch.subResolver as Address };
        io.patch(patch, receipt);
      }
      if (context?.subResolver) ctx.subResolver = context.subResolver;
      if (step.verify) {
        io.setState(step.id, { status: "verifying", intent, txHash, context });
        const result = await step.verify(io.read, ctx);
        if (!result.ok) throw new Error(result.detail);
        io.setState(step.id, { status: "done", intent, txHash, context, detail: result.detail });
      } else {
        io.setState(step.id, { status: "done", intent, txHash, context });
      }
    } catch (error) {
      io.setState(step.id, { status: "failed", intent, txHash, context, reverted, detail: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  return ctx;
}
