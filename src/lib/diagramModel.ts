/**
 * Maps a subregistry setup onto the diagram builder's node/edge model
 * (read-only visualization). Layout is deterministic: fixed columns,
 * rows derived from content, so snapshots are stable.
 */

import { isAddress } from "viem";
import type { DiagramEdge, DiagramNode, DiagramState } from "../diagram/types";
import type { Preset } from "./presets";
import { decomposeBitmap } from "./roles";

export type SetupView = {
  parentName: string; // e.g. "nick.eth"
  parentOwner?: string;
  parentNote?: string;
  inheritedResolver?: string;
  resolverAncestor?: string;
  /** A labelled configuration schematic, never on-chain state. */
  illustrative?: boolean;
  /** Real address, or a short placeholder like "new" for planned contracts. */
  userRegistry?: string;
  registrar?: string;
  /** The shared/default resolver: what the parent name points at (zero/undefined = none). */
  resolver?: string;
  /** Roles the registrar holds on the registry root. */
  registrarRoles?: bigint;
  /** True once dangerous root roles were revoked. */
  locked?: boolean;
  /** Verified direct record ids per resolver and name; empty name is the default record. */
  resolverRecords?: Record<string, Record<string, string | null>>;
  /** Verified names from resolver history, independent of registry labels. */
  resolverNames?: string[];
  subnames?: {
    label: string;
    ownerLabel?: string;
    status?: "reserved";
    neverExpires?: boolean;
    childRegistry?: boolean;
    /** The subname's own resolver pointer (undefined/zero = none). */
    resolver?: string;
  }[];
};

const ZERO = "0x0000000000000000000000000000000000000000";

export type ResolverKind = "default" | "foreign" | "none";

/** Classify a subname's resolver relative to the setup's shared resolver. */
export function classifyResolver(
  subResolver?: string,
  defaultResolver?: string,
): ResolverKind {
  const res = subResolver?.toLowerCase();
  if (!res || res === ZERO) return "none";
  if (defaultResolver && res === defaultResolver.toLowerCase())
    return "default";
  return "foreign";
}

/** Distinct foreign resolvers get their own node, capped to keep layouts sane. */
export const MAX_FOREIGN_RESOLVER_NODES = 4;

/** Real addresses render shortened; anything else (e.g. "new") renders as-is. */
function displayAddr(value?: string): string {
  if (!value) return "";
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
  return value;
}

/** Contract boundaries contain local token labels or fully qualified resolver names. */
export function toDiagram(setup: SetupView): DiagramState {
  const subnames = setup.subnames ?? [];
  const parentWidth = Math.max(
    200,
    Math.min(680, setup.parentName.length * 9.5 + 48),
  );
  const registryX = parentWidth + 110;
  const tokenSubtitle = (sub: NonNullable<SetupView["subnames"]>[number]) => {
    const text =
      sub.status === "reserved"
        ? "reserved label"
        : setup.illustrative
          ? `token · owned by ${sub.ownerLabel ?? sub.label}${sub.neverExpires ? " · never expires" : ""}`
          : classifyResolver(sub.resolver, setup.resolver) === "none"
            ? "inherits ancestor resolver"
            : "subname token";
    return `${text}${sub.childRegistry ? " · child registry ↳" : ""}`;
  };
  const registryWidth = Math.max(
    260,
    Math.min(
      560,
      Math.max(
        0,
        ...subnames.map((sub) =>
          Math.max(
            (sub.label.length + (sub.neverExpires ? 2 : 0)) * 9 + 96,
            tokenSubtitle(sub).length * 6 + 72,
          ),
        ),
      ),
    ),
  );
  const resolverX =
    setup.userRegistry && subnames.length
      ? registryX + registryWidth + 100
      : parentWidth + 100;
  const nodes: DiagramNode[] = [
    {
      id: "parent",
      type: "registry",
      position: { x: 0, y: 0 },
      style: { width: parentWidth },
      data: {
        label: setup.parentName,
        subtitle: setup.parentNote ?? "your parent name",
      },
    },
  ];
  const edges: DiagramEdge[] = [];
  const affinities: Record<string, string[]> = {};
  const relate = (a: string, b: string) => {
    (affinities[a] ??= []).push(b);
    (affinities[b] ??= []).push(a);
  };
  const subs = setup.subnames ?? [];
  const hasRegistry = Boolean(setup.userRegistry && subs.length);
  if (hasRegistry) {
    nodes.push({
      id: "user-registry",
      type: "group",
      position: { x: registryX, y: 0 },
      style: {
        width: registryWidth,
        height: Math.max(155, subs.length * 90 + 75),
        background: "transparent",
        border: "none",
        padding: 0,
      },
      data: {
        label: setup.illustrative
          ? "USERREGISTRY · EXAMPLE"
          : setup.locked
            ? "USERREGISTRY · LOCKED"
            : "USERREGISTRY CONTRACT",
        subtitle: displayAddr(setup.userRegistry),
        inspection:
          !setup.illustrative &&
          isAddress(setup.userRegistry!, { strict: false })
            ? { kind: "registry", address: setup.userRegistry as `0x${string}` }
            : undefined,
      },
    });
    edges.push({
      id: "e-parent-registry",
      source: "parent",
      sourceHandle: "right",
      target: "user-registry",
      targetHandle: "left",
      label: "subregistry",
    });
    subs.forEach((sub, index) => {
      nodes.push({
        id: `sub-${sub.label}`,
        type: "action",
        parentId: "user-registry",
        extent: "parent",
        position: { x: 24, y: 65 + index * 90 },
        style: { width: registryWidth - 48 },
        data: {
          label: `${sub.label}${sub.neverExpires ? " ∞" : ""}`,
          note: tokenSubtitle(sub),
          inspection:
            !setup.illustrative &&
            isAddress(setup.userRegistry!, { strict: false })
              ? {
                  kind: "label",
                  registry: setup.userRegistry as `0x${string}`,
                  label: sub.label,
                }
              : undefined,
        },
      });
      relate("user-registry", `sub-${sub.label}`);
    });
  }
  if (setup.registrar && hasRegistry) {
    nodes.push({
      id: "registrar",
      type: "gateway",
      position: { x: registryX + registryWidth / 2 - 56, y: -160 },
      data: {
        label: "REGISTRAR",
        id: setup.illustrative ? "example" : displayAddr(setup.registrar),
      },
    });
    const roles = setup.registrarRoles
      ? decomposeBitmap(setup.registrarRoles)
          .filter((r) => !r.isAdmin)
          .map((r) => r.short)
          .join(" + ")
      : undefined;
    edges.push({
      id: "e-registrar-registry",
      source: "registrar",
      target: "user-registry",
      targetHandle: "top",
      label: roles,
    });
  }

  const isUsableResolver = (address?: string): address is string =>
    Boolean(
      address &&
      address.toLowerCase() !== ZERO &&
      (setup.illustrative || isAddress(address, { strict: false })),
    );
  const candidate = setup.resolver ?? setup.inheritedResolver;
  const shared = isUsableResolver(candidate) ? candidate : undefined;
  const hasExplicitSharedPointer =
    hasRegistry &&
    subs.some(
      (sub) =>
        isUsableResolver(sub.resolver) &&
        classifyResolver(sub.resolver, shared) === "default",
    );
  const served = new Map<
    string,
    { address: string; names: string[]; shared: boolean }
  >();
  if (shared)
    served.set(shared.toLowerCase(), {
      address: shared,
      names: setup.illustrative
        ? []
        : [...new Set([setup.parentName, ...(setup.resolverNames ?? [])])],
      shared: true,
    });
  const foreignIds = new Map<string, string>();
  const overflow = new Set<string>();
  for (const sub of hasRegistry ? subs : []) {
    const kind = classifyResolver(sub.resolver, shared);
    const address = kind === "foreign" ? sub.resolver! : shared;
    if (!isUsableResolver(address)) continue;
    const key = address.toLowerCase();
    if (!served.has(key)) {
      if (foreignIds.size >= MAX_FOREIGN_RESOLVER_NODES) {
        overflow.add(key);
        continue;
      }
      foreignIds.set(key, `resolver-${key}`);
      served.set(key, { address, names: [], shared: false });
    }
    served.get(key)!.names.push(`${sub.label}.${setup.parentName}`);
  }
  let nextY = 0;
  for (const [key, group] of served) {
    const id = group.shared ? "resolver" : foreignIds.get(key)!;
    const records = setup.resolverRecords?.[key];
    const defaultId = records?.[""];
    const hasVerifiedRecords = Object.values(records ?? {}).some(
      (record) => record && record !== "0",
    );
    // A live pointer and its served name remain visible before any records exist.
    // Keep unrelated empty shared frames out of the initial parent-only view.
    if (
      !setup.illustrative &&
      group.shared &&
      !hasExplicitSharedPointer &&
      !hasVerifiedRecords &&
      !setup.resolverNames?.length
    )
      continue;
    const nameWidth = Math.max(
      260,
      Math.min(
        640,
        Math.max(0, ...group.names.map((name) => name.length)) * 9 + 24,
      ),
    );
    const width = nameWidth + 40;
    const height = Math.max(group.names.length, 1) * 90 + 75;
    nodes.push({
      id,
      type: "resolver",
      position: { x: resolverX, y: nextY },
      style: { width, height },
      data: {
        label: setup.illustrative
          ? "RESOLVER · EXAMPLE"
          : group.shared
            ? "RESOLVER CONTRACT"
            : "OWN RESOLVER CONTRACT",
        address: displayAddr(group.address),
        inspection: !setup.illustrative
          ? { kind: "resolver", address: group.address as `0x${string}` }
          : undefined,
        foreign: !group.shared,
        note: setup.illustrative
          ? "Full names"
          : hasVerifiedRecords
            ? "Known names only · record fields not enumerated"
            : "Linked names · no record data verified",
      },
    });
    nextY += height + 48;
    group.names.forEach((name, index) => {
      const direct = records?.[name];
      const fallback =
        direct === "0" && Boolean(defaultId && defaultId !== "0");
      const nameId = `${id}-name-${index}`;
      nodes.push({
        id: nameId,
        type: "action",
        parentId: id,
        extent: "parent",
        position: { x: 20, y: 78 + index * 90 },
        style: { width: nameWidth },
        data: {
          label: name,
          inspection: !setup.illustrative
            ? { kind: "name", resolver: group.address as `0x${string}`, name }
            : undefined,
          note: setup.illustrative
            ? undefined
            : direct === null
              ? "record lookup unavailable"
              : setup.resolverNames?.includes(name)
                ? "resolver-linked name"
                : direct === undefined
                  ? "record link not read yet"
                  : direct === "0"
                    ? fallback
                      ? "uses default record"
                      : "no direct record link"
                    : "name link",
        },
      });
      relate(id, nameId);
    });
    if (group.shared) {
      edges.push({
        id: "e-parent-resolver",
        source: "parent",
        sourceHandle: "right",
        target: id,
        targetHandle: "top",
        ...(setup.inheritedResolver && !setup.resolver
          ? { style: { strokeDasharray: "5 4" }, label: "ancestor resolver" }
          : {}),
        // The destination identifies this pointer; avoid crossing the registrar roles label.
        type: "smoothstep",
      });
      relate(id, "parent");
    }
  }
  if (overflow.size)
    nodes.push({
      id: "resolver-more",
      type: "action",
      position: { x: resolverX, y: nextY },
      data: {
        label: `+${overflow.size} more resolvers`,
        note: "See each address in the subname list",
      },
    });
  if (hasRegistry)
    for (const sub of subs) {
      const kind = classifyResolver(sub.resolver, shared);
      const target =
        kind === "foreign"
          ? (foreignIds.get(sub.resolver!.toLowerCase()) ??
            (overflow.has(sub.resolver!.toLowerCase())
              ? "resolver-more"
              : undefined))
          : shared
            ? "resolver"
            : undefined;
      if (!target) continue;
      edges.push({
        id: `e-sub-${sub.label}-resolver`,
        source: `sub-${sub.label}`,
        sourceHandle: "right",
        target,
        targetHandle: "left",
        label: kind === "none" ? undefined : "resolver",
        ...(kind === "none" ? { style: { strokeDasharray: "5 4" } } : {}),
      });
      relate(target, `sub-${sub.label}`);
    }
  const visible = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: edges.filter(
      (edge) => visible.has(edge.source) && visible.has(edge.target),
    ),
    affinities: Object.fromEntries(
      Object.entries(affinities)
        .filter(([id]) => visible.has(id))
        .map(([id, related]) => [
          id,
          related.filter((other) => visible.has(other)),
        ]),
    ),
  };
}

/** Only the review uses this hypothetical example. No real addresses or records. */
export function buildConfigurationExample(
  parentName: string,
  preset: Preset,
  resolverMode: "new" | "existing" | "none",
): SetupView {
  const resolver =
    resolverMode === "none"
      ? undefined
      : resolverMode === "new"
        ? "new resolver"
        : "your existing resolver";
  return {
    illustrative: true,
    parentName,
    userRegistry: "new registry",
    resolver,
    registrar: preset.registrar ? "new registrar" : undefined,
    registrarRoles: preset.registrar?.grantBitmap,
    subnames: [
      {
        label: "alice",
        ownerLabel: "Alice",
        resolver,
        neverExpires: preset.subnameDefaults.expiry === "max",
      },
      {
        label: "bob",
        ownerLabel: "Bob",
        resolver,
        neverExpires: preset.subnameDefaults.expiry === "max",
      },
    ],
  };
}
