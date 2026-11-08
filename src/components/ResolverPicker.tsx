import { useResolverAccess } from "../hooks/useResolverAccess";
/**
 * Resolver selection for the setup. ENSv2 convention: one PermissionedResolver
 * per ACCOUNT serving all its names, so reuse comes first:
 *  1. the resolver the parent name currently uses (strongest signal),
 *  2. resolvers this wallet deployed earlier (factory logs),
 *  3. deploy a fresh one only as fallback.
 */

import { useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";
import { zeroAddress, type Address } from "viem";
import { useDeployedResolvers } from "../hooks/useDeployedRegistries";
import { useNameStatus } from "../hooks/useNameStatus";
import { useLab } from "../state/LabContext";
import { AddressLink } from "./ui";

type Choice =
  | { kind: "existing"; address: Address; note: string }
  | { kind: "deploy" }
  | { kind: "none" };

export function ResolverPicker() {
  const { address } = useAccount();
  const { session, dispatch } = useLab();
  const nameStatus = useNameStatus(session?.parentLabel, address);
  const { resolvers } = useDeployedResolvers(address);
  const canReuseParent = useResolverAccess(nameStatus.resolver, address);

  const choices = useMemo<Choice[]>(() => {
    const out: Choice[] = [];
    const seen = new Set<string>();
    const parentResolver = nameStatus.resolver;
    if (canReuseParent && parentResolver && parentResolver !== zeroAddress) {
      out.push({
        kind: "existing",
        address: parentResolver,
        note: `current resolver of ${session?.parentLabel}.eth`,
      });
      seen.add(parentResolver.toLowerCase());
    }
    for (const r of resolvers) {
      if (!seen.has(r.address.toLowerCase())) {
        out.push({ kind: "existing", address: r.address, note: "deployed by you earlier" });
        seen.add(r.address.toLowerCase());
      }
    }
    out.push({ kind: "deploy" });
    out.push({ kind: "none" });
    return out;
  }, [nameStatus.resolver, resolvers, session?.parentLabel, canReuseParent]);

  // Default to reuse: if the parent name already has a resolver and the user
  // hasn't touched the choice (fresh session, setup not run), select it.
  const autoApplied = useRef(false);
  useEffect(() => {
    if (autoApplied.current || !session) return;
    const untouched =
      session.deployResolver &&
      !session.addresses.resolver &&
      !session.sequences["setup"];
    const parentResolver = nameStatus.resolver;
    if (untouched && canReuseParent && parentResolver && parentResolver !== zeroAddress) {
      autoApplied.current = true;
      dispatch({ type: "set-deploy-resolver", value: false });
      dispatch({ type: "patch-addresses", patch: { resolver: parentResolver } });
    }
  }, [session, nameStatus.resolver, dispatch, canReuseParent]);

  if (!session) return null;

  // What is currently selected in the session?
  const selectedKind: string = session.deployResolver
    ? "deploy"
    : session.addresses.resolver
      ? `existing:${session.addresses.resolver.toLowerCase()}`
      : "none";

  const choose = (choice: Choice) => {
    if (choice.kind === "existing") {
      dispatch({ type: "set-deploy-resolver", value: false });
      dispatch({ type: "patch-addresses", patch: { resolver: choice.address } });
    } else if (choice.kind === "deploy") {
      dispatch({ type: "set-deploy-resolver", value: true });
      dispatch({ type: "patch-addresses", patch: { resolver: undefined } });
    } else {
      dispatch({ type: "set-deploy-resolver", value: false });
      dispatch({ type: "patch-addresses", patch: { resolver: undefined } });
    }
  };

  const hasExisting = choices.some((c) => c.kind === "existing");

  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
      <legend className="px-1 text-sm font-medium">Resolver for your subnames</legend>
      <p className="text-xs opacity-60">
        Reuse a compatible resolver you administer, or deploy a fresh one. Its setter permissions apply across all names it serves; subname owners can deploy their own resolver for independent control.
      </p>
      {choices.map((choice) => {
        const key =
          choice.kind === "existing"
            ? `existing:${choice.address.toLowerCase()}`
            : choice.kind;
        return (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="resolver-choice"
              checked={selectedKind === key}
              onChange={() => choose(choice)}
            />
            {choice.kind === "existing" && (
              <span className="flex items-center gap-2">
                Use <AddressLink address={choice.address} />
                <span className="text-xs opacity-60">({choice.note})</span>
              </span>
            )}
            {choice.kind === "deploy" && (
              <span>
                Deploy a fresh resolver
                {hasExisting && (
                  <span className="text-xs opacity-60"> (only if you want a separate one)</span>
                )}
              </span>
            )}
            {choice.kind === "none" && (
              <span>
                No resolver <span className="text-xs opacity-60">(subnames won't hold records)</span>
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
