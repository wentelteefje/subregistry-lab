import { describe, expect, it } from "vitest";
import { walletRejectionDump } from "./fixtures/walletRejection";
import { classifyError, errorSummary, isRateLimitError } from "./errors";

describe("classifyError", () => {
  it("user rejection via code and via name", () => {
    expect(classifyError({ code: 4001, message: "rejected" }).kind).toBe(
      "user-rejected",
    );
    expect(
      classifyError({
        name: "UserRejectedRequestError",
        message: "User rejected the request.",
      }).kind,
    ).toBe("user-rejected");
  });

  it("nested causes are searched", () => {
    const err = {
      name: "ContractFunctionExecutionError",
      message: "Execution reverted",
      cause: {
        name: "ContractFunctionRevertedError",
        message:
          "reverted with EACUnauthorizedAccountRoles(uint256,uint256,address)",
      },
    };
    expect(classifyError(err).kind).toBe("unauthorized");
  });

  it("chain mismatch", () => {
    expect(
      classifyError({
        name: "ChainMismatchError",
        message: "chain does not match",
      }).kind,
    ).toBe("wrong-chain");
  });

  it("erc20 allowance and balance", () => {
    expect(
      classifyError({ message: "ERC20InsufficientAllowance(...)" }).kind,
    ).toBe("insufficient-allowance");
    expect(
      classifyError({ message: "ERC20InsufficientBalance(...)" }).kind,
    ).toBe("insufficient-balance");
  });

  it("gas money", () => {
    expect(
      classifyError({ message: "insufficient funds for gas * price + value" })
        .kind,
    ).toBe("insufficient-eth");
  });

  it("name availability", () => {
    expect(classifyError({ message: "NameNotAvailable(string)" }).kind).toBe(
      "name-unavailable",
    );
  });

  it("rpc range", () => {
    expect(
      classifyError({ message: "query returned more than 10000 results" }).kind,
    ).toBe("rpc-range");
  });

  it("unknown keeps a short message", () => {
    const res = classifyError({ shortMessage: "boom" });
    expect(res.kind).toBe("unknown");
    expect(res.message).toBe("boom");
  });
});

describe("bounded transaction errors", () => {
  it("summarizes the saved viem rejection dump without calldata", () => {
    expect(errorSummary(walletRejectionDump)).toBe(
      "Request cancelled in your wallet. Resume when you’re ready.",
    );
    expect(classifyError(walletRejectionDump).kind).toBe("user-rejected");
  });
  it("handles legacy wallet rejection variants", () => {
    for (const message of [
      "User denied transaction signature",
      "Provider rejected the request",
      "user rejected request",
    ])
      expect(errorSummary(message)).toContain("Request cancelled");
  });
  it("does not claim nothing was sent or confirmed when a transaction hash exists", () => {
    const message = errorSummary(walletRejectionDump, { txHash: "0x123" });
    expect(message).toContain("Check the recorded transaction");
    expect(message.toLowerCase()).not.toMatch(/nothing|confirmed/);
  });
  it("bounds unknown summaries and keeps calldata out of the primary message", () => {
    for (const raw of [
      `provider error: 0x${"ff".repeat(10000)}`,
      "x".repeat(1000),
    ]) {
      const summary = errorSummary(raw);
      expect(summary.length).toBeLessThanOrEqual(160);
      expect(summary).not.toContain("0x");
    }
    expect(errorSummary("RPC offline.\nRequest Arguments: large payload")).toBe(
      "RPC offline.",
    );
  });
  it("uses distinct on-chain revert and wallet replacement language", () => {
    expect(errorSummary("raw", { reverted: true })).toContain(
      "reverted on-chain",
    );
    expect(errorSummary("raw", { cancelled: true, txHash: "0x123" })).toContain(
      "replaced or cancelled",
    );
  });
});

it("does not mistake request input 429 for provider throttling", () => {
  expect(isRateLimitError({name:"HttpRequestError",message:'HTTP request failed. Request body: {"input":429}',body:{input:429},status:500})).toBe(false);
  expect(isRateLimitError({status:429})).toBe(true);
});
