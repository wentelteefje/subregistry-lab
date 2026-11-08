import { zeroAddress, type Address } from "viem";
import { RpcConnectionStatus } from "./RpcConnectionStatus";
import {
  useState,
  useEffect,
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

type BrowseState = {
  filter: string;
  page: number;
  includeInactive: boolean;
  resolverFilter: string;
  resolverPage: number;
};
type OpenedFrom = { address: Address; block: string };
type TrailEntry = InspectionRequest & {
  browse?: BrowseState;
  openedFrom?: OpenedFrom;
};
export type InspectionFormState = {
  draft: string;
  chainId: 1 | 11155111;
  target?: InspectionRequest;
  trail?: TrailEntry[];
  browse?: BrowseState;
  openedFrom?: OpenedFrom;
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
  const {
    query,
    registrar,
    discovery,
    snapshot: enrichedSnapshot,
    refresh,
  } = useConfigurationInspection(state.target, active);
  useEffect(() => {
    if (active && state.target && typeof document !== "undefined")
      document.getElementById("inspect-heading")?.focus();
  }, [active, state.target]);
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
        trail: [],
        browse: undefined,
        openedFrom: undefined,
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
          {Boolean(state.trail?.length) && (
            <nav
              aria-label="Registry exploration path"
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              {state.trail!.map((entry, index) => (
                <span
                  key={`${entry.chainId}:${entry.name}`}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    className="inspection-link break-all"
                    onClick={() =>
                      onChange((previous) => ({
                        ...previous,
                        draft: entry.name,
                        chainId: entry.chainId,
                        target: { name: entry.name, chainId: entry.chainId },
                        trail: previous.trail?.slice(0, index),
                        browse: entry.browse,
                        openedFrom: entry.openedFrom,
                      }))
                    }
                  >
                    {entry.name}
                  </button>
                  <span aria-hidden>›</span>
                </span>
              ))}
              <span aria-current="page" className="break-all">
                {state.target.name}
              </span>
            </nav>
          )}
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
          {query.data && (
            <p className="text-xs text-ens-muted">
              Cached snapshot at block {query.data.block.toString()}. Refresh
              configuration to read current state.
            </p>
          )}
          {query.data && state.openedFrom && (
            <p role="status" className="text-sm text-ens-muted">
              This level uses its own snapshot.{" "}
              {query.data.childRegistry?.toLowerCase() !==
              state.openedFrom.address.toLowerCase()
                ? `The child registry pointer differs from the one shown at block ${state.openedFrom.block}; current configuration is shown.`
                : `Its pointer matches the parent view at block ${state.openedFrom.block}.`}
            </p>
          )}
          {query.data && (
            <ConfigurationView
              key={`${state.target.chainId}:${state.target.name}:${query.data.block}`}
              snapshot={enrichedSnapshot ?? query.data}
              initialBrowse={state.browse}
              onExplore={(label, address, browse) => {
                try {
                  const name = normalizeInspectionName(
                    `${label}.${state.target!.name}`,
                  );
                  if (
                    label.includes(".") ||
                    name !== `${label}.${state.target!.name}`
                  )
                    throw Error(
                      "This label cannot be safely explored as an ENS name.",
                    );
                  setError(undefined);
                  onChange((previous) => ({
                    ...previous,
                    draft: name,
                    chainId: state.target!.chainId,
                    target: { name, chainId: state.target!.chainId },
                    trail: [
                      ...(previous.trail ?? []),
                      {
                        ...state.target!,
                        browse,
                        openedFrom: previous.openedFrom,
                      },
                    ],
                    browse: undefined,
                    openedFrom: { address, block: String(query.data!.block) },
                  }));
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "This name cannot be explored.",
                  );
                }
              }}
              resolverNamesPending={Boolean(discovery?.isFetching)}
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
  resolverNamesPending,
  initialBrowse,
  onExplore,
}: {
  snapshot: ConfigurationSnapshot;
  active: boolean;
  registrar?: `0x${string}`;
  registrarPending: boolean;
  registrarError?: string;
  resolverNamesPending?: boolean;
  initialBrowse?: BrowseState;
  onExplore: (label: string, address: Address, browse: BrowseState) => void;
}) {
  const [filter, setFilter] = useState(initialBrowse?.filter ?? "");
  const [page, setPage] = useState(initialBrowse?.page ?? 0);
  const [includeInactive, setIncludeInactive] = useState(
    initialBrowse?.includeInactive ?? false,
  );
  const [resolverFilter, setResolverFilter] = useState(
    initialBrowse?.resolverFilter ?? "",
  );
  const [resolverPage, setResolverPage] = useState(
    initialBrowse?.resolverPage ?? 0,
  );
  const resolverNames = snapshot.resolverNames ?? [];
  const matchingNames = resolverNames.filter((entry) =>
    entry.name.includes(resolverFilter.toLowerCase()),
  );
  const currentResolverPage = Math.min(
    resolverPage,
    Math.max(0, Math.ceil(matchingNames.length / 10) - 1),
  );
  const shownNames = matchingNames.slice(
    currentResolverPage * 10,
    currentResolverPage * 10 + 10,
  );
  const registryEntry =
    snapshot.status === "registered" || snapshot.status === "reserved";
  const subs = snapshot.subnames ?? [];
  const filtered = subs.filter(
    (sub) =>
      (includeInactive || sub.registered || sub.status === 1) &&
      sub.label.toLowerCase().includes(filter.toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 25) - 1),
  );
  const shown = filtered.slice(currentPage * 25, currentPage * 25 + 25);
  const currentLabels = subs.filter(
    (sub) => sub.registered || sub.status === 1,
  );
  const deeper = currentLabels.filter(
    (sub) => sub.subregistry && sub.subregistry.toLowerCase() !== zeroAddress,
  );
  const unknownPointers = currentLabels.filter(
    (sub) => sub.subregistry === undefined,
  );
  const browse = {
    filter,
    page: currentPage,
    includeInactive,
    resolverFilter,
    resolverPage: currentResolverPage,
  };
  const explorationError = (label: string) => {
    try {
      const name = `${label}.${snapshot.name}`;
      if (label.includes(".") || normalizeInspectionName(name) !== name)
        return "This label cannot be represented safely as an ENS name.";
    } catch {
      return "This name exceeds the supported format or depth.";
    }
  };
  const setup = {
    ...snapshot.setup,
    registrar,
    resolverNames:
      (
        snapshot.setup.resolver ?? snapshot.setup.inheritedResolver
      )?.toLowerCase() === snapshot.resolution?.resolver.toLowerCase()
        ? shownNames.slice(0, 5).map((entry) => entry.name)
        : undefined,
    subnames: shown
      .filter((sub) => sub.registered || sub.status === 1)
      .map((sub) => ({
        label: sub.label,
        status: sub.status === 1 ? ("reserved" as const) : undefined,
        neverExpires: sub.neverExpires,
        resolver: sub.resolver,
        childRegistry: Boolean(
          sub.subregistry && sub.subregistry.toLowerCase() !== zeroAddress,
        ),
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
  if (!registryEntry && !snapshot.resolution)
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
        {snapshot.resolutionError && (
          <TransactionError
            error={snapshot.resolutionError}
            summary="Wildcard routing could not be checked. Refresh to retry."
          />
        )}
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
      {!registryEntry && (
        <p className="mb-4 text-sm text-ens-muted">
          {snapshot.status === "unsupported-registry"
            ? "The registry interface could not be inspected. Resolver routing is shown independently below."
            : "No registry entry was found for this name. Its resolver routing is shown independently below."}
        </p>
      )}
      {snapshot.resolution && (
        <p className="mb-4 text-sm text-ens-muted">
          {snapshot.resolution.wildcard
            ? snapshot.resolution.wildcardSupported === false
              ? `The ancestor resolver at ${snapshot.resolution.foundAt} does not support wildcard resolution. `
              : snapshot.resolution.wildcardSupported === undefined
                ? `Ancestor resolver found at ${snapshot.resolution.foundAt}; wildcard support could not be verified. `
                : `Wildcard resolver found at ${snapshot.resolution.foundAt}. `
            : "Resolver set on this name. "}
          {snapshot.resolution.source === "linked"
            ? `Name-specific record bundle #${snapshot.resolution.recordId}.`
            : snapshot.resolution.source === "default"
              ? `Uses default record bundle #${snapshot.resolution.recordId}.`
              : snapshot.resolution.source === "none"
                ? "No name-specific or default record bundle is linked."
                : "This resolver’s record bundles cannot be enumerated by the lab."}
        </p>
      )}
      {snapshot.resolutionError && (
        <TransactionError
          error={snapshot.resolutionError}
          summary="Resolver routing or record links could not be fully checked. Refresh to retry."
        />
      )}
      {snapshot.resolverNamesError && (
        <TransactionError
          error={snapshot.resolverNamesError}
          summary={`Resolver name discovery incomplete: ${snapshot.resolverNamesError}`}
        />
      )}
      {snapshot.resolution && !snapshot.resolution.permissioned && (
        <p className="mb-4 text-sm text-amber-800">
          Name discovery is unavailable for this resolver. An empty list does
          not mean it serves no other names.
        </p>
      )}
      {snapshot.resolution?.permissioned &&
        snapshot.resolution.wildcardSupported === false && (
          <p className="mb-4 text-sm text-amber-800">
            Resolver name discovery was skipped because this resolver reports
            that it does not support wildcard resolution.
          </p>
        )}
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
              {registryEntry && (
                <>
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
                </>
              )}
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
            {snapshot.resolution?.defaultId &&
              snapshot.resolution.defaultId !== "0" && (
                <p className="mb-4 text-sm text-ens-muted">
                  Default record bundle #{snapshot.resolution.defaultId} applies
                  to names routed to this resolver without a name-specific
                  bundle. These wildcard names cannot all be listed.
                </p>
              )}
            <div className="mb-5 flex flex-wrap gap-3">
              {snapshot.resolution?.permissioned && (
                <StatCard
                  label="Resolver-linked descendants"
                  value={
                    resolverNamesPending
                      ? "Checking…"
                      : snapshot.resolverNamesError
                        ? `${resolverNames.length}+ (incomplete)`
                        : snapshot.resolverNames === undefined
                          ? "Not checked"
                          : resolverNames.length
                  }
                />
              )}
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
                  snapshot.subnamesError || !snapshot.childRegistry
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
            {resolverNamesPending && (
              <p role="status" className="mb-4 text-sm text-ens-muted">
                Discovering names from resolver history… The configuration above
                is ready to inspect.
              </p>
            )}
            {(resolverNames.length > 0 || snapshot.resolverNamesError) && (
              <details className="mb-5 rounded-lg border border-ens-border bg-white p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  Browse resolver-linked names ({resolverNames.length}
                  {snapshot.resolverNamesError ? "+" : ""})
                </summary>
                <p className="my-3 text-xs text-ens-muted">
                  Names discovered from resolver history and verified against
                  current routing at this snapshot. These are separate from
                  registry labels. Click a name to inspect its records. The
                  diagram previews up to five names from this page.
                </p>
                <label className="block text-xs">
                  Filter resolver names
                  <input
                    className="mt-1 block w-full rounded border border-ens-border p-2"
                    value={resolverFilter}
                    onChange={(event) => {
                      setResolverFilter(event.target.value);
                      setResolverPage(0);
                    }}
                  />
                </label>
                <ul className="my-3 space-y-2">
                  {shownNames.map((entry) => (
                    <li
                      key={entry.name}
                      className="flex flex-wrap justify-between gap-2"
                    >
                      <button
                        type="button"
                        className="inspection-link break-all text-left"
                        onClick={(event) =>
                          inspect(
                            {
                              kind: "name",
                              resolver: entry.resolver,
                              name: entry.name,
                            },
                            event.currentTarget,
                          )
                        }
                      >
                        {entry.name} · Records ›
                      </button>
                      <span className="text-xs text-ens-muted">
                        Bundle #{entry.recordId}
                      </span>
                    </li>
                  ))}
                </ul>
                {!matchingNames.length && <p>No matching resolver names.</p>}
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    disabled={currentResolverPage === 0}
                    onClick={() => setResolverPage(currentResolverPage - 1)}
                    className="rounded border border-ens-border p-2 disabled:opacity-40"
                  >
                    Previous names
                  </button>
                  <span>
                    Page {currentResolverPage + 1} of{" "}
                    {Math.max(1, Math.ceil(matchingNames.length / 10))}
                  </span>
                  <button
                    type="button"
                    disabled={
                      (currentResolverPage + 1) * 10 >= matchingNames.length
                    }
                    onClick={() => setResolverPage(currentResolverPage + 1)}
                    className="rounded border border-ens-border p-2 disabled:opacity-40"
                  >
                    Next names
                  </button>
                </div>
              </details>
            )}
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
                    ? `${currentPage * 25 + 1}–${currentPage * 25 + shown.length}`
                    : "0"}{" "}
                  of {filtered.length} matching labels. The diagram shows this
                  page.
                </p>
                <div className="mb-4 rounded-lg border border-ens-border bg-white p-3 text-sm">
                  <p className="font-medium">Deeper registries</p>
                  <p className="mt-1 text-xs text-ens-muted">
                    {deeper.length} of {currentLabels.length}{" "}
                    {snapshot.subnamesError
                      ? "listed current labels"
                      : "current labels"}{" "}
                    have a child registry pointer
                    {unknownPointers.length
                      ? ` · ${unknownPointers.length} not verified`
                      : ""}
                    . Child contents are loaded only when you choose Explore
                    subregistry.
                  </p>
                  {shown
                    .filter((sub) => sub.registered || sub.status === 1)
                    .map((sub) => {
                      const child =
                        sub.subregistry &&
                        sub.subregistry.toLowerCase() !== zeroAddress
                          ? sub.subregistry
                          : undefined;
                      const problem = explorationError(sub.label);
                      return child ? (
                        <div
                          key={sub.label}
                          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ens-border p-3"
                        >
                          <div className="min-w-0">
                            <strong className="break-all">{sub.label}</strong>{" "}
                            <span className="text-xs text-ens-blue">
                              Child registry ↳
                            </span>
                            <p className="mt-1 break-all text-xs text-ens-muted">
                              {child}
                            </p>
                            {problem && (
                              <p className="mt-1 text-xs text-amber-800">
                                {problem}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            aria-label={`Explore subregistry of ${sub.label}.${snapshot.name}`}
                            className="rounded-lg border border-ens-blue px-3 py-2 text-ens-blue disabled:opacity-40"
                            disabled={Boolean(problem)}
                            onClick={() => onExplore(sub.label, child, browse)}
                          >
                            Explore subregistry →
                          </button>
                        </div>
                      ) : sub.subregistry === undefined ? (
                        <p
                          key={sub.label}
                          role="status"
                          className="mt-2 text-xs text-amber-800"
                        >
                          {sub.label}: child registry pointer unavailable.{" "}
                          {sub.subregistryError ??
                            "Refresh configuration to check."}
                        </p>
                      ) : null;
                    })}
                  {deeper.length > 0 &&
                    !shown.some(
                      (sub) =>
                        sub.subregistry &&
                        sub.subregistry.toLowerCase() !== zeroAddress,
                    ) && (
                      <p className="mt-2 text-xs text-ens-muted">
                        Child registries exist on other label pages or outside
                        this filter.
                      </p>
                    )}
                </div>
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
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            className="rounded border border-ens-border px-3 py-2 disabled:opacity-40"
          >
            Previous labels
          </button>
          <span>
            Page {currentPage + 1} of{" "}
            {Math.max(1, Math.ceil(filtered.length / 25))}
          </span>
          <button
            type="button"
            disabled={(currentPage + 1) * 25 >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
            className="rounded border border-ens-border px-3 py-2 disabled:opacity-40"
          >
            Next labels
          </button>
        </div>
      )}
      {snapshot.subnamesError && (
        <p className="mt-3 text-sm text-amber-800">
          {subs.length
            ? "Only labels verified in the completed portion of history are shown. The total count is unknown."
            : "Subname routing is unavailable because the label scan failed."}
        </p>
      )}
      <p className="mt-4 text-xs text-ens-muted">
        Resolver link IDs are sampled for the first 25 active labels. Other
        labels’ records can be read by opening their details.
      </p>
      <p className="mt-4 text-xs text-ens-muted">
        Configuration read at block {String(snapshot.block)}.{" "}
        {snapshot.childRegistry && (
          <>Label history scanned from block {String(snapshot.scanFrom)}. </>
        )}
        {snapshot.resolution?.permissioned &&
          snapshot.resolution.wildcardSupported !== false && (
            <>
              Resolver name discovery starts at block{" "}
              {String(snapshot.scanFrom)}; earlier history may be
              unavailable.{" "}
            </>
          )}
        Detail drawers use this same snapshot. Refresh configuration for a newer
        block. Parent-link locking was not checked.
      </p>
    </section>
  );
}
