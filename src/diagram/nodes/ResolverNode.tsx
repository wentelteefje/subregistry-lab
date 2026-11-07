/** Resolver contract frame. Children show fully qualified names. */
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ResolverNodeData } from "../types";
export type ResolverNodeType = Node<ResolverNodeData, "resolver">;
const handleClass =
  "!w-2 !h-2 !border-2 !bg-[var(--diagram-paper)] !border-[var(--diagram-stroke)]";
function ResolverNode({ data }: NodeProps<ResolverNodeType>) {
  return (
    <div
      className="diagram-resolver relative h-full w-full rounded-2xl border-[1.5px] border-dashed border-[var(--diagram-stroke)] text-[var(--diagram-ink)]"
      style={{
        background: data.foreign ? "rgba(255,255,255,0.12)" : "transparent",
      }}
    >
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        className={handleClass}
      />
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        className={handleClass}
      />
      <div className="diagram-semimono absolute -top-2.5 left-4 bg-[var(--diagram-paper)] px-2 text-xs font-medium tracking-wider text-[var(--diagram-stroke)]">
        {data.label}
      </div>
      {data.address && (
        <div className="diagram-semimono px-6 pt-5 text-xs opacity-75">
          contract: {data.address}
        </div>
      )}
      <div className="diagram-semimono absolute bottom-3 left-6 text-[10px] opacity-65">
        {data.note}
      </div>
    </div>
  );
}
export default memo(ResolverNode);
