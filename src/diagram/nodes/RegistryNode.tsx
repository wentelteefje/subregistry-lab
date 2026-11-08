/**
 * Registry node: ENS Diagram System registry frame — double outline
 * (outer + inner stroke in lapis/500), Semi-Mono title, on the lapis field.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import type { RegistryNodeData } from "../types";

export type RegistryNodeType = Node<RegistryNodeData, "registry">;

const handleClass =
  "!w-2 !h-2 !border-2 !bg-[var(--diagram-paper)] !border-[var(--diagram-stroke)]";

function RegistryNode({ data, selected }: NodeProps<RegistryNodeType>) {
  return (
    <div
      className={`
        diagram-registry relative min-w-[150px] rounded-[14px] border-[1.5px] p-1
        border-[var(--diagram-stroke)] bg-[var(--diagram-paper)]
        ${selected ? "ring-2 ring-[var(--diagram-stroke)] ring-offset-2 ring-offset-[var(--diagram-paper)]" : ""}
      `}
    >
      {/* Named handles on all four sides so edges can route without detours. */}
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
      <div className="rounded-[10px] border-[1.5px] border-[var(--diagram-stroke)] px-4 py-2.5 text-[var(--diagram-ink)]">
        <div title={data.label} className="diagram-semimono truncate font-medium text-[var(--diagram-font-main)] leading-tight">
          {data.label}
          {data.example && (
            <span className="ml-2 rounded border border-[var(--diagram-stroke)] px-1 text-[9px] font-normal align-middle">
              example
            </span>
          )}
        </div>
        {data.subtitle != null && data.subtitle !== "" && (
          <div title={data.subtitle} className="diagram-semimono truncate text-[var(--diagram-font-sub)] font-normal opacity-75 mt-0.5">
            {data.subtitle}
          </div>
        )}
      </div>
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className={handleClass}
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        className={handleClass}
      />
    </div>
  );
}

export default memo(RegistryNode);
