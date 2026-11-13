import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { MUSD, PAYGUARD_ROUTER, musdAbi } from "@/config/contracts";
import { payloadHash } from "@/lib/engine/payload";
import { checkSignRequest, type SignRequest } from "@/lib/engine/sign-guard";
import { invoiceRefHash } from "@/lib/invoice";
import { ALICE, BOB, CAROL, ONE, baseContext } from "./fixtures";

const payload = baseContext().payload;
const expected = { chainId: 31611, token: MUSD.address, router: PAYGUARD_ROUTER.address };
const directReq = (over: Partial<SignRequest> = {}, data = encodeFunctionData({ abi: musdAbi, functionName: "transfer", args: [BOB, 2n * ONE] })): SignRequest => ({
  reviewedPayloadHash: payloadHash(payload),
  payload,
  account: ALICE,
  walletChainId: 31611,
  expected,
  call: { kind: "direct", to: MUSD.address, data },
  ...over,
});

describe("pre-signature guard", () => {
  it("allows the exact reviewed transfer", () => {
    expect(checkSignRequest(directReq()).ok).toBe(true);
  });

  it("refuses when the calldata recipient or amount differ from the reviewed payload", () => {
    const wrongTo = checkSignRequest(directReq({}, encodeFunctionData({ abi: musdAbi, functionName: "transfer", args: [CAROL, 2n * ONE] })));
    const wrongAmt = checkSignRequest(directReq({}, encodeFunctionData({ abi: musdAbi, functionName: "transfer", args: [BOB, 3n * ONE] })));
    expect(wrongTo.ok).toBe(false);
    expect(wrongAmt.ok).toBe(false);
  });

  it("refuses when the wallet account or network changed", () => {
    expect(checkSignRequest(directReq({ account: CAROL })).ok).toBe(false);
    expect(checkSignRequest(directReq({ walletChainId: 1 })).ok).toBe(false);
  });

  it("refuses when the payload changed after review", () => {
    expect(checkSignRequest(directReq({ payload: { ...payload, amount: (5n * ONE).toString() } })).ok).toBe(false);
  });

  it("refuses a call to a non-MUSD contract", () => {
    const r = directReq();
    expect(checkSignRequest({ ...r, call: { ...(r.call as { kind: "direct"; to: string; data: `0x${string}` }), to: CAROL } }).ok).toBe(false);
  });

  it("checks router calls including the invoice reference hash", () => {
    const routerPayload = { ...payload, method: "router" as const };
    const base: SignRequest = {
      reviewedPayloadHash: payloadHash(routerPayload),
      payload: routerPayload,
      account: ALICE,
      walletChainId: 31611,
      expected,
      call: { kind: "router", to: PAYGUARD_ROUTER.address, args: { to: BOB, amount: 2n * ONE, invoiceRefHash: invoiceRefHash("INV-1001") }, expectedRefHash: invoiceRefHash("INV-1001") },
    };
    expect(checkSignRequest(base).ok).toBe(true);
    expect(
      checkSignRequest({ ...base, call: { ...(base.call as Extract<SignRequest["call"], { kind: "router" }>), args: { to: BOB, amount: 2n * ONE, invoiceRefHash: invoiceRefHash("INV-9") } } }).ok,
    ).toBe(false);
  });
});
