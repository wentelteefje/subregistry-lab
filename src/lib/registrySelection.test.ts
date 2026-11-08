import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { registryAbi } from "../config/abis";
import { getDeployment } from "../config/deployments";
import { labelhashId } from "./names";
import {
  recoveredRegistryAdoption,
  confirmedRegistryDeployments,
} from "./registrySelection";
import { newSession, type StepState } from "../state/labSession";
const registry = "0x1111111111111111111111111111111111111111" as const;
const network = getDeployment(11155111);
const step: StepState = {
  status: "done",
  confirmed: true,
  blockNumber: "999",
  registryDeployBlock: "100",
  transaction: {
    from: registry,
    to: network.addresses.ETHRegistry,
    nonce: 1,
    input: encodeFunctionData({
      abi: registryAbi,
      functionName: "setSubregistry",
      args: [labelhashId("lab"), registry],
    }),
  },
};
describe("registry selection from confirmed journals", () => {
  it("recovers the target with its factory block, never the relink receipt block", () => {
    expect(recoveredRegistryAdoption(step, "lab", network)).toEqual({
      type: "adopt-registry",
      registry,
      deployBlock: 100n,
    });
    expect(
      recoveredRegistryAdoption(
        { ...step, registryDeployBlock: undefined },
        "lab",
        network,
      ),
    ).toEqual({ type: "adopt-registry", registry, deployBlock: undefined });
  });
  it("does not adopt failed, pending, cancelled or unrelated transactions", () => {
    for (const patch of [
      { confirmed: false },
      { cancelled: true },
      { reverted: true },
      { transaction: { ...step.transaction!, to: registry } },
    ])
      expect(
        recoveredRegistryAdoption({ ...step, ...patch }, "lab", network),
      ).toBeUndefined();
    expect(recoveredRegistryAdoption(step, "other", network)).toBeUndefined();
  });
  it("keeps confirmed local deployments available when a history RPC fails", () => {
    const session = {
      ...newSession(registry, "lab", 11155111),
      sequences: {
        setup: {
          "deploy-registry": {
            status: "done" as const,
            confirmed: true,
            context: { userRegistry: registry },
            blockNumber: "100",
          },
        },
      },
    };
    expect(confirmedRegistryDeployments([session], registry, 11155111)).toEqual(
      [{ address: registry, blockNumber: 100n }],
    );
    expect(confirmedRegistryDeployments([session], registry, 1)).toEqual([]);
    expect(
      confirmedRegistryDeployments(
        [{ ...session, sequences: {} }],
        registry,
        11155111,
      ),
    ).toEqual([]);
  });
});
