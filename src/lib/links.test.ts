import { describe, expect, it } from "vitest";
import { etherscanAddress, etherscanTx, explorerName, explorerRegistry } from "./links";

describe("links", () => {
  it("builds explorer and etherscan urls", () => {
    expect(explorerName("nick.eth")).toBe("https://sepolia.explorer.ens.domains/nick.eth");
    expect(explorerRegistry("nick.eth")).toBe("https://sepolia.explorer.ens.domains/nick.eth/registry");
    expect(etherscanAddress("0xabc")).toBe("https://sepolia.etherscan.io/address/0xabc");
    expect(etherscanTx("0xdef")).toBe("https://sepolia.etherscan.io/tx/0xdef");
    expect(etherscanTx("0xdef", 1)).toBe("https://etherscan.io/tx/0xdef");
    expect(explorerName("nick.eth", 1)).toBe("https://explorer.ens.domains/nick.eth");
  });
});
