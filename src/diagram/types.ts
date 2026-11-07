/**
 * Diagram builder: type definitions for flow nodes and edges.
 * Supports: root, action, gateway (diamond), registry (oval), group (dotted box).
 * Edges support optional `label` for step/action text (e.g. "2. UPLOAD", "resolve name").
 */

import type { Node, Edge } from "@xyflow/react";

export type InspectionTarget =
  | { kind: "registry"; address: `0x${string}` }
  | { kind: "label"; registry: `0x${string}`; label: string }
  | { kind: "resolver"; address: `0x${string}` }
  | { kind: "name"; resolver: `0x${string}`; name: string };

type Inspectable = { inspection?: InspectionTarget };

/** Blue = domain/root nodes, brown = resolver nodes (Figma) */
export type DiagramVariant = "blue" | "brown";

export type RootNodeData = {
  label?: string;
  owner?: string; // e.g. "0x0123..."
  variant?: DiagramVariant;
};

export type ActionNodeData = Inspectable & {
  example?: boolean;
  label: string; // e.g. "eth", "montoya.eth"
  note?: string;
  variant?: DiagramVariant;
};

export type GatewayNodeData = {
  label: string; // e.g. "REPLACEABLE GATEWAY"
  id?: string; // e.g. "eth.limo"
};

export type RegistryNodeData = {
  example?: boolean;
  label: string; // e.g. "ONCHAIN NAME REGISTRY"
  subtitle?: string; // e.g. "ENS"
};

export type GroupNodeData = Inspectable & {
  label: string;
  subtitle?: string;
};

/** Contract boundary containing fully qualified name entries. */
export type ResolverNodeData = Inspectable & {
  label: string; // e.g. "Resolver 1"
  address?: string;
  note?: string;
  foreign?: boolean;
};

export type DiagramNode =
  | Node<RootNodeData, "root">
  | Node<ActionNodeData, "action">
  | Node<GatewayNodeData, "gateway">
  | Node<RegistryNodeData, "registry">
  | Node<GroupNodeData, "group">
  | Node<ResolverNodeData, "resolver">;
export type DiagramEdge = Edge;

export type DiagramState = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /**
   * Semantic relations that aren't drawn as edges (node id -> related node
   * ids, symmetric). Hover highlighting unions these with edge adjacency,
   * e.g. a shared resolver serves subnames it has no direct edge to.
   */
  affinities?: Record<string, string[]>;
};
