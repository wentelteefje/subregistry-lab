/**
 * Action node: plain name label without pill chrome (ENS Diagram System
 * protocol mode) — Marist serif, lapis/900 ink, sits directly on the field.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import type { ActionNodeData } from "../types";

export type ActionNodeType = Node<ActionNodeData, "action">;

const handleClass =
  "!w-2 !h-2 !border-2 !bg-[var(--diagram-paper)] !border-[var(--diagram-stroke)]";

function ActionNode({ data, selected }: NodeProps<ActionNodeType>) {
  return (
    <div
      className={`
        diagram-action relative whitespace-nowrap rounded-md px-3 py-1.5
        bg-[var(--diagram-paper)] text-[var(--diagram-ink)]
        ${selected ? "ring-2 ring-[var(--diagram-stroke)] ring-offset-2 ring-offset-[var(--diagram-paper)]" : ""}
      `}
    >
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        className={handleClass}
      />
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        className={handleClass}
      />
      <span title={data.label} className="diagram-marist block truncate text-[var(--diagram-font-main)]">
        {data.label}
        {data.example && (
          <span className="diagram-semimono ml-2 text-[9px] opacity-70">
            example
          </span>
        )}
      </span>
      {data.note && (
        <div className="diagram-semimono mt-1 text-[10px] opacity-65">
          {data.note}
        </div>
      )}
      <Handle id="right" type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

export default memo(ActionNode);
