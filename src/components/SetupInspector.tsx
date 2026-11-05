import { hasUnfinishedSetup } from "../state/labSession";
import { useDeployment } from "../hooks/useDeployment";
/**
 * Step 3: show the selected name's current on-chain configuration and gate
 * the rest of the wizard on the wallet actually being able to configure it.
 * If a subregistry already exists: Adopt it (skip deploy) or Replace it.
 */

import { useAccount } from "wagmi";
import { useNameStatus } from "../hooks/useNameStatus";
import { explorerName, explorerRegistry } from "../lib/links";
import { useLab } from "../state/LabContext";
import { RegistryHistory } from "./RegistryHistory";
import {
  AddressLink,
  Badge,
  ExternalLink,
  NameChip,
  WarningBox,
  formatExpiry,
} from "./ui";

export function SetupInspector({
  onModeChosen,
}: {
  onModeChosen: (mode: "fresh" | "adopt" | "replace") => void;
}) {
  const network = useDeployment();
  const { address } = useAccount();
  const { session, dispatch } = useLab();
  const blocked = hasUnfinishedSetup(session);
  const status = useNameStatus(session?.parentLabel, address);

  if (!session || !address) return null;
  const name = `${session.parentLabel}.eth`;

  if (status.loading)
    return <p className="text-sm opacity-70">Reading on-chain state…</p>;

  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired = status.expiry !== undefined && status.expiry <= now;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="opacity-60">Name</dt>
        <dd>
          <NameChip name={name} href={explorerName(name, network.id)} />
        </dd>
        <dt className="opacity-60">Expiry</dt>
        <dd>
          {formatExpiry(status.expiry)}{" "}
          {expired ? (
            <Badge tone="red">expired</Badge>
          ) : (
            <Badge tone="green">active</Badge>
          )}
        </dd>
        <dt className="opacity-60">Owner</dt>
        <dd>
          {status.owner ? <AddressLink address={status.owner} /> : "—"}{" "}
          {status.isOwner && <Badge tone="green">you</Badge>}
        </dd>
        <dt className="opacity-60">Subregistry</dt>
        <dd>
          {status.hasSubregistry && status.subregistry ? (
            <AddressLink address={status.subregistry} />
          ) : (
            <span className="opacity-60">none yet</span>
          )}
        </dd>
      </dl>

      <ExternalLink href={explorerRegistry(name, network.id)}>
        inspect registry in ENS Explorer
      </ExternalLink>

      {expired && (
        <WarningBox>
          This name is expired (or in its grace period). Renew it first, setting
          up subnames for an expired parent won't work.
        </WarningBox>
      )}

      {!expired && !status.canConfigure && (
        <WarningBox>
          The connected wallet cannot configure this name (it lacks the "set
          subregistry" permission). Connect the owning account, or have the
          owner grant this wallet the role.
        </WarningBox>
      )}

      {!expired && status.canConfigure && !status.hasSubregistry && (
        <button
          type="button"
          onClick={() => onModeChosen("fresh")}
          className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
        >
          Set up a subname registry →
        </button>
      )}

      {!expired && status.canConfigure && status.hasSubregistry && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            This name already has a subregistry.
            {session.addresses.userRegistry?.toLowerCase() ===
              status.subregistry?.toLowerCase() &&
              " (This session deployed it.)"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (status.subregistry) {
                  dispatch({
                    type: "patch-addresses",
                    patch: { userRegistry: status.subregistry },
                  });
                }
                onModeChosen("adopt");
              }}
              className="rounded-lg border border-neutral-400 px-4 py-2 text-sm hover:border-neutral-700"
            >
              Keep it: register subnames
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                if (blocked) return;
                // A replace is a fresh run: drop the previous setup's step
                // states and deployed addresses, or the runner would replay
                // the old run's "done" steps without sending anything.
                dispatch({ type: "reset-setup" });
                onModeChosen("replace");
              }}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
            >
              Replace with a new setup →
            </button>
          </div>
          <p className="text-xs opacity-60">
            Replacing points your name at a brand-new registry. Subnames in the
            old registry stop resolving, but aren't deleted: re-linking the old
            registry address brings them back.
          </p>
        </div>
      )}

      {!expired && status.canConfigure && <RegistryHistory />}
    </div>
  );
}
