import { bigintMax, bigintMedian, formatAmount, ratio } from "../../amount";
import { formatGas } from "../../format";
import { result, skipped } from "../result";
import type { CheckResult, PreflightContext } from "../types";

const UINT256_MAX = 2n ** 256n - 1n;

export function parsePayloadAmount(amount: string): bigint | null {
  if (!/^\d{1,78}$/.test(amount)) return null;
  const v = BigInt(amount);
  return v > UINT256_MAX ? null : v;
}

const musd = (v: bigint) => `${formatAmount(v, { maxFraction: 6 })} MUSD`;
const btc = (v: bigint) => `${formatAmount(v, { maxFraction: 8, minFraction: 0 })} BTC`;

export function fundsChecks(ctx: PreflightContext): CheckResult[] {
  const out: CheckResult[] = [];
  const amount = parsePayloadAmount(ctx.payload.amount);

  if (amount === null || amount === 0n) {
    out.push(
      result("funds.amount", {
        status: "fail",
        severity: "critical",
        explanation: amount === 0n ? "The amount is zero." : "The amount is not a valid token amount.",
        recommendation: "Enter a positive amount.",
      }),
    );
    out.push(skipped("funds.balance", "the amount is invalid."), skipped("funds.anomaly", "the amount is invalid."));
  } else {
    out.push(
      result("funds.amount", {
        status: "pass",
        severity: "info",
        explanation: `The payment is for exactly ${musd(amount)} (${amount.toString()} base units).`,
        recommendation: "Make sure this is the amount you intend to send.",
        evidence: [{ label: "Amount", value: musd(amount), kind: "amount" }],
      }),
    );
    out.push(balanceCheck(ctx, amount));
    out.push(anomalyCheck(ctx, amount));
  }
  out.push(gasCheck(ctx));
  return out;
}

function balanceCheck(ctx: PreflightContext, amount: bigint): CheckResult {
  const obs = ctx.balances;
  if (!obs.ok) {
    return result("funds.balance", {
      status: "unavailable",
      severity: "high",
      explanation: `Your MUSD balance could not be read (${obs.error}). PayGuard will not send without confirming you can cover the payment.`,
      recommendation: "Retry in a moment.",
    });
  }
  const bal = obs.value.musd;
  if (bal < amount) {
    return result("funds.balance", {
      status: "fail",
      severity: "high",
      explanation: `Your balance of ${musd(bal)} does not cover ${musd(amount)}. The transaction would fail and still cost a network fee.`,
      recommendation: `Lower the amount or add at least ${musd(amount - bal)} to this wallet.`,
      evidence: [
        { label: "MUSD balance", value: musd(bal), kind: "amount" },
        { label: "Payment", value: musd(amount), kind: "amount" },
        { label: "Shortfall", value: musd(amount - bal), kind: "amount" },
      ],
    });
  }
  return result("funds.balance", {
    status: "pass",
    severity: "info",
    explanation: `Your live balance of ${musd(bal)} covers the payment; ${musd(bal - amount)} would remain.`,
    recommendation: "No action needed.",
    evidence: [
      { label: "MUSD balance", value: musd(bal), kind: "amount" },
      { label: "After payment", value: musd(bal - amount), kind: "amount" },
    ],
  });
}

function gasCheck(ctx: PreflightContext): CheckResult {
  const bal = ctx.balances;
  if (!bal.ok) {
    return result("funds.gas", {
      status: "unavailable",
      severity: "medium",
      explanation: `Your BTC balance for network fees could not be read (${bal.error}).`,
      recommendation: "Retry in a moment.",
    });
  }
  const native = bal.value.native;
  const sep = "MUSD and BTC are separate balances: network fees on Mezo are paid in BTC, never in MUSD.";
  if (native === 0n) {
    return result("funds.gas", {
      status: "fail",
      severity: "high",
      explanation: `Your wallet has no BTC to pay the network fee. ${sep}`,
      recommendation: "Get a small amount of testnet BTC from the Mezo faucet, then review again.",
      evidence: [{ label: "BTC balance", value: btc(native), kind: "amount" }],
    });
  }
  const fee = ctx.fee;
  if (!fee.ok) {
    return result("funds.gas", {
      status: "unavailable",
      severity: "medium",
      explanation: `The network fee could not be estimated (${fee.error}). You have ${btc(native)}, which is usually plenty on Mezo. ${sep}`,
      recommendation: "Retry the review to get a fee estimate.",
      evidence: [{ label: "BTC balance", value: btc(native), kind: "amount" }],
    });
  }
  const { maxFee, gasLimit, maxFeePerGas } = fee.value;
  const evidence = [
    { label: "BTC balance", value: btc(native), kind: "amount" as const },
    { label: "Maximum network fee", value: btc(maxFee), kind: "amount" as const },
    { label: "Gas limit × max fee", value: `${formatGas(gasLimit)} × ${maxFeePerGas.toString()} wei`, kind: "text" as const },
  ];
  if (native < maxFee) {
    return result("funds.gas", {
      status: "fail",
      severity: "high",
      explanation: `Your ${btc(native)} does not cover the maximum network fee of ${btc(maxFee)}. ${sep}`,
      recommendation: "Add testnet BTC from the Mezo faucet, then review again.",
      evidence,
    });
  }
  return result("funds.gas", {
    status: "pass",
    severity: "info",
    explanation: `Your BTC covers the maximum network fee of ${btc(maxFee)}. ${sep} Mezo may charge up to half the gas limit even if less is used, so the shown fee is a ceiling.`,
    recommendation: "No action needed.",
    evidence,
  });
}

function anomalyCheck(ctx: PreflightContext, amount: bigint): CheckResult {
  const confirmed = ctx.history.filter((h) => h.status === "confirmed").map((h) => BigInt(h.amount));
  if (confirmed.length < 3) {
    return result("funds.anomaly", {
      status: "unavailable",
      severity: "info",
      explanation: `Not enough history to compare: ${confirmed.length} confirmed payment(s); at least 3 are needed.`,
      recommendation: "Double-check the number of zeros in the amount.",
    });
  }
  const median = bigintMedian(confirmed)!;
  const max = bigintMax(confirmed)!;
  const r = ratio(amount, median);
  const evidence = [
    { label: "This payment", value: musd(amount), kind: "amount" as const },
    { label: "Your median payment", value: musd(median), kind: "amount" as const },
    { label: "Your largest payment", value: musd(max), kind: "amount" as const },
  ];
  if (median > 0n && amount >= median * 5n && amount > max) {
    const extraZero = amount >= median * 10n;
    return result("funds.anomaly", {
      status: "warn",
      severity: "medium",
      explanation: `This payment is about ${r >= 100 ? Math.round(r) : r.toFixed(1)}× your median payment and larger than any payment you have made through PayGuard.${
        extraZero ? " A jump of 10× or more is a common sign of an extra zero." : ""
      }`,
      recommendation: "Re-read the amount digit by digit against the invoice.",
      evidence,
    });
  }
  return result("funds.anomaly", {
    status: "pass",
    severity: "info",
    explanation: `Within the range of your ${confirmed.length} previous confirmed payments.`,
    recommendation: "No action needed.",
    evidence,
  });
}

export function simulationChecks(ctx: PreflightContext): CheckResult[] {
  const out: CheckResult[] = [];
  const fee = ctx.fee;
  if (!fee.ok) {
    out.push(
      result("simulation.estimate", {
        status: "unavailable",
        severity: "medium",
        explanation: `Gas could not be estimated (${fee.error}).`,
        recommendation: "Retry the review. PayGuard will not guess a fee silently.",
      }),
    );
  } else if (fee.value.estimateError?.isRevert) {
    out.push(
      result("simulation.estimate", {
        status: "fail",
        severity: "high",
        explanation: `The node reports this transaction would fail: ${fee.value.estimateError.reason}.`,
        recommendation: "Fix the cause shown before sending; a failed transaction still costs a fee.",
        evidence: [{ label: "Reason", value: fee.value.estimateError.reason, kind: "text" }],
      }),
    );
  } else if (fee.value.estimate === null && ctx.payload.method === "router") {
    out.push(
      result("simulation.estimate", {
        status: "unavailable",
        severity: "low",
        explanation: `A PayGuardRouter payment needs your permit signature before it can be estimated. PayGuard estimates and simulates the exact router call right after you sign the permit and before your wallet asks to send; until then it plans with a safe gas floor of ${formatGas(fee.value.gasLimit)}.`,
        recommendation: "No action needed; the router call is checked again before sending.",
        evidence: [{ label: "Planned gas limit", value: formatGas(fee.value.gasLimit), kind: "number" }],
      }),
    );
  } else if (fee.value.estimate === null) {
    out.push(
      result("simulation.estimate", {
        status: "unavailable",
        severity: "medium",
        explanation: `Gas could not be estimated${fee.value.estimateError ? ` (${fee.value.estimateError.reason})` : ""}. PayGuard will use its safe gas floor of ${formatGas(fee.value.gasLimit)}.`,
        recommendation: "You can continue; the explicit gas limit protects against an under-estimate.",
        evidence: [{ label: "Gas limit used", value: formatGas(fee.value.gasLimit), kind: "number" }],
      }),
    );
  } else if (!fee.value.estimateUsable) {
    out.push(
      result("simulation.estimate", {
        status: "warn",
        severity: "low",
        explanation: `The node returned an implausibly low estimate (${formatGas(fee.value.estimate)} gas). Mezo's RPC has been seen doing this; trusting it would make the transaction fail. PayGuard uses its safe floor of ${formatGas(fee.value.gasLimit)} instead.`,
        recommendation: "No action needed — the explicit gas limit already accounts for this.",
        evidence: [
          { label: "Reported estimate", value: formatGas(fee.value.estimate), kind: "number" },
          { label: "Gas limit used", value: formatGas(fee.value.gasLimit), kind: "number" },
        ],
      }),
    );
  } else {
    out.push(
      result("simulation.estimate", {
        status: "pass",
        severity: "info",
        explanation: `Estimated ${formatGas(fee.value.estimate)} gas; PayGuard will send with an explicit limit of ${formatGas(fee.value.gasLimit)} (estimate + 30%, never below the floor).`,
        recommendation: "No action needed.",
        evidence: [
          { label: "Estimate", value: formatGas(fee.value.estimate), kind: "number" },
          { label: "Gas limit used", value: formatGas(fee.value.gasLimit), kind: "number" },
        ],
      }),
    );
  }

  const sim = ctx.simulation;
  if (!sim.ok) {
    out.push(
      result("simulation.call", {
        status: "unavailable",
        severity: "medium",
        explanation: `The transaction could not be simulated (${sim.error}). PayGuard cannot tell in advance whether it would succeed.`,
        recommendation: "Review the details carefully, or retry the review in a moment.",
        evidence: [{ label: "Source", value: sim.source, kind: "text" }],
      }),
    );
  } else if (!sim.value.success) {
    const reason = sim.value.revert?.reason ?? (sim.value.returned === false ? "the token returned false" : "unknown reason");
    out.push(
      result("simulation.call", {
        status: "fail",
        severity: "high",
        explanation: `Simulating the exact transfer from your address failed: ${reason}. Sending it would fail and still cost a fee.`,
        recommendation: "Fix the cause before sending.",
        evidence: [
          { label: "Reason", value: reason, kind: "text" },
          ...(sim.value.blockNumber ? [{ label: "Simulated at block", value: sim.value.blockNumber, kind: "number" as const }] : []),
        ],
      }),
    );
  } else {
    out.push(
      result("simulation.call", {
        status: "pass",
        severity: "info",
        explanation: `${
          sim.value.note ?? "The exact transfer succeeds when simulated from your address against the latest block."
        } A successful simulation does not guarantee the real transaction will succeed — state can change before it is mined.`,
        recommendation: "No action needed.",
        evidence: sim.value.blockNumber ? [{ label: "Simulated at block", value: sim.value.blockNumber, kind: "number" }] : [],
      }),
    );
  }
  return out;
}
