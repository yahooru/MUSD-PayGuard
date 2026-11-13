import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { MUSD, PAYGUARD_ROUTER, musdAbi, routerAbi } from "@/config/contracts";
import { verifyPayment, type ChainLog, type ExpectedPayment } from "@/lib/verify/receipt";
import { invoiceRefHash } from "@/lib/invoice";
import { ALICE, BOB, CAROL, ONE } from "./fixtures";

function transferLog(from: string, to: string, value: bigint, token: string = MUSD.address): ChainLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: musdAbi, eventName: "Transfer", args: { from: from as Hex, to: to as Hex } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex: 0,
  };
}

function invoiceLog(payer: string, recipient: string, ref: Hex, amount: bigint): ChainLog {
  return {
    address: PAYGUARD_ROUTER.address,
    topics: encodeEventTopics({ abi: routerAbi, eventName: "InvoicePaid", args: { payer: payer as Hex, recipient: recipient as Hex, invoiceRef: ref } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, amount]),
    logIndex: 1,
  };
}

const expected: ExpectedPayment = {
  chainId: 31611,
  token: MUSD.address,
  to: BOB,
  amount: 2n * ONE,
  from: ALICE,
  method: "direct",
  routerAddress: PAYGUARD_ROUTER.address,
  requiredConfirmations: 1,
};

const tx = { hash: "0x1", from: ALICE, to: MUSD.address, chainId: 31611, blockNumber: 100n };
const okReceipt = (logs: ChainLog[], status: "success" | "reverted" = "success") => ({
  status,
  blockNumber: 100n,
  blockHash: "0xblock",
  from: ALICE,
  to: MUSD.address,
  logs,
  gasUsed: 45_000n,
  effectiveGasPrice: 146n,
});

describe("receipt verification", () => {
  it("confirms only when chain, success, target, sender and exact Transfer log all match", () => {
    const r = verifyPayment({ expected, tx, receipt: okReceipt([transferLog(ALICE, BOB, 2n * ONE)]), latestBlock: 101n });
    expect(r.outcome).toBe("confirmed");
    expect(r.confirmations).toBe(2);
    expect(r.matchedTransfer).toMatchObject({ value: (2n * ONE).toString() });
    expect(r.steps.every((s) => s.state === "pass")).toBe(true);
  });

  it("rejects a wrong amount", () => {
    const r = verifyPayment({ expected, tx, receipt: okReceipt([transferLog(ALICE, BOB, 3n * ONE)]), latestBlock: 101n });
    expect(r.outcome).toBe("mismatch");
    expect(r.steps.find((s) => s.id === "transfer_log")?.state).toBe("fail");
  });

  it("rejects a wrong recipient", () => {
    const r = verifyPayment({ expected, tx, receipt: okReceipt([transferLog(ALICE, CAROL, 2n * ONE)]), latestBlock: 101n });
    expect(r.outcome).toBe("mismatch");
  });

  it("rejects a Transfer event emitted by a different (fake) token contract", () => {
    const fake = "0x1111111111111111111111111111111111111111";
    const r = verifyPayment({ expected, tx: { ...tx, to: MUSD.address }, receipt: okReceipt([transferLog(ALICE, BOB, 2n * ONE, fake)]), latestBlock: 101n });
    expect(r.outcome).toBe("mismatch");
    expect(r.transfers).toHaveLength(0);
  });

  it("rejects a transaction sent by a different wallet", () => {
    const r = verifyPayment({ expected, tx: { ...tx, from: CAROL }, receipt: okReceipt([transferLog(CAROL, BOB, 2n * ONE)]), latestBlock: 101n });
    expect(r.outcome).toBe("mismatch");
    expect(r.steps.find((s) => s.id === "sender")?.state).toBe("fail");
  });

  it("rejects a transaction on another chain", () => {
    const r = verifyPayment({ expected, tx: { ...tx, chainId: 1 }, receipt: okReceipt([transferLog(ALICE, BOB, 2n * ONE)]), latestBlock: 101n });
    expect(r.outcome).toBe("mismatch");
  });

  it("reports a reverted transaction", () => {
    const r = verifyPayment({ expected, tx, receipt: okReceipt([], "reverted"), latestBlock: 101n });
    expect(r.outcome).toBe("reverted");
  });

  it("stays pending with no receipt and reports unknown hashes as not found", () => {
    expect(verifyPayment({ expected, tx, receipt: null, latestBlock: 101n }).outcome).toBe("awaiting_receipt");
    expect(verifyPayment({ expected, tx: null, receipt: null, latestBlock: 101n }).outcome).toBe("not_found");
  });

  it("waits for the required confirmations", () => {
    const r = verifyPayment({
      expected: { ...expected, requiredConfirmations: 3 },
      tx,
      receipt: okReceipt([transferLog(ALICE, BOB, 2n * ONE)]),
      latestBlock: 100n,
    });
    expect(r.outcome).toBe("awaiting_receipt");
    expect(r.confirmations).toBe(1);
  });

  it("verifies router payments including the on-chain invoice reference", () => {
    const ref = invoiceRefHash("inv-77");
    const routerExpected: ExpectedPayment = { ...expected, method: "router", invoiceRefHash: ref };
    const routerTx = { ...tx, to: PAYGUARD_ROUTER.address };
    const ok = verifyPayment({
      expected: routerExpected,
      tx: routerTx,
      receipt: { ...okReceipt([transferLog(ALICE, BOB, 2n * ONE), invoiceLog(ALICE, BOB, ref, 2n * ONE)]), to: PAYGUARD_ROUTER.address },
      latestBlock: 100n,
    });
    expect(ok.outcome).toBe("confirmed");
    expect(ok.invoiceRefOnchain).toBe(ref);
    const wrongRef = verifyPayment({
      expected: { ...routerExpected, invoiceRefHash: invoiceRefHash("inv-78") },
      tx: routerTx,
      receipt: { ...okReceipt([transferLog(ALICE, BOB, 2n * ONE), invoiceLog(ALICE, BOB, ref, 2n * ONE)]), to: PAYGUARD_ROUTER.address },
      latestBlock: 100n,
    });
    expect(wrongRef.outcome).toBe("mismatch");
  });

  it("rejects a direct transfer when the router was expected", () => {
    const r = verifyPayment({ expected: { ...expected, method: "router" }, tx, receipt: okReceipt([transferLog(ALICE, BOB, 2n * ONE)]), latestBlock: 100n });
    expect(r.outcome).toBe("mismatch");
  });

  it("public mode (no expected sender) still requires the exact transfer", () => {
    const pub = { ...expected, from: null, method: "any" as const };
    expect(verifyPayment({ expected: pub, tx, receipt: okReceipt([transferLog(ALICE, BOB, 2n * ONE)]), latestBlock: 100n }).outcome).toBe("confirmed");
    expect(verifyPayment({ expected: { ...pub, amount: ONE }, tx, receipt: okReceipt([transferLog(ALICE, BOB, 2n * ONE)]), latestBlock: 100n }).outcome).toBe(
      "mismatch",
    );
  });
});
