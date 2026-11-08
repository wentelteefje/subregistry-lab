import type { ReactNode } from "react";

export type WorkspaceView = "deployment" | "playground" | "inspect";

/** Keep view contents mounted: leaving a view must not cancel a transaction. */
export function WorkspaceLayout({
  view,
  onNavigate,
  playgroundReady,
  deploymentStatus,
  playgroundStatus,
  context,
  pending,
  deployment,
  playground,
  inspection,
}: {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  playgroundReady: boolean;
  deploymentStatus: string;
  playgroundStatus: string;
  context?: ReactNode;
  pending?: ReactNode;
  deployment: ReactNode;
  playground: ReactNode;
  inspection?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
      <aside className="min-w-0 lg:sticky lg:top-6">
        {context && <div className="mb-4 min-w-0 text-sm">{context}</div>}
        <nav
          aria-label="Lab workspace"
          className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1"
        >
          {(
            [
              ["deployment", "Deployment & configuration", deploymentStatus],
              ["playground", "Playground", playgroundStatus],
              ["inspect", "Inspect a name", "Read-only · Any parent"],
            ] as const
          ).map(([id, label, status]) => (
            <button
              key={id}
              type="button"
              id={`${id}-navigation`}
              aria-current={view === id ? "page" : undefined}
              aria-controls={`${id}-view`}
              disabled={id === "playground" && !playgroundReady && view !== id}
              onClick={() => onNavigate(id)}
              className={`rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ens-blue disabled:cursor-not-allowed disabled:opacity-50 ${
                view === id
                  ? "border-ens-blue bg-ens-blue-fill text-ens-fg"
                  : "border-ens-border bg-white hover:bg-ens-card"
              }`}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span
                className="mt-1 block text-xs text-ens-muted"
                aria-live="polite"
              >
                {status}
              </span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 max-w-[58rem]">
        {pending}
        <div
          id="deployment-view"
          aria-labelledby="deployment-navigation"
          hidden={view !== "deployment"}
        >
          <div className="flex min-w-0 flex-col gap-6">{deployment}</div>
        </div>
        <div
          id="playground-view"
          aria-labelledby="playground-navigation"
          hidden={view !== "playground"}
        >
          <div className="flex min-w-0 flex-col gap-6">{playground}</div>
        </div>
        <div
          id="inspect-view"
          aria-labelledby="inspect-navigation"
          hidden={view !== "inspect"}
        >
          <div className="flex min-w-0 flex-col gap-6">{inspection}</div>
        </div>
      </main>
    </div>
  );
}
