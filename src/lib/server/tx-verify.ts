import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Hash,
} from "viem";
import { SUPPORTED_NETWORK } from "../../config/chains";
import { ALL_ROUTER_ADDRESSES, MUSD } from "../../config/contracts";
import { formatAmount } from "../amount";
import { nextStatus, STATUS_LABEL, type TxStatus, type VerificationOutcome } from "../engine/status";
import { invoiceRefHash } from "../invoice";
import { parseSettings } from "../settings";
import { verifyPayment, type ChainReceipt, type ChainTx, type ExpectedPayment, type VerificationResult } from "../verify/receipt";
import { audit, notify } from "./audit";
import { errorMessage, publicClient, withTimeout } from "./chain";
import { q, q1, type Row } from "./db";

export interface FetchedChainState {
  tx: ChainTx | null;
  receipt: ChainReceipt | null;
  latestBlock: bigint | null;
  rpcError: string | null;
}

/**
 * Fetch transaction, receipt and head block. The public Mezo RPC is load-balanced and a node can
 * lag: it may return a mined transaction without its receipt, or not know a fresh hash yet.
 * Retry briefly in those cases before reporting "pending" / "not found".
 */
export async function fetchChainState(hash: Hash): Promise<FetchedChainState> {
  let state = await fetchChainStateOnce(hash);
  for (let i = 0; i < 3 && !state.rpcError && !state.receipt && (state.tx?.blockNumber != null || (i === 0 && !state.tx)); i++) {
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    state = await fetchChainStateOnce(hash);
  }
  return state;
}

async function fetchChainStateOnce(hash: Hash): Promise<FetchedChainState> {
  const c = publicClient();
  try {
    const [txRes, rcRes, head] = await withTimeout(
      Promise.all([
        c.getTransaction({ hash }).catch((e) => (e instanceof TransactionNotFoundError ? null : Promise.reject(e))),
        c.getTransactionReceipt({ hash }).catch((e) => (e instanceof TransactionReceiptNotFoundError ? null : Promise.reject(e))),
        c.getBlockNumber(),
      ]),
      12_000,
      "receipt lookup",
    );
    const tx: ChainTx | null = txRes
      ? { hash: txRes.hash, from: txRes.from, to: txRes.to ?? null, chainId: txRes.chainId ?? null, blockNumber: txRes.blockNumber ?? null }
      : null;
    const receipt: ChainReceipt | null = rcRes
      ? {
          status: rcRes.status,
          blockNumber: rcRes.blockNumber,
          blockHash: rcRes.blockHash,
          from: rcRes.from,
          to: rcRes.to ?? null,
          logs: rcRes.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })),
          gasUsed: rcRes.gasUsed,
          effectiveGasPrice: rcRes.effectiveGasPrice,
        }
      : null;
    return { tx, receipt, latestBlock: head, rpcError: null };
  } catch (e) {
    return { tx: null, receipt: null, latestBlock: null, rpcError: errorMessage(e) };
  }
}

export function expectedFromRow(r: Row): ExpectedPayment {
  return {
    chainId: Number(r.chain_id),
    token: MUSD.address,
    to: r.recipient_address,
    amount: BigInt(String(r.amount)),
    from: r.from_address,
    method: r.method === "router" ? "router" : "direct",
    routerAddress: ALL_ROUTER_ADDRESSES,
    invoiceRefHash: r.method === "router" && r.invoice_ref ? invoiceRefHash(r.invoice_ref) : null,
    requiredConfirmations: SUPPORTED_NETWORK.requiredConfirmations,
  };
}

/**
 * Verify one recorded transaction against the chain and persist the result.
 * Only this function can move a payment to "confirmed" or "failed".
 * Uses an optimistic WHERE status = <current> guard so concurrent checks cannot regress state.
 */
export async function refreshTransaction(row: Row): Promise<Row> {
  const current = row.status as TxStatus;
  if (current === "confirmed" || current === "failed") return row;

  // Brief retry: right after submission, the RPC may lag a block behind.
  let state = await fetchChainState(row.tx_hash as Hash);
  let result: VerificationResult | null = null;
  let outcome: VerificationOutcome;
  if (state.rpcError) {
    outcome = "rpc_error";
  } else {
    result = verifyPayment({ expected: expectedFromRow(row), tx: state.tx, receipt: state.receipt, latestBlock: state.latestBlock });
    outcome = result.outcome;
    if (outcome === "not_found" && Date.now() - new Date(row.submitted_at).getTime() < 30_000) {
      await new Promise((r) => setTimeout(r, 1500));
      state = await fetchChainState(row.tx_hash as Hash);
      if (!state.rpcError) {
        result = verifyPayment({ expected: expectedFromRow(row), tx: state.tx, receipt: state.receipt, latestBlock: state.latestBlock });
        outcome = result.outcome;
      }
    }
  }

  const next = nextStatus(current, outcome, {
    now: Date.now(),
    submittedAtMs: new Date(row.submitted_at).getTime(),
    missingGraceMs: SUPPORTED_NETWORK.missingTxGraceMs,
  });
  const reason =
    outcome === "rpc_error"
      ? `RPC unavailable: ${state.rpcError}`
      : outcome === "not_found" && next === "unknown"
        ? "The network has not seen this transaction hash for over 15 minutes."
        : result?.reason ?? null;

  const updated = await q1(
    `UPDATE payguard.transactions SET
        status = $3,
        status_reason = $4,
        verification = COALESCE($5::jsonb, verification),
        block_number = COALESCE($6, block_number),
        block_hash = COALESCE($7, block_hash),
        confirmations = COALESCE($8, confirmations),
        gas_used = COALESCE($9, gas_used),
        effective_gas_price = COALESCE($10, effective_gas_price),
        verified_at = CASE WHEN $3 IN ('confirmed', 'failed') THEN now() ELSE verified_at END,
        last_checked_at = now(),
        check_attempts = check_attempts + 1
      WHERE id = $1 AND status = $2
      RETURNING *`,
    [
      row.id,
      current,
      next,
      reason,
      result ? JSON.stringify({ ...result, checkedAt: new Date().toISOString() }) : null,
      result?.blockNumber ?? null,
      result?.blockHash ?? null,
      result && result.blockNumber ? result.confirmations : null,
      result?.gasUsed ?? null,
      result?.effectiveGasPrice ?? null,
    ],
  );
  if (!updated) {
    // Someone else updated it first; return the fresh row.
    return (await q1(`SELECT * FROM payguard.transactions WHERE id = $1`, [row.id])) ?? row;
  }

  if (next !== current) {
    await audit(row.user_id, "transaction.status_changed", { type: "transaction", id: row.id }, { from: current, to: next, outcome, txHash: row.tx_hash });
    const settingsRow = await q1<{ settings: unknown }>(`SELECT settings FROM payguard.users WHERE id = $1`, [row.user_id]);
    const prefs = parseSettings(settingsRow?.settings).notifications;
    const amount = `${formatAmount(BigInt(String(row.amount)))} MUSD`;
    const link = `/tx/${row.id}`;
    if (next === "confirmed" && prefs.confirmed) {
      await notify(row.user_id, "payment.confirmed", "Payment confirmed", `${amount} verified on-chain${row.invoice_ref ? ` for ${row.invoice_ref}` : ""}.`, link);
    } else if (next === "failed" && prefs.failed) {
      await notify(row.user_id, "payment.failed", "Payment failed", `${amount}: ${reason ?? "verification failed"}.`, link);
    } else if ((next === "verification_delayed" || next === "unknown") && prefs.delayed) {
      await notify(row.user_id, `payment.${next}`, STATUS_LABEL[next], `${amount}: ${reason ?? ""}`, link);
    }
    if (next === "confirmed" && row.request_id) await markRequestPaid(row);
  }
  return updated;
}

/** A request becomes "paid" only if the verified transfer matches it exactly. */
async function markRequestPaid(tx: Row) {
  await q(
    `UPDATE payguard.payment_requests SET status = 'paid', paid_tx_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'open' AND recipient_address = $3 AND amount = $4::numeric AND chain_id = $5`,
    [tx.request_id, tx.id, String(tx.recipient_address).toLowerCase(), String(tx.amount), Number(tx.chain_id)],
  );
}
