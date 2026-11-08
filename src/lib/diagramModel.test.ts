import { describe, expect, it } from "vitest";
import {
  MAX_FOREIGN_RESOLVER_NODES,
  classifyResolver,
  toDiagram,
  buildConfigurationExample,
  type SetupView,
} from "./diagramModel";
import { PRESETS } from "./presets";
import { ROLE_REGISTRAR, ROLE_RENEW } from "./roles";
const shared = "0x3333333333333333333333333333333333333333";
const own = "0x4444444444444444444444444444444444444444";
const base: SetupView = {
  parentName: "lab.eth",
  userRegistry: "new",
  resolver: shared,
  resolverRecords: {
    [shared]: {
      "lab.eth": "1",
      "alice.lab.eth": "2",
      "bare.lab.eth": "0",
      "": "3",
    },
    [own]: { "bob.lab.eth": "1", "alice.lab.eth": "2", "": "0" },
  },
};
describe("resolver classification", () => {
  it("distinguishes missing pointers, the shared contract and another resolver", () => {
    expect(classifyResolver(undefined, shared)).toBe("none");
    expect(classifyResolver(`0x${"0".repeat(40)}`, shared)).toBe("none");
    expect(classifyResolver(shared, shared.toUpperCase())).toBe("default");
    expect(classifyResolver(own, shared)).toBe("foreign");
    expect(classifyResolver(own)).toBe("foreign");
  });
});
describe("configuration diagrams", () => {
  it("draws only the parent chain when nothing is attached", () => {
    const diagram = toDiagram({ parentName: "lab.eth" });
    expect(diagram.nodes.map((node) => node.id)).toEqual(["parent"]);
    expect(diagram.edges).toHaveLength(0);
  });
  it("shows plain token labels inside the registry boundary", () => {
    const diagram = toDiagram({
      ...base,
      subnames: [{ label: "alice", neverExpires: true }],
    });
    const child = diagram.nodes.find((node) => node.id === "sub-alice")!;
    expect(child.parentId).toBe("user-registry");
    expect(child.type).toBe("action");
    expect(child.data.label).toContain("∞");
    expect(
      diagram.edges.find((edge) => edge.id === "e-parent-registry")?.target,
    ).toBe("user-registry");
  });
  it("draws parent resolver and subregistry pointers independently", () => {
    const diagram = toDiagram(base);
    expect(
      diagram.edges.find((edge) => edge.id === "e-parent-resolver")?.source,
    ).toBe("parent");
    expect(
      diagram.edges.some(
        (edge) => edge.source === "user-registry" && edge.target === "resolver",
      ),
    ).toBe(false);
    expect(
      diagram.nodes.find((node) => node.id === "resolver")?.data,
    ).not.toHaveProperty("addr");
    expect(
      diagram.nodes.find((node) => node.id === "resolver")?.data,
    ).not.toHaveProperty("owner");
  });
  it("distinguishes explicit resolver pointers from nearest-ancestor inheritance", () => {
    const diagram = toDiagram({
      ...base,
      subnames: [
        { label: "alice", resolver: shared },
        { label: "bare" },
        { label: "bob", resolver: own },
      ],
    });
    expect(
      diagram.edges.find((edge) => edge.id === "e-sub-alice-resolver")?.label,
    ).toBe("resolver");
    const inherited = diagram.edges.find(
      (edge) => edge.id === "e-sub-bare-resolver",
    )!;
    expect(inherited.label).toBeUndefined();
    expect(inherited.style?.strokeDasharray).toBeDefined();
    expect(
      diagram.edges.find((edge) => edge.id === "e-sub-bob-resolver")?.target,
    ).toBe(`resolver-${own}`);
    expect(diagram.affinities?.resolver).toContain("sub-bare");
    expect(diagram.affinities?.resolver).not.toContain("sub-bob");
  });
  it("keeps full resolver names but shows only labels in registry tokens", () => {
    const diagram = toDiagram({ ...base, subnames: [{ label: "alice" }] });
    expect(diagram.nodes.find((node) => node.id === "sub-alice")?.data.label).toBe("alice");
    expect(diagram.nodes.find((node) => node.id === "resolver-name-1")?.data).toMatchObject({ label: "alice.lab.eth", note: "name link" });
    expect(diagram.nodes.map((node) => node.type)).not.toContain("record");
  });
  it("shows verified default fallback as a row status", () => {
    const diagram = toDiagram({ ...base, resolverRecords: { [shared]: { "lab.eth": "0", "": "9" } } });
    expect(diagram.nodes.find((node) => node.id === "resolver-name-0")?.data).toMatchObject({ note: "uses default record" });
    expect(toDiagram({ ...base, resolverRecords: { [shared]: { "lab.eth": "0", "": "0" } } }).nodes.map((node) => node.type)).not.toContain("resolver");
  });
  it("never invents record bundles for loading, failed or planned reads", () => {
    for (const resolverRecords of [
      undefined,
      { [shared]: { "lab.eth": null } },
    ]) {
      const diagram = toDiagram({ ...base, resolverRecords });
      expect(diagram.nodes.some((node) => String(node.type) === "record")).toBe(false);
      expect(
        diagram.nodes.some((node) => String(node.data.label).includes("*")),
      ).toBe(false);
    }
    expect(
      toDiagram({ ...base, resolver: "new" }).nodes.some(
        (node) => node.type === "resolver",
      ),
    ).toBe(false);
  });
  it("keeps record ids scoped to each resolver, including another contract shared by multiple names", () => {
    const diagram = toDiagram({
      ...base,
      subnames: [
        { label: "alice", resolver: own },
        { label: "bob", resolver: own.toUpperCase().replace("0X", "0x") },
      ],
      resolverRecords: {
        [shared]: { "lab.eth": "1" },
        [own]: { "alice.lab.eth": "1", "bob.lab.eth": "1" },
      },
    });
    expect(
      diagram.nodes.filter((node) => node.type === "resolver"),
    ).toHaveLength(2);
    expect(diagram.nodes.find((node) => node.id === "resolver-name-0")?.data).toMatchObject({ note: "name link" });
    expect(diagram.nodes.find((node) => node.id === `resolver-${own}-name-0`)?.data).toMatchObject({ note: "name link" });
    expect(diagram.nodes.map((node) => node.type)).not.toContain("record");
  });
  it("caps distinct own resolver frames, counts unique overflow and never overlaps frames", () => {
    const subnames = Array.from(
      { length: MAX_FOREIGN_RESOLVER_NODES + 2 },
      (_, index) => ({
        label: `s${index}`,
        resolver: `0x${String(index + 1).padStart(40, "0")}`,
      }),
    );
    subnames.push({ ...subnames.at(-1)!, label: "duplicate" });
    const diagram = toDiagram({
      ...base,
      subnames,
      resolverRecords: {
        ...base.resolverRecords,
        ...Object.fromEntries(
          subnames.map((sub) => [
            sub.resolver,
            Object.fromEntries(
              subnames
                .filter((other) => other.resolver === sub.resolver)
                .map((other) => [`${other.label}.lab.eth`, "1"]),
            ),
          ]),
        ),
      },
    });
    expect(
      diagram.nodes.find((node) => node.id === "resolver-more")?.data.label,
    ).toBe("+2 more resolvers");
    const frames = diagram.nodes.filter((node) => node.type === "resolver");
    for (let i = 1; i < frames.length; i++)
      expect(frames[i].position.y).toBeGreaterThanOrEqual(
        frames[i - 1].position.y + Number(frames[i - 1].style?.height),
      );
  });
  it("counts linked resolvers without records in the overflow summary", () => {
    const subnames = Array.from({length: 5}, (_, index) => ({label: `s${index}`, resolver: `0x${String(index + 1).padStart(40, "0")}`}));
    const empty = {label: "empty", resolver: `0x${"9".repeat(40)}`};
    const diagram = toDiagram({...base, subnames: [...subnames, empty], resolverRecords: Object.fromEntries(subnames.map(sub => [sub.resolver, {[`${sub.label}.lab.eth`]: "1"}]))});
    expect(diagram.nodes.find(node => node.id === "resolver-more")?.data.label).toBe("+2 more resolvers");
    expect(diagram.edges.find(edge => edge.source === "sub-empty")?.target).toBe("resolver-more");
    expect(diagram.edges.find(edge => edge.source === "sub-s4")?.target).toBe("resolver-more");
  });
  it("distinguishes unread, unavailable and unlinked resolver name rows", () => {
    const diagram = toDiagram({...base, subnames: [{label:"alice"}, {label:"bob"}, {label:"bare"}], resolverRecords:{[shared]:{"lab.eth":"1", "alice.lab.eth":null, "bare.lab.eth":"0"}}});
    const notes = diagram.nodes.filter(node => node.type === "action").map(node => node.data.note);
    expect(notes).toContain("record lookup unavailable");
    expect(notes).toContain("record link not read yet");
    expect(notes).toContain("no direct record link");
  });
  it("retains registrar permissions and locked registry state", () => {
    const diagram = toDiagram({
      ...base,
      locked: true,
      subnames: [{ label: "alice" }],
      registrar: "new",
      registrarRoles: ROLE_REGISTRAR | ROLE_RENEW,
    });
    expect(
      diagram.nodes.find((node) => node.id === "user-registry")?.data.label,
    ).toContain("LOCKED");
    expect(
      diagram.edges.find((edge) => edge.id === "e-registrar-registry")?.label,
    ).toBe("REGISTRAR + RENEW");
    expect(
      toDiagram({ ...base, resolver: `0x${"0".repeat(40)}` }).nodes.some(
        (node) => node.id === "resolver",
      ),
    ).toBe(false);
  });
});

describe("configuration examples and empty live diagrams", () => {
  for (const preset of PRESETS)
    it(`shows a clearly illustrative nonempty ${preset.id} configuration`, () => {
      const setup = buildConfigurationExample("wallet.eth", preset, "new");
      expect(setup.illustrative).toBe(true);
      expect(setup.resolverRecords).toBeUndefined();
      expect(
        JSON.stringify(setup, (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ).not.toMatch(/0x[0-9a-f]{40}/i);
      const diagram = toDiagram(setup);
      expect(diagram.nodes.some((node) => node.id === "eth-registry")).toBe(
        false,
      );
      expect(
        diagram.nodes.filter((node) => String(node.type) === "record"),
      ).toHaveLength(0);
      expect(
        diagram.nodes
          .filter(
            (node) => String(node.type) === "record" || node.id.startsWith("sub-"),
          )
          .every((node) => !String(node.data.label).includes("wallet.eth")),
      ).toBe(true);
      expect(
        diagram.nodes.find((node) => node.id === "user-registry")?.data.label,
      ).not.toContain("LOCKED");
      expect(
        diagram.nodes.find((node) => node.id === "registrar") !== undefined,
      ).toBe(Boolean(preset.registrar));
      const ids = new Set(diagram.nodes.map((node) => node.id));
      expect(
        diagram.edges.every(
          (edge) => ids.has(edge.source) && ids.has(edge.target),
        ),
      ).toBe(true);
      expect(
        diagram.nodes
          .filter((node) => node.type === "action")
          .some((node) => node.data.label === "wallet.eth"),
      ).toBe(false);
    });
  it("draws only the parent for an empty, unread or failed live setup", () => {
    for (const resolverRecords of [
      undefined,
      { [shared]: { "lab.eth": "0", "": "0" } },
      { [shared]: { "lab.eth": null, "": null } },
    ]) {
      const diagram = toDiagram({ ...base, resolverRecords });
      expect(diagram.nodes.map((node) => node.id)).toEqual(["parent"]);
      expect(diagram.edges).toEqual([]);
    }
  });
  it("shows explicit shared resolver pointers even before record data is available", () => {
    const diagram = toDiagram({
      ...base,
      subnames: [{ label: "alice", resolver: shared }],
      resolverRecords: {},
    });
    expect(diagram.nodes.some((node) => node.id === "user-registry")).toBe(
      true,
    );
    expect(diagram.nodes.some((node) => node.id === "resolver")).toBe(true);
    expect(diagram.edges.find((edge) => edge.source === "sub-alice")?.target).toBe("resolver");
    const ids = new Set(diagram.nodes.map((node) => node.id));
    expect(
      diagram.edges.every(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    ).toBe(true);
  });
  it("keeps a linked own resolver visible through loading, zero and failed record reads", () => {
    const snapshot = {
      ...base,
      parentName: "sgtest-mv6mhi7a.eth",
      subnames: [{label:"alice",resolver:shared}, {label:"greg",resolver:own}],
    };
    const expectedNotes = ["record link not read yet", "no direct record link", "record lookup unavailable"];
    let stableIds: string[] | undefined;
    for (const [index, records] of [undefined, {"greg.sgtest-mv6mhi7a.eth":"0", "":"0"}, {"greg.sgtest-mv6mhi7a.eth":null, "":null}].entries()) {
      const diagram = toDiagram({...snapshot, resolverRecords: records ? {[own]:records} : undefined});
      const ids = diagram.nodes.map(node=>node.id);
      stableIds ??= ids;
      expect(ids).toEqual(stableIds);
      const frame = diagram.nodes.find(node=>node.id===`resolver-${own}`)!;
      expect(frame.data).toMatchObject({address:"0x4444…4444",note:"Linked names · no record data verified"});
      expect(diagram.nodes.find(node=>node.id===`resolver-${own}-name-0`)?.data).toMatchObject({label:"greg.sgtest-mv6mhi7a.eth",note:expectedNotes[index]});
      expect(diagram.edges.find(edge=>edge.id==="e-sub-greg-resolver")).toMatchObject({target:frame.id,label:"resolver"});
      expect(diagram.nodes.map(node=>node.type)).not.toContain("record");
      expect(diagram.nodes.some(node=>String(node.data.label).includes("*"))).toBe(false);
    }
  });
  it("does not draw orphan resolver frames for subnames without a registry", () => {
    const diagram = toDiagram({...base,userRegistry:undefined,resolverRecords:undefined,subnames:[{label:"greg",resolver:own}]});
    expect(diagram.nodes.map(node=>node.id)).toEqual(["parent"]);
    expect(diagram.edges).toEqual([]);
  });
  it("has no example resolver when none was selected", () => {
    const diagram = toDiagram(
      buildConfigurationExample("wallet.eth", PRESETS[0], "none"),
    );
    expect(
      diagram.nodes.some(
        (node) => node.type === "resolver" || String(node.type) === "record",
      ),
    ).toBe(false);
    expect(
      diagram.nodes.filter((node) => node.id.startsWith("sub-")),
    ).toHaveLength(2);
  });
});

it("renders resolver-discovered names without registry tokens or duplicate entries", () => {
  const diagram = toDiagram({
    parentName: "lab.eth",
    resolver: shared,
    resolverNames: ["time-q.lab.eth", "time-q.lab.eth"],
    resolverRecords: {
      [shared]: { "lab.eth": "0", "time-q.lab.eth": "21", "": "0" },
    },
  });
  expect(diagram.nodes.some((node) => node.id === "user-registry")).toBe(false);
  const names = diagram.nodes.filter(
    (node) => node.data.label === "time-q.lab.eth",
  );
  expect(names).toHaveLength(1);
  expect(names[0].data).toMatchObject({
    inspection: { kind: "name", resolver: shared, name: "time-q.lab.eth" },
    note: "resolver-linked name",
  });
  const resolverNode = diagram.nodes.find((node) => node.id === "resolver")!;
  expect(resolverNode.position.x).toBeLessThan(600);
});
