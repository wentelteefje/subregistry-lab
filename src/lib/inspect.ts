import {
  decodeAbiParameters,
  decodeFunctionData,
  getAbiItem,
  keccak256,
  toFunctionSignature,
  toHex,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import { getDeployment } from "../config/deployments";
import { resolverInitAbi, userRegistryInitAbi } from "../config/abis";
import type { StepState } from "../state/labSession";
import { prepareTransaction } from "./sequence";
import type { StepCtx, StepDef } from "./steps";
import { ALL_ROLES, decomposeBitmap } from "./roles";

export const dependencyLabels = {
  userRegistry:
    "Registry address — available after “Deploy your subname registry”",
  resolver: "Resolver address — available after “Deploy a resolver”",
  registrar:
    "Registrar address — available after “Deploy the subname registrar”",
};

function namedValue(param: AbiParameter, value: unknown): unknown {
  if (value === undefined) return "Not resolved yet";
  if (param.type.endsWith("[]") && Array.isArray(value))
    return value.map((item) =>
      namedValue(
        { ...param, type: param.type.slice(0, -2) } as AbiParameter,
        item,
      ),
    );
  if (param.type === "tuple" && "components" in param) {
    return Object.fromEntries(
      param.components.map((component, i) => [
        component.name || String(i),
        namedValue(
          component,
          Array.isArray(value)
            ? value[i]
            : (value as Record<string, unknown>)[component.name ?? ""],
        ),
      ]),
    );
  }
  if (typeof value === "bigint") {
    if (/bitmap/i.test(param.name ?? ""))
      return {
        decimal: value.toString(),
        hex: toHex(value),
        ...(value === ALL_ROLES
          ? { meaning: "ALL_ROLES (all user and admin roles)" }
          : {}),
      };
    return value.toString();
  }
  return value;
}

export function namedArguments(
  inputs: readonly AbiParameter[],
  args: readonly unknown[],
) {
  return Object.fromEntries(
    inputs.map((input, i) => [
      `${input.name || `arg${i}`} (${input.type})`,
      namedValue(input, args[i]),
    ]),
  );
}

export type Inspection = {
  source: "draft" | "recorded" | "unrecorded";
  chainId: number;
  from: Address;
  to?: Address | null;
  value: string;
  nonce?: number;
  kind: "call" | "create";
  signature?: string;
  args?: ReturnType<typeof namedArguments>;
  initializer?: {
    contract: string;
    signature: string;
    args: ReturnType<typeof namedArguments>;
  };
  roles?: string[];
  missing: string[];
  data?: Hex;
  dataHash?: Hex;
  request?: {
    chainId: Hex;
    from: Address;
    to?: Address;
    value: Hex;
    data: Hex;
    nonce?: Hex;
  };
  error?: string;
  previousAttempt?: {
    reason: string;
    hash?: Hex;
    transaction?: StepState["transaction"];
  };
};

/** A mined failure or an unsigned failure is a new request on Resume. */
export function willSendNewRequest(state?: StepState): boolean {
  return (
    !state ||
    Boolean(state.reverted || state.cancelled) ||
    (!state.txHash && !state.confirmed && state.status !== "wallet")
  );
}

/** No RPCs, nonce selection or wallet access. Uses execution's exact encoder. */
export function inspectStep(
  step: StepDef,
  ctx: StepCtx,
  state?: StepState,
): Inspection {
  const network = getDeployment(ctx.chainId);
  const nextRequest = willSendNewRequest(state);
  const recorded = nextRequest ? undefined : state?.transaction;
  const result: Inspection = {
    source: recorded
      ? "recorded"
      : !nextRequest && state?.txHash
        ? "unrecorded"
        : "draft",
    chainId: network.id,
    from: recorded?.from ?? ctx.account,
    value: recorded?.value ?? "0",
    nonce: recorded?.nonce,
    kind: recorded?.to === null ? "create" : "call",
    missing: [],
  };
  if (nextRequest && state && (state.transaction || state.txHash))
    result.previousAttempt = {
      reason: state.cancelled
        ? "Cancelled or replaced"
        : state.reverted
          ? "Reverted"
          : "Interrupted or rejected wallet request (no hash recorded)",
      hash: state.txHash,
      transaction: state.transaction,
    };
  // Legacy hashes must never be described using a newly constructed draft.
  if (result.source === "unrecorded") return result;
  if (
    !recorded &&
    step.capture &&
    ["userRegistry", "resolver"].includes(step.capture) &&
    !ctx.setupNonce
  ) {
    result.missing.push(
      "Stable deployment salt — click Continue to review to prepare this setup",
    );
    return result;
  }
  try {
    const action = step.build(ctx);
    result.kind = recorded
      ? recorded.to === null
        ? "create"
        : "call"
      : action.type === "deploy"
        ? "create"
        : "call";
    result.to = recorded
      ? recorded.to
      : action.type === "write"
        ? action.address
        : null;
    result.missing = recorded
      ? []
      : (step.needs ?? [])
          .filter((key) => !ctx[key])
          .map((key) => dependencyLabels[key]);
    result.data =
      recorded?.input ??
      (result.missing.length
        ? undefined
        : prepareTransaction(action, ctx.account, 0).input);
    if (action.type === "write" && result.kind === "call") {
      const decoded = recorded
        ? decodeFunctionData({ abi: action.abi, data: recorded.input })
        : undefined;
      const item = getAbiItem({
        abi: action.abi,
        name: decoded?.functionName ?? action.functionName,
      });
      if (item?.type === "function") {
        const args = decoded?.args ?? action.args;
        result.signature = toFunctionSignature(item);
        result.args = namedArguments(item.inputs, args);
        if (item.name === "deployProxy") {
          const implementation = String(args[0]).toLowerCase();
          const isRegistry =
            implementation === network.addresses.UserRegistryImpl.toLowerCase();
          const isResolver =
            implementation ===
            network.addresses.PermissionedResolverImpl.toLowerCase();
          if (isRegistry || isResolver) {
            const abi = isRegistry ? userRegistryInitAbi : resolverInitAbi;
            const init = decodeFunctionData({ abi, data: args[2] as Hex });
            result.initializer = {
              contract: isRegistry ? "UserRegistry" : "PermissionedResolver",
              signature: toFunctionSignature(abi[0]),
              args: namedArguments(abi[0].inputs, init.args),
            };
            if (isRegistry) {
              const grants = init.args[0] as readonly {
                account: Address;
                roleBitmap: bigint;
              }[];
              result.roles = grants.map(
                (grant) =>
                  `${grant.account}: ${
                    grant.roleBitmap === ALL_ROLES
                      ? "ALL_ROLES (every registry user and admin role)"
                      : decomposeBitmap(grant.roleBitmap)
                          .map((role) => role.short)
                          .join(", ") || "none"
                  }`,
              );
            }
          }
        }
      }
    } else if (action.type === "deploy" && result.kind === "create") {
      const constructor = action.abi.find(
        (item) => item.type === "constructor",
      );
      if (constructor?.type === "constructor") {
        result.signature = `constructor(${constructor.inputs.map((input) => input.type).join(",")})`;
        const args = recorded
          ? decodeAbiParameters(
              constructor.inputs,
              `0x${recorded.input.slice(action.bytecode.length)}`,
            )
          : action.args;
        result.args = namedArguments(constructor.inputs, args);
      }
    }
  } catch (error) {
    result.error =
      error instanceof Error ? error.message : "Could not decode request";
    // Raw recorded data remains authoritative even when ABI decoding fails.
    if (recorded) {
      result.to = recorded.to;
      result.data = recorded.input;
    }
  }
  if (result.data) {
    result.dataHash = keccak256(result.data);
    result.request = {
      chainId: toHex(result.chainId),
      from: result.from,
      ...(result.to ? { to: result.to } : {}),
      value: toHex(BigInt(result.value)),
      data: result.data,
      ...(result.nonce === undefined ? {} : { nonce: toHex(result.nonce) }),
    };
  }
  return result;
}
