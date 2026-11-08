/**
 * Filled corner sockets on a node frame (ENS Diagram System: small squares
 * with a slight radius, lapis/900 in protocol mode).
 */

import { memo } from "react";
import type { DiagramVariant } from "../types";

const socketClass =
  "absolute w-1.5 h-1.5 rounded-[2px] pointer-events-none bg-[var(--diagram-socket)]";
const cornerPos = "translate-x-[-3px] translate-y-[-3px]";

function CornerMarkers(props: { variant?: DiagramVariant }) {
  return (
    <span data-variant={props.variant ?? "blue"}>
      <span className={`${socketClass} top-0 left-0 ${cornerPos}`} />
      <span className={`${socketClass} top-0 right-0 ${cornerPos}`} />
      <span className={`${socketClass} bottom-0 right-0 ${cornerPos}`} />
      <span className={`${socketClass} bottom-0 left-0 ${cornerPos}`} />
    </span>
  );
}

export default memo(CornerMarkers);
