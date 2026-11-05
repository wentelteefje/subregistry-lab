import { paidOperationExpiry } from "../lib/registration";
import { useLockStatus } from "../hooks/useLockStatus";
import { useResolverAccess } from "../hooks/useResolverAccess";
import { labelhashId } from "../lib/names";
import { useDeployment } from "../hooks/useDeployment";
/**
 * Playground: register subnames (directly as owner, or via the paid
 * registrar), set address records, run resolve checks, and watch the live
 * on-chain state of the setup (list + diagram).
 */

import { useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress, zeroAddress, type Abi, type Address } from "viem";
import { ConfigDiagram } from "../diagram";
import type { DiagramNode } from "../diagram";
import { registryAbi, simpleRegistrarAbi } from "../config/abis";

import { classifyResolver, toDiagram } from "../lib/diagramModel";
import { classifyError } from "../lib/errors";
import { fqdn, normalizeLabel, subnameNode } from "../lib/names";
import { MAX_EXPIRY, getPreset } from "../lib/presets";
import {
  buildDirectRegisterStep,
  buildFaucetStep,
  buildRegistrarRegisterSteps,
  buildSetAddrStep,
  buildSwitchResolverSteps,
  type StepCtx,
} from "../lib/steps";
import { useNameStatus } from "../hooks/useNameStatus";
import { useRegistrarDiscovery } from "../hooks/useRegistrarDiscovery";
import { useRegistryState, type Subname } from "../hooks/useRegistryState";
import { useTxSequence } from "../hooks/useTxSequence";
import { useUsdc } from "../hooks/useUsdc";
import { useLab } from "../state/LabContext";
import { etherscanTx, explorerName } from "../lib/links";
import { useIsReady } from "./ChainGuard";
import { TxStepper } from "./TxStepper";
import {
  AddressLink,
  Badge,
  ExternalLink,
  NameChip,
  StatCard,
  formatExpiry,
} from "./ui";
import type { StepDef } from "../lib/steps";

const YEAR = 365n * 86400n;

export function PlaygroundPanel() {
  const network = useDeployment();
  const deployments = network.addresses;
  const { address } = useAccount();
  const ready = useIsReady();
  const client = usePublicClient();
  const { session } = useLab();
  const nameStatus = useNameStatus(session?.parentLabel, address);
  const registry = session?.addresses.userRegistry;
  const { registryLocked } = useLockStatus(registry, session?.parentLabel);
  // The shared resolver is on-chain truth: whatever the parent name points at
  // on the .eth registry (the setup sequence keeps this in sync). The session
  // resolver is only a planning value and can drift across replace/relink.
  const resolver =
    nameStatus.resolver && nameStatus.resolver !== zeroAddress
      ? nameStatus.resolver
      : undefined;
  const canWriteRecords = useResolverAccess(resolver, address);
  const fromBlock = session?.registryDeployBlock
    ? BigInt(session.registryDeployBlock)
    : undefined;
  // On-chain truth for the registrar: the session address if known, else
  // discovered from the registry's role grants (session memory can be lost
  // on reconfiguration while the registrar keeps its on-chain roles).
  const discoveredRegistrar = useRegistrarDiscovery(
    registry,
    fromBlock,
    Boolean(session?.addresses.registrar),
  );
  const registrar = session?.addresses.registrar ?? discoveredRegistrar;
  const { subnames, loading, refresh } = useRegistryState(registry, fromBlock);
  const usdc = useUsdc(address, registrar);

  const sequence = useTxSequence("playground");
  const [activePlan, setActivePlan] = useState<StepDef[]>([]);

  const [label, setLabel] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [years, setYears] = useState(1);
  // null = follow the preset default ('max' expiry presets start ticked)
  const [foreverOverride, setForeverOverride] = useState<boolean | null>(null);
  const [via, setVia] = useState<"direct" | "registrar">("direct");
  const [paidOperation, setPaidOperation] = useState<"register" | "renew">(
    "register",
  );
  const [acknowledgePayment, setAcknowledgePayment] = useState(false);
  const failedPayment = session?.sequences.playground?.["registrar-register"];
  const unverifiedPayment =
    failedPayment?.confirmed &&
    failedPayment.status === "failed" &&
    !failedPayment.reverted &&
    !failedPayment.cancelled;
  const [formError, setFormError] = useState<string>();
  const [resolveResults, setResolveResults] = useState<Record<string, string>>(
    {},
  );
  const [inspected, setInspected] = useState<DiagramNode | null>(null);

  const preset = session?.presetId ? getPreset(session.presetId) : undefined;
  const forever = foreverOverride ?? preset?.subnameDefaults.expiry === "max";
  const parentName = session ? `${session.parentLabel}.eth` : "";

  const liveDiagram = useMemo(() => {
    if (!session || !registry) return undefined;
    return toDiagram({
      parentName,
      parentOwner: address,
      userRegistry: registry,
      registrar,
      registrarRoles: preset?.registrar?.grantBitmap,
      resolver,
      locked: registryLocked,
      subnames: subnames
        .filter((s) => s.registered)
        .map((s) => ({
          label: s.label,
          neverExpires: s.neverExpires,
          resolver: s.resolver,
        })),
    });
  }, [
    session,
    registry,
    registrar,
    resolver,
    subnames,
    preset,
    address,
    parentName,
    registryLocked,
  ]);

  if (!session || !address || !registry) return null;

  const runPlan = async (plan: StepDef[], ctx?: Partial<StepCtx>) => {
    const isPayment = plan.some((step) => step.id === "registrar-register");
    sequence.reset({
      acknowledgeConfirmedFailure: isPayment && acknowledgePayment,
    });
    if (isPayment) setAcknowledgePayment(false);
    setActivePlan(plan);
    const base: StepCtx = {
      chainId: network.id,
      account: address,
      parentLabel: session.parentLabel,
      ownerInitBitmap: 0n,
      deployResolver: false,
      userRegistry: registry,
      resolver,
      registrar,
      ...ctx,
    };
    const result = await sequence.run(plan, base);
    refresh();
    usdc.refetch();
    return result;
  };

  const register = async () => {
    setFormError(undefined);
    const { label: cleanLabel, error } = normalizeLabel(label);
    if (error || !cleanLabel) {
      setFormError(error);
      return;
    }
    const owner = (ownerInput.trim() || address) as Address;
    if (!isAddress(owner)) {
      setFormError("Owner must be a valid address.");
      return;
    }
    const roleBitmap = session.subnameRoleBitmap
      ? BigInt(session.subnameRoleBitmap)
      : (preset?.subnameDefaults.roleBitmap ?? 0n);

    if (via === "direct") {
      const expiry = forever
        ? MAX_EXPIRY
        : BigInt(Math.floor(Date.now() / 1000)) + BigInt(years) * YEAR;
      await runPlan(
        buildDirectRegisterStep({
          chainId: network.id,
          userRegistry: registry,
          label: cleanLabel,
          owner,
          resolver: resolver ?? "0x0000000000000000000000000000000000000000",
          roleBitmap,
          expiry,
        }),
      );
    } else {
      if (!registrar || !client) return;
      try {
        if (unverifiedPayment && !acknowledgePayment)
          throw new Error(
            "Check the previous confirmed payment and acknowledge it before starting another paid action",
          );
        const duration = BigInt(years) * YEAR;
        const price = (await client.readContract({
          address: registrar,
          abi: simpleRegistrarAbi as Abi,
          functionName: "getPrice",
          args: [duration],
        })) as bigint;
        const state = await client.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "getState",
          args: [labelhashId(cleanLabel)],
        });
        const renewFromExpiry = paidOperationExpiry(
          paidOperation,
          state.status,
          state.expiry,
        );
        if (
          paidOperation === "renew" &&
          state.latestOwner.toLowerCase() !== owner.toLowerCase()
        )
          throw new Error(
            "Renewal keeps the existing owner; enter that address.",
          );
        await runPlan(
          buildRegistrarRegisterSteps({
            chainId: network.id,
            registrar,
            userRegistry: registry,
            label: cleanLabel,
            owner,
            resolver: resolver ?? "0x0000000000000000000000000000000000000000",
            duration,
            price,
            currentAllowance: usdc.allowance,
            payer: address,
            renewFromExpiry,
          }),
        );
      } catch (err) {
        setFormError(classifyError(err).message);
      }
    }
  };

  const setAddrFor = async (subLabel: string) => {
    if (!resolver || !canWriteRecords) return;
    await runPlan(
      buildSetAddrStep({
        chainId: network.id,
        resolver,
        node: subnameNode(subLabel, parentName),
        fqdn: fqdn(subLabel, parentName),
        addr: address,
      }),
    );
  };

  const switchResolverFor = async (subLabel: string) => {
    if (!registry || !session) return;
    const name = fqdn(subLabel, parentName);
    await runPlan(
      buildSwitchResolverSteps({
        chainId: network.id,
        userRegistry: registry,
        parentLabel: session.parentLabel,
        label: subLabel,
        owner: address,
      }),
      {
        subResolver: session.ownResolvers?.[name.toLowerCase()],
        subResolverName: name,
      },
    );
  };

  const resolveCheck = async (subLabel: string) => {
    if (!client) return;
    const name = fqdn(subLabel, parentName);
    try {
      const resolved = await client.getEnsAddress({
        name,
        universalResolverAddress: deployments.UniversalResolverV2,
      });
      setResolveResults((prev) => ({
        ...prev,
        [subLabel]: resolved ?? "(no address set)",
      }));
    } catch (err) {
      setResolveResults((prev) => ({
        ...prev,
        [subLabel]: `error: ${classifyError(err).message}`,
      }));
    }
  };

  const registeredCount = subnames.filter((s) => s.registered).length;
  const foreverCount = subnames.filter(
    (s) => s.registered && s.neverExpires,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Explorer-style stat boxes */}
      <div className="flex flex-wrap gap-3">
        <StatCard label="Subnames" value={registeredCount} />
        <StatCard
          label="Never expiring"
          value={foreverCount}
          hint="Subnames registered with the maximum expiry"
        />
        <StatCard
          label="Registrar"
          value={registrar ? <AddressLink address={registrar} /> : "—"}
          hint={
            registrar ? "Paid registrations enabled" : "No registrar deployed"
          }
        />
        <StatCard
          label="Shared resolver"
          value={resolver ? <AddressLink address={resolver} /> : "—"}
          hint={
            resolver
              ? "The parent name's resolver; subname records live here by default"
              : "The parent name has no resolver set"
          }
        />
      </div>

      {/* Live diagram from on-chain state; click a resolver node to inspect it */}
      {liveDiagram && (
        <div className="h-80 overflow-hidden rounded-lg border border-neutral-200">
          <ConfigDiagram
            nodes={liveDiagram.nodes}
            edges={liveDiagram.edges}
            affinities={liveDiagram.affinities}
            onNodeClick={(node) =>
              setInspected(node.type === "resolver" ? node : null)
            }
          />
        </div>
      )}

      {/* Resolver inspector (from a diagram click) */}
      {inspected && (
        <ResolverInspector
          node={inspected}
          sharedResolver={resolver}
          parentName={parentName}
          subnames={subnames}
          onClose={() => setInspected(null)}
        />
      )}

      {/* Register form */}
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
        <h3 className="font-medium">Register a subname</h3>
        {registrar && (
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setVia("direct")}
              className={`rounded-full px-3 py-1 ${via === "direct" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
            >
              as owner (free)
            </button>
            <button
              type="button"
              onClick={() => setVia("registrar")}
              className={`rounded-full px-3 py-1 ${via === "registrar" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
            >
              via registrar (paid)
            </button>
          </div>
        )}
        {via === "registrar" && (
          <label className="text-sm">
            Paid action{" "}
            <select
              aria-label="Paid action"
              className="ml-2 rounded border p-2"
              value={paidOperation}
              onChange={(event) =>
                setPaidOperation(event.target.value as "register" | "renew")
              }
            >
              <option value="register">Register a new subname</option>
              <option value="renew">Renew an existing subname</option>
            </select>
          </label>
        )}
        {via === "registrar" && unverifiedPayment && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>
              The previous payment was confirmed, but its result was not
              verified. Check it before paying again.
            </p>
            {failedPayment.txHash && (
              <ExternalLink
                href={etherscanTx(failedPayment.txHash, network.id)}
              >
                View previous payment
              </ExternalLink>
            )}
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={acknowledgePayment}
                onChange={(event) =>
                  setAcknowledgePayment(event.target.checked)
                }
              />
              I checked the previous payment and want to start another paid
              transaction.
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-70">Label</span>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="alice"
                className="w-36 rounded-lg border border-neutral-300 px-3 py-2"
              />
              <span className="text-sm opacity-60">.{parentName}</span>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-70">Owner (default: you)</span>
            <input
              type="text"
              value={ownerInput}
              onChange={(e) => setOwnerInput(e.target.value)}
              placeholder={address}
              className="w-64 rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs"
            />
          </label>
          {!forever && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="opacity-70">Years</span>
              <input
                type="number"
                min="1"
                max="100"
                value={years}
                onChange={(e) =>
                  setYears(Math.max(1, Number(e.target.value || 1)))
                }
                className="w-20 rounded-lg border border-neutral-300 px-3 py-2"
              />
            </label>
          )}
          {via === "direct" && (
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={forever}
                onChange={(e) => setForeverOverride(e.target.checked)}
              />
              never expires
            </label>
          )}
          <button
            type="button"
            onClick={register}
            disabled={!ready || sequence.status === "running"}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {via === "registrar" && paidOperation === "renew"
              ? "Renew"
              : "Register"}
          </button>
        </div>
        {via === "registrar" && (
          <div className="flex items-center gap-3 text-sm">
            <span className="opacity-70">
              Your USDC: {(Number(usdc.balance) / 1e6).toFixed(2)}
            </span>
            {network.canMint && (
              <button
                type="button"
                disabled={!ready || sequence.status === "running"}
                onClick={() =>
                  runPlan(
                    buildFaucetStep({
                      chainId: network.id,
                      account: address,
                      amount: 100_000_000n,
                    }),
                  )
                }
                className="rounded-lg border border-neutral-300 px-3 py-1 hover:border-neutral-600 disabled:opacity-40"
              >
                Faucet: mint 100 USDC
              </button>
            )}
          </div>
        )}
        {formError && <p className="text-sm text-red-700">{formError}</p>}
        {activePlan.length > 0 && (
          <TxStepper
            plan={activePlan}
            steps={sequence.steps}
            error={sequence.error}
            running={sequence.status === "running"}
          />
        )}
      </div>

      {/* Subname list */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Subnames in this registry</h3>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-lg border border-neutral-300 px-3 py-1 text-sm hover:border-neutral-600 disabled:opacity-40"
          >
            ↻ refresh
          </button>
        </div>
        {loading && <p className="text-sm opacity-70">Loading…</p>}
        {!loading && subnames.length === 0 && (
          <p className="text-sm opacity-70">None yet, register one above.</p>
        )}
        <ul className="flex flex-col gap-2">
          {subnames.map((sub) => (
            <li
              key={sub.label}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <NameChip
                  name={fqdn(sub.label, parentName)}
                  href={explorerName(fqdn(sub.label, parentName), network.id)}
                />
                {sub.neverExpires ? (
                  <Badge tone="green">never expires</Badge>
                ) : (
                  <Badge tone={sub.registered ? "green" : "red"}>
                    {sub.registered
                      ? `expires ${formatExpiry(sub.expiry)}`
                      : "expired"}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm">
                {classifyResolver(sub.resolver, resolver) === "foreign" && (
                  <Badge tone="amber">own resolver</Badge>
                )}
                {/* Works for resolver-less subnames too: resolution falls back
                    to the shared resolver, where records are keyed by namehash */}
                {resolver &&
                  classifyResolver(sub.resolver, resolver) !== "foreign" && (
                    <button
                      type="button"
                      onClick={() => setAddrFor(sub.label)}
                      disabled={
                        !canWriteRecords ||
                        !ready ||
                        sequence.status === "running"
                      }
                      className="underline decoration-dotted underline-offset-2 disabled:opacity-40"
                    >
                      set my address
                    </button>
                  )}
                {sub.owner.toLowerCase() === address.toLowerCase() &&
                  classifyResolver(sub.resolver, resolver) !== "foreign" && (
                    <button
                      type="button"
                      onClick={() => switchResolverFor(sub.label)}
                      disabled={!ready || sequence.status === "running"}
                      className="underline decoration-dotted underline-offset-2 disabled:opacity-40"
                      title="Deploy a resolver owned by this subname's owner and point the subname at it"
                    >
                      switch to own resolver
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => resolveCheck(sub.label)}
                  className="underline decoration-dotted underline-offset-2"
                >
                  resolve check
                </button>
                <ExternalLink
                  href={explorerName(fqdn(sub.label, parentName), network.id)}
                >
                  explorer
                </ExternalLink>
              </div>
              {resolveResults[sub.label] && (
                <p className="w-full text-xs">
                  resolves to:{" "}
                  <code className="font-mono">{resolveResults[sub.label]}</code>
                  {resolveResults[sub.label].toLowerCase() ===
                    address.toLowerCase() && " ✓"}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Renew via registrar */}
      {registrar && (
        <p className="text-xs opacity-60">
          Renewals: choose "via registrar", select "Renew an existing subname",
          and enter its label to extend it, or ask the owner to renew directly.
          Registry status refreshes with ↻.
        </p>
      )}

      <p className="text-xs opacity-60">
        Tip: to try a different configuration on {parentName}, scroll up to
        "Current setup" and choose "Replace with a new setup". Old registries
        keep their subnames and can be re-adopted later.
      </p>
      {nameStatus.hasSubregistry &&
        registry &&
        nameStatus.subregistry?.toLowerCase() !== registry.toLowerCase() && (
          <p className="text-sm text-amber-800">
            Heads up: {parentName} currently points at a different registry than
            this session's. Re-run the link step or adopt the on-chain one.
          </p>
        )}
    </div>
  );
}

/** Detail card for a resolver node clicked in the diagram. */
function ResolverInspector({
  node,
  sharedResolver,
  parentName,
  subnames,
  onClose,
}: {
  node: DiagramNode;
  sharedResolver?: Address;
  parentName: string;
  subnames: Subname[];
  onClose: () => void;
}) {
  const network = useDeployment();
  const isShared = node.id === "resolver";
  const isOverflow = node.id === "resolver-more";
  const addr = isShared
    ? sharedResolver
    : node.id.startsWith("resolver-0x")
      ? (node.id.slice("resolver-".length) as Address)
      : undefined;

  // The shared resolver also serves subnames with no resolver of their own:
  // resolution falls back to the nearest ancestor resolver (findResolver).
  const servedSubnames = addr
    ? subnames.filter(
        (s) =>
          s.registered &&
          (isShared
            ? classifyResolver(s.resolver, addr) !== "foreign"
            : s.resolver.toLowerCase() === addr.toLowerCase()),
      )
    : [];
  // The shared node only exists because the parent points at it.
  const servesParent = isShared && Boolean(sharedResolver);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ens-border bg-ens-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          Resolver {addr && <AddressLink address={addr} />}
          {isShared ? (
            <Badge tone="green">shared (parent's resolver)</Badge>
          ) : (
            <Badge tone="amber">own resolver</Badge>
          )}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-sm opacity-60 hover:opacity-100"
        >
          ✕ close
        </button>
      </div>
      {isOverflow ? (
        <p className="text-sm opacity-70">
          Several subnames use their own distinct resolvers; see the badges in
          the subname list below.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="opacity-60">serves:</span>
          {servesParent && (
            <NameChip
              name={parentName}
              href={explorerName(parentName, network.id)}
            />
          )}
          {servedSubnames.map((s) => (
            <NameChip
              key={s.label}
              name={fqdn(s.label, parentName)}
              href={explorerName(fqdn(s.label, parentName), network.id)}
            />
          ))}
          {!servesParent && servedSubnames.length === 0 && (
            <span className="opacity-60">no names currently</span>
          )}
        </div>
      )}
      {isShared && (
        <p className="text-xs opacity-60">
          This is whatever resolver the parent name points at on the .eth
          registry. Subnames registered through this app use it by default; a
          subname can switch to its own resolver at any time.
        </p>
      )}
    </div>
  );
}
