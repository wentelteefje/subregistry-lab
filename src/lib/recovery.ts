import { parseEventLogs, type Address, type TransactionReceipt } from "viem";
import type { Deployment } from "../config/deployments";
import { verifiableFactoryAbi } from "../config/abis";
import type { StepState } from "../state/labSession";

type Transaction = NonNullable<StepState["transaction"]>;
export type RecoveryIO = {
  receipt: (hash: `0x${string}`) => Promise<TransactionReceipt | null>;
  transaction: (hash: `0x${string}`) => Promise<Transaction>;
  minedNonce: (account: Address) => Promise<number>;
};

function settled(
  state: StepState,
  receipt: TransactionReceipt,
  network: Deployment,
): StepState {
  const result: StepState = {
    ...state,
    confirmed: true,
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    reverted: receipt.status !== "success",
  };
  if (result.reverted || result.cancelled)
    return {
      ...result,
      status: "failed",
      detail:
        "The original action was reverted or cancelled; a new action can now be started",
    };
  const capture = state.capture;
  if (capture === "registrar") {
    if (!receipt.contractAddress)
      throw new Error("The recovered transaction did not deploy a registrar");
    result.context = { registrar: receipt.contractAddress };
  } else if (capture) {
    const implementation =
      capture === "userRegistry"
        ? network.addresses.UserRegistryImpl
        : network.addresses.PermissionedResolverImpl;
    const [log] = parseEventLogs({
      abi: verifiableFactoryAbi,
      eventName: "ProxyDeployed",
      logs: receipt.logs.filter(
        (log) =>
          log.address.toLowerCase() ===
          network.addresses.VerifiableFactory.toLowerCase(),
      ),
    });
    if (
      !log ||
      log.args.implementation.toLowerCase() !== implementation.toLowerCase()
    )
      throw new Error(
        "The recovered transaction did not deploy the expected implementation",
      );
    result.context = {
      [capture]: log.args.proxyAddress,
      ...(capture === "subResolver" && state.targetName
        ? { subResolverName: state.targetName }
        : {}),
    };
  }
  return {
    ...result,
    status: "done",
    detail:
      "Transaction confirmed. Its deployment results were restored; resume the original flow to verify and complete it.",
  };
}

/** A consumed nonce alone cannot prove cancellation: require the actual mined replacement. */
export async function recoverPending(
  state: StepState,
  replacement: `0x${string}` | undefined,
  account: Address,
  network: Deployment,
  io: RecoveryIO,
): Promise<StepState> {
  if (!state.txHash) throw new Error("No submitted transaction to recover");
  const original = await io.receipt(state.txHash);
  if (original) return settled(state, original, network);
  if (!replacement || replacement === state.txHash) {
    let transaction = state.transaction;
    if (!transaction) {
      try {
        transaction = await io.transaction(state.txHash);
      } catch {
        /* A dropped hash may no longer be available. */
      }
    }
    return {
      ...state,
      transaction,
      detail:
        "No receipt yet. If your wallet sped up or cancelled this transaction, paste its replacement hash.",
    };
  }
  const originalTransaction =
    state.transaction ?? (await io.transaction(state.txHash));
  const transaction = await io.transaction(replacement);
  if (
    originalTransaction.from.toLowerCase() !== account.toLowerCase() ||
    transaction.from.toLowerCase() !== account.toLowerCase() ||
    transaction.nonce !== originalTransaction.nonce
  ) {
    throw new Error(
      "The replacement must be from the same wallet and use the original nonce",
    );
  }
  const receipt = await io.receipt(replacement);
  if (!receipt || (await io.minedNonce(account)) <= transaction.nonce)
    throw new Error("The replacement transaction has not been mined yet");
  const sameRequest =
    transaction.to?.toLowerCase() === originalTransaction.to?.toLowerCase() &&
    transaction.input.toLowerCase() ===
      originalTransaction.input.toLowerCase() &&
    (transaction.value ?? "0") === (originalTransaction.value ?? "0");
  return settled(
    { ...state, transaction, cancelled: !sameRequest },
    receipt,
    network,
  );
}
