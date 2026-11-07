import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ConfigDiagram } from "./ConfigDiagram";
import { toDiagram, buildConfigurationExample } from "../lib/diagramModel";
import { PRESETS } from "../lib/presets";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const registry = "0x1111111111111111111111111111111111111111";
const resolver = "0x2222222222222222222222222222222222222222";
const own = "0x3333333333333333333333333333333333333333";
describe("compact diagram inspection", () => {
  it("exposes separate native buttons for contracts, registry labels and full resolver names", async () => {
    const diagram = toDiagram({
      parentName: "lab.eth",
      userRegistry: registry,
      resolver,
      subnames: [
        { label: "alice", resolver },
        { label: "greg", resolver: own },
      ],
    });
    const inspect = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ConfigDiagram {...diagram} onInspect={inspect} />);
    });
    const buttons = renderer.root.findAllByType("button");
    expect(buttons).toHaveLength(8);
    const targets = buttons.map((button) => {
      const opener = {};
      act(() => button.props.onClick({ currentTarget: opener }));
      expect(inspect.mock.lastCall?.[1]).toBe(opener);
      return inspect.mock.lastCall?.[0];
    });
    expect(targets).toContainEqual({ kind: "registry", address: registry });
    expect(targets).toContainEqual({ kind: "label", registry, label: "alice" });
    expect(targets).toContainEqual({ kind: "resolver", address: own });
    expect(targets).toContainEqual({
      kind: "name",
      resolver: own,
      name: "greg.lab.eth",
    });
    expect(buttons.every((button) => button.props.type === "button")).toBe(
      true,
    );
    await act(async () => renderer.unmount());
  });
  it("never turns illustrative review names or deployment placeholders into live targets", async () => {
    const diagram = toDiagram(
      buildConfigurationExample("lab.eth", PRESETS[0], "new"),
    );
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ConfigDiagram {...diagram} onInspect={vi.fn()} />);
    });
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});
