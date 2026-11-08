import { useSessionActivity } from "../hooks/useSessionActivity";
import { hasUnfinishedSetup } from "../state/labSession";
/** Step 4: choose a configuration preset (or open the custom role editor). */

import { PRESETS, type PresetId } from "../lib/presets";
import { useLab } from "../state/LabContext";

export function PresetPicker({ disabled }: { disabled?: boolean }) {
  const { session, dispatch } = useLab();

  const { senderBusy } = useSessionActivity();
  const blocked = hasUnfinishedSetup(session) || senderBusy;
  const choose = (presetId: PresetId) => {
    if (blocked) return;
    // Switching preset invalidates a previous run's steps/addresses; the
    // idempotence guard re-skips anything genuinely already on-chain.
    if (session?.presetId && session.presetId !== presetId) {
      dispatch({ type: "reset-setup" });
    }
    dispatch({ type: "set-preset", presetId });
    const preset = PRESETS.find((p) => p.id === presetId)!;
    dispatch({
      type: "set-registrar-params",
      params: preset.registrar
        ? {
            pricePerYear: preset.registrar.pricePerYear,
            minDuration: preset.registrar.minDuration,
            beneficiary: (session?.wallet ?? "0x") as `0x${string}`,
          }
        : undefined,
    });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PRESETS.map((preset) => {
        const selected = session?.presetId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            disabled={disabled || blocked}
            onClick={() => choose(preset.id)}
            className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition hover:border-neutral-600 disabled:opacity-40 ${
              selected
                ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900"
                : "border-neutral-300"
            }`}
          >
            <span className="font-medium">{preset.name}</span>
            <span className="text-xs font-medium uppercase tracking-wide opacity-50">
              {preset.tagline}
            </span>
            <span className="mt-1 text-xs opacity-70">
              {preset.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
