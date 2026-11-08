import { savedSetupAddresses } from "../state/labSession";
import { getDeployment } from "../config/deployments";
import { useSetupPrediction } from "../hooks/useSetupPrediction";
import { inspectStep, willSendNewRequest } from "../lib/inspect";
/**
 * Step 5: plain-language summary of the planned transactions plus a
 * read-only diagram of the TARGET state, then the execute stepper.
 */

import { useMemo } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { ConfigDiagram } from "../diagram";
import { toDiagram, buildConfigurationExample } from "../lib/diagramModel";
import { getPreset } from "../lib/presets";
import { buildSetupSteps, type StepCtx } from "../lib/steps";
import { useTxSequence } from "../hooks/useTxSequence";
import { useNameStatus } from "../hooks/useNameStatus";
import { useLab } from "../state/LabContext";
import { TxStepper } from "./TxStepper";
import { useIsReady } from "./ChainGuard";

export function ReviewPanel({
  onComplete,
  onOpenPlayground,
}: {
  onComplete: () => void;
  onOpenPlayground?: () => void;
}) {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const ready = useIsReady();
  const { session } = useLab();
  const sequence = useTxSequence("setup");
  const network = getDeployment(session?.chainId);
  const nameStatus = useNameStatus(session?.parentLabel, address);

  const preset = session?.presetId ? getPreset(session.presetId) : undefined;

  const plan = useMemo(
    () => (preset ? buildSetupSteps(preset, network.id) : []),
    [preset, network.id],
  );

  const ctx: StepCtx | undefined = useMemo(() => {
    if (!session || !address || !preset) return undefined;
    return {
      chainId: session.chainId,
      setupNonce: session.setupNonce,
      account: session.wallet as `0x${string}`,
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
      userRegistry: savedSetupAddresses(session).userRegistry,
      resolver: savedSetupAddresses(session).resolver,
      registrar: savedSetupAddresses(session).registrar,
    };
  }, [session, address, preset]);

  const prediction = useSetupPrediction(ctx, sequence.steps);
  const reviewCtx = ctx
    ? {
        ...ctx,
        userRegistry: ctx.userRegistry ?? prediction.data?.userRegistry,
        resolver:
          ctx.resolver ??
          (ctx.deployResolver ? prediction.data?.resolver : undefined),
      }
    : undefined;

  const resolverMode = session?.deployResolver
    ? "new"
    : session?.addresses.resolver
      ? "existing"
      : "none";
  const parentLabel = session?.parentLabel;
  const targetDiagram = useMemo(
    () =>
      parentLabel && preset
        ? toDiagram(
            buildConfigurationExample(
              `${parentLabel}.eth`,
              preset,
              resolverMode,
            ),
          )
        : undefined,
    [parentLabel, preset, resolverMode],
  );

  if (!session || !preset || !ctx) return null;

  const visiblePlan = plan.filter((s) => !s.skipIf?.(ctx));
  const running = sequence.status === "running";
  const done =
    sequence.status === "done" ||
    visiblePlan.every((s) => {
      const st = sequence.steps[s.id]?.status;
      return st === "done" || st === "skipped";
    });

  const canStart =
    ready &&
    Boolean(walletClient) &&
    chainId === session.chainId &&
    address?.toLowerCase() === session.wallet.toLowerCase() &&
    Boolean(session.setupNonce) &&
    !running &&
    !prediction.isFetching;
  const start = async () => {
    if (!canStart || !reviewCtx) return;
    const reviewedRequests: NonNullable<StepCtx["reviewedRequests"]> = {};
    for (const step of visiblePlan) {
      const inspection = inspectStep(step, reviewCtx, sequence.steps[step.id]);
      if (willSendNewRequest(sequence.steps[step.id]) && inspection.data)
        reviewedRequests[step.id] = inspection.data;
    }
    const result = await sequence.run(plan, {
      ...ctx,
      expectedAddresses: prediction.data,
      reviewedRequests,
    });
    if (result) {
      nameStatus.refetch();
      onComplete();
    }
  };

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4">
      <p className="text-sm">
        <strong>{preset.name}</strong> for{" "}
        <strong>{session.parentLabel}.eth</strong>: the app will send{" "}
        {visiblePlan.length} planned transaction
        {visiblePlan.length === 1 ? "" : "s"} on {network.chain.name}. Review
        their details below, then start the sequence. Your wallet asks for
        confirmation before each transaction; actions already complete on-chain
        are skipped.
      </p>

      {targetDiagram && (
        <figure className="min-w-0">
          <figcaption className="mb-2 text-xs text-neutral-600">
            <strong>Configuration example.</strong> Alice and Bob illustrate
            what you can create after setup. These transactions do not register
            these example subnames.
            {resolverMode === "none" &&
              " No resolver selected; this example shows registry tokens only."}
            {preset.lockPlan &&
              " The optional lock actions happen later; this example does not indicate a locked registry."}
          </figcaption>
          <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200">
            <ConfigDiagram
              nodes={targetDiagram.nodes}
              edges={targetDiagram.edges}
              affinities={targetDiagram.affinities}
            />
          </div>
        </figure>
      )}

      <TxStepper
        plan={visiblePlan}
        steps={sequence.steps}
        ctx={reviewCtx}
        error={sequence.error}
        running={running}
        onRetry={start}
        retryDisabled={!canStart}
      />
      {prediction.isFetching && (
        <p className="text-xs opacity-70">
          Preparing deterministic deployment addresses…
        </p>
      )}
      {prediction.isError && (
        <p className="text-xs text-amber-800">
          Factory address prediction is unavailable. Dependent calldata will
          appear after each deployment confirms.
        </p>
      )}
      {!session.setupNonce && (
        <p className="text-sm text-amber-800">
          Click Continue to review above to prepare a stable transaction plan.
        </p>
      )}
      {!done &&
        !Object.values(sequence.steps).some(
          (step) => step.status === "failed",
        ) && (
          <button
            type="button"
            disabled={!canStart}
            onClick={start}
            className="self-start rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {running ? "Executing setup…" : "Start setup transactions"}
          </button>
        )}
      <p className="text-xs opacity-60">
        Starting continues through up to {visiblePlan.length} wallet
        confirmations, one at a time. Inspect details at any point; rejecting a
        request stops the sequence.
      </p>

      {done && (
        <p className="text-sm font-medium text-emerald-800">
          Setup complete.{" "}
          {onOpenPlayground && (
            <button
              type="button"
              onClick={onOpenPlayground}
              className="underline underline-offset-2"
            >
              Open playground →
            </button>
          )}
        </p>
      )}
    </div>
  );
}
