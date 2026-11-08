import { hasUnfinishedTransactions } from "../state/labSession";
import {
  confirmedRegistryDeployments,
  rememberedRegistries,
  verifyRestoreTarget,
  relinkTarget,
} from "../lib/registrySelection";
import { TransactionError } from "./TransactionError";
import { useSessionActivity } from "../hooks/useSessionActivity";
import { useDeployment } from "../hooks/useDeployment";
/**
 * Registries this wallet deployed earlier (on-chain provenance via the
 * factory's ProxyDeployed logs), with one-click re-linking so older
 * configurations can be brought back.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress, type Address } from "viem";
import { useDeployedRegistries } from "../hooks/useDeployedRegistries";
import { useNameStatus } from "../hooks/useNameStatus";
import { useTxSequence } from "../hooks/useTxSequence";
import { buildRelinkStep, type StepCtx, type StepDef } from "../lib/steps";
import { useLab } from "../state/LabContext";
import { useIsReady } from "./ChainGuard";
import { TxStepper } from "./TxStepper";
import { AddressLink, Badge } from "./ui";

type DeployedTarget = { address: Address; blockNumber?: bigint };

export function RegistryHistory({ onAdopt }: { onAdopt?: () => void }) {
  const network = useDeployment();
  const { address } = useAccount();
  const client = usePublicClient({ chainId: network.id });
  const ready = useIsReady();
  const { session, state, dispatch } = useLab();
  const deployment = session?.sequences.setup?.["deploy-registry"];
  const {
    registries: scannedRegistries,
    error,
    loading,
    refresh,
  } = useDeployedRegistries(
    address,
    deployment?.confirmed
      ? (deployment.txHash ?? deployment.blockNumber)
      : undefined,
  );
  const known = confirmedRegistryDeployments(
    Object.values(state.sessions),
    address ?? "",
    network.id,
  );
  const remembered = useMemo(
    () => (address ? rememberedRegistries(state, address, network.id) : []),
    [state, address, network.id],
  );
  useEffect(() => {
    if (!session || !address) return;
    const missing = scannedRegistries.filter(
      (reg) =>
        !remembered.some(
          (entry) =>
            entry.address.toLowerCase() === reg.address.toLowerCase() &&
            entry.blockNumber === reg.blockNumber,
        ),
    );
    if (missing.length)
      dispatch({
        type: "remember-registries",
        sessionKey: state.activeKey,
        registries: missing.map((reg) => ({
          address: reg.address,
          deployBlock: reg.blockNumber,
        })),
      });
  }, [
    scannedRegistries,
    state.activeKey,
    state.registryHistory,
    dispatch,
    session,
    address,
    network.id,
    remembered,
  ]);
  const registries = [
    ...new Map(
      [...remembered, ...scannedRegistries, ...known].map((reg) => [
        reg.address.toLowerCase(),
        reg,
      ]),
    ).values(),
  ].sort((a, b) => ((a.blockNumber ?? 0n) > (b.blockNumber ?? 0n) ? -1 : 1));
  const status = useNameStatus(session?.parentLabel, address);
  const sequence = useTxSequence("relink");
  const { senderBusy } = useSessionActivity();
  const [manualAddress, setManualAddress] = useState("");
  const [manualError, setManualError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const [activePlan, setActivePlan] = useState<StepDef[]>([]);

  if (!session || !address) return null;
  const blocked = senderBusy || hasUnfinishedTransactions(session);
  const saved = session.sequences.relink?.relink;
  const savedTarget = relinkTarget(saved, session.parentLabel, network);
  const visiblePlan = activePlan.length
    ? activePlan
    : savedTarget
      ? buildRelinkStep({
          chainId: network.id,
          parentLabel: session.parentLabel,
          registry: savedTarget,
        })
      : [];

  const relink = async (registry: DeployedTarget) => {
    if (
      blocked ||
      checkingRef.current ||
      !ready ||
      !status.canConfigure ||
      !client
    )
      return;
    checkingRef.current = true;
    setChecking(true);
    setManualError(undefined);
    try {
      await verifyRestoreTarget(
        client,
        registry.address,
        session.parentLabel,
        address,
        network,
      );
      sequence.reset();
      const plan = buildRelinkStep({
        chainId: network.id,
        parentLabel: session.parentLabel,
        registry: registry.address,
        registryDeployBlock: registry.blockNumber,
      });
      setActivePlan(plan);
      const ctx: StepCtx = {
        chainId: network.id,
        account: address,
        parentLabel: session.parentLabel,
        ownerInitBitmap: 0n,
        deployResolver: false,
      };
      const result = await sequence.run(plan, ctx);
      if (result) {
        dispatch({
          type: "adopt-registry",
          sessionKey: state.activeKey,
          registry: registry.address,
          deployBlock: registry.blockNumber,
        });
        status.refetch();
        onAdopt?.();
      }
    } catch (error) {
      setManualError(
        error instanceof Error
          ? error.message
          : "Could not verify this registry.",
      );
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };

  const restoreAddress = async () => {
    const target = manualAddress.trim();
    if (!isAddress(target, { strict: false })) {
      setManualError("Enter a valid registry address.");
      return;
    }
    await relink({
      address: target,
      blockNumber: registries.find(
        (reg) => reg.address.toLowerCase() === target.toLowerCase(),
      )?.blockNumber,
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ens-border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">Saved and deployed registries</h4>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            refresh();
            status.refetch();
          }}
          className="text-sm text-ens-blue"
        >
          {loading ? "Refreshing…" : "Refresh registries"}
        </button>
      </div>
      <p className="text-sm">
        Currently linked:{" "}
        {status.subregistry ? (
          <AddressLink address={status.subregistry} />
        ) : (
          "Not available"
        )}
      </p>
      <p className="text-xs opacity-60">
        Includes factory deployments and registries saved by this app.
        Re-linking swaps which registry your name points at; subnames always
        stay inside their registry.
      </p>
      {error && (
        <TransactionError
          error={error}
          summary="Could not refresh deployment history. Saved confirmed deployments are shown; other registries may be missing."
        />
      )}
      {!loading && !error && registries.length === 0 && (
        <p className="text-sm text-ens-muted">
          No registry deployments found for this wallet.
        </p>
      )}
      {blocked && (
        <p role="status" className="text-sm text-amber-800">
          Finish or cancel the outstanding wallet request, or recover the
          pending transaction, before re-linking.
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {registries.map((reg) => {
          const isLinked =
            status.subregistry?.toLowerCase() === reg.address.toLowerCase();
          return (
            <li
              key={reg.address}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-2">
                <AddressLink address={reg.address} />
                <span className="text-xs opacity-50">
                  {reg.blockNumber === undefined
                    ? "deployment block unknown"
                    : `block ${reg.blockNumber}`}
                </span>
                {isLinked && <Badge tone="green">currently linked</Badge>}
              </span>
              {isLinked && (
                <button
                  type="button"
                  disabled={blocked || checking || !ready}
                  onClick={() => {
                    dispatch({
                      type: "adopt-registry",
                      sessionKey: state.activeKey,
                      registry: reg.address,
                      deployBlock: reg.blockNumber,
                    });
                    onAdopt?.();
                  }}
                  className="rounded-lg border border-neutral-400 px-3 py-1 text-xs disabled:opacity-40"
                >
                  Open playground
                </button>
              )}
              {!isLinked && (
                <button
                  type="button"
                  disabled={
                    blocked ||
                    checking ||
                    !ready ||
                    !status.canConfigure ||
                    sequence.status === "running"
                  }
                  onClick={() => relink(reg)}
                  className="rounded-lg border border-neutral-400 px-3 py-1 text-xs hover:border-neutral-700 disabled:opacity-40"
                >
                  Re-link
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">
          Restore a registry by address
        </summary>
        <p className="mt-2 text-xs text-ens-muted">
          Use this if an older registry is missing from the list. Re-linking
          requires wallet confirmation.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Registry address to restore"
            value={manualAddress}
            onChange={(event) => setManualAddress(event.target.value)}
            placeholder="0x…"
            className="min-w-0 flex-1 rounded border p-2 font-mono"
          />
          <button
            type="button"
            disabled={blocked || !ready || !status.canConfigure || checking}
            onClick={() => void restoreAddress()}
            className="rounded border px-3 py-2 disabled:opacity-40"
          >
            {checking ? "Checking…" : "Re-link by address"}
          </button>
        </div>
      </details>
      {manualError && <TransactionError error={manualError} />}
      {visiblePlan.length > 0 && (
        <TxStepper
          plan={visiblePlan}
          steps={sequence.steps}
          error={sequence.error}
          running={sequence.status === "running"}
        />
      )}
    </div>
  );
}
