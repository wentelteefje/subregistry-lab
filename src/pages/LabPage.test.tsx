import { useEffect, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { newSession, type SessionData } from "../state/labSession";
import { acquireRun } from "../lib/inflight";
import { getDeployment } from "../config/deployments";
import LabPage from "./LabPage";

const harness = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  registry: "0x2222222222222222222222222222222222222222" as `0x${string}`,
  session: undefined as SessionData | undefined,
  pointer: undefined as `0x${string}` | undefined,
  loading: false,
  refetch: vi.fn(),
  dispatch: vi.fn(),
  execute: vi.fn(),
  mounts: { name: 0, playground: 0, review: 0 },
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true, address: harness.address }),
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () => <button>Connect Wallet</button>,
}));
vi.mock("../state/LabContext", () => ({
  useLab: () => ({
    session: harness.session,
    state: { activeKey: "lab" },
    dispatch: harness.dispatch,
  }),
}));
vi.mock("../hooks/useDeployment", () => ({
  useDeployment: () => getDeployment(1),
}));
vi.mock("../hooks/useNameStatus", () => ({
  useNameStatus: () => ({
    loading: harness.loading,
    subregistry: harness.pointer,
    hasSubregistry: Boolean(harness.pointer),
    canConfigure: true,
    isOwner: true,
    owner: harness.address,
    expiry: 99_999_999_999n,
    refetch: harness.refetch,
  }),
}));
vi.mock("../components/InspectPanel", () => ({
  InspectPanel: ({
    state,
    onChange,
  }: {
    state: { draft: string };
    onChange: (fn: (state: { draft: string }) => unknown) => void;
  }) => (
    <>
      <h2 id="inspect-heading">Inspect a name</h2>
      <input
        aria-label="Inspection draft"
        value={state.draft}
        onChange={(event) =>
          onChange((previous) => ({ ...previous, draft: event.target.value }))
        }
      />
    </>
  ),
}));
vi.mock("../components/ChainGuard", () => ({
  ChainGuard: () => null,
  useIsReady: () => true,
}));
vi.mock("../hooks/useDeployedRegistries", () => ({
  useDeployedRegistries: () => ({ registries: [] }),
}));
vi.mock("../components/RegistryHistory", () => ({
  RegistryHistory: () => null,
}));
vi.mock("../components/NamePicker", () => ({
  NamePicker: () => {
    const [value, setValue] = useState("");
    useEffect(() => {
      harness.mounts.name++;
    }, []);
    return (
      <input
        aria-label="Name draft"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  },
}));
vi.mock("../components/ConfigurePanel", () => ({
  ConfigurePanel: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>Continue to review</button>
  ),
}));
vi.mock("../components/ReviewPanel", () => ({
  ReviewPanel: ({ onComplete }: { onComplete: () => void }) => {
    useEffect(() => {
      harness.mounts.review++;
    }, []);
    return (
      <button
        onClick={() => {
          harness.execute();
          onComplete();
        }}
      >
        Finish setup
      </button>
    );
  },
}));
vi.mock("../components/PlaygroundPanel", () => ({
  PlaygroundPanel: ({ refreshVersion }: { refreshVersion: number }) => {
    const [value, setValue] = useState("");
    useEffect(() => {
      harness.mounts.playground++;
    }, []);
    return (
      <>
        <input
          aria-label="Subname draft"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <span data-refresh={refreshVersion} />
      </>
    );
  },
}));
vi.mock("../components/LockPanel", () => ({
  LockPanel: () => <p>Lock controls</p>,
}));
vi.mock("../components/PendingTransactions", () => ({
  PendingTransactions: ({ onRecovered }: { onRecovered: () => void }) => (
    <button onClick={onRecovered}>Recover transaction</button>
  ),
}));

let renderer: ReactTestRenderer;
let release: (() => void) | undefined;
const view = (name: string) =>
  renderer.root.findByProps({ id: `${name}-view` });
const button = (text: string) =>
  renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes(text))!;
const nav = (name: string) =>
  renderer.root.findByProps({ id: `${name}-navigation` });
async function mount() {
  await act(async () => {
    renderer = create(<LabPage />);
  });
}
async function rerender() {
  await act(async () => {
    renderer.update(<LabPage />);
  });
}
async function click(node: ReturnType<typeof button>) {
  await act(async () => {
    node.props.onClick();
  });
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  harness.session = {
    ...newSession(harness.address, "wallet", 1),
    presetId: "fully-controlled",
    setupNonce: "saved",
    addresses: { userRegistry: harness.registry },
    sequences: {
      setup: {
        "deploy-registry": {
          status: "done",
          confirmed: true,
          capture: "userRegistry",
          context: { userRegistry: harness.registry },
        },
      },
    },
  };
  harness.pointer = harness.registry;
  harness.loading = false;
  harness.mounts = { name: 0, playground: 0, review: 0 };
  harness.refetch.mockReset();
  harness.execute.mockReset();
  harness.dispatch.mockReset();
});
afterEach(async () => {
  await act(async () => {
    release?.();
    release = undefined;
    renderer?.unmount();
  });
  vi.useRealTimers();
});

describe("workspace navigation", () => {
  it("retains both views, drafts and saved deployment details without starting transactions", async () => {
    await mount();
    expect(view("playground").props.hidden).toBe(true);
    const name = renderer.root.findByProps({ "aria-label": "Name draft" });
    const sub = renderer.root.findByProps({ "aria-label": "Subname draft" });
    await act(async () => {
      name.props.onChange({ target: { value: "name draft" } });
      sub.props.onChange({ target: { value: "alice" } });
    });
    await click(nav("playground"));
    expect(view("deployment").props.hidden).toBe(true);
    await click(nav("deployment"));
    expect(name.props.value).toBe("name draft");
    expect(sub.props.value).toBe("alice");
    expect(harness.mounts).toEqual({ name: 1, playground: 1, review: 1 });
    expect(
      renderer.root.findByProps({ "aria-label": "Saved deployment details" }),
    ).toBeDefined();
    expect(harness.execute).not.toHaveBeenCalled();
  });
  it("gates the playground on the actual pointer and never auto-navigates on a background update", async () => {
    harness.pointer = undefined;
    await mount();
    expect(nav("playground").props.disabled).toBe(true);
    expect(harness.mounts.playground).toBe(0);
    harness.pointer = harness.registry;
    await rerender();
    expect(view("deployment").props.hidden).toBe(false);
    expect(nav("playground").props.disabled).toBe(false);
  });
  it("waits for the linked pointer after completion, then opens the playground", async () => {
    harness.pointer = undefined;
    await mount();
    await click(button("Finish setup"));
    expect(view("deployment").props.hidden).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(harness.refetch).toHaveBeenCalledTimes(2);
    harness.pointer = harness.registry;
    await rerender();
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(view("playground").props.hidden).toBe(false);
  });
  it("manual navigation cancels completion intent and polling", async () => {
    harness.pointer = undefined;
    await mount();
    await click(button("Finish setup"));
    await click(nav("deployment"));
    harness.pointer = harness.registry;
    await rerender();
    await act(async () => {
      vi.advanceTimersByTime(35_000);
    });
    expect(view("deployment").props.hidden).toBe(false);
    expect(harness.refetch).toHaveBeenCalledTimes(1);
  });
  it("bounds pointer retries and preserves the deployment after timeout", async () => {
    harness.pointer = undefined;
    await mount();
    await click(button("Finish setup"));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    const calls = harness.refetch.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(harness.refetch).toHaveBeenCalledTimes(calls);
    expect(button("Check again")).toBeDefined();
    expect(view("deployment").props.hidden).toBe(false);
  });
  it("restores a started review on reload but never turns a stale prepared plan into a replacement", async () => {
    await mount();
    expect(harness.mounts.review).toBe(1);
    await act(async () => {
      renderer.unmount();
    });
    harness.session = { ...harness.session!, sequences: {} };
    harness.pointer = "0x3333333333333333333333333333333333333333";
    await mount();
    expect(
      renderer.root
        .findAllByType("button")
        .some((node) => node.children.includes("Finish setup")),
    ).toBe(false);
  });
  it("recovers without remounting a hidden playground or losing its draft", async () => {
    await mount();
    const sub = renderer.root.findByProps({ "aria-label": "Subname draft" });
    await act(async () => {
      sub.props.onChange({ target: { value: "alice" } });
      release = acquireRun("sender:1:" + harness.address);
    });
    await click(button("Recover transaction"));
    expect(harness.mounts.playground).toBe(1);
    expect(sub.props.value).toBe("alice");
    expect(renderer.root.findByProps({ "data-refresh": 1 })).toBeDefined();
  });
  it("blocks replace and adopt while a hidden playground holds the sender lock", async () => {
    await mount();
    await act(async () => {
      release = acquireRun("sender:1:" + harness.address);
    });
    const replace = button("Replace with a new setup →");
    expect(replace.props.disabled).toBe(true);
    expect(button("Keep it: register subnames").props.disabled).toBe(true);
    await click(replace);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });
  it("retains saved transaction history after adopting the same deployed registry", async () => {
    await mount();
    await click(button("Keep it: register subnames"));
    expect(harness.mounts.review).toBe(1);
    expect(button("Finish setup")).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "Saved setup transactions",
    );
  });
  it("keeps original deployment contracts separate after adopting a different registry", async () => {
    const originalResolver = "0x4444444444444444444444444444444444444444";
    const originalRegistrar = "0x5555555555555555555555555555555555555555";
    const otherResolver = "0x6666666666666666666666666666666666666666";
    const otherRegistrar = "0x7777777777777777777777777777777777777777";
    harness.session!.sequences.setup["deploy-resolver"] = {
      status: "done",
      context: { resolver: originalResolver },
    };
    harness.session!.sequences.setup["deploy-registrar"] = {
      status: "done",
      context: { registrar: originalRegistrar },
    };
    harness.pointer = "0x3333333333333333333333333333333333333333";
    harness.session!.addresses = {
      userRegistry: harness.pointer,
      resolver: otherResolver,
      registrar: otherRegistrar,
    };
    await mount();
    const card = renderer.root.findByProps({
      "aria-label": "Saved deployment details",
    });
    const addresses = card.findAllByType("a").map((node) => node.props.title);
    expect(addresses).toContain(harness.registry);
    expect(addresses).toContain(originalResolver);
    expect(addresses).toContain(originalRegistrar);
    expect(addresses).not.toContain(otherResolver);
    expect(addresses).not.toContain(otherRegistrar);
    expect(
      renderer.root
        .findAllByType("button")
        .some((node) => node.children.includes("Finish setup")),
    ).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "Saved setup transactions",
    );
  });
  it("keeps the selected view with a safe placeholder if the linked registry changes", async () => {
    await mount();
    await click(nav("playground"));
    harness.pointer = undefined;
    await rerender();
    expect(view("playground").props.hidden).toBe(false);
    expect(button("Go to Deployment")).toBeDefined();
    await click(button("Go to Deployment"));
    expect(view("deployment").props.hidden).toBe(false);
  });
});

it("does not restore the replacement review after a rejected deployment and adoption", async () => {
  harness.session!.registrySelection = "adopted";
  harness.session!.sequences.setup = {
    "deploy-registry": {
      status: "failed",
      transaction: {
        from: harness.address,
        to: harness.registry,
        nonce: 1,
        input: "0x1234",
      },
    },
  };
  await mount();
  expect(
    renderer.root
      .findAllByType("button")
      .some((node) => node.children.includes("Finish setup")),
  ).toBe(false);
  expect(nav("playground").props.disabled).toBe(false);
});

it("keeps inspection input and view across wallet/session changes", async () => {
  await mount();
  await click(nav("inspect"));
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Inspection draft" })
      .props.onChange({ target: { value: "other.eth" } }),
  );
  harness.session = undefined;
  await rerender();
  expect(view("inspect").props.hidden).toBe(false);
  expect(
    renderer.root.findByProps({ "aria-label": "Inspection draft" }).props.value,
  ).toBe("other.eth");
});
it("does not let a stale setup completion callback pull the user out of inspection", async () => {
  await mount();
  const completion = button("Finish setup").props.onClick;
  await click(nav("inspect"));
  await act(async () => completion());
  await act(async () => {
    vi.advanceTimersByTime(35000);
  });
  expect(view("inspect").props.hidden).toBe(false);
});
