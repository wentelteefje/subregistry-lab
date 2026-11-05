import {
  encodeFunctionData,
  encodeDeployData,
  type Address,
  type TransactionReceipt,
} from "viem";
import { isPendingTransaction, type StepState } from "../state/labSession";
import {
  actionIntent,
  type ReadFn,
  type StepAction,
  type StepCtx,
  type StepDef,
} from "./steps";

type Replacement = {
  hash: `0x${string}`;
  cancelled: boolean;
  transaction?: StepState["transaction"];
};
export type SequenceIO = {
  read: ReadFn;
  assertIdentity: () => Promise<void>;
  prepare?: (
    action: StepAction,
  ) => Promise<NonNullable<StepState["transaction"]>>;
  send: (
    action: StepAction,
    transaction?: StepState["transaction"],
  ) => Promise<`0x${string}`>;
  verificationBlock?: (minimum: bigint) => Promise<bigint>;
  transaction?: (
    hash: `0x${string}`,
  ) => Promise<NonNullable<StepState["transaction"]>>;
  receipt: (
    hash: `0x${string}`,
    onReplaced?: (replacement: Replacement) => void,
  ) => Promise<TransactionReceipt>;
  getState: (id: string) => StepState | undefined;
  setState: (id: string, state: StepState) => void;
  patch: (patch: Partial<StepCtx>, blockNumber: bigint) => void;
};

export function prepareTransaction(
  action: StepAction,
  account: Address,
  nonce: number,
): NonNullable<StepState["transaction"]> {
  if (!Number.isSafeInteger(nonce) || nonce < 0)
    throw new Error("Wallet returned an invalid transaction nonce");
  const input =
    action.type === "write"
      ? encodeFunctionData({
          abi: action.abi,
          functionName: action.functionName,
          args: action.args as unknown[],
        })
      : encodeDeployData({
          abi: action.abi,
          bytecode: action.bytecode,
          args: action.args as unknown[],
        });
  return {
    nonce,
    from: account,
    to: action.type === "write" ? action.address : null,
    input,
    value: "0",
  };
}

function contextPatch(patch: Partial<StepCtx>): StepState["context"] {
  const result: NonNullable<StepState["context"]> = {};
  for (const key of [
    "userRegistry",
    "resolver",
    "registrar",
    "subResolver",
  ] as const) {
    if (patch[key]) result[key] = patch[key];
  }
  if (patch.subResolverName) result.subResolverName = patch.subResolverName;
  return result;
}

/** Confirmed results are replayed from persisted context; only unknown receipts are awaited. */
export async function executeSequence(
  plan: StepDef[],
  initial: StepCtx,
  io: SequenceIO,
): Promise<StepCtx> {
  let ctx = { ...initial };
  for (const step of plan) {
    await io.assertIdentity();
    if (step.skipIf?.(ctx)) {
      io.setState(step.id, { status: "skipped" });
      continue;
    }
    const action = step.build(ctx);
    const normalized =
      action.type === "write" && action.functionName === "deployProxy"
        ? {
            ...action,
            args: [
              action.args[0],
              `${ctx.parentLabel}:${step.intentSeed ?? step.id}`,
              action.args[2],
            ],
          }
        : action;
    const intent = actionIntent(normalized);
    const prior = io.getState(step.id);
    const changedPending = Boolean(
      prior && isPendingTransaction(prior) && prior.intent !== intent,
    );
    let state: StepState =
      prior?.intent === intent || changedPending
        ? { ...prior!, title: prior?.title ?? step.title }
        : {
            status: "queued",
            intent,
            title: step.title,
            capture: step.capture,
            targetName: step.targetName,
          };
    const publish = (patch: Partial<StepState>) => {
      state = { ...state, ...patch };
      io.setState(step.id, state);
    };
    try {
      if (
        state.confirmed &&
        !state.reverted &&
        !state.cancelled &&
        (!step.capture || state.context?.[step.capture])
      ) {
        ctx = { ...ctx, ...state.context };
        if (state.context && state.blockNumber)
          io.patch(state.context, BigInt(state.blockNumber));
      } else {
        if (state.reverted || state.cancelled) {
          state = {
            status: "queued",
            intent,
            title: step.title,
            capture: step.capture,
            targetName: step.targetName,
          };
        }
        if (!state.txHash && step.preflight !== false && step.verify) {
          const pre = await step.verify(io.read, ctx);
          if (pre.ok) {
            publish({ status: "done", detail: `Already done: ${pre.detail}` });
            continue;
          }
        }
        if (!state.txHash) {
          await step.guard?.(io.read, ctx);
          publish({ status: "wallet" });
          if (io.prepare) publish({ transaction: await io.prepare(action) });
          await io.assertIdentity();
          const txHash = await io.send(action, state.transaction);
          publish({ status: "mining", txHash });
          if (io.transaction) {
            try {
              publish({ transaction: await io.transaction(txHash) });
            } catch {
              /* Receipt recovery remains possible when transaction lookup lags. */
            }
          }
        }
        publish({ status: "mining" });
        const receipt = await io.receipt(state.txHash!, (replacement) => {
          publish({
            txHash: replacement.hash,
            cancelled: replacement.cancelled,
            transaction: replacement.transaction ?? state.transaction,
          });
        });
        publish({
          confirmed: true,
          blockNumber: receipt.blockNumber.toString(),
          txHash: receipt.transactionHash ?? state.txHash,
          reverted: receipt.status !== "success",
        });
        if (state.cancelled)
          throw new Error(
            "Wallet replaced or cancelled this action. Review the replacement before retrying.",
          );
        if (state.reverted)
          throw new Error(
            "Transaction reverted; retry to submit a new transaction",
          );
        if (step.onReceipt) {
          const patch = contextPatch(step.onReceipt(receipt, ctx));
          if (patch && state.capture === "subResolver" && state.targetName)
            patch.subResolverName = state.targetName;
          publish({ context: patch });
          ctx = { ...ctx, ...patch };
          io.patch(patch ?? {}, receipt.blockNumber);
        }
        if (changedPending) {
          publish({
            status: "done",
            detail:
              "Previous transaction confirmed; review its result before submitting a different action",
          });
          throw new Error(
            "Previous transaction recovered. Review its result and retry the requested action if needed.",
          );
        }
      }
      if (step.verify) {
        publish({ status: "verifying" });
        const minimum = state.blockNumber
          ? BigInt(state.blockNumber)
          : undefined;
        const blockNumber =
          minimum === undefined
            ? undefined
            : ((await io.verificationBlock?.(minimum)) ?? minimum);
        if (minimum !== undefined && blockNumber! < minimum)
          throw new Error(
            "Verification node is behind the transaction receipt; retry verification",
          );
        const read: ReadFn = (params) =>
          io.read({
            ...params,
            ...(blockNumber === undefined ? {} : { blockNumber }),
          });
        const result = await step.verify(read, ctx);
        if (!result.ok) throw new Error(result.detail);
        publish({ status: "done", detail: result.detail });
      } else publish({ status: "done" });
    } catch (error) {
      publish({
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  return ctx;
}
