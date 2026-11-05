import { useDeployment } from "../hooks/useDeployment";
/**
 * Step 5: plain-language summary of the planned transactions plus a
 * read-only diagram of the TARGET state, then the execute stepper.
 */

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ConfigDiagram } from "../diagram";
import { toDiagram } from "../lib/diagramModel";
import { getPreset } from "../lib/presets";
import { buildSetupSteps, type StepCtx } from "../lib/steps";
import { useTxSequence } from "../hooks/useTxSequence";
import { useNameStatus } from "../hooks/useNameStatus";
import { useLab } from "../state/LabContext";
import { TxStepper } from "./TxStepper";
import { useIsReady } from "./ChainGuard";

export function ReviewPanel({ onComplete }: { onComplete: () => void }) {
  const network = useDeployment();
  const { address } = useAccount();
  const ready = useIsReady();
  const { session } = useLab();
  const sequence = useTxSequence("setup");
  const [started, setStarted] = useState(false);
  const nameStatus = useNameStatus(session?.parentLabel, address);

  const preset = session?.presetId ? getPreset(session.presetId) : undefined;

  const plan = useMemo(
    () => (preset ? buildSetupSteps(preset, network.id) : []),
    [preset, network.id],
  );

  const ctx: StepCtx | undefined = useMemo(() => {
    if (!session || !address || !preset) return undefined;
    return {
      chainId: network.id,
      account: address,
      parentLabel: session.parentLabel,
      ownerInitBitmap: preset.ownerInitBitmap,
      deployResolver: session.deployResolver,
      registrarParams:
        preset.registrar && session.registrarParams
          ? {
              pricePerYear: BigInt(session.registrarParams.pricePerYear),
              minDuration: BigInt(session.registrarParams.minDuration),
              beneficiary: session.registrarParams.beneficiary,
              grantBitmap: preset.registrar.grantBitmap,
            }
          : undefined,
      // Resume support: already-deployed addresses flow back into the ctx.
      userRegistry: session.addresses.userRegistry,
      resolver: session.addresses.resolver,
      registrar: session.addresses.registrar,
    };
  }, [session, address, preset, network.id]);

  const targetDiagram = useMemo(() => {
    if (!session || !preset) return undefined;
    return toDiagram({
      parentName: `${session.parentLabel}.eth`,
      parentOwner: address,
      userRegistry: session.addresses.userRegistry ?? "new",
      registrar: preset.registrar
        ? (session.addresses.registrar ?? "new")
        : undefined,
      registrarRoles: preset.registrar?.grantBitmap,
      resolver: session.deployResolver
        ? (session.addresses.resolver ?? "new")
        : session.addresses.resolver, // reused per-account resolver (or none)
    });
  }, [session, preset, address]);

  if (!session || !preset || !ctx) return null;

  const visiblePlan = plan.filter((s) => !s.skipIf?.(ctx));
  const running = sequence.status === "running";
  const done =
    sequence.status === "done" ||
    visiblePlan.every((s) => {
      const st = sequence.steps[s.id]?.status;
      return st === "done" || st === "skipped";
    });

  const start = async () => {
    setStarted(true);
    const result = await sequence.run(plan, ctx);
    if (result) {
      nameStatus.refetch();
      onComplete();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <strong>{preset.name}</strong> for{" "}
        <strong>{session.parentLabel}.eth</strong>: the app will send{" "}
        {visiblePlan.length} transaction{visiblePlan.length === 1 ? "" : "s"}.
        Your wallet asks for confirmation before each one.
      </p>

      {targetDiagram && (
        <div className="h-72 overflow-hidden rounded-lg border border-neutral-200">
          <ConfigDiagram
            nodes={targetDiagram.nodes}
            edges={targetDiagram.edges}
            affinities={targetDiagram.affinities}
          />
        </div>
      )}

      {!started && !done && (
        <button
          type="button"
          disabled={!ready}
          onClick={start}
          className="self-start rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          Looks good, start
        </button>
      )}

      {(started || done) && (
        <TxStepper
          plan={visiblePlan}
          steps={sequence.steps}
          error={sequence.error}
          running={running}
          onRetry={start}
        />
      )}

      {done && (
        <p className="text-sm font-medium text-emerald-800">
          Setup complete. Scroll down to register subnames.
        </p>
      )}
    </div>
  );
}
