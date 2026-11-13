import { describe, expect, it } from "vitest";
import { canSign, explainAssessment, payloadHash, runPreflight, type CheckId, type PreflightContext } from "@/lib/engine";
import { ALICE, BOB, BOB_LOOKALIKE, CAROL, NOW, ONE, baseContext, withPayload } from "./fixtures";
import { MUSD } from "@/config/contracts";

const check = (ctx: PreflightContext, id: CheckId) => {
  const a = runPreflight(ctx);
  const c = a.checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} missing; got ${a.checks.map((x) => x.id).join(",")}`);
  return { a, c };
};

describe("happy path", () => {
  it("a clean payment to a saved, previously paid recipient is low observed risk and may proceed", () => {
    const ctx = baseContext({
      history: [
        { id: "t1", to: BOB, amount: (2n * ONE).toString(), invoiceRefNorm: "INV-1", status: "confirmed", submittedAt: "2026-09-01T10:00:00Z", txHash: "0x01" },
      ],
    });
    const a = runPreflight(ctx);
    expect(a.counts.fail).toBe(0);
    expect(a.category).toBe("low");
    expect(a.categoryLabel).toBe("Low observed risk");
    expect(a.decision).toBe("proceed");
    expect(a.decisionRules).toEqual(["R-CAT-5"]);
    expect(a.blockers).toEqual([]);
    expect(a.payloadHash).toBe(payloadHash(ctx.payload));
  });

  it("every check result is explainable (explanation, recommendation, rule)", () => {
    const a = runPreflight(baseContext());
    for (const c of a.checks) {
      expect(c.explanation.length).toBeGreaterThan(10);
      expect(c.recommendation.length).toBeGreaterThan(3);
      expect(c.rule).toMatch(/^R-[A-Z]{3}-\d{2}$/);
      expect(["pass", "warn", "fail", "unavailable"]).toContain(c.status);
    }
  });
});

describe("recipient address validation", () => {
  it.each([
    ["", "empty"],
    ["0x123", "bad_length"],
    ["9F112Fbf7440a7D8031F72c99e25C179D77f0AB4", "missing_prefix"],
    ["0x9F112Fbf7440a7D8031F72c99e25C179D77f0AB4Z", "non_hex"],
    ["0xO000000000000000000000000000000000000001", "non_hex"],
    ["bob.eth", "looks_like_name"],
    ["0x9F112Fbf7440a7D8031F72c99e25C179D77f0A​B4", "hidden_characters"],
  ])("rejects %j as malformed and blocks sending", (to) => {
    const { a, c } = check(withPayload({ to }), "recipient.format");
    expect(c.status).toBe("fail");
    expect(c.findingClass).toBe("technical_failure");
    expect(c.blocking).toBe(true);
    expect(a.category).toBe("high");
    expect(a.decision).toBe("blocked");
    // dependent checks are reported as not performed, not silently dropped
    expect(a.checks.find((x) => x.id === "recipient.lookalike")?.status).toBe("unavailable");
  });

  it("accepts a valid checksummed address", () => {
    const { c } = check(baseContext(), "recipient.checksum");
    expect(c.status).toBe("pass");
  });

  it("fails a mixed-case address with an invalid EIP-55 checksum", () => {
    const tampered = BOB.replace("c85", "C85"); // flip case of one letter
    const { a, c } = check(withPayload({ to: tampered }), "recipient.checksum");
    expect(c.status).toBe("fail");
    expect(a.decision).toBe("blocked");
  });

  it("reports checksum as not performed for an all-lowercase address", () => {
    const { a, c } = check(withPayload({ to: BOB.toLowerCase() }), "recipient.checksum");
    expect(c.status).toBe("unavailable");
    expect(c.findingClass).toBe("not_performed");
    expect(c.blocking).toBe(false);
    expect(a.decision).not.toBe("blocked");
  });

  it.each([
    ["0x0000000000000000000000000000000000000000", "zero"],
    ["0x000000000000000000000000000000000000dEaD", "burn"],
    [MUSD.address, "token contract"],
    ["0xCdF7028ceAB81fA0C6971208e83fa7872994beE5", "system contract"],
  ])("blocks payments to %s (%s)", (to) => {
    const { a, c } = check(withPayload({ to }, { selectedRecipientId: null }), "recipient.destination");
    expect(c.status).toBe("fail");
    expect(a.decision).toBe("blocked");
  });

  it("warns on self-send without blocking", () => {
    const { a, c } = check(withPayload({ to: ALICE }, { selectedRecipientId: null }), "recipient.self");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("medium");
    expect(a.decision).not.toBe("blocked");
  });

  it("warns when the recipient is a contract and when it is EIP-7702 delegated", () => {
    const contract = check(baseContext({ recipientCode: { ok: true, source: "rpc", value: { code: "0x6080604052" } } }), "recipient.contract");
    expect(contract.c.status).toBe("warn");
    expect(contract.c.severity).toBe("medium");
    const delegated = check(
      baseContext({ recipientCode: { ok: true, source: "rpc", value: { code: "0xef0100" + "ab".repeat(20) } } }),
      "recipient.contract",
    );
    expect(delegated.c.status).toBe("warn");
    expect(delegated.c.severity).toBe("low");
  });

  it("marks recipient type as not performed (caution) when the RPC fails", () => {
    const { a, c } = check(baseContext({ recipientCode: { ok: false, source: "rpc", error: "timeout" } }), "recipient.contract");
    expect(c.status).toBe("unavailable");
    expect(a.category).toBe("caution");
    expect(a.decision).toBe("proceed");
  });
});

describe("saved recipient and lookalike detection", () => {
  it("flags an address that differs from the selected saved contact (critical, needs acknowledgement)", () => {
    const { a, c } = check(withPayload({ to: CAROL }), "recipient.book");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("critical");
    expect(c.requiresAcknowledgement).toBe(true);
    expect(a.category).toBe("high");
    expect(a.decision).toBe("acknowledge");
    expect(a.acknowledgementsRequired).toContain("recipient.book");
  });

  it("flags an address saved under a different contact than the one selected", () => {
    const ctx = withPayload(
      { to: CAROL },
      {
        savedRecipients: [
          { id: "rec-bob", label: "Bob", address: BOB, createdAt: "2026-10-20T10:00:00Z" },
          { id: "rec-carol", label: "Carol", address: CAROL, createdAt: "2026-10-21T10:00:00Z" },
        ],
      },
    );
    // selected Bob, paying Carol's saved address → mismatch with selected contact (critical)
    expect(check(ctx, "recipient.book").c.severity).toBe("critical");
  });

  it("states that a saved label is not a verification", () => {
    const { c } = check(baseContext(), "recipient.book");
    expect(c.status).toBe("pass");
    expect(c.explanation).toMatch(/does not prove/);
  });

  it("detects an address-poisoning lookalike of a saved recipient", () => {
    const { a, c } = check(withPayload({ to: BOB_LOOKALIKE }, { selectedRecipientId: null }), "recipient.lookalike");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("critical");
    expect(c.evidence.some((e) => e.value.includes("first 4"))).toBe(true);
    expect(a.decision).toBe("acknowledge");
  });

  it("detects a lookalike of an on-chain counterparty", () => {
    const ctx = withPayload(
      { to: BOB_LOOKALIKE },
      {
        selectedRecipientId: null,
        savedRecipients: [],
        counterparties: { ok: true, source: "explorer", value: [{ address: BOB, direction: "out", value: (5n * ONE).toString(), timestamp: "2026-10-01T00:00:00Z", txHash: "0xaa" }] },
      },
    );
    expect(check(ctx, "recipient.lookalike").c.severity).toBe("critical");
  });

  it("flags a recipient that only ever sent the user a zero-value transfer (poisoning pattern)", () => {
    const ctx = withPayload(
      { to: CAROL },
      {
        selectedRecipientId: null,
        savedRecipients: [],
        counterparties: { ok: true, source: "explorer", value: [{ address: CAROL, direction: "in", value: "0", timestamp: "2026-10-01T00:00:00Z", txHash: "0xbb" }] },
      },
    );
    const { c } = check(ctx, "recipient.lookalike");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("critical");
    expect(c.explanation).toMatch(/address-poisoning/);
  });

  it("does not flag unrelated addresses", () => {
    expect(check(baseContext(), "recipient.lookalike").c.status).toBe("pass");
  });

  it("warns (low) on a first-time, unsaved recipient", () => {
    const { a, c } = check(withPayload({ to: CAROL }, { selectedRecipientId: null }), "recipient.first_time");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("low");
    expect(a.category).toBe("caution");
    expect(a.decision).toBe("proceed");
  });

  it("reports explorer scam labels as the explorer's claim", () => {
    const { c } = check(
      baseContext({ explorerInfo: { ok: true, source: "explorer", value: { isScam: true, isContract: false, name: null, publicTags: [] } } }),
      "recipient.explorer_flags",
    );
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("high");
    expect(c.explanation).toMatch(/explorer's label/);
  });
});

describe("network and token verification", () => {
  it("blocks a wallet on an unsupported network", () => {
    const { a, c } = check(baseContext({ wallet: { connectedChainId: 1 } }), "network.wallet");
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/Ethereum Mainnet/);
    expect(a.decision).toBe("blocked");
  });

  it("fails safe when the wallet network is unknown", () => {
    const { a, c } = check(baseContext({ wallet: { connectedChainId: null } }), "network.wallet");
    expect(c.status).toBe("unavailable");
    expect(c.blocking).toBe(true);
    expect(a.decision).toBe("blocked");
    expect(a.category).toBe("caution"); // could not verify ≠ confirmed failure
  });

  it("blocks a payload built for a different chain", () => {
    const { a, c } = check(withPayload({ chainId: 31612 }), "network.payment");
    expect(c.status).toBe("fail");
    expect(a.decision).toBe("blocked");
  });

  it("blocks a token that is not the configured MUSD, even if called MUSD", () => {
    const { a, c } = check(withPayload({ token: "0x1111111111111111111111111111111111111111" }), "token.config");
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/call itself MUSD/);
    expect(a.decision).toBe("blocked");
  });

  it("blocks when on-chain token metadata differs", () => {
    const { c } = check(
      baseContext({ token: { ok: true, source: "rpc", value: { hasCode: true, name: "Mezo USD", symbol: "MUSD", decimals: 6 } } }),
      "token.onchain",
    );
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/decimals is 6/);
  });

  it("fails safe when the token cannot be read", () => {
    const { a, c } = check(baseContext({ token: { ok: false, source: "rpc", error: "RPC down" } }), "token.onchain");
    expect(c.status).toBe("unavailable");
    expect(c.blocking).toBe(true);
    expect(a.decision).toBe("blocked");
  });
});

describe("balance, gas and simulation", () => {
  it("blocks when MUSD balance is insufficient and shows the shortfall", () => {
    const { a, c } = check(baseContext({ balances: { ok: true, source: "rpc", value: { musd: ONE, native: 10n ** 15n } } }), "funds.balance");
    expect(c.status).toBe("fail");
    expect(c.evidence.find((e) => e.label === "Shortfall")?.value).toBe("1.00 MUSD");
    expect(a.decision).toBe("blocked");
  });

  it("blocks when there is no BTC for gas and explains the balances are separate", () => {
    const { a, c } = check(baseContext({ balances: { ok: true, source: "rpc", value: { musd: 150n * ONE, native: 0n } } }), "funds.gas");
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/separate balances/);
    expect(a.decision).toBe("blocked");
  });

  it("blocks when BTC is below the maximum fee", () => {
    const { c } = check(baseContext({ balances: { ok: true, source: "rpc", value: { musd: 150n * ONE, native: 1000n } } }), "funds.gas");
    expect(c.status).toBe("fail");
  });

  it("fails safe when balances cannot be read", () => {
    const { a } = check(baseContext({ balances: { ok: false, source: "rpc", error: "503" } }), "funds.balance");
    expect(a.decision).toBe("blocked");
    expect(a.notPerformed).toContain("funds.balance");
  });

  it("treats an implausibly low gas estimate as suspicious and uses the floor", () => {
    const { c } = check(
      baseContext({ fee: { ok: true, source: "rpc", value: { estimate: 21_644n, gasLimit: 90_000n, estimateUsable: false, maxFeePerGas: 200n, maxFee: 18_000_000n } } }),
      "simulation.estimate",
    );
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("low");
    expect(c.explanation).toMatch(/implausibly low/);
  });

  it("blocks when simulation reverts and surfaces the decoded reason", () => {
    const { a, c } = check(
      baseContext({ simulation: { ok: true, source: "rpc", value: { success: false, revert: { reason: "ERC20InsufficientBalance", isRevert: true } } } }),
      "simulation.call",
    );
    expect(c.status).toBe("fail");
    expect(c.explanation).toMatch(/ERC20InsufficientBalance/);
    expect(a.decision).toBe("blocked");
  });

  it("blocks when gas estimation reports a revert", () => {
    const { c } = check(
      baseContext({
        fee: { ok: true, source: "rpc", value: { estimate: null, estimateError: { reason: "transfer to the zero address", isRevert: true }, gasLimit: 90_000n, estimateUsable: false, maxFeePerGas: 200n, maxFee: 1n } },
      }),
      "simulation.estimate",
    );
    expect(c.status).toBe("fail");
  });

  it("clearly states when simulation is unavailable (caution, not blocked)", () => {
    const { a, c } = check(baseContext({ simulation: { ok: false, source: "rpc", error: "method not supported" } }), "simulation.call");
    expect(c.status).toBe("unavailable");
    expect(c.explanation).toMatch(/could not be simulated/);
    expect(a.category).toBe("caution");
    expect(a.decision).toBe("proceed");
  });

  it("warns on an amount far above the user's history (extra zero)", () => {
    const history = ["1", "2", "2", "3"].map((v, i) => ({
      id: `h${i}`,
      to: BOB,
      amount: (BigInt(v) * ONE).toString(),
      invoiceRefNorm: null,
      status: "confirmed" as const,
      submittedAt: "2026-09-01T00:00:00Z",
      txHash: `0x0${i}`,
    }));
    const { c } = check(withPayload({ amount: (20n * ONE).toString() }, { history }), "funds.anomaly");
    expect(c.status).toBe("warn");
    expect(c.explanation).toMatch(/extra zero/);
    const normal = check(withPayload({ amount: (2n * ONE).toString() }, { history }), "funds.anomaly");
    expect(normal.c.status).toBe("pass");
  });

  it("rejects a zero amount", () => {
    const { a, c } = check(withPayload({ amount: "0" }), "funds.amount");
    expect(c.status).toBe("fail");
    expect(a.decision).toBe("blocked");
  });
});

describe("duplicate payment protection", () => {
  const confirmed = {
    id: "tx-old",
    to: BOB,
    amount: (2n * ONE).toString(),
    invoiceRefNorm: "INV-1001",
    status: "confirmed" as const,
    submittedAt: "2026-10-25T10:00:00Z",
    txHash: "0xabc",
  };

  it("flags an invoice reference already associated with a confirmed payment, with a link to inspect it", () => {
    const { a, c } = check(withPayload({ invoiceRef: " inv-1001 " }, { history: [confirmed] }), "duplicates.invoice_paid");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("high");
    expect(c.explanation).toMatch(/Possible duplicate payment: this invoice reference has already been associated with a confirmed transaction/);
    expect(c.related?.[0]).toMatchObject({ kind: "transaction", id: "tx-old" });
    expect(a.decision).toBe("acknowledge");
  });

  it("passes once the reference is corrected", () => {
    const { a, c } = check(withPayload({ invoiceRef: "INV-1002" }, { history: [{ ...confirmed, submittedAt: "2026-09-01T10:00:00Z" }] }), "duplicates.invoice_paid");
    expect(c.status).toBe("pass");
    expect(a.decision).toBe("proceed");
  });

  it("flags a reference used by a pending payment", () => {
    const { c } = check(withPayload({}, { history: [{ ...confirmed, status: "pending" }] }), "duplicates.invoice_pending");
    expect(c.status).toBe("warn");
    expect(c.requiresAcknowledgement).toBe(true);
  });

  it("does not treat failed attempts as paid", () => {
    const { c } = check(withPayload({}, { history: [{ ...confirmed, status: "failed" }] }), "duplicates.invoice_paid");
    expect(c.status).toBe("pass");
    expect(c.explanation).toMatch(/failed/);
  });

  it("never blocks legitimate recurring identical payments (medium warning only)", () => {
    const { a, c } = check(withPayload({ invoiceRef: "RENT-NOV" }, { history: [{ ...confirmed, invoiceRefNorm: "RENT-OCT" }] }), "duplicates.similar_recent");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("medium");
    expect(a.decision).toBe("proceed");
  });

  it("raises an identical still-pending payment to high", () => {
    const pending = { ...confirmed, invoiceRefNorm: null, status: "pending" as const, submittedAt: new Date(NOW - 10 * 60_000).toISOString() };
    expect(check(withPayload({ invoiceRef: null }, { history: [pending] }), "duplicates.similar_recent").c.severity).toBe("high");
  });

  it("reports duplicate detection as limited when no reference is given", () => {
    const { c } = check(withPayload({ invoiceRef: null }), "duplicates.reference");
    expect(c.status).toBe("unavailable");
  });

  it("uses the on-chain registry when available", () => {
    const { c } = check(
      baseContext({ onchainInvoice: { ok: true, source: "router", value: { paid: true, amount: (2n * ONE).toString(), blockNumber: "100" } } }),
      "duplicates.onchain_registry",
    );
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("high");
  });
});

describe("payment requests", () => {
  const request = {
    id: "pr_test",
    creator: BOB,
    recipient: BOB,
    amount: (2n * ONE).toString(),
    token: MUSD.address,
    chainId: 31611,
    invoiceRef: "INV-1001",
    description: "Design work",
    createdAt: "2026-10-25T00:00:00Z",
    expiresAt: "2026-11-25T00:00:00Z",
    status: "open" as const,
    paidTxId: null,
  };

  it("passes a payment that matches its request", () => {
    const a = runPreflight(withPayload({ requestId: "pr_test" }, { request }));
    for (const id of ["request.status", "request.expiry", "request.recipient", "request.amount", "request.network", "request.token", "request.reference"] as CheckId[]) {
      expect(a.checks.find((c) => c.id === id)?.status, id).toBe("pass");
    }
  });

  it("flags an expired request", () => {
    const { c } = check(withPayload({ requestId: "pr_test" }, { request: { ...request, expiresAt: "2026-10-01T00:00:00Z" } }), "request.expiry");
    expect(c.status).toBe("warn");
    expect(c.severity).toBe("high");
  });

  it("flags an invoice amount mismatch with the difference", () => {
    const { c } = check(withPayload({ amount: (3n * ONE).toString(), requestId: "pr_test" }, { request }), "request.amount");
    expect(c.status).toBe("warn");
    expect(c.explanation).toMatch(/more than the request/);
  });

  it("blocks a request on another network or with another token", () => {
    expect(check(withPayload({ requestId: "pr_test" }, { request: { ...request, chainId: 1 } }), "request.network").a.decision).toBe("blocked");
    expect(
      check(withPayload({ requestId: "pr_test" }, { request: { ...request, token: "0x1111111111111111111111111111111111111111" } }), "request.token").a
        .decision,
    ).toBe("blocked");
  });

  it("flags paying a different address than the request names", () => {
    const { c } = check(withPayload({ to: CAROL, requestId: "pr_test" }, { request, selectedRecipientId: null }), "request.recipient");
    expect(c.severity).toBe("critical");
  });

  it("flags an already-paid request", () => {
    const { c } = check(withPayload({ requestId: "pr_test" }, { request: { ...request, status: "paid", paidTxId: "tx-1" } }), "request.status");
    expect(c.status).toBe("warn");
    expect(c.related?.[0]?.id).toBe("tx-1");
  });
});

describe("review integrity", () => {
  it("passes when the payload is unchanged since review", () => {
    const ctx = baseContext();
    const reviewed = payloadHash(ctx.payload);
    expect(check({ ...ctx, reviewedPayloadHash: reviewed }, "integrity.payload").c.status).toBe("pass");
  });

  it("blocks when any detail changed after review", () => {
    const ctx = baseContext();
    const reviewed = payloadHash(ctx.payload);
    for (const patch of [{ amount: (3n * ONE).toString() }, { to: CAROL }, { invoiceRef: "INV-9" }, { to: BOB.toLowerCase() }]) {
      const changed = { ...ctx, payload: { ...ctx.payload, ...patch }, reviewedPayloadHash: reviewed };
      const { a, c } = check(changed, "integrity.payload");
      expect(c.status).toBe("fail");
      expect(a.decision).toBe("blocked");
    }
  });
});

describe("decision gate and assistant", () => {
  it("requires every serious warning to be acknowledged before signing", () => {
    const a = runPreflight(withPayload({ to: BOB_LOOKALIKE }, { selectedRecipientId: null }));
    expect(canSign(a, []).ok).toBe(false);
    expect(canSign(a, a.acknowledgementsRequired).ok).toBe(true);
  });

  it("never allows signing a blocked assessment, even with acknowledgements", () => {
    const a = runPreflight(withPayload({ to: "0x123" }));
    expect(canSign(a, a.checks.map((c) => c.id)).ok).toBe(false);
  });

  it("the assistant only restates engine findings and cannot soften failures", () => {
    const a = runPreflight(baseContext({ wallet: { connectedChainId: 1 } }));
    const e = explainAssessment(a);
    expect(e.headline).toMatch(/stopped/);
    expect(e.points[0]?.tone).toBe("stop");
    expect(e.points.every((p) => a.checks.some((c) => c.id === p.checkId))).toBe(true);
  });

  it("distinguishes technical failure, suspicious pattern and not performed", () => {
    const a = runPreflight(
      withPayload(
        { to: BOB_LOOKALIKE },
        { selectedRecipientId: null, wallet: { connectedChainId: 1 }, simulation: { ok: false, source: "rpc", error: "down" } },
      ),
    );
    const classes = new Set(a.checks.map((c) => c.findingClass));
    expect(classes.has("technical_failure")).toBe(true);
    expect(classes.has("suspicious_pattern")).toBe(true);
    expect(classes.has("not_performed")).toBe(true);
  });
});
