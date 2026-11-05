import { expect, it } from "vitest";
import { acquireRun, isRunning } from "./inflight";
it("allows one run across remounted instances and releases it explicitly", () => {
  const release = acquireRun("wallet:chain:name:setup")!;
  expect(isRunning("wallet:chain:name:setup")).toBe(true);
  expect(acquireRun("wallet:chain:name:setup")).toBeUndefined();
  release();
  expect(isRunning("wallet:chain:name:setup")).toBe(false);
  acquireRun("wallet:chain:name:setup")!();
});
