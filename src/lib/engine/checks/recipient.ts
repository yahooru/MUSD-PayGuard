import { formatAmount } from "../../amount";
import { analyzeAddress, lookalikeStrength, sameAddress, sharedEnds, type AddressAnalysis } from "../address";
import { result, skipped } from "../result";
import type { CheckResult, Evidence, PreflightContext, RelatedRecord } from "../types";

const DUST = 10n ** 15n; // 0.001 MUSD: transfers at or below this are treated as dust for poisoning detection

export function recipientChecks(ctx: PreflightContext, a: AddressAnalysis): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(formatCheck(a));
  if (!a.valid) {
    const why = "the recipient address is not valid.";
    out.push(
      skipped("recipient.checksum", why),
      skipped("recipient.destination", why),
      skipped("recipient.self", why),
      skipped("recipient.contract", why),
      skipped("recipient.book", why),
      skipped("recipient.lookalike", why),
      skipped("recipient.first_time", why),
    );
    return out;
  }
  out.push(checksumCheck(a));
  out.push(destinationCheck(ctx, a));
  out.push(selfCheck(ctx, a));
  out.push(contractCheck(ctx, a));
  out.push(bookCheck(ctx, a));
  out.push(lookalikeCheck(ctx, a));
  out.push(firstTimeCheck(ctx, a));
  if (ctx.explorerInfo) out.push(explorerFlagsCheck(ctx, a));
  return out;
}

function formatCheck(a: AddressAnalysis): CheckResult {
  if (!a.valid) {
    return result("recipient.format", {
      status: "fail",
      severity: "critical",
      explanation: a.problem ?? "The recipient address is not a valid EVM address.",
      recommendation:
        "Copy the complete address again directly from the recipient (not from a screenshot or a message forwarded by someone else).",
      evidence: [{ label: "Entered", value: a.input.length > 80 ? `${a.input.slice(0, 80)}…` : a.input || "(empty)", kind: "text" }],
    });
  }
  return result("recipient.format", {
    status: "pass",
    severity: "info",
    explanation: a.hadSurroundingWhitespace
      ? "The address is a valid 20-byte EVM address (surrounding spaces were removed). A valid format does not prove who controls it."
      : "The address is a valid 20-byte EVM address. A valid format does not prove who controls it.",
    recommendation: "Compare the full address below with the one the recipient gave you, character group by group.",
    evidence: [{ label: "Address", value: a.checksummed!, kind: "address" }],
  });
}

function checksumCheck(a: AddressAnalysis): CheckResult {
  if (a.checksum === "invalid") {
    return result("recipient.checksum", {
      status: "fail",
      severity: "critical",
      explanation:
        "The address uses mixed upper and lower case, but the capitalisation does not match its EIP-55 checksum. That almost always means a character was mistyped or altered.",
      recommendation: "Do not edit the address by hand. Ask the recipient to send it again and paste it unchanged.",
      evidence: [
        { label: "Entered", value: a.trimmed, kind: "address" },
        { label: "Checksum form of these characters", value: a.checksummed!, kind: "address" },
      ],
    });
  }
  if (a.checksum === "valid") {
    return result("recipient.checksum", {
      status: "pass",
      severity: "info",
      explanation: "The mixed-case address matches its EIP-55 checksum, so a single mistyped character is unlikely.",
      recommendation: "No action needed.",
    });
  }
  return result("recipient.checksum", {
    status: "unavailable",
    severity: "info",
    explanation:
      "The address is all lower case or all upper case, so it carries no checksum and typos cannot be detected this way.",
    recommendation: "Compare the full address carefully. PayGuard shows the checksummed form on the review screen.",
    evidence: [{ label: "Checksummed form", value: a.checksummed!, kind: "address" }],
  });
}

function destinationCheck(ctx: PreflightContext, a: AddressAnalysis): CheckResult {
  const lower = a.lower!;
  const burn = ctx.config.burnAddresses[lower];
  const system = ctx.config.systemContracts[lower];
  const isToken = sameAddress(lower, ctx.config.token.address);
  if (burn || system || isToken) {
    const what = burn ?? system ?? "the MUSD token contract itself";
    return result("recipient.destination", {
      status: "fail",
      severity: "critical",
      explanation: `The recipient is ${what}. MUSD sent there cannot be recovered, or the token rejects the transfer outright.`,
      recommendation: "This is never a valid payment destination. Get the recipient's own wallet address.",
      evidence: [{ label: "Recipient", value: a.checksummed!, kind: "address", href: ctx.config.explorerAddress(a.checksummed!) }],
    });
  }
  return result("recipient.destination", {
    status: "pass",
    severity: "info",
    explanation: "Not a burn address, the token contract or a known MUSD system contract.",
    recommendation: "No action needed.",
  });
}

function selfCheck(ctx: PreflightContext, a: AddressAnalysis): CheckResult {
  if (sameAddress(a.lower, ctx.payload.from)) {
    return result("recipient.self", {
      status: "warn",
      severity: "medium",
      explanation: "The recipient is your own connected wallet. You would pay a network fee and your MUSD balance would not change.",
      recommendation: "If you meant to pay someone else, select their saved address or paste their address again.",
      evidence: [{ label: "Your wallet", value: ctx.payload.from, kind: "address" }],
    });
  }
  return result("recipient.self", {
    status: "pass",
    severity: "info",
    explanation: "The recipient is not your connected wallet.",
    recommendation: "No action needed.",
  });
}

function contractCheck(ctx: PreflightContext, a: AddressAnalysis): CheckResult {
  const obs = ctx.recipientCode;
  if (!obs.ok) {
    return result("recipient.contract", {
      status: "unavailable",
      severity: "medium",
      explanation: `PayGuard could not read whether the recipient is a contract (${obs.error}).`,
      recommendation: "Retry the review. If it keeps failing, the RPC may be down; you can still compare the address manually.",
      evidence: [{ label: "Source", value: obs.source, kind: "text" }],
    });
  }
  const code = obs.value.code;
  if (!code || code === "0x") {
    return result("recipient.contract", {
      status: "pass",
      severity: "info",
      explanation: "The recipient is a regular account (no contract code), which can hold and send MUSD.",
      recommendation: "No action needed.",
    });
  }
  if (code.toLowerCase().startsWith("0xef0100") && code.length === 2 + 46) {
    const delegate = `0x${code.slice(8)}`;
    return result("recipient.contract", {
      status: "warn",
      severity: "low",
      explanation:
        "The recipient is an account that has delegated its code to a smart contract (EIP-7702). It is usually still controlled by its owner, but its behaviour depends on that contract.",
      recommendation: "Confirm with the recipient that this is their wallet.",
      evidence: [{ label: "Delegates to", value: delegate, kind: "address", href: ctx.config.explorerAddress(delegate) }],
    });
  }
  return result("recipient.contract", {
    status: "warn",
    severity: "medium",
    explanation:
      "The recipient is a smart contract, not a regular wallet. Unless it was designed to hold MUSD (for example a multisig or smart-contract wallet), tokens sent to it may be stuck permanently.",
    recommendation: "Pay a contract only if the recipient told you to, through a channel you trust.",
    evidence: [
      { label: "Contract code size", value: `${(code.length - 2) / 2} bytes`, kind: "number" },
      { label: "Inspect on explorer", value: a.checksummed!, kind: "address", href: ctx.config.explorerAddress(a.checksummed!) },
    ],
  });
}

function bookCheck(ctx: PreflightContext, a: AddressAnalysis): CheckResult {
  const saved = ctx.savedRecipients;
  const selected = ctx.selectedRecipientId ? saved.find((r) => r.id === ctx.selectedRecipientId) : undefined;
  const exact = saved.filter((r) => sameAddress(r.address, a.lower));

  if (selected && !sameAddress(selected.address, a.lower)) {
    const ends = sharedEnds(selected.address, a.lower!);
    return result("recipient.book", {
      status: "warn",
      severity: "critical",
      explanation: `You selected “${selected.label}”, but the address being paid is different from the address you saved for that contact${
        ends.prefix >= 3 || ends.suffix >= 3 ? ", even though the beginning or end looks similar" : ""
      }.`,
      recommendation: `Use the saved address for “${selected.label}”, or confirm the new address with them through a channel you trust before updating the contact.`,
      evidence: [
        { label: `Saved for ${selected.label}`, value: selected.address, kind: "address" },
        { label: "Address being paid", value: a.checksummed!, kind: "address" },
      ],
      related: [{ kind: "recipient", id: selected.id, label: selected.label }],
    });
  }

  if (selected && exact.length > 0 && !exact.some((r) => r.id === selected.id)) {
    return result("recipient.book", {
      status: "warn",
      severity: "high",
      explanation: `This address is saved under “${exact[0]!.label}”, not under “${selected.label}”, the contact you selected.`,
      recommendation: "Check which person you intend to pay.",
      evidence: exact.map((r) => ({ label: `Saved as ${r.label}`, value: r.address, kind: "address" as const })),
    });
  }

  if (exact.length > 0) {
    const r = exact[0]!;
    return result("recipient.book", {
      status: "pass",
      severity: "info",
      explanation: `Matches “${r.label}” in your recipient book. This only means you saved it on ${r.createdAt.slice(
        0,
        10,
      )}; it does not prove who controls the address.`,
      recommendation: "For large or unusual payments, confirm the address with the recipient through a channel you trust.",
      evidence: [{ label: `Saved as ${r.label}`, value: r.address, kind: "address" }],
      related: [{ kind: "recipient", id: r.id, label: r.label }],
    });
  }

  return result("recipient.book", {
    status: "pass",
    severity: "info",
    explanation:
      saved.length === 0
        ? "Your recipient book is empty, so there is nothing to compare against."
        : "This address is not in your recipient book and no contact was selected, so there was no saved address to contradict.",
    recommendation: "After you have confirmed the address with the recipient, save it so future payments can be compared.",
  });
}

interface Candidate {
  address: string;
  source: string;
  related?: RelatedRecord;
}

function lookalikeCheck(ctx: PreflightContext, a: AddressAnalysis): CheckResult {
  const target = a.lower!;
  const candidates: Candidate[] = [];
  for (const r of ctx.savedRecipients) {
    candidates.push({ address: r.address, source: `saved recipient “${r.label}”`, related: { kind: "recipient", id: r.id, label: r.label } });
  }
  for (const h of ctx.history) {
    if (h.status === "confirmed")
      candidates.push({ address: h.to, source: "an address you paid before", related: { kind: "transaction", id: h.id, label: "Earlier payment" } });
  }
  const explorerOk = ctx.counterparties.ok;
  const counterparties = ctx.counterparties.ok ? ctx.counterparties.value : [];
  for (const c of counterparties) {
    // Only counterparties with real value count as "known"; dust senders are what poisoning looks like.
    if (c.direction === "out" || BigInt(c.value) > DUST) {
      candidates.push({ address: c.address, source: c.direction === "out" ? "an address you sent MUSD to on-chain" : "an address that sent you MUSD" });
    }
  }

  // Pattern 1: target itself only ever appeared as a zero-value / dust sender to the user.
  const asSender = counterparties.filter((c) => sameAddress(c.address, target));
  const onlyDustIn = asSender.length > 0 && asSender.every((c) => c.direction === "in" && BigInt(c.value) <= DUST);

  const matches: { cand: Candidate; strength: "strong" | "moderate"; prefix: number; suffix: number }[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    const key = cand.address.toLowerCase();
    if (seen.has(key)) continue;
    const strength = lookalikeStrength(target, cand.address);
    if (strength) {
      seen.add(key);
      matches.push({ cand, strength, ...sharedEnds(target, cand.address) });
    }
  }
  matches.sort((x, y) => (x.strength === y.strength ? y.prefix + y.suffix - (x.prefix + x.suffix) : x.strength === "strong" ? -1 : 1));

  const coverage = `Compared with ${ctx.savedRecipients.length} saved recipient(s), ${
    ctx.history.filter((h) => h.status === "confirmed").length
  } past payment(s) and ${explorerOk ? `${counterparties.length} on-chain transfer(s)` : "no on-chain history (explorer unavailable)"}.`;

  if (matches.length > 0 || onlyDustIn) {
    const top = matches[0];
    const evidence: Evidence[] = [{ label: "Address being paid", value: a.checksummed!, kind: "address" }];
    if (top) {
      evidence.push({ label: `Lookalike of ${top.cand.source}`, value: top.cand.address, kind: "address" });
      evidence.push({
        label: "Matching characters",
        value: `first ${top.prefix} and last ${top.suffix} after 0x — the rest differs`,
        kind: "text",
      });
    }
    if (onlyDustIn) {
      const first = asSender[0]!;
      evidence.push({
        label: "Seen on-chain as",
        value: `a ${formatAmount(BigInt(first.value), { maxFraction: 6 })} MUSD transfer to you`,
        kind: "text",
      });
      evidence.push({ label: "Transfer", value: first.txHash, kind: "hash", href: ctx.config.explorerTx(first.txHash) });
    }
    const strong = onlyDustIn || top?.strength === "strong";
    return result("recipient.lookalike", {
      status: "warn",
      severity: strong ? "critical" : "high",
      explanation: onlyDustIn
        ? "This address has only ever sent you a zero-value or dust transfer. That is the signature of an address-poisoning attack: the attacker plants a lookalike address in your history hoping you copy it."
        : `This address looks like ${top!.cand.source} — the first ${top!.prefix} and last ${top!.suffix} characters match — but it is a different address. Attackers create lookalike addresses so a shortened “0x1234…abcd” view looks right.`,
      recommendation:
        "Do not copy addresses from your transaction history. Use your saved contact or get the full address directly from the recipient and compare every character group.",
      evidence,
      related: top?.cand.related ? [top.cand.related] : undefined,
    });
  }
  return result("recipient.lookalike", {
    status: "pass",
    severity: "info",
    explanation: `No lookalike found. ${coverage}`,
    recommendation: explorerOk ? "No action needed." : "On-chain history could not be checked; compare the address manually.",
  });
}

function firstTimeCheck(ctx: PreflightContext, a: AddressAnalysis): CheckResult {
  const paid = ctx.history.filter((h) => h.status === "confirmed" && sameAddress(h.to, a.lower));
  const saved = ctx.savedRecipients.find((r) => sameAddress(r.address, a.lower));
  if (paid.length > 0) {
    const last = paid.reduce((m, h) => (h.submittedAt > m.submittedAt ? h : m));
    return result("recipient.first_time", {
      status: "pass",
      severity: "info",
      explanation: `You have paid this address ${paid.length} time(s) through PayGuard, most recently on ${last.submittedAt.slice(0, 10)}.`,
      recommendation: "No action needed.",
      related: [{ kind: "transaction", id: last.id, label: "Most recent payment" }],
    });
  }
  if (saved) {
    return result("recipient.first_time", {
      status: "pass",
      severity: "info",
      explanation: `You have not paid this address through PayGuard yet, but you saved it as “${saved.label}”.`,
      recommendation: "For a first payment, consider sending a small test amount first.",
    });
  }
  return result("recipient.first_time", {
    status: "warn",
    severity: "low",
    explanation: "You have never paid this address through PayGuard and it is not in your recipient book.",
    recommendation:
      "Confirm the full address with the recipient through a channel you trust (a call or a known contact, not the message that sent the address). Consider a small test payment first.",
  });
}

function explorerFlagsCheck(ctx: PreflightContext, a: AddressAnalysis): CheckResult {
  const obs = ctx.explorerInfo!;
  if (!obs.ok) {
    return result("recipient.explorer_flags", {
      status: "unavailable",
      severity: "low",
      explanation: `The block explorer could not be reached (${obs.error}), so public labels were not checked.`,
      recommendation: "This check is informational; the other checks still apply.",
    });
  }
  const info = obs.value;
  const evidence: Evidence[] = [];
  if (info.name) evidence.push({ label: "Explorer name", value: info.name, kind: "text" });
  if (info.publicTags.length > 0) evidence.push({ label: "Public tags", value: info.publicTags.join(", "), kind: "text" });
  evidence.push({ label: "Source", value: "Mezo explorer (Blockscout)", kind: "text", href: ctx.config.explorerAddress(a.checksummed!) });
  if (info.isScam) {
    return result("recipient.explorer_flags", {
      status: "warn",
      severity: "high",
      explanation:
        "The Mezo block explorer labels this address as a scam. This is the explorer's label, not PayGuard's own finding, but it is a strong reason to stop.",
      recommendation: "Do not pay unless you have independently confirmed with the recipient why the address is labelled.",
      evidence,
    });
  }
  return result("recipient.explorer_flags", {
    status: "pass",
    severity: "info",
    explanation: "The explorer has no negative label for this address. Absence of a label proves nothing about the owner.",
    recommendation: "No action needed.",
    evidence,
  });
}
