import { decodeEventLog, type Hex } from "viem";
import { musdAbi, routerAbi } from "../../config/contracts";
import { formatAmount } from "../amount";
import { sameAddress } from "../engine/address";
import type { VerificationOutcome } from "../engine/status";

/**
 * Pure receipt verification. Given what the node returned (or null), decide whether a
 * transaction proves the expected MUSD payment. Never trusts a hash, a client-reported
 * status or a screenshot: only the receipt, the transaction and the token's own logs.
 */

export interface ExpectedPayment {
  chainId: number;
  token: string;
  to: string;
  amount: bigint;
  /** Required for PayGuard's own records; optional in the public API. */
  from?: string | null;
  /** If set, the payment must carry this invoice ref on-chain (router payments only). */
  invoiceRefHash?: Hex | null;
  /** Contract that the transaction must call: the token (direct) or the router. */
  method?: "direct" | "router" | "any";
  routerAddress?: string;
  requiredConfirmations: number;
}

export interface ChainTx {
  hash: string;
  from: string;
  to: string | null;
  chainId?: number | null;
  blockNumber: bigint | null;
}

export interface ChainLog {
  address: string;
  topics: readonly Hex[];
  data: Hex;
  logIndex?: number | null;
}

export interface ChainReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash?: string;
  from: string;
  to: string | null;
  logs: readonly ChainLog[];
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
}

export type CheckState = "pass" | "fail" | "pending" | "skipped";

export interface VerificationStep {
  id:
    | "tx_found"
    | "network"
    | "receipt"
    | "execution"
    | "target"
    | "sender"
    | "transfer_log"
    | "invoice_ref"
    | "confirmations";
  label: string;
  state: CheckState;
  detail: string;
}

export interface MatchedTransfer {
  from: string;
  to: string;
  value: string;
  logIndex: number | null;
}

export interface VerificationResult {
  outcome: VerificationOutcome;
  steps: VerificationStep[];
  reason: string;
  confirmations: number;
  blockNumber: string | null;
  blockHash: string | null;
  matchedTransfer: MatchedTransfer | null;
  /** Every MUSD Transfer in the receipt, for transparency. */
  transfers: MatchedTransfer[];
  invoiceRefOnchain: string | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  sender: string | null;
}

export interface VerifyInput {
  expected: ExpectedPayment;
  tx: ChainTx | null;
  receipt: ChainReceipt | null;
  latestBlock: bigint | null;
}

const musd = (v: bigint) => `${formatAmount(v, { maxFraction: 6 })} MUSD`;

export function decodeTransfers(logs: readonly ChainLog[], token: string): MatchedTransfer[] {
  const out: MatchedTransfer[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, token)) continue;
    try {
      const ev = decodeEventLog({ abi: musdAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "Transfer") {
        const args = ev.args as { from: string; to: string; value: bigint };
        out.push({ from: args.from, to: args.to, value: args.value.toString(), logIndex: log.logIndex ?? null });
      }
    } catch {
      // not a Transfer event of this ABI; ignore
    }
  }
  return out;
}

function decodeInvoicePaid(logs: readonly ChainLog[], router: string | undefined) {
  if (!router) return [] as { payer: string; recipient: string; invoiceRef: Hex; amount: bigint }[];
  const out: { payer: string; recipient: string; invoiceRef: Hex; amount: bigint }[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, router)) continue;
    try {
      const ev = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "InvoicePaid") {
        const a = ev.args as { payer: string; recipient: string; invoiceRef: Hex; amount: bigint };
        out.push(a);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

export function verifyPayment({ expected, tx, receipt, latestBlock }: VerifyInput): VerificationResult {
  const steps: VerificationStep[] = [];
  const base: Omit<VerificationResult, "outcome" | "reason" | "steps"> = {
    confirmations: 0,
    blockNumber: receipt ? receipt.blockNumber.toString() : null,
    blockHash: receipt?.blockHash ?? null,
    matchedTransfer: null,
    transfers: [],
    invoiceRefOnchain: null,
    gasUsed: receipt?.gasUsed != null ? receipt.gasUsed.toString() : null,
    effectiveGasPrice: receipt?.effectiveGasPrice != null ? receipt.effectiveGasPrice.toString() : null,
    sender: tx?.from ?? receipt?.from ?? null,
  };

  if (!tx && !receipt) {
    steps.push({ id: "tx_found", label: "Transaction found", state: "fail", detail: "The Mezo Testnet node does not know this transaction hash." });
    return { ...base, outcome: "not_found", steps, reason: "Transaction not found on Mezo Testnet." };
  }
  steps.push({ id: "tx_found", label: "Transaction found", state: "pass", detail: "The node returned the transaction." });

  // Network: we only ever query the configured chain's RPC; if the tx carries a chain id it must match.
  if (tx?.chainId != null && tx.chainId !== expected.chainId) {
    steps.push({ id: "network", label: "Network", state: "fail", detail: `Transaction is for chain ${tx.chainId}, expected ${expected.chainId}.` });
    return { ...base, outcome: "mismatch", steps, reason: "Transaction belongs to a different network." };
  }
  steps.push({ id: "network", label: "Network", state: "pass", detail: `Included on chain ${expected.chainId} (queried via the configured RPC).` });

  if (!receipt) {
    steps.push({ id: "receipt", label: "Receipt", state: "pending", detail: "No receipt yet: the transaction has not been mined." });
    return { ...base, outcome: "awaiting_receipt", steps, reason: "Waiting for the transaction to be mined." };
  }
  steps.push({ id: "receipt", label: "Receipt", state: "pass", detail: `Mined in block ${receipt.blockNumber.toString()}.` });

  if (receipt.status !== "success") {
    steps.push({ id: "execution", label: "Execution", state: "fail", detail: "The transaction reverted. No MUSD moved." });
    return { ...base, outcome: "reverted", steps, reason: "Transaction reverted on-chain." };
  }
  steps.push({ id: "execution", label: "Execution", state: "pass", detail: "Receipt status is success." });

  const target = tx?.to ?? receipt.to;
  const method = expected.method ?? "direct";
  const targetOk =
    method === "any"
      ? sameAddress(target, expected.token) || (expected.routerAddress ? sameAddress(target, expected.routerAddress) : false)
      : method === "router"
        ? sameAddress(target, expected.routerAddress)
        : sameAddress(target, expected.token);
  if (!targetOk) {
    steps.push({
      id: "target",
      label: "Contract called",
      state: "fail",
      detail: `The transaction called ${target ?? "no contract"}, not ${method === "router" ? "PayGuardRouter" : "the MUSD contract"}.`,
    });
    return { ...base, outcome: "mismatch", steps, reason: "Transaction did not call the expected contract." };
  }
  steps.push({
    id: "target",
    label: "Contract called",
    state: "pass",
    detail: sameAddress(target, expected.token) ? "Called the configured MUSD contract." : "Called PayGuardRouter.",
  });

  const sender = tx?.from ?? receipt.from;
  if (expected.from) {
    if (!sameAddress(sender, expected.from)) {
      steps.push({ id: "sender", label: "Sender", state: "fail", detail: `Sent by ${sender}, expected ${expected.from}.` });
      return { ...base, outcome: "mismatch", steps, reason: "Transaction was sent by a different wallet." };
    }
    steps.push({ id: "sender", label: "Sender", state: "pass", detail: `Sent by ${sender}.` });
  } else {
    steps.push({ id: "sender", label: "Sender", state: "skipped", detail: `No expected sender given; actual sender ${sender}.` });
  }

  const transfers = decodeTransfers(receipt.logs, expected.token);
  base.transfers = transfers;
  const payer = expected.from ?? sender;
  const match = transfers.find(
    (t) => sameAddress(t.from, payer) && sameAddress(t.to, expected.to) && BigInt(t.value) === expected.amount,
  );
  if (!match) {
    const seen = transfers.length
      ? transfers.map((t) => `${musd(BigInt(t.value))} from ${t.from} to ${t.to}`).join("; ")
      : "no MUSD Transfer events";
    steps.push({
      id: "transfer_log",
      label: "MUSD Transfer event",
      state: "fail",
      detail: `Expected ${musd(expected.amount)} from ${payer} to ${expected.to}; receipt contains ${seen}.`,
    });
    return { ...base, outcome: "mismatch", steps, reason: "The receipt does not contain the expected MUSD transfer." };
  }
  base.matchedTransfer = match;
  steps.push({
    id: "transfer_log",
    label: "MUSD Transfer event",
    state: "pass",
    detail: `Transfer of ${musd(BigInt(match.value))} from ${match.from} to ${match.to}, emitted by the MUSD contract.`,
  });

  const invoiceEvents = decodeInvoicePaid(receipt.logs, expected.routerAddress);
  if (invoiceEvents.length) base.invoiceRefOnchain = invoiceEvents[0]!.invoiceRef;
  if (expected.invoiceRefHash) {
    const ev = invoiceEvents.find(
      (e) =>
        e.invoiceRef.toLowerCase() === expected.invoiceRefHash!.toLowerCase() &&
        sameAddress(e.recipient, expected.to) &&
        e.amount === expected.amount,
    );
    if (!ev) {
      steps.push({
        id: "invoice_ref",
        label: "Invoice reference on-chain",
        state: "fail",
        detail: "No PayGuardRouter InvoicePaid event with the expected reference, recipient and amount.",
      });
      return { ...base, outcome: "mismatch", steps, reason: "Invoice reference not recorded on-chain as expected." };
    }
    steps.push({ id: "invoice_ref", label: "Invoice reference on-chain", state: "pass", detail: "PayGuardRouter recorded the invoice reference." });
  }

  const confirmations = latestBlock != null && latestBlock >= receipt.blockNumber ? Number(latestBlock - receipt.blockNumber + 1n) : 1;
  base.confirmations = confirmations;
  if (confirmations < expected.requiredConfirmations) {
    steps.push({
      id: "confirmations",
      label: "Confirmations",
      state: "pending",
      detail: `${confirmations} of ${expected.requiredConfirmations} required confirmations.`,
    });
    return { ...base, outcome: "awaiting_receipt", steps, reason: "Waiting for confirmations." };
  }
  steps.push({
    id: "confirmations",
    label: "Confirmations",
    state: "pass",
    detail: `${confirmations} confirmation${confirmations === 1 ? "" : "s"} (required: ${expected.requiredConfirmations}).`,
  });
  return { ...base, outcome: "confirmed", steps, reason: "All verification steps passed." };
}
