import { expect, it } from "vitest";
import { paidOperationExpiry } from "./registration";
it("never turns a repeated registration into a second payment for renewal", () => {
  expect(paidOperationExpiry("register", 0, 0n)).toBeUndefined();
  expect(() => paidOperationExpiry("register", 2, 100n)).toThrow(
    "explicitly choose Renew",
  );
  expect(() => paidOperationExpiry("renew", 0, 0n)).toThrow(
    "active registered",
  );
  expect(paidOperationExpiry("renew", 2, 100n)).toBe(100n);
});
