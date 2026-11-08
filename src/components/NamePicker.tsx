import { useDeployment } from "../hooks/useDeployment";
/**
 * Step 2: pick one of your .eth names (scanned from chain logs) or enter a
 * label manually (covers names owned by a Safe/smart account that granted
 * roles to this wallet).
 */

import { useState } from "react";
import { useAccount } from "wagmi";
import { useOwnedNames } from "../hooks/useOwnedNames";
import { normalizeLabel } from "../lib/names";
import { explorerName } from "../lib/links";
import { useLab } from "../state/LabContext";
import { AvatarSquare, Badge, ExternalLink, formatExpiry } from "./ui";

export function NamePicker() {
  const network = useDeployment();
  const { address } = useAccount();
  const { names, loading, progress, error, refresh } = useOwnedNames(address);
  const { session, dispatch } = useLab();
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string>();

  if (!address) return null;

  const select = (label: string) => {
    dispatch({ type: "select-name", wallet: address, parentLabel: label, chainId: network.id });
  };

  const submitManual = () => {
    const { label, error: err } = normalizeLabel(manual.replace(/\.eth$/i, ""));
    if (err || !label) {
      setManualError(err);
      return;
    }
    setManualError(undefined);
    select(label);
  };

  return (
    <div className="flex flex-col gap-4">
      {loading && (
        <div>
          <p className="text-sm opacity-70">Scanning {network.chain.name} for your names…</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-neutral-200">
            <div
              className="h-full bg-neutral-800 transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}

      {names.length > 0 && (
        <ul className="flex flex-col gap-2">
          {names.map((n) => {
            const selected = session?.parentLabel === n.label;
            return (
              <li key={n.label}>
                <button
                  type="button"
                  onClick={() => select(n.label)}
                  className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left hover:border-neutral-500 ${
                    selected ? "border-neutral-900 bg-neutral-50" : "border-neutral-300"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <AvatarSquare size={20} />
                    {n.name}
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    {n.status === "active" && <Badge tone="green">expires {formatExpiry(n.expiry)}</Badge>}
                    {n.status === "grace" && <Badge tone="amber">in grace period</Badge>}
                    {n.status === "expired" && <Badge tone="red">expired</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && names.length === 0 && !error && (
        <p className="text-sm opacity-70">
          No .eth names found for this wallet on {network.chain.name}. Register one with the{" "}
          <ExternalLink href={network.id === 1 ? "https://explorer.ens.domains" : "https://sepolia.explorer.ens.domains"}>ENS Explorer</ExternalLink> or enter a
          label below if your name is owned by a different account that granted you access.
        </p>
      )}

      <div className="flex items-end gap-2">
        <label className="flex grow flex-col gap-1 text-sm">
          <span className="opacity-70">My name isn't listed:</span>
          <input
            type="text"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="mycoolnewname"
            className="rounded-lg border border-neutral-300 px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={submitManual}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
        >
          Use this name
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:border-neutral-500 disabled:opacity-40"
          title="Re-scan the chain"
        >
          ↻
        </button>
      </div>
      {manualError && <p className="text-sm text-red-700">{manualError}</p>}

      {session && (
        <p className="flex items-center gap-2 text-sm">
          <span>Working on</span>
          <AvatarSquare size={16} />
          <strong>{session.parentLabel}.eth</strong>
          <ExternalLink href={explorerName(`${session.parentLabel}.eth`, network.id)}>
            view in ENS Explorer
          </ExternalLink>
        </p>
      )}
    </div>
  );
}
