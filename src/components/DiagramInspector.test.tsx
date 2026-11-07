import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DiagramInspector, InspectionDiagram } from "./DiagramInspector";
import { toDiagram } from "../lib/diagramModel";
import type { InspectionData } from "../lib/inspection";
import type { InspectionTarget } from "../diagram/types";
import { zeroAddress } from "viem";
const harness = vi.hoisted(() => ({
  data: undefined as InspectionData | undefined,
  read: vi.fn(),
}));
vi.mock("../hooks/useInspection", () => ({
  useInspection: (...args: unknown[]) => {
    harness.read(...args);
    return {
      data: harness.data,
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));
const registry = "0x1111111111111111111111111111111111111111";
const resolver = "0x2222222222222222222222222222222222222222";
const owner = "0x3333333333333333333333333333333333333333";
const setup = {
  parentName: "lab.eth",
  userRegistry: registry,
  resolver,
  subnames: [{ label: "alice", resolver }],
};
let renderer: ReactTestRenderer;
const listeners = new Map<string, (event: unknown) => void>();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("document", {
    addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
    removeEventListener: vi.fn((name) => listeners.delete(name)),
  });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
  harness.read.mockClear();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  listeners.clear();
  vi.unstubAllGlobals();
});
async function open(
  target: InspectionTarget,
  data: Partial<InspectionData> = {},
) {
  harness.data = { target, block: 100n, ...data };
  const select = vi.fn(),
    close = vi.fn();
  await act(async () => {
    renderer = create(
      <DiagramInspector
        target={target}
        setup={setup}
        chainId={11155111}
        onSelect={select}
        onClose={close}
      />,
    );
  });
  return { select, close };
}
const text = () => JSON.stringify(renderer.toJSON());
describe("read-only diagram inspectors", () => {
  it("shows registry metadata and navigates from the known label list", async () => {
    const { select } = await open(
      { kind: "registry", address: registry },
      {
        parent: { ok: true, value: [owner, "lab"] },
        emancipated: { ok: true, value: false },
        rootCounts: { ok: true, value: 0n },
      },
    );
    expect(text()).toContain("UserRegistry");
    expect(text()).toContain("Parent pointer");
    act(() =>
      renderer.root
        .findAllByType("button")
        .find((b) => b.props.className === "inspection-nav")!
        .props.onClick(),
    );
    expect(select).toHaveBeenCalledWith({
      kind: "label",
      registry,
      label: "alice",
    });
  });
  it("distinguishes normal, admin and admin-only label permissions", async () => {
    const normal = 1n << 24n;
    await open(
      { kind: "label", registry, label: "alice" },
      {
        ownerRoles: {
          ok: true,
          value: normal | (normal << 128n) | (1n << 156n),
        },
      },
    );
    const admin = renderer.root.findAllByProps({
      className: "inspection-role-admin",
    });
    expect(admin).toHaveLength(2);
    expect(
      admin.every((badge) =>
        JSON.stringify(
          badge.children.map((child) =>
            typeof child === "string" ? child : child.props.children,
          ),
        ).includes("Admin"),
      ),
    ).toBe(true);
    expect(text()).toContain("Change a subname's resolver");
  });
  it("uses the same admin styling for resolver role counts", async () => {
    await open(
      { kind: "resolver", address: resolver },
      { rootCounts: { ok: true, value: 1n | (2n << 128n) } },
    );
    expect(
      renderer.root.findAllByProps({ className: "inspection-role-admin" }),
    ).toHaveLength(1);
    expect(text()).toContain("Admin · ");
    expect(text()).toContain("Set addresses");
    expect(text()).toContain(" · 2");
  });
  it("shows expired raw holders as last holders and separates scoped permissions", async () => {
    const { select } = await open(
      { kind: "label", registry, label: "alice" },
      {
        state: {
          ok: true,
          value: {
            status: 0,
            expiry: 10n,
            latestOwner: owner,
            tokenId: 4n,
            resource: 8n,
          },
        },
        resolver: { ok: true, value: resolver },
        subregistry: { ok: true, value: zeroAddress },
        ownerRoles: { ok: true, value: 0n },
        ownerRootRoles: { ok: true, value: 0n },
      },
    );
    expect(text()).toContain("Not currently owned");
    expect(text()).toContain("last holder");
    expect(text()).toContain("Holder’s registry-wide permissions");
    act(() =>
      renderer.root
        .findByProps({ className: "inspection-link" })
        .props.onClick(),
    );
    expect(select).toHaveBeenCalledWith({
      kind: "resolver",
      address: resolver,
    });
  });
  it("navigates from resolver names to records at that exact resolver", async () => {
    const { select } = await open(
      { kind: "resolver", address: resolver },
      { compatible: true, defaultId: { ok: true, value: 0n } },
    );
    const name = renderer.root
      .findAllByType("button")
      .find(
        (b) =>
          b.props.className === "inspection-nav" &&
          b.children[0] === "alice.lab.eth",
      )!;
    act(() => name.props.onClick());
    expect(select).toHaveBeenCalledWith({
      kind: "name",
      resolver,
      name: "alice.lab.eth",
    });
  });
  it("explains whole-bundle fallback and retains unavailable-read details", async () => {
    await open(
      { kind: "name", resolver, name: "alice.lab.eth" },
      {
        source: "default",
        recordId: 2n,
        directId: { ok: true, value: 0n },
        defaultId: { ok: true, value: 2n },
        records: [
          { profile: { kind: "text", key: "custom" }, error: "RPC offline" },
        ],
        history: { complete: false, from: 1n, through: 50n },
      },
    );
    expect(text()).toContain("whole default bundle");
    expect(text()).toContain("History incomplete");
    expect(text()).toContain("RPC offline");
  });
  it("validates and normalizes manual profile identifiers", async () => {
    await open({ kind: "name", resolver, name: "alice.lab.eth" });
    const change = (kind: string, key: string) =>
      act(() => {
        renderer.root
          .findByType("select")
          .props.onChange({ target: { value: kind } });
        renderer.root
          .findByType("input")
          .props.onChange({ target: { value: key } });
      });
    const submit = () =>
      act(() =>
        renderer.root
          .findByType("form")
          .props.onSubmit({ preventDefault: vi.fn() }),
      );
    change("address", "bogus");
    submit();
    expect(text()).toContain("Enter a numeric coin type");
    change("address", "0x3c");
    submit();
    expect(harness.read.mock.lastCall?.[3]).toEqual([
      { kind: "address", key: "60" },
    ]);
    change("interface", "0xABCDEF01");
    submit();
    expect(harness.read.mock.lastCall?.[3]).toContainEqual({
      kind: "interface",
      key: "0xabcdef01",
    });
  });
  it("closes on Escape while leaving a modal above it alone", async () => {
    const { close } = await open({ kind: "resolver", address: resolver });
    const event = {
      key: "Escape",
      defaultPrevented: false,
      preventDefault: vi.fn(),
    };
    act(() => listeners.get("keydown")!(event));
    expect(close).toHaveBeenCalledTimes(1);
    Object.assign(document, { activeElement: { closest: () => ({}) } });
    act(() => listeners.get("keydown")!(event));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("retains an open inspector after adding an unrelated label, and resets on a chain change", async () => {
    const diagram = toDiagram(setup);
    await act(async () => {
      renderer = create(
        <InspectionDiagram
          diagram={diagram}
          setup={setup}
          chainId={11155111}
        />,
      );
    });
    act(() =>
      renderer.root
        .findAllByType("button")[0]
        .props.onClick({ currentTarget: {} }),
    );
    expect(renderer.root.findAllByType(DiagramInspector)).toHaveLength(1);
    const expandedSetup = {
      ...setup,
      subnames: [...setup.subnames, { label: "bob", resolver }],
    };
    await act(async () =>
      renderer.update(
        <InspectionDiagram
          diagram={toDiagram(expandedSetup)}
          setup={expandedSetup}
          chainId={11155111}
        />,
      ),
    );
    expect(renderer.root.findAllByType(DiagramInspector)).toHaveLength(1);
    await act(async () =>
      renderer.update(
        <InspectionDiagram diagram={diagram} setup={setup} chainId={1} />,
      ),
    );
    expect(renderer.root.findAllByType(DiagramInspector)).toHaveLength(0);
  });
});

it("keeps drawer IDs unique across retained workspace views", async () => {
  const diagram = toDiagram(setup);
  await act(async () => {
    renderer = create(
      <>
        <InspectionDiagram diagram={diagram} setup={setup} chainId={11155111} />
        <InspectionDiagram diagram={diagram} setup={setup} chainId={11155111} />
      </>,
    );
  });
  const buttons = renderer.root
    .findAllByType("button")
    .filter((button) => button.props["aria-controls"]);
  const first = buttons[0],
    last = buttons.at(-1)!;
  act(() => first.props.onClick({ currentTarget: {} }));
  act(() => last.props.onClick({ currentTarget: {} }));
  const ids = renderer.root
    .findAllByType("aside")
    .map((aside) => aside.props.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(first.props["aria-controls"]).not.toBe(last.props["aria-controls"]);
});
