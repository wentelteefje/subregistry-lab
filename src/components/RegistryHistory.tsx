import { useDeployment } from "../hooks/useDeployment";
/**
 * Registries this wallet deployed earlier (on-chain provenance via the
 * factory's ProxyDeployed logs), with one-click re-linking so older
 * configurations can be brought back.
 */

import { useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { useDeployedRegistries } from "../hooks/useDeployedRegistries";
import { useNameStatus } from "../hooks/useNameStatus";
import { useTxSequence } from "../hooks/useTxSequence";
import { buildRelinkStep, type StepCtx, type StepDef } from "../lib/steps";
import { useLab } from "../state/LabContext";
import { useIsReady } from "./ChainGuard";
import { TxStepper } from "./TxStepper";
import { AddressLink, Badge } from "./ui";

type DeployedTarget = { address: Address; blockNumber: bigint };

export function RegistryHistory() {
  const network = useDeployment();
  const { address } = useAccount();
  const ready = useIsReady();
  const { session, state, dispatch } = useLab();
  const { registries, error } = useDeployedRegistries(address);
  const status = useNameStatus(session?.parentLabel, address);
  const sequence = useTxSequence("relink");
  const [activePlan, setActivePlan] = useState<StepDef[]>([]);

  if (!session || !address || registries.length === 0) return null;

  const relink = async (registry: DeployedTarget) => {
    sequence.reset();
    const plan = buildRelinkStep({
      chainId: network.id,
      parentLabel: session.parentLabel,
      registry: registry.address,
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
      // Adopt the re-linked registry into the session so the playground
      // (subname scans need its deploy block) points at it.
      dispatch({
        type: "patch-addresses",
        sessionKey: state.activeKey,
        patch: { userRegistry: registry.address },
      });
      dispatch({
        type: "set-registry-deploy-block",
        sessionKey: state.activeKey,
        block: registry.blockNumber,
      });
      status.refetch();
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ens-border bg-white p-4">
      <h4 className="text-sm font-medium">Registries you deployed earlier</h4>
      <p className="text-xs opacity-60">
        Found on-chain via the factory's deployment logs for your wallet.
        Re-linking swaps which registry your name points at; subnames always
        stay inside their registry.
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
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
                  block {reg.blockNumber.toString()}
                </span>
                {isLinked && <Badge tone="green">currently linked</Badge>}
              </span>
              {!isLinked && (
                <button
                  type="button"
                  disabled={
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
      {activePlan.length > 0 && (
        <TxStepper
          plan={activePlan}
          steps={sequence.steps}
          error={sequence.error}
          running={sequence.status === "running"}
        />
      )}
    </div>
  );
}
