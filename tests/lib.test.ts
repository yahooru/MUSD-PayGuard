import { describe, expect, it } from "vitest";
import { bigintMedian, formatAmount, formatUnitsExact, parseAmountInput, ratio } from "@/lib/amount";
import { invoiceRefHash, normalizeInvoiceRef, validateInvoiceRef } from "@/lib/invoice";
import { analyzeAddress, lookalikeStrength, sharedEnds } from "@/lib/engine/address";
import { canTransition, nextStatus, type TxStatus } from "@/lib/engine/status";
import { gasLimitFor } from "@/config/contracts";
import { isSupportedChain } from "@/config/chains";
import { groupHex } from "@/lib/format";
import { keccak256, toBytes } from "viem";
import { ALICE, BOB } from "./fixtures";

describe("amount parsing (bigint, no floats)", () => {
  it.each([
    ["2", 2n * 10n ** 18n],
    ["0.1", 10n ** 17n],
    ["1250.50", 125050n * 10n ** 16n],
    [".5", 5n * 10n ** 17n],
    ["0.000000000000000001", 1n],
  ])("parses %s", (input, expected) => {
    const r = parseAmountInput(input);
    expect(r.ok && r.value).toBe(expected);
  });

  it.each(["", "0", "-1", "1e3", "1,000", "1.2.3", "abc", "0.0000000000000000001", "10000000000000"])("rejects %j", (input) => {
    expect(parseAmountInput(input).ok).toBe(false);
  });

  it("formats with grouping and rounds down", () => {
    expect(formatAmount(1234567n * 10n ** 16n)).toBe("12,345.67");
    expect(formatAmount(19999n * 10n ** 14n, { maxFraction: 2 })).toBe("1.99");
    expect(formatUnitsExact(125n * 10n ** 16n)).toBe("1.25");
    expect(ratio(10n, 4n)).toBe(2.5);
    expect(bigintMedian([1n, 3n, 2n])).toBe(2n);
    expect(bigintMedian([1n, 2n, 3n, 4n])).toBe(2n);
  });
});

describe("invoice references", () => {
  it("normalises case, spacing and unicode forms", () => {
    expect(normalizeInvoiceRef("  inv-0042 ")).toBe("INV-0042");
    expect(normalizeInvoiceRef("inv  0042")).toBe("INV 0042");
    expect(normalizeInvoiceRef("ｉｎｖ-１")).toBe("INV-1"); // full-width forms (NFKC)
  });
  it("hashes the normalised ref exactly like the PayGuardRouter convention", () => {
    expect(invoiceRefHash(" inv-0042")).toBe(keccak256(toBytes("INV-0042")));
  });
  it("rejects invisible characters and over-long refs", () => {
    expect(validateInvoiceRef("INV​-1").ok).toBe(false);
    expect(validateInvoiceRef("x".repeat(65)).ok).toBe(false);
    expect(validateInvoiceRef("INV-1").ok).toBe(true);
  });
});

describe("address helpers", () => {
  it("analyses checksum states", () => {
    expect(analyzeAddress(ALICE).checksum).toBe("valid");
    expect(analyzeAddress(ALICE.toLowerCase()).checksum).toBe("absent");
    expect(analyzeAddress(ALICE.replace("9F1", "9f1")).checksum).toBe("invalid");
    expect(analyzeAddress(`  ${ALICE} `).hadSurroundingWhitespace).toBe(true);
  });
  it("measures shared prefix/suffix and lookalike strength", () => {
    const look = `0x6c85${"0".repeat(32)}f631`;
    expect(sharedEnds(BOB, look)).toEqual({ prefix: 4, suffix: 4 });
    expect(lookalikeStrength(BOB, look)).toBe("strong");
    expect(lookalikeStrength(BOB, `0x6c8${"0".repeat(33)}f631`)).toBe("moderate"); // 3 + 4
    expect(lookalikeStrength(BOB, `0x6c${"0".repeat(34)}f631`)).toBe(null); // 2 + 4: too weak
    expect(lookalikeStrength(BOB, BOB.toLowerCase())).toBe(null);
    expect(lookalikeStrength(BOB, ALICE)).toBe(null);
  });
  it("groups hex for display", () => {
    expect(groupHex("0x1234abcd")).toEqual(["0x", "1234", "abcd"]);
  });
});

describe("transaction status transitions", () => {
  const opts = { now: 1_000_000, submittedAtMs: 0, missingGraceMs: 600_000 };
  it("only the verifier can confirm or fail; terminal states never change", () => {
    expect(nextStatus("pending", "confirmed", opts)).toBe("confirmed");
    expect(nextStatus("pending", "reverted", opts)).toBe("failed");
    expect(nextStatus("pending", "mismatch", opts)).toBe("failed");
    expect(nextStatus("confirmed", "rpc_error", opts)).toBe("confirmed");
    expect(nextStatus("failed", "confirmed", opts)).toBe("failed");
  });
  it("RPC errors produce verification delayed, never success", () => {
    expect(nextStatus("pending", "rpc_error", opts)).toBe("verification_delayed");
    expect(nextStatus("verification_delayed", "awaiting_receipt", opts)).toBe("pending");
    expect(nextStatus("verification_delayed", "confirmed", opts)).toBe("confirmed");
  });
  it("missing hashes become unknown only after the grace period", () => {
    expect(nextStatus("pending", "not_found", { ...opts, now: 1000 })).toBe("pending");
    expect(nextStatus("pending", "not_found", opts)).toBe("unknown");
    expect(nextStatus("unknown", "confirmed", opts)).toBe("confirmed");
  });
  it("transition table is closed", () => {
    const all: TxStatus[] = ["pending", "confirmed", "failed", "verification_delayed", "unknown"];
    for (const s of all) expect(canTransition(s, s)).toBe(true);
    expect(canTransition("confirmed", "pending")).toBe(false);
  });
});

describe("gas policy and network config", () => {
  it("always applies an explicit floor and treats tiny estimates as invalid", () => {
    expect(gasLimitFor("erc20Transfer", 21_644n)).toEqual({ gas: 90_000n, estimateUsable: false });
    expect(gasLimitFor("erc20Transfer", 34_573n)).toEqual({ gas: 90_000n, estimateUsable: true });
    expect(gasLimitFor("erc20Transfer", 100_000n)).toEqual({ gas: 130_000n, estimateUsable: true });
    expect(gasLimitFor("routerPay", null).gas).toBe(250_000n);
  });
  it("supports only Mezo Testnet for sending", () => {
    expect(isSupportedChain(31611)).toBe(true);
    expect(isSupportedChain(31612)).toBe(false);
    expect(isSupportedChain(1)).toBe(false);
    expect(isSupportedChain(undefined)).toBe(false);
  });
});
