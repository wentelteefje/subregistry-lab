import type { SessionData } from "../state/labSession";
import { getPreset } from "../lib/presets";
import { etherscanTx } from "../lib/links";
import { AddressLink, ExternalLink } from "./ui";

/** Captured receipt context proves which registry the saved setup belongs to. */
export function savedSetupRegistry(session?: SessionData) {
  return session?.sequences.setup?.["deploy-registry"]?.context?.userRegistry;
}

export function DeploymentDetails({ session, linked }: { session: SessionData; linked: boolean }) {
  const selected = session.addresses.userRegistry;
  const original = savedSetupRegistry(session);
  const sameSetup = Boolean(original && original.toLowerCase() === selected?.toLowerCase());
  const steps = Object.entries(session.sequences.setup ?? {});
  const capturedResolver = session.sequences.setup?.["deploy-resolver"]?.context?.resolver;
  const capturedRegistrar = session.sequences.setup?.["deploy-registrar"]?.context?.registrar;
  // Mutable selected addresses can belong to another registry after Adopt/Re-link.
  const resolver = sameSetup ? session.addresses.resolver : capturedResolver;
  const registrar = sameSetup ? session.addresses.registrar : capturedRegistrar;
  if (!selected && !steps.length) return null;
  return (
    <section aria-label="Saved deployment details" className="min-w-0 rounded-2xl border border-ens-border bg-ens-card p-5">
      <h3 className="mb-3 font-medium">Deployment details</h3>
      {selected && <>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ens-muted">Selected registry</dt>
          <dd><AddressLink address={selected} /></dd>
        </dl>
        <p className="mt-3 text-xs text-ens-muted">
          {linked ? "Your name currently points at this registry." : "Your name is not currently verified as pointing at this registry."}
        </p>
      </>}
      {original && <div className="mt-4 border-t border-ens-border pt-4">
        <h4 className="mb-2 text-sm font-medium">Saved setup{sameSetup ? "" : " · a different registry"}</h4>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {!sameSetup && <><dt className="text-ens-muted">Setup registry</dt><dd><AddressLink address={original} /></dd></>}
          {session.presetId && <><dt className="text-ens-muted">Configuration</dt><dd>{getPreset(session.presetId).name}</dd></>}
          {resolver && <><dt className="text-ens-muted">Resolver</dt><dd><AddressLink address={resolver} /></dd></>}
          {registrar && <><dt className="text-ens-muted">Registrar</dt><dd><AddressLink address={registrar} /></dd></>}
        </dl>
      </div>}
      {steps.length > 0 && <details className="mt-4 border-t border-ens-border pt-4">
        <summary className="cursor-pointer text-sm font-medium">Saved setup transactions ({steps.length})</summary>
        <ol className="mt-3 flex flex-col gap-3 text-sm">
          {steps.map(([id, step]) => <li key={id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span>{step.title ?? id}</span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-ens-muted">{step.status}</span>
              {step.txHash && <ExternalLink href={etherscanTx(step.txHash, session.chainId)}>View transaction</ExternalLink>}
            </span>
          </li>)}
        </ol>
      </details>}
    </section>
  );
}
