/** Compact, native-size routing diagram. The graph never scales its hit targets. */
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { DiagramEdge, DiagramNode, InspectionTarget } from "./types";

type Route = {
  id: string;
  path: string;
  label?: string;
  x: number;
  y: number;
  dashed: boolean;
  active: boolean;
};
export const inspectionKey = (target?: InspectionTarget) =>
  target ? JSON.stringify(target) : "";

export function ConfigDiagram({
  nodes,
  edges,
  selected,
  onInspect,
  inspectorId = "diagram-inspector",
}: {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  affinities?: Record<string, string[]>;
  selected?: InspectionTarget;
  inspectorId?: string;
  onInspect?: (target: InspectionTarget, opener: HTMLButtonElement) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const parent = nodes.find((node) => node.id === "parent");
  const registry = nodes.find((node) => node.id === "user-registry");
  const registrar = nodes.find((node) => node.id === "registrar");
  const resolvers = nodes.filter((node) => node.type === "resolver");
  const overflow = nodes.find((node) => node.id === "resolver-more");
  const rows = (id: string) => nodes.filter((node) => node.parentId === id);
  const selectedNode = nodes.find(
    (node) =>
      "inspection" in node.data &&
      inspectionKey(node.data.inspection) === inspectionKey(selected) &&
      selected,
  );
  const layoutKey = JSON.stringify(nodes.map((node) => [node.id, node.data]));
  const edgeKey = JSON.stringify(edges);

  useLayoutEffect(() => {
    const root = stage.current;
    if (!root) return;
    const update = () => {
      const bounds = root.getBoundingClientRect();
      if (!bounds.width) return;
      const lookup = new Map(
        [...root.querySelectorAll<HTMLElement>("[data-diagram-id]")].map(
          (element) => [element.dataset.diagramId!, element],
        ),
      );
      const box = (id: string) => {
        const rect = lookup.get(id)?.getBoundingClientRect();
        return rect
          ? {
              x: rect.left - bounds.left,
              y: rect.top - bounds.top,
              width: rect.width,
              height: rect.height,
            }
          : undefined;
      };
      const mobile =
        getComputedStyle(root).gridTemplateColumns.split(" ").length === 3;
      const result: Route[] = [];
      for (const edge of edges) {
        const source = box(edge.source),
          target = box(edge.target);
        if (!source || !target) continue;
        let x1 = source.x + source.width,
          y1 = source.y + source.height / 2;
        let x2 = target.x,
          y2 = target.y + target.height / 2;
        let path: string;
        let label: string | undefined;
        if (edge.id === "e-parent-resolver") {
          x1 = source.x + source.width / 2;
          y1 = source.y;
          x2 = target.x + target.width / 2;
          y2 = target.y;
          path = mobile
            ? `M${x2} ${source.y + source.height} V${y2}`
            : `M${x1} ${y1} V8 H${x2} V${y2}`;
          label = mobile
            ? undefined
            : edge.label === "ancestor resolver"
              ? "ancestor resolver"
              : "parent resolver";
        } else if (edge.id === "e-registrar-registry") {
          x1 = source.x + source.width / 2;
          y1 = source.y + source.height;
          x2 = target.x + target.width / 2;
          y2 = target.y;
          path = `M${x1} ${y1} V${y2}`;
        } else if (edge.id === "e-parent-registry" && mobile) {
          x1 = target.x + target.width / 2;
          y1 = source.y + source.height;
          x2 = x1;
          y2 = target.y;
          path = `M${x1} ${y1} V${y2}`;
          label = "subregistry";
        } else {
          if (edge.source.startsWith("sub-")) {
            const nameRow = nodes.find(
              (node) =>
                node.parentId === edge.target &&
                node.data.label ===
                  `${edge.source.slice(4)}.${parent?.data.label}`,
            );
            const row = nameRow && box(nameRow.id);
            if (row) y2 = row.y + row.height / 2;
          }
          const middle = (x1 + x2) / 2;
          path = `M${x1} ${y1} H${middle} V${y2} H${x2}`;
          label = edge.id === "e-parent-registry" ? "subregistry" : undefined;
        }
        result.push({
          id: edge.id,
          path,
          label,
          x: (x1 + x2) / 2,
          y: edge.id === "e-parent-resolver" ? 8 : (y1 + y2) / 2,
          dashed:
            edge.id === "e-parent-registry" ||
            Boolean(edge.style?.strokeDasharray),
          active: Boolean(
            selectedNode &&
              (edge.source === selectedNode.id ||
                edge.target === selectedNode.id ||
                selectedNode.parentId === edge.target),
          ),
        });
      }
      setRoutes((previous) =>
        JSON.stringify(previous) === JSON.stringify(result) ? previous : result,
      );
    };
    update();
    let frame = 0;
    let disposed = false;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!disposed) update();
      });
    };
    const observer = new ResizeObserver(schedule);
    void document.fonts?.ready.then(() => {
      if (!disposed) schedule();
    });
    observer.observe(root);
    root
      .querySelectorAll<HTMLElement>("[data-diagram-id]")
      .forEach((element) => observer.observe(element));
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [layoutKey, edgeKey, nodes, edges, selectedNode, parent?.data.label]);

  const hit = (node: DiagramNode, header = false) => {
    const target = "inspection" in node.data ? node.data.inspection : undefined;
    const interactive = Boolean(target && onInspect);
    const active = Boolean(
      target && inspectionKey(target) === inspectionKey(selected),
    );
    const content = (
      <>
        <span className="compact-hit-text">
          <span className={interactive ? "compact-under" : ""}>
            {node.data.label}
          </span>
          {!header && "note" in node.data && node.data.note && (
            <span className="compact-row-note">{node.data.note}</span>
          )}
          {header && (
            <span className="compact-address">
              {"address" in node.data
                ? node.data.address
                : "subtitle" in node.data
                  ? node.data.subtitle
                  : ""}
            </span>
          )}
        </span>
        {interactive && (
          <span className="compact-chevron" aria-hidden>
            {header ? "Inspect ›" : "›"}
          </span>
        )}
      </>
    );
    const props = {
      "data-diagram-id": header ? undefined : node.id,
      className: `compact-hit ${header ? "compact-header" : "compact-name"} ${active ? "compact-selected" : ""}`,
      title: String(node.data.label),
    };
    return interactive ? (
      <button
        {...props}
        type="button"
        aria-label={`Inspect ${target!.kind === "label" ? "registry label" : target!.kind === "name" ? "records for" : target!.kind} ${target!.kind === "label" ? target!.label : target!.kind === "name" ? target!.name : target!.address}`}
        aria-expanded={active}
        aria-controls={inspectorId}
        onClick={(event) => onInspect!(target!, event.currentTarget)}
      >
        {content}
      </button>
    ) : (
      <div {...props}>{content}</div>
    );
  };

  const contract = (node: DiagramNode) => (
    <div key={node.id} data-diagram-id={node.id} className="compact-contract">
      {hit(node, true)}
      {rows(node.id).map((row) => (
        <Fragment key={row.id}>{hit(row)}</Fragment>
      ))}
    </div>
  );

  return (
    <div className="diagram-canvas compact-canvas">
      <div
        ref={stage}
        className={`compact-stage ${registry ? "" : "compact-no-registry"}`}
      >
        <svg className="compact-routes" aria-hidden>
          {routes.map((route) => (
            <g key={route.id}>
              <path
                d={route.path}
                strokeDasharray={route.dashed ? "4 3" : undefined}
                style={
                  { strokeWidth: route.active ? 2.3 : 1.3 } as CSSProperties
                }
              />
              {route.label && (
                <>
                  <rect
                    x={route.x - (route.label === "subregistry" ? 34 : 49)}
                    y={route.y - 7}
                    width={route.label === "subregistry" ? 68 : 98}
                    height={15}
                    rx={3}
                  />
                  <text x={route.x} y={route.y + 3} textAnchor="middle">
                    {route.label}
                  </text>
                </>
              )}
            </g>
          ))}
        </svg>
        {parent && (
          <div data-diagram-id={parent.id} className="compact-parent">
            <strong>{parent.data.label}</strong>
            <span>
              {"subtitle" in parent.data ? parent.data.subtitle : "parent name"}
            </span>
          </div>
        )}
        <div className="compact-registry-column">
          {registrar && (
            <div
              data-diagram-id="registrar"
              className="compact-registrar"
              title={String(
                edges.find((edge) => edge.id === "e-registrar-registry")
                  ?.label ?? "",
              )}
            >
              <strong>{registrar.data.label}</strong>
              <span>{"id" in registrar.data ? registrar.data.id : ""}</span>
            </div>
          )}
          {registry && contract(registry)}
        </div>
        <div className="compact-resolver-column">
          {resolvers.map(contract)}
          {overflow && (
            <p data-diagram-id="resolver-more" className="compact-overflow">
              {overflow.data.label}
              <br />
              <span>Inspect a label to see its resolver.</span>
            </p>
          )}
        </div>
      </div>
      {onInspect && (
        <p className="compact-legend">
          <span className="compact-under">Names</span> and “Inspect” headers
          open details.
        </p>
      )}
    </div>
  );
}
