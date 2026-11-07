/** Dashed contract enclosure; tokens are child nodes. */
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { GroupNodeData } from "../types";
export type GroupNodeType = Node<GroupNodeData, "group">;
const handleClass =
  "!w-2 !h-2 !border-2 !bg-[var(--diagram-paper)] !border-[var(--diagram-stroke)]";
function GroupNode({ data }: NodeProps<GroupNodeType>) {
  return (
    <div className="diagram-contract relative h-full w-full rounded-2xl border-[1.5px] border-dashed border-[var(--diagram-stroke)] text-[var(--diagram-ink)]">
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
      <span className="diagram-semimono absolute -top-2.5 left-4 bg-[var(--diagram-paper)] px-2 text-xs font-medium tracking-wider text-[var(--diagram-stroke)]">
        {data.label}
      </span>
      {data.subtitle && (
        <p className="diagram-semimono px-6 pt-5 text-xs opacity-75">
          contract: {data.subtitle}
        </p>
      )}
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
export default memo(GroupNode);
