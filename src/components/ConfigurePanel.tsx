/**
 * Step 4: preset cards + options (resolver deploy toggle, registrar params,
 * custom subname-owner roles behind a disclosure).
 */

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { getPreset } from "../lib/presets";
import { useLab } from "../state/LabContext";
import { PresetPicker } from "./PresetPicker";
import { ResolverPicker } from "./ResolverPicker";
import { RoleMatrixEditor } from "./RoleMatrixEditor";

export function ConfigurePanel({ onDone }: { onDone: () => void }) {
  const { session, dispatch } = useLab();
  const [showRoles, setShowRoles] = useState(false);

  if (!session) return null;
  const preset = session.presetId ? getPreset(session.presetId) : undefined;

  const subnameBitmap = session.subnameRoleBitmap
    ? BigInt(session.subnameRoleBitmap)
    : preset?.subnameDefaults.roleBitmap;

  return (
    <div className="flex flex-col gap-5">
      <PresetPicker />

      {preset && (
        <>
          <ResolverPicker />

          {preset.registrar && session.registrarParams && (
            <fieldset className="flex flex-wrap items-end gap-4 rounded-lg border border-neutral-200 p-4">
              <legend className="px-1 text-sm font-medium">Registrar pricing</legend>
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Price per year (USDC)</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={formatUnits(BigInt(session.registrarParams.pricePerYear), 6)}
                  onChange={(e) => {
                    try {
                      dispatch({
                        type: "set-registrar-params",
                        params: {
                          pricePerYear: parseUnits(e.target.value || "0", 6),
                          minDuration: BigInt(session.registrarParams!.minDuration),
                          beneficiary: session.registrarParams!.beneficiary,
                        },
                      });
                    } catch {
                      // ignore unparsable input while typing
                    }
                  }}
                  className="w-40 rounded-lg border border-neutral-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Minimum duration (days)</span>
                <input
                  type="number"
                  min="1"
                  value={Number(BigInt(session.registrarParams.minDuration) / 86400n)}
                  onChange={(e) => {
                    const days = BigInt(Math.max(1, Number(e.target.value || 1)));
                    dispatch({
                      type: "set-registrar-params",
                      params: {
                        pricePerYear: BigInt(session.registrarParams!.pricePerYear),
                        minDuration: days * 86400n,
                        beneficiary: session.registrarParams!.beneficiary,
                      },
                    });
                  }}
                  className="w-40 rounded-lg border border-neutral-300 px-3 py-2"
                />
              </label>
              <p className="w-full text-xs opacity-60">
                Fees go to your wallet. Anyone can pay with the free USDC from the
                faucet below.
              </p>
            </fieldset>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowRoles((v) => !v)}
              className="text-sm underline decoration-dotted underline-offset-2"
            >
              {showRoles ? "Hide" : "Customize"} subname owner permissions
            </button>
            {showRoles && subnameBitmap !== undefined && (
              <div className="mt-3 rounded-lg border border-neutral-200 p-4">
                <p className="mb-2 text-xs opacity-60">
                  {preset.id === "unruggable"
                    ? "This preset defaults to a minimal, records-only set so locked subnames can't be restructured."
                    : "The default matches REGISTRATION_ROLE_BITMAP, the standard set the ETH Registrar grants on .eth registrations."}
                </p>
                <RoleMatrixEditor
                  bitmap={subnameBitmap}
                  onChange={(next) => dispatch({ type: "set-subname-bitmap", bitmap: next })}
                />
                <button
                  type="button"
                  className="mt-2 text-xs underline decoration-dotted"
                  onClick={() => dispatch({ type: "set-subname-bitmap", bitmap: undefined })}
                >
                  Reset to preset default
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onDone}
            className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
          >
            Continue to review →
          </button>
        </>
      )}
    </div>
  );
}
