import { PendingTransactions } from "../components/PendingTransactions";
import { useDeployment } from "../hooks/useDeployment";
import {
  InspectPanel,
  type InspectionFormState,
} from "../components/InspectPanel";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  WorkspaceLayout,
  type WorkspaceView,
} from "../components/WorkspaceLayout";
import { useSessionActivity } from "../hooks/useSessionActivity";
import { hasStartedSetup } from "../state/labSession";
import {
  DeploymentDetails,
  savedSetupRegistry,
} from "../components/DeploymentDetails";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { ChainGuard, useIsReady } from "../components/ChainGuard";
import { ExperimentalNotice } from "../components/ExperimentalNotice";
import { EnsMarkLogo } from "../components/EnsMarkLogo";
import { ConfigurePanel } from "../components/ConfigurePanel";
import { LockPanel } from "../components/LockPanel";
import { NamePicker } from "../components/NamePicker";
import { PlaygroundPanel } from "../components/PlaygroundPanel";
import { ReviewPanel } from "../components/ReviewPanel";
import { SetupInspector } from "../components/SetupInspector";
import { Section } from "../components/ui";
import { useNameStatus } from "../hooks/useNameStatus";
import { useLab } from "../state/LabContext";

export type SetupMode = "fresh" | "adopt" | "replace";

/** A retained deployment workspace and a separate live playground. */
export default function LabPage() {
  const { session } = useLab();
  const network = useDeployment();
  const scope = `${session?.chainId}:${session?.wallet}:${session?.parentLabel}`;
  const [navigation, setNavigation] = useState<{
    scope: string;
    view: WorkspaceView;
  }>({ scope, view: "deployment" });
  const view =
    navigation.scope === scope || navigation.view === "inspect"
      ? navigation.view
      : "deployment";
  const [inspection, setInspection] = useState<InspectionFormState>({
    draft: "",
    chainId: network.id,
  });
  const changeView = useCallback(
    (next: WorkspaceView) => setNavigation({ scope, view: next }),
    [scope],
  );
  return (
    <LabWorkspace
      key={scope}
      view={view}
      setView={changeView}
      inspection={inspection}
      setInspection={setInspection}
    />
  );
}

function LabWorkspace({
  view,
  setView,
  inspection,
  setInspection,
}: {
  view: WorkspaceView;
  setView: (view: WorkspaceView) => void;
  inspection: InspectionFormState;
  setInspection: Dispatch<SetStateAction<InspectionFormState>>;
}) {
  const { isConnected, address } = useAccount();
  const ready = useIsReady();
  const network = useDeployment();
  const { session } = useLab();
  const activity = useSessionActivity();
  const latestView = useRef(view);
  useLayoutEffect(() => {
    latestView.current = view;
  }, [view]);
  const [playgroundIntent, setPlaygroundIntent] = useState<number>();
  const [pointerTimedOut, setPointerTimedOut] = useState(false);
  const workspaceTop = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<SetupMode>();
  const [configured, setConfigured] = useState(false);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const nameStatus = useNameStatus(session?.parentLabel, address);
  const refetchName = nameStatus.refetch;

  const originalRegistry = savedSetupRegistry(session);
  const selectedIsOriginal = originalRegistry
    ? originalRegistry.toLowerCase() ===
      session?.addresses.userRegistry?.toLowerCase()
    : !session?.addresses.userRegistry &&
      session?.registrySelection !== "adopted";
  const restoreReview = Boolean(
    session?.presetId &&
      !nameStatus.loading &&
      ((hasStartedSetup(session) && selectedIsOriginal) ||
        (!hasStartedSetup(session) &&
          session.setupNonce &&
          !nameStatus.hasSubregistry)),
  );
  const showConfigure =
    Boolean(session) &&
    selectedIsOriginal &&
    (mode === "fresh" ||
      mode === "replace" ||
      ((!mode || mode === "adopt") && restoreReview));
  const showReview = showConfigure && (configured || restoreReview);
  // On-chain truth decides: the playground is relevant whenever the name's
  // live subregistry pointer matches the session's registry. This covers
  // adopt, completed setups, AND re-links from the history box uniformly.
  const playgroundReady = Boolean(
    session?.addresses.userRegistry &&
      nameStatus.subregistry?.toLowerCase() ===
        session.addresses.userRegistry.toLowerCase(),
  );

  const scrollToWorkspace = () =>
    workspaceTop.current?.scrollIntoView?.({ block: "start" });
  const navigate = (next: WorkspaceView) => {
    setPlaygroundIntent(undefined);
    setPointerTimedOut(false);
    setView(next);
    scrollToWorkspace();
  };
  const openPlayground = () => {
    if (latestView.current === "inspect") return;
    setPointerTimedOut(false);
    if (playgroundReady) {
      navigate("playground");
    } else {
      setPlaygroundIntent(Date.now() + 30_000);
      refetchName();
    }
  };

  // A successful run requests navigation, but only a verified pointer unlocks it.
  // A manual nav click cancels this intent; background reads cannot change views.
  useEffect(() => {
    if (!playgroundIntent || !playgroundReady) return;
    const timer = setTimeout(() => {
      setView("playground");
      setPlaygroundIntent(undefined);
      workspaceTop.current?.scrollIntoView?.({ block: "start" });
    }, 0);
    return () => clearTimeout(timer);
  }, [playgroundIntent, playgroundReady, setView]);

  useEffect(() => {
    if (!playgroundIntent || playgroundReady) return;
    const poll = setInterval(() => refetchName(), 2_000);
    const timeout = setTimeout(
      () => {
        setPlaygroundIntent(undefined);
        setPointerTimedOut(true);
      },
      Math.max(0, playgroundIntent - Date.now()),
    );
    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [playgroundIntent, playgroundReady, refetchName]);

  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    workspaceTop.current
      ?.querySelector<HTMLElement>(`#${view}-heading`)
      ?.focus({ preventScroll: true });
  }, [view]);

  const setupStatus = activity.setup
    ? "Transaction in progress"
    : playgroundIntent
      ? "Waiting for name pointer…"
      : playgroundReady
        ? "Registry linked · details saved"
        : session?.setupNonce
          ? "Review your setup"
          : "Deploy or manage a registry";
  const playgroundStatus =
    activity.playground || activity.lock
      ? "Transaction in progress"
      : playgroundReady
        ? "Register and manage subnames"
        : "Available after a registry is linked";

  return (
    <div className="mx-auto flex min-h-screen max-w-[76rem] flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <EnsMarkLogo size={28} />
            ENSv2 Subregistry Lab
          </h1>
          <p className="text-sm opacity-70">
            Deploy and configure subname registries for your .eth names.
          </p>
        </div>
        <ConnectButton />
      </header>

      <ExperimentalNotice />
      <div hidden={view === "inspect"}>
        <ChainGuard />
      </div>
      <div ref={workspaceTop} className="min-w-0 scroll-mt-6">
        <WorkspaceLayout
          view={view}
          onNavigate={navigate}
          playgroundReady={playgroundReady}
          deploymentStatus={setupStatus}
          playgroundStatus={playgroundStatus}
          inspection={
            <InspectPanel
              active={view === "inspect"}
              state={inspection}
              onChange={setInspection}
            />
          }
          context={
            view !== "inspect" &&
            session && (
              <>
                <p className="break-all font-medium">
                  {session.parentLabel}.eth
                </p>
                <p className="mt-1 text-xs text-ens-muted">
                  {network.chain.name}
                </p>
              </>
            )
          }
          pending={
            <div className="mb-4 empty:hidden">
              <PendingTransactions
                onRecovered={() => setRecoveryVersion((value) => value + 1)}
              />
            </div>
          }
          deployment={
            <>
              <div>
                <h2
                  id="deployment-heading"
                  tabIndex={-1}
                  className="text-xl font-semibold outline-none"
                >
                  Deployment & configuration
                </h2>
                <p className="mt-1 text-sm text-ens-muted">
                  Set up your registry. Contract details and transaction history
                  stay here.
                </p>
              </div>
              {session && (
                <DeploymentDetails session={session} linked={playgroundReady} />
              )}
              {playgroundIntent && (
                <p role="status" className="text-sm text-ens-muted">
                  Waiting for the on-chain name pointer before opening the
                  playground…
                </p>
              )}
              {pointerTimedOut && (
                <p role="status" className="text-sm text-amber-800">
                  The registry link is not verified yet. Your deployment details
                  are saved.{" "}
                  <button
                    type="button"
                    onClick={openPlayground}
                    className="underline"
                  >
                    Check again
                  </button>
                </p>
              )}
              <Section step={1} title="Connect your wallet" enabled>
                {isConnected ? (
                  <p className="text-sm">
                    Connected{ready ? ` and on ${network.chain.name}.` : "."}
                  </p>
                ) : (
                  <p className="text-sm">
                    Use the connect button in the top right corner.
                  </p>
                )}
              </Section>

              <Section step={2} title="Pick a name" enabled={ready}>
                <NamePicker />
              </Section>

              <Section
                step={3}
                title="Current setup"
                enabled={ready && Boolean(session)}
              >
                <SetupInspector
                  onModeChosen={(m) => {
                    setMode(m);
                    setConfigured(false);
                    setPlaygroundIntent(undefined);
                    if (m === "adopt") openPlayground();
                  }}
                />
              </Section>

              {showConfigure && (
                <Section
                  step={4}
                  title="Choose a configuration"
                  enabled={ready}
                >
                  <ConfigurePanel onDone={() => setConfigured(true)} />
                </Section>
              )}

              {showReview && (
                <Section step={5} title="Review and execute" enabled={ready}>
                  {/* keyed by preset: switching presets remounts and drops in-memory step state */}
                  <ReviewPanel
                    key={`${session?.parentLabel}:${session?.presetId}`}
                    onComplete={openPlayground}
                    onOpenPlayground={openPlayground}
                  />
                </Section>
              )}
            </>
          }
          playground={
            <>
              <div>
                <h2
                  id="playground-heading"
                  tabIndex={-1}
                  className="text-xl font-semibold outline-none"
                >
                  Playground
                </h2>
                <p className="mt-1 text-sm text-ens-muted">
                  Register subnames, manage records, and inspect your live
                  setup.
                </p>
              </div>
              {playgroundReady ? (
                <>
                  <section
                    aria-label="Subname playground"
                    className="min-w-0 rounded-2xl border border-ens-border bg-ens-card p-5"
                  >
                    {ready ? (
                      <PlaygroundPanel
                        key={session?.addresses.userRegistry?.toLowerCase()}
                        refreshVersion={recoveryVersion}
                        active={view === "playground"}
                      />
                    ) : (
                      <p className="text-sm">
                        Connect your wallet on {network.chain.name} to continue.
                      </p>
                    )}
                  </section>
                  {ready && (
                    <details className="rounded-xl border border-red-200 bg-red-50/40 p-5">
                      <summary className="cursor-pointer text-lg font-medium text-red-900">
                        Advanced: make it unruggable
                      </summary>
                      <div className="mt-4">
                        <LockPanel />
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <section className="rounded-2xl border border-ens-border bg-ens-card p-5">
                  <p className="text-sm">
                    The name is not currently verified as pointing at this
                    session’s registry. Review the deployment before continuing.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("deployment")}
                    className="mt-3 rounded-lg border border-ens-border px-4 py-2 text-sm"
                  >
                    Go to Deployment
                  </button>
                </section>
              )}
            </>
          }
        />
      </div>
    </div>
  );
}
