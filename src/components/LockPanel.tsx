import { useLockStatus } from "../hooks/useLockStatus";
import { useDeployment } from "../hooks/useDeployment";
/**
 * Advanced: irreversible lock steps for the "unruggable" setup.
 * Each step requires typing the parent name to confirm, and proves the
 * revocation afterwards with a hasRoles read-back shown in the stepper.
 */

import { useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import type { Abi } from "viem";
import { registryAbi } from "../config/abis";

import { classifyError } from "../lib/errors";
import { labelhashId } from "../lib/names";
import {
  buildLockParentLinkStep,
  buildRevokeRegistryRolesStep,
  type StepCtx,
  type StepDef,
} from "../lib/steps";
import { useTxSequence } from "../hooks/useTxSequence";
import { useLab } from "../state/LabContext";
import { useIsReady } from "./ChainGuard";
import { TxStepper } from "./TxStepper";
import { WarningBox, Badge } from "./ui";

export function LockPanel() {
  const network = useDeployment();
  const deployments = network.addresses;
  const { address } = useAccount();
  const ready = useIsReady();
  const client = usePublicClient();
  const { session } = useLab();
  const sequence = useTxSequence("lock");
  const [confirmText, setConfirmText] = useState("");
  const [activePlan, setActivePlan] = useState<StepDef[]>([]);
  const [error, setError] = useState<string>();

  const {
    registryLocked,
    linkLocked,
    supported,
    loading: lockLoading,
    refetch: refetchLock,
  } = useLockStatus(session?.addresses.userRegistry, session?.parentLabel);

  if (!session || !address || !session.addresses.userRegistry) return null;
  const registry = session.addresses.userRegistry;
  const parentName = `${session.parentLabel}.eth`;
  const confirmed = confirmText.trim().toLowerCase() === parentName;

  const runLock = async (plan: StepDef[]) => {
    setError(undefined);
    sequence.reset();
    setActivePlan(plan);
    const ctx: StepCtx = {
      chainId: network.id,
      account: address,
      parentLabel: session.parentLabel,
      ownerInitBitmap: 0n,
      deployResolver: false,
      userRegistry: registry,
    };
    await sequence.run(plan, ctx);
    void refetchLock();
  };

  const lockRegistry = () =>
    runLock(
      buildRevokeRegistryRolesStep({
        chainId: network.id,
        userRegistry: registry,
        account: address,
      }),
    );

  const lockLink = async () => {
    if (!client) return;
    try {
      // The EAC resource embeds a version counter; read it fresh, never derive it.
      const resource = (await client.readContract({
        address: deployments.ETHRegistry,
        abi: registryAbi as Abi,
        functionName: "getResource",
        args: [labelhashId(session.parentLabel)],
      })) as bigint;
      await runLock(
        buildLockParentLinkStep({
          chainId: network.id,
          parentLabel: session.parentLabel,
          parentResource: resource,
          account: address,
        }),
      );
    } catch (err) {
      setError(classifyError(err).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        These actions remove permissions permanently for the current
        registration. Keep the parent .eth name renewed; expiry and
        re-registration can replace its subregistry.{" "}
        <strong>There is no undo</strong>.
      </p>

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">1. Give up dangerous registry roles</h4>
          {registryLocked && <Badge tone="green">done</Badge>}
        </div>
        <WarningBox>
          After every holder revokes the listed root permissions, root accounts
          cannot delete, renew, re-point, or upgrade anything in this registry,
          and the registry's parent pointer (recorded during setup) is frozen.
          New subnames can still be registered.
        </WarningBox>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">
            2. Lock your name's registry pointer (optional)
          </h4>
          {linkLocked && <Badge tone="green">done</Badge>}
        </div>
        <WarningBox>
          Irreversible: you give up the permission to change which registry{" "}
          {parentName} points at (its subregistry pointer in the .eth registry,
          not the registry's own parent metadata). This locks the current parent
          registration; it does not survive expiry and re-registration. Keep the
          parent name renewed to preserve the link.
        </WarningBox>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">
            Type <strong>{parentName}</strong> to unlock the buttons:
          </span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-64 rounded-lg border border-neutral-300 px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={
            !supported ||
            lockLoading ||
            !ready ||
            !confirmed ||
            registryLocked ||
            sequence.status === "running"
          }
          onClick={lockRegistry}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-40"
        >
          Lock registry roles
        </button>
        <button
          type="button"
          disabled={
            !ready || !confirmed || linkLocked || sequence.status === "running"
          }
          onClick={lockLink}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-40"
        >
          Lock registry pointer
        </button>
      </div>

      {!supported && !lockLoading && (
        <p className="text-sm text-amber-800">
          This registry does not support current lock verification. Registry
          locking is unavailable.
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {activePlan.length > 0 && (
        <TxStepper
          plan={activePlan}
          steps={sequence.steps}
          running={sequence.status === "running"}
        />
      )}
    </div>
  );
}
