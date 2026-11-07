import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { isAddress, zeroAddress, type Address } from "viem";
import { namehash } from "viem/ens";
import {
  ConfigDiagram,
  type DiagramState,
  type InspectionTarget,
} from "../diagram";
import { useInspection } from "../hooks/useInspection";
import { labelhashId } from "../lib/names";
import { bitmapHex, ROLE_CATALOG, adminOf } from "../lib/roles";
import { etherscanAddress } from "../lib/links";
import type {
  InspectionData,
  InspectedRecord,
  Profile,
  ReadValue,
} from "../lib/inspection";
import { MAX_EXPIRY } from "../lib/presets";
import type { SetupView } from "../lib/diagramModel";
import { classifyResolver } from "../lib/diagramModel";
import { TransactionError } from "./TransactionError";

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <dt>{title}</dt>
      <dd>{children}</dd>
    </>
  );
}
function Read<T>({
  value,
  children,
}: {
  value?: ReadValue<T>;
  children: (value: T) => ReactNode;
}) {
  if (!value) return <span className="inspection-muted">Not available</span>;
  return value.ok ? (
    <>{children(value.value)}</>
  ) : (
    <details className="inspection-muted">
      <summary>Read unavailable</summary>
      {value.error}
    </details>
  );
}
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="inspection-copy">
      <code>{value}</code>
      <button
        type="button"
        aria-label="Copy value"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        <span role="status">{copied ? "Copied" : "Copy"}</span>
      </button>
    </span>
  );
}
function AddressValue({
  address,
  chainId,
}: {
  address: string;
  chainId: number;
}) {
  return (
    <span className="inspection-address">
      <CopyValue value={address} />
      <a
        href={etherscanAddress(address, chainId)}
        target="_blank"
        rel="noreferrer"
      >
        Explorer ↗
      </a>
    </span>
  );
}
const resolverRoles = [
  [0n, "Set addresses"],
  [4n, "Set text"],
  [8n, "Set contenthash"],
  [12n, "Set ABI"],
  [16n, "Set interface"],
  [20n, "Set primary name"],
  [24n, "Set data"],
  [28n, "Link records"],
  [120n, "Contract naming"],
  [124n, "Upgrade"],
] as const;
function RoleDetails({
  value,
  resolver = false,
  counts = false,
}: {
  value?: ReadValue<bigint>;
  resolver?: boolean;
  counts?: boolean;
}) {
  return (
    <Read value={value}>
      {(bitmap) => {
        const roles = resolver
          ? resolverRoles.flatMap(([shift, label]) => [
              { bit: 1n << shift, label },
              { bit: 1n << (shift + 128n), label },
            ])
          : ROLE_CATALOG.flatMap((role) => [
              { bit: role.bit, label: role.label },
              ...(!role.adminOnly
                ? [{ bit: adminOf(role.bit), label: role.adminLabel }]
                : []),
            ]);
        const shown = counts
          ? roles.filter((role) => ((bitmap / role.bit) & 15n) !== 0n)
          : roles.filter((role) => (bitmap & role.bit) !== 0n);
        return (
          <>
            <div className="inspection-tags">
              {shown.length ? (
                shown.map((role) => (
                  <span
                    key={role.bit.toString()}
                    className={
                      role.bit >= 1n << 128n
                        ? "inspection-role-admin"
                        : undefined
                    }
                  >
                    {role.bit >= 1n << 128n && (
                      <strong className="inspection-role-kind">Admin · </strong>
                    )}
                    {role.label}
                    {counts ? ` · ${Number((bitmap / role.bit) & 15n)}` : ""}
                  </span>
                ))
              ) : (
                <span>None</span>
              )}
            </div>
            <details className="inspection-advanced">
              <summary>
                {counts ? "Packed role counts" : "Raw role bitmap"}
              </summary>
              <CopyValue value={bitmapHex(bitmap)} />
            </details>
          </>
        );
      }}
    </Read>
  );
}
function profileTitle(profile: Profile) {
  return profile.kind === "address"
    ? profile.key === "60"
      ? "ETH address"
      : profile.key === "2147483648"
        ? "Default EVM address"
        : `Address · coin ${profile.key}`
    : profile.kind === "text"
      ? profile.key
      : profile.kind === "data"
        ? `Data · ${profile.key}`
        : profile.kind === "abi"
          ? `ABI · content type ${profile.key}`
          : profile.kind === "interface"
            ? `Interface · ${profile.key}`
            : profile.kind === "name"
              ? "Primary name"
              : "Contenthash";
}
function RecordRow({ record }: { record: InspectedRecord }) {
  return (
    <div className="inspection-record">
      <div>
        <strong>{profileTitle(record.profile)}</strong>
        <span className="inspection-muted">{record.profile.kind}</span>
      </div>
      {record.error ? (
        <details className="inspection-muted">
          <summary>Read unavailable</summary>
          {record.error}
        </details>
      ) : (
        <>
          <CopyValue value={record.value ?? ""} />
          {record.derived && (
            <p className="inspection-muted">
              Resolved interface; may be derived via ERC-165.
            </p>
          )}
          <details>
            <summary>Raw return data</summary>
            <CopyValue value={record.raw ?? "0x"} />
          </details>
        </>
      )}
    </div>
  );
}

type InspectionDiagramProps = {
  diagram: DiagramState;
  setup: SetupView;
  chainId: number;
  account?: Address;
  snapshotBlock?: bigint;
  active?: boolean;
  summary?: (
    inspect: (target: InspectionTarget, opener: HTMLButtonElement) => void,
  ) => ReactNode;
};
function InspectionSummary({
  render,
  onInspect,
}: {
  render: NonNullable<InspectionDiagramProps["summary"]>;
  onInspect: (target: InspectionTarget, opener: HTMLButtonElement) => void;
}) {
  return <>{render(onInspect)}</>;
}
export function InspectionDiagram(props: InspectionDiagramProps) {
  const { setup, chainId } = props;
  const scope = JSON.stringify([chainId, setup.parentName, setup.userRegistry]);
  const fallback = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={fallback}
      tabIndex={-1}
      aria-label="Setup routing diagram"
      role="group"
    >
      <ScopedInspectionDiagram key={scope} {...props} fallback={fallback} />
    </div>
  );
}
function ScopedInspectionDiagram({
  diagram,
  setup,
  chainId,
  account,
  active = true,
  fallback,
  summary,
  snapshotBlock,
}: InspectionDiagramProps & { fallback: RefObject<HTMLDivElement | null> }) {
  const scopeArea = useRef<HTMLDivElement>(null);
  const inspectorId = useId();
  useLayoutEffect(
    () => () => {
      if (
        scopeArea.current?.contains(document.activeElement) &&
        document.activeElement?.closest("[data-diagram-inspector]")
      )
        fallback.current?.focus({ preventScroll: true });
    },
    [fallback],
  );
  const [selection, setSelection] = useState<InspectionTarget>();
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setSelection(undefined);
    const button = opener.current;
    requestAnimationFrame(() => {
      if (button?.isConnected && button.getClientRects().length)
        button.focus({ preventScroll: true });
    });
  };
  const inspect = (target: InspectionTarget, button: HTMLButtonElement) => {
    opener.current = button;
    setSelection(target);
  };
  return (
    <div ref={scopeArea}>
      {summary && <InspectionSummary render={summary} onInspect={inspect} />}
      <ConfigDiagram
        {...diagram}
        selected={active ? selection : undefined}
        inspectorId={inspectorId}
        onInspect={inspect}
      />
      {selection && (
        <DiagramInspector
          key={`${chainId}:${JSON.stringify(selection)}`}
          target={selection}
          inspectorId={inspectorId}
          active={active}
          chainId={chainId}
          account={account}
          snapshotBlock={snapshotBlock}
          setup={setup}
          onSelect={setSelection}
          onClose={close}
        />
      )}
    </div>
  );
}

export function DiagramInspector({
  target,
  setup,
  chainId,
  account,
  onSelect,
  onClose,
  active = true,
  inspectorId: suppliedId,
  snapshotBlock,
}: {
  target: InspectionTarget;
  active?: boolean;
  inspectorId?: string;
  setup: SetupView;
  chainId: number;
  account?: Address;
  snapshotBlock?: bigint;
  onSelect: (target: InspectionTarget) => void;
  onClose: () => void;
}) {
  const generatedId = useId();
  const inspectorId = suppliedId ?? generatedId;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const query = useInspection(target, chainId, account, profiles, active, snapshotBlock);
  const heading = useRef<HTMLHeadingElement>(null);
  const [manualKind, setManualKind] = useState<Profile["kind"]>("text");
  const [manualKey, setManualKey] = useState("");
  const [manualError, setManualError] = useState("");
  const content = query.data;
  const name =
    target.kind === "label"
      ? `${target.label}.${setup.parentName}`
      : target.kind === "name"
        ? target.name
        : undefined;
  const address =
    target.kind === "label"
      ? target.registry
      : target.kind === "name"
        ? target.resolver
        : target.address;
  const shared =
    (setup.resolver ?? setup.inheritedResolver)?.toLowerCase() ===
    address.toLowerCase();
  const kind =
    target.kind === "label"
      ? "Registry label"
      : target.kind === "name"
        ? "Name records"
        : target.kind === "registry"
          ? "Registry contract"
          : "Resolver contract";
  const title =
    target.kind === "label"
      ? target.label
      : target.kind === "name"
        ? target.name
        : target.kind === "registry"
          ? address.toLowerCase() === setup.userRegistry?.toLowerCase()
            ? "UserRegistry"
            : "Registry contract"
          : shared
            ? !setup.resolver && setup.inheritedResolver
              ? "Inherited resolver"
              : "Shared resolver"
            : "Own resolver";
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        active &&
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.activeElement?.closest("[role=dialog],dialog[open]")
      ) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, active]);
  const openResolver = (value: string) =>
    isAddress(value, { strict: false }) && value !== zeroAddress ? (
      <button
        type="button"
        className="inspection-link"
        onClick={() =>
          onSelect({ kind: "resolver", address: value as Address })
        }
      >
        {short(value)} →
      </button>
    ) : (
      "None"
    );
  const namesAtResolver = (setup.subnames ?? [])
    .filter((sub) =>
      shared
        ? classifyResolver(sub.resolver, address) !== "foreign"
        : sub.resolver?.toLowerCase() === address.toLowerCase(),
    )
    .map((sub) => `${sub.label}.${setup.parentName}`);
  if (shared) namesAtResolver.unshift(setup.parentName);
  const requestProfile = (event: FormEvent) => {
    event.preventDefault();
    let key = manualKey.trim();
    try {
      if (!key) throw new Error("Enter a key or identifier.");
      if (["address", "abi"].includes(manualKind)) {
        let number: bigint;
        try {
          number = BigInt(key);
        } catch {
          throw new Error("Enter a numeric coin type or ABI content type.");
        }
        if (
          number < 0n ||
          number >= 1n << 256n ||
          (manualKind === "abi" &&
            (number === 0n || (number & (number - 1n)) !== 0n))
        )
          throw new Error(
            "Use a non-negative uint256 coin type or a single-bit ABI content type.",
          );
        key = number.toString();
      }
      if (manualKind === "interface") key = key.toLowerCase();
      if (manualKind === "interface" && !/^0x[\da-f]{8}$/i.test(key))
        throw new Error(
          "Use a four-byte interface ID, for example 0x01ffc9a7.",
        );
      setProfiles((previous) => [
        ...previous.filter(
          (profile) => profile.kind !== manualKind || profile.key !== key,
        ),
        { kind: manualKind, key },
      ]);
      setManualError("");
    } catch (error) {
      setManualError(
        error instanceof Error ? error.message : "Invalid lookup key.",
      );
    }
  };
  const renderContent = (data: InspectionData) => (
    <>
      {target.kind === "label" && (
        <>
          <p className="inspection-scope">
            Ownership and permissions of this label in its registry.
          </p>
          <dl className="inspection-fields">
            <Field title="Full name">{name}</Field>
            <Field title="Status">
              <Read value={data.state}>
                {(state) =>
                  state.status === 2
                    ? "Registered"
                    : state.status === 1
                      ? "Reserved"
                      : "Available / expired"
                }
              </Read>
            </Field>
            <Field title="Owner">
              <Read value={data.state}>
                {(state) =>
                  state.status === 2 ? (
                    <AddressValue
                      address={state.latestOwner}
                      chainId={chainId}
                    />
                  ) : (
                    <span>
                      Not currently owned
                      {state.latestOwner !== zeroAddress && (
                        <>
                          {" "}
                          · last holder{" "}
                          <AddressValue
                            address={state.latestOwner}
                            chainId={chainId}
                          />
                        </>
                      )}
                    </span>
                  )
                }
              </Read>
            </Field>
            <Field title="Expiry">
              <Read value={data.state}>
                {(state) =>
                  state.expiry === MAX_EXPIRY
                    ? "Never expires"
                    : state.expiry === 0n
                      ? "Not set"
                      : new Date(Number(state.expiry) * 1000).toLocaleString()
                }
              </Read>
            </Field>
            <Field title="Resolver">
              <Read value={data.resolver}>{openResolver}</Read>
            </Field>
            <Field title="Subregistry">
              <Read value={data.subregistry}>
                {(value) =>
                  value === zeroAddress ? (
                    "None"
                  ) : (
                    <button
                      type="button"
                      className="inspection-link"
                      onClick={() =>
                        onSelect({ kind: "registry", address: value })
                      }
                    >
                      {short(value)} →
                    </button>
                  )
                }
              </Read>
            </Field>
          </dl>
          <h4>Holder’s label permissions</h4>
          <RoleDetails value={data.ownerRoles} />
          <p className="inspection-muted">
            Label-scoped grants. Registry-wide grants are separate.
          </p>
          <details className="inspection-advanced">
            <summary>Holder’s registry-wide permissions</summary>
            <RoleDetails value={data.ownerRootRoles} />
          </details>
          {account && (
            <details className="inspection-advanced">
              <summary>Connected wallet’s label permissions</summary>
              <RoleDetails value={data.accountRoles} />
            </details>
          )}
          <details className="inspection-advanced">
            <summary>Developer identifiers</summary>
            <dl className="inspection-fields">
              <Field title="Labelhash">
                <CopyValue value={toHash(target.label)} />
              </Field>
              <Field title="Token ID">
                <Read value={data.state}>
                  {(state) => <CopyValue value={state.tokenId.toString()} />}
                </Read>
              </Field>
              <Field title="Resource ID">
                <Read value={data.state}>
                  {(state) => <CopyValue value={state.resource.toString()} />}
                </Read>
              </Field>
            </dl>
          </details>
        </>
      )}
      {(target.kind === "registry" || target.kind === "resolver") && (
        <>
          <AddressValue address={address} chainId={chainId} />
          <dl className="inspection-fields inspection-spaced">
            <Field title="Implementation">
              <Read value={data.implementation}>
                {(value) =>
                  value ? (
                    <AddressValue address={value} chainId={chainId} />
                  ) : (
                    "No ERC-1967 implementation set"
                  )
                }
              </Read>
            </Field>
            {target.kind === "registry" ? (
              <>
                <Field title="Parent pointer">
                  <Read value={data.parent}>
                    {(value) => (
                      <>
                        {value[1] || "(root)"} ·{" "}
                        <AddressValue address={value[0]} chainId={chainId} />
                      </>
                    )}
                  </Read>
                </Field>
                <Field title="Emancipated">
                  <Read value={data.emancipated}>
                    {(value) => (value ? "Yes" : "No")}
                  </Read>
                </Field>
              </>
            ) : (
              <>
                <Field title="Interface">
                  {data.compatible
                    ? "Pinned PermissionedResolver"
                    : "Unrecognized implementation"}
                </Field>
                <Field title="Default record">
                  <Read value={data.defaultId}>
                    {(value) => (value === 0n ? "Not configured" : `#${value}`)}
                  </Read>
                </Field>
              </>
            )}
          </dl>
          <h4>
            {target.kind === "registry"
              ? "Labels shown in this setup"
              : "Names routed here in this setup"}
          </h4>
          {target.kind === "registry" &&
            (setup.userRegistry?.toLowerCase() !== address.toLowerCase() ||
              !setup.subnames?.length) && (
              <p className="inspection-muted">
                No known labels from this registry in this setup.
              </p>
            )}
          {target.kind === "registry"
            ? (setup.userRegistry?.toLowerCase() === address.toLowerCase()
                ? (setup.subnames ?? [])
                : []
              ).map((sub) => (
                <button
                  key={sub.label}
                  type="button"
                  className="inspection-nav"
                  onClick={() =>
                    onSelect({
                      kind: "label",
                      registry: address,
                      label: sub.label,
                    })
                  }
                >
                  {sub.label}
                  <span>›</span>
                </button>
              ))
            : namesAtResolver.map((fullName) => (
                <button
                  key={fullName}
                  type="button"
                  className="inspection-nav"
                  onClick={() =>
                    onSelect({
                      kind: "name",
                      resolver: address,
                      name: fullName,
                    })
                  }
                >
                  {fullName}
                  <span>›</span>
                </button>
              ))}
          <details className="inspection-advanced">
            <summary>Root role assignee counts</summary>
            <RoleDetails
              resolver={target.kind === "resolver"}
              counts
              value={data.rootCounts}
            />
          </details>
          {account && (
            <details className="inspection-advanced">
              <summary>Connected wallet’s root permissions</summary>
              <RoleDetails
                resolver={target.kind === "resolver"}
                value={data.accountRoles}
              />
            </details>
          )}
        </>
      )}
      {target.kind === "name" && (
        <>
          <p className="inspection-scope">
            Read directly from {openResolver(target.resolver)} for this full
            name. This view inspects this resolver, not a Universal Resolver
            lookup.
          </p>
          <dl className="inspection-fields">
            <Field title="Record source">
              {data.source === "direct"
                ? `Name-specific bundle #${data.recordId}`
                : data.source === "default"
                  ? `Default bundle #${data.recordId}`
                  : data.source === "none"
                    ? "No record bundle"
                    : "Unavailable"}
            </Field>
            <Field title="Direct ID">
              <Read value={data.directId}>{String}</Read>
            </Field>
            <Field title="Default ID">
              <Read value={data.defaultId}>{String}</Read>
            </Field>
          </dl>
          {data.history && !data.history.complete && (
            <p role="status" className="inspection-notice">
              History incomplete. Common and discovered profiles are shown;
              other keys may exist. {data.history.note}
            </p>
          )}
          {data.source === "default" && (
            <p className="inspection-muted">
              This name uses the whole default bundle. A name-specific bundle
              does not fall back field by field.
            </p>
          )}
          {data.source === "none" && data.compatible ? (
            <div className="inspection-empty">
              <strong>No records set here</strong>
              <p>No direct or default bundle is linked for this name.</p>
            </div>
          ) : (
            <>
              <h4>Record values</h4>
              {query.manualError && <div role="alert" className="inspection-warning">Manual lookup failed: {query.manualError.message} <button type="button" onClick={query.retryManual}>Retry lookup</button></div>}
              {(data.records ?? []).some((record) => record.error) && <p role="alert" className="inspection-warning">Some record reads failed. The values below are incomplete; unavailable profiles are listed below. Refresh to retry.</p>}
              {query.manualPending && (
                <p role="status" className="inspection-muted">
                  Reading requested profiles…
                </p>
              )}
              {(data.records ?? [])
                .filter((record) => !record.unset && !record.error)
                .map((record) => (
                  <RecordRow
                    key={`${record.profile.kind}:${record.profile.key}`}
                    record={record}
                  />
                ))}
              {!(data.records ?? []).some(
                (record) => !record.unset && !record.error,
              ) && (
                <p className="inspection-muted">
                  {(data.records ?? []).some((record) => record.error) ? "No values could be confirmed from the successful reads." : "No non-empty values found in the checked profiles."}
                </p>
              )}
              {(data.records ?? []).some((record) => record.error) && (
                <details className="inspection-advanced">
                  <summary>Unavailable profiles</summary>
                  {data
                    .records!.filter((record) => record.error)
                    .map((record) => (
                      <RecordRow
                        key={`${record.profile.kind}:${record.profile.key}`}
                        record={record}
                      />
                    ))}
                </details>
              )}
              {(data.records ?? []).some((record) => record.unset) && (
                <details className="inspection-advanced">
                  <summary>Unset profiles</summary>
                  <p className="inspection-muted">
                    {data
                      .records!.filter((record) => record.unset)
                      .map((record) => profileTitle(record.profile))
                      .join(", ")}
                  </p>
                </details>
              )}
              {(data.records ?? []).some(
                (record) =>
                  record.profile.kind === "address" &&
                  record.profile.key === "2147483648" &&
                  !record.unset &&
                  !record.error,
              ) && (
                <p className="inspection-muted">
                  Default EVM address is a separate stored record. ETH or other
                  EVM lookups can use it when their exact address record is
                  unset.
                </p>
              )}
            </>
          )}
          <details className="inspection-advanced">
            <summary>Look up another profile</summary>
            <form className="inspection-lookup" onSubmit={requestProfile}>
              <select
                aria-label="Profile kind"
                value={manualKind}
                onChange={(event) =>
                  setManualKind(event.target.value as Profile["kind"])
                }
              >
                {["text", "address", "data", "abi", "interface"].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
              <input
                aria-label="Profile key"
                value={manualKey}
                onChange={(event) => setManualKey(event.target.value)}
                placeholder="Key, coin type or interface ID"
              />
              <button type="submit">Look up</button>
            </form>
            {manualError && (
              <p role="alert" className="text-red-700 text-xs">
                {manualError}
              </p>
            )}
          </details>
          <details className="inspection-advanced">
            <summary>Namehash & scan scope</summary>
            <CopyValue value={namehash(target.name)} />
            {data.history && (
              <p className="inspection-muted">
                Keys scanned from block {String(data.history.from)} through{" "}
                {String(data.history.through)}. Values read at block{" "}
                {String(data.block)}.
              </p>
            )}
          </details>
        </>
      )}
    </>
  );
  return (
    <aside
      id={inspectorId}
      data-diagram-inspector
      className="diagram-inspector"
      style={active ? undefined : { display: "none" }}
      aria-labelledby={`${inspectorId}-title`}
    >
      <header className="inspection-header">
        <span className="inspection-kind">{kind}</span>
        <h3 id={`${inspectorId}-title`} ref={heading} tabIndex={-1}>
          {title}
        </h3>
        <p>
          {target.kind === "label"
            ? `Registry ${short(address)} › label ${target.label}`
            : `${short(address)}${target.kind === "name" ? " › full name" : ""}`}
        </p>
        <button
          className="inspection-close"
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="inspection-body">
        {query.isPending ? (
          <p role="status">Reading on-chain data…</p>
        ) : query.error ? (
          <TransactionError error={query.error.message} />
        ) : content ? (
          renderContent(content)
        ) : (
          <p>Read-only connection unavailable.</p>
        )}
      </div>
      <footer className="inspection-footer">
        <span>
          {content
            ? `Block ${content.block} · ${chainId === 1 ? "Ethereum" : "Sepolia"}`
            : "Read-only inspection"}
        </span>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </footer>
    </aside>
  );
}
function toHash(label: string) {
  return `0x${labelhashId(label).toString(16).padStart(64, "0")}`;
}
