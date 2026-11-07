import { RpcConnectionStatus } from "./RpcConnectionStatus";
import {
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
} from "react";
import {
  normalizeInspectionName,
  type ConfigurationSnapshot,
} from "../lib/readConfiguration";
import {
  useConfigurationInspection,
  type InspectionRequest,
} from "../hooks/useConfigurationInspection";
import { getDeployment } from "../config/deployments";
import { toDiagram } from "../lib/diagramModel";
import { etherscanAddress } from "../lib/links";
import { MAX_EXPIRY } from "../lib/presets";
import { InspectionDiagram } from "./DiagramInspector";
import { EntityChip, StatCard, formatExpiry } from "./ui";
import { TransactionError } from "./TransactionError";

export type InspectionFormState = {
  draft: string;
  chainId: 1 | 11155111;
  target?: InspectionRequest;
};
export function InspectPanel({
  active,
  state,
  onChange,
}: {
  active: boolean;
  state: InspectionFormState;
  onChange: Dispatch<SetStateAction<InspectionFormState>>;
}) {
  const [error, setError] = useState<string>();
  const { query, registrar, refresh } = useConfigurationInspection(
    state.target,
    active,
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const name = normalizeInspectionName(state.draft);
      setError(undefined);
      if (
        state.target?.name === name &&
        state.target.chainId === state.chainId
      ) {
        return;
      }
      onChange((previous) => ({
        ...previous,
        draft: name,
        target: { name, chainId: previous.chainId },
      }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Enter a valid name.");
    }
  };
  return (
    <>
      <div>
        <h2
          id="inspect-heading"
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          Inspect a name
        </h2>
        <p className="mt-1 text-sm text-ens-muted">
          View any .eth parent’s ENSv2 configuration. No wallet connection
          required.
        </p>
      </div>
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-ens-border bg-ens-card p-5"
      >
        <label className="min-w-0 basis-full text-sm sm:basis-auto sm:flex-1">
          Parent name
          <input
            className="mt-1 block w-full rounded-lg border border-ens-border bg-white p-3"
            placeholder="wallet.eth"
            autoCapitalize="none"
            spellCheck={false}
            value={state.draft}
            onChange={(event) =>
              onChange((previous) => ({
                ...previous,
                draft: event.target.value,
              }))
            }
          />
        </label>
        <label className="text-sm">
          Inspection network
          <select
            className="mt-1 block rounded-lg border border-ens-border bg-white p-3"
            value={state.chainId}
            onChange={(event) =>
              onChange((previous) => ({
                ...previous,
                chainId: Number(event.target.value) as 1 | 11155111,
              }))
            }
          >
            <option value={1}>Ethereum</option>
            <option value={11155111}>Sepolia</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-5 py-3 text-sm text-white"
        >
          Inspect
        </button>
        <p className="w-full text-xs text-ens-muted">
          Read-only. This view does not change your selected setup or switch
          your wallet’s network.
        </p>
        {error && (
          <p role="alert" className="w-full text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
      <RpcConnectionStatus chainId={state.target?.chainId ?? state.chainId} />
      {state.target && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="break-all text-sm">
              <strong>{state.target.name}</strong> ·{" "}
              {getDeployment(state.target.chainId).chain.name}
            </p>
            <button
              type="button"
              onClick={refresh}
              disabled={query.isFetching}
              className="rounded-lg border border-ens-border px-3 py-2 text-sm"
            >
              {query.isFetching ? "Refreshing…" : "Refresh configuration"}
            </button>
          </div>
          {query.isPending && (
            <p role="status" className="text-sm text-ens-muted">
              Reading the parent and its configuration…
            </p>
          )}
          {query.error && (
            <TransactionError
              error={query.error.message}
              summary="Could not read this configuration. Use Refresh to retry."
            />
          )}
          {query.data && <p className="text-xs text-ens-muted">Cached snapshot at block {query.data.block.toString()}. Refresh configuration to read current state.</p>}
          {query.data && (
            <ConfigurationView
              key={`${state.target.chainId}:${state.target.name}:${query.data.block}`}
              snapshot={query.data}
              active={active}
              registrar={registrar.data ?? undefined}
              registrarPending={Boolean(
                query.data.childRegistry && registrar.isPending,
              )}
              registrarError={registrar.error?.message}
            />
          )}
        </>
      )}
      {!state.target && (
        <p className="text-sm text-ens-muted">
          Enter a parent such as wallet.eth or team.wallet.eth to explore its
          registries, labels, resolvers, and records.
        </p>
      )}
    </>
  );
}
function ConfigurationView({
  snapshot,
  active,
  registrar,
  registrarPending,
  registrarError,
}: {
  snapshot: ConfigurationSnapshot;
  active: boolean;
  registrar?: `0x${string}`;
  registrarPending: boolean;
  registrarError?: string;
}) {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [includeInactive, setIncludeInactive] = useState(false);
  const subs = snapshot.subnames ?? [];
  const filtered = subs.filter(
    (sub) =>
      (includeInactive || sub.registered || sub.status === 1) &&
      sub.label.toLowerCase().includes(filter.toLowerCase()),
  );
  const shown = filtered.slice(page * 25, page * 25 + 25);
  const setup = {
    ...snapshot.setup,
    registrar,
    subnames: shown
      .filter((sub) => sub.registered || sub.status === 1)
      .map((sub) => ({
        label: sub.label,
        status: sub.status === 1 ? ("reserved" as const) : undefined,
        neverExpires: sub.neverExpires,
        resolver: sub.resolver,
      })),
  };
  const diagram = toDiagram(setup);
  const address = (value: string) => (
    <EntityChip
      href={etherscanAddress(value, snapshot.chainId)}
      title={value}
      variant="pink"
    >
      {value.slice(0, 6)}…{value.slice(-4)}
    </EntityChip>
  );
  if (snapshot.status !== "registered" && snapshot.status !== "reserved")
    return (
      <section className="rounded-xl border border-ens-border p-5">
        <p className="text-sm">
          {snapshot.status === "unregistered"
            ? `${snapshot.atName} has no active ENSv2 registration.`
            : snapshot.status === "no-registry"
              ? `${snapshot.atName} has no subregistry through which to locate ${snapshot.name}.`
              : `The registry at ${snapshot.atName} does not support the interfaces used by this lab.`}
        </p>
        {snapshot.detail && <TransactionError error={snapshot.detail} />}
        <p className="mt-3 text-xs text-ens-muted">
          Checked the ENSv2 deployments on{" "}
          {getDeployment(snapshot.chainId).chain.name} at block{" "}
          {String(snapshot.block)}. Canonical ENS and resolver-only wildcard
          names can differ.
        </p>
        {snapshot.effectiveResolver && (
          <p className="mt-3 text-sm">
            Nearest ancestor resolver ({snapshot.resolverSource}):{" "}
            {address(snapshot.effectiveResolver)}
          </p>
        )}
      </section>
    );
  return (
    <section className="min-w-0 rounded-2xl border border-ens-border bg-ens-card p-5">
      {snapshot.status === "reserved" && (
        <p className="mb-4 text-sm text-ens-muted">
          This name is reserved in ENSv2. Its configured pointers are shown.
        </p>
      )}
      {snapshot.subnamesError && (
        <TransactionError
          error={snapshot.subnamesError}
          summary={`Subname count unavailable: ${snapshot.subnamesError}`}
        />
      )}
      {snapshot.recordLinksError && (
        <p role="status" className="mb-4 text-sm text-amber-800">
          {snapshot.recordLinksError} Open a name’s details to retry its
          records.
        </p>
      )}
      {registrarError && (
        <TransactionError
          error={registrarError}
          summary="Registrar discovery is unavailable. The remaining configuration is shown."
        />
      )}
      <InspectionDiagram
        diagram={diagram}
        setup={setup}
        chainId={snapshot.chainId}
        active={active}
        snapshotBlock={snapshot.block}
        summary={(inspect) => (
          <>
            <dl className="mb-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
              <dt className="text-ens-muted">
                {snapshot.status === "reserved"
                  ? "Last holder"
                  : "Parent owner"}
              </dt>
              <dd>
                {snapshot.state &&
                  (snapshot.state.latestOwner.toLowerCase() ===
                  "0x0000000000000000000000000000000000000000"
                    ? "None"
                    : address(snapshot.state.latestOwner))}
              </dd>
              <dt className="text-ens-muted">Expiry</dt>
              <dd>
                {snapshot.state?.expiry === MAX_EXPIRY
                  ? "Never expires"
                  : formatExpiry(snapshot.state?.expiry)}
              </dd>
              <dt className="text-ens-muted">Subregistry</dt>
              <dd className="min-w-0">
                {snapshot.childRegistry ? (
                  <button
                    type="button"
                    className="inspection-link break-all"
                    onClick={(event) =>
                      inspect(
                        { kind: "registry", address: snapshot.childRegistry! },
                        event.currentTarget,
                      )
                    }
                  >
                    {snapshot.childRegistry} · Inspect ›
                  </button>
                ) : (
                  "Not configured"
                )}
              </dd>
              <dt className="text-ens-muted">Parent resolver</dt>
              <dd>
                {snapshot.directResolver ? (
                  <button
                    type="button"
                    className="inspection-link"
                    onClick={(event) =>
                      inspect(
                        { kind: "resolver", address: snapshot.directResolver! },
                        event.currentTarget,
                      )
                    }
                  >
                    {snapshot.directResolver.slice(0, 6)}…
                    {snapshot.directResolver.slice(-4)} · Inspect ›
                  </button>
                ) : (
                  "No direct pointer"
                )}
              </dd>
              {!snapshot.directResolver && snapshot.effectiveResolver && (
                <>
                  <dt className="text-ens-muted">Inherited resolver</dt>
                  <dd>
                    <button
                      type="button"
                      className="inspection-link"
                      onClick={(event) =>
                        inspect(
                          {
                            kind: "resolver",
                            address: snapshot.effectiveResolver!,
                          },
                          event.currentTarget,
                        )
                      }
                    >
                      {snapshot.effectiveResolver.slice(0, 6)}…
                      {snapshot.effectiveResolver.slice(-4)} · Inspect ›
                    </button>
                    <p className="mt-1 text-xs text-ens-muted">
                      Inherited from {snapshot.resolverSource}; not set on this
                      parent.
                    </p>
                  </dd>
                </>
              )}
              {snapshot.effectiveResolver && (
                <>
                  <dt className="text-ens-muted">Parent records</dt>
                  <dd>
                    <button
                      type="button"
                      className="inspection-link"
                      onClick={(event) =>
                        inspect(
                          {
                            kind: "name",
                            resolver: snapshot.effectiveResolver!,
                            name: snapshot.name,
                          },
                          event.currentTarget,
                        )
                      }
                    >
                      Inspect {snapshot.name} ›
                    </button>
                  </dd>
                </>
              )}
            </dl>
            <div className="mb-5 flex flex-wrap gap-3">
              <StatCard
                label="Registered subnames"
                value={
                  snapshot.subnamesError
                    ? "Unavailable"
                    : snapshot.childRegistry
                      ? subs.filter((sub) => sub.registered).length
                      : "—"
                }
              />
              <StatCard
                label="Never expiring"
                value={
                  snapshot.subnamesError
                    ? "—"
                    : subs.filter((sub) => sub.registered && sub.neverExpires)
                        .length
                }
              />
              <StatCard
                label="Lab-compatible registrar"
                value={
                  registrarError
                    ? "Unknown"
                    : registrarPending
                      ? "Checking…"
                      : registrar
                        ? address(registrar)
                        : "None found"
                }
              />
            </div>
            {!snapshot.childRegistry && (
              <p className="mb-5 text-sm text-ens-muted">
                This parent has no configured subregistry. A resolver can still
                hold records for names beneath it.
              </p>
            )}
            {snapshot.childRegistry && (
              <>
                <div className="mb-4 flex flex-wrap gap-3 text-sm">
                  <label className="flex-1">
                    Filter labels
                    <input
                      className="ml-2 rounded border border-ens-border bg-white p-2"
                      value={filter}
                      onChange={(event) => {
                        setFilter(event.target.value);
                        setPage(0);
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeInactive}
                      onChange={(event) => {
                        setIncludeInactive(event.target.checked);
                        setPage(0);
                      }}
                    />
                    Include inactive labels
                  </label>
                </div>
                <p className="mb-3 text-xs text-ens-muted">
                  Showing{" "}
                  {filtered.length
                    ? `${page * 25 + 1}–${page * 25 + shown.length}`
                    : "0"}{" "}
                  of {filtered.length} matching labels. The diagram shows this
                  page.
                </p>
                {shown.some((sub) => !sub.registered && sub.status !== 1) && (
                  <div className="mb-4 rounded-lg border border-ens-border bg-white p-3 text-sm">
                    <p className="mb-2 text-xs text-ens-muted">
                      Inactive labels are listed here and omitted from the
                      routing diagram.
                    </p>
                    {shown
                      .filter((sub) => !sub.registered && sub.status !== 1)
                      .map((sub) => (
                        <div
                          key={sub.label}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <span>{sub.label} · inactive</span>
                          <button
                            type="button"
                            className="inspection-link"
                            onClick={(event) =>
                              inspect(
                                {
                                  kind: "label",
                                  registry: snapshot.childRegistry!,
                                  label: sub.label,
                                },
                                event.currentTarget,
                              )
                            }
                          >
                            Label details ›
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      />
      {snapshot.childRegistry && !snapshot.subnamesError && (
        <div className="mt-5 flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
            className="rounded border border-ens-border px-3 py-2 disabled:opacity-40"
          >
            Previous labels
          </button>
          <span>
            Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}
          </span>
          <button
            type="button"
            disabled={(page + 1) * 25 >= filtered.length}
            onClick={() => setPage((value) => value + 1)}
            className="rounded border border-ens-border px-3 py-2 disabled:opacity-40"
          >
            Next labels
          </button>
        </div>
      )}
      {snapshot.subnamesError && (
        <p className="mt-3 text-sm text-amber-800">
          {subs.length ? "Only labels verified in the completed portion of history are shown. The total count is unknown." : "Subname routing is unavailable because the label scan failed."}
        </p>
      )}
      <p className="mt-4 text-xs text-ens-muted">
        Resolver link IDs are sampled for the first 25 active labels. Other
        labels’ records can be read by opening their details.
      </p>
      <p className="mt-4 text-xs text-ens-muted">
        Configuration read at block {String(snapshot.block)}. Label history
        scanned from block {String(snapshot.scanFrom)}. Detail drawers use this same snapshot. Refresh configuration for a newer block. Parent-link locking was not checked.
      </p>
    </section>
  );
}
