import { getAddress } from "viem";
import type { AssessmentDTO, DraftDTO, NotificationDTO, RecipientDTO, RequestDTO, TransactionDTO } from "../dto";
import type { Assessment, HistoryEntry, PaymentPayload, RequestSnapshot, SavedRecipient } from "../engine/types";
import type { DraftStatus, TxStatus } from "../engine/status";
import type { VerificationResult } from "../verify/receipt";
import { iso, q, q1, type Row } from "./db";
import { HttpError } from "./http";

const cs = (a: string | null | undefined) => {
  if (!a) return a ?? null;
  try {
    return getAddress(a);
  } catch {
    return a;
  }
};
const numStr = (v: unknown) => (v == null ? null : String(v));

/* ---------------------------------------------------------------- users */

export async function upsertUser(address: string) {
  const row = await q1<{ id: string; address: string; settings: unknown }>(
    `INSERT INTO payguard.users (address, last_login_at) VALUES ($1, now())
     ON CONFLICT (address) DO UPDATE SET last_login_at = now()
     RETURNING id, address, settings`,
    [address.toLowerCase()],
  );
  if (!row) throw new Error("user upsert failed");
  return row;
}

export async function getUserSettingsRaw(userId: string): Promise<unknown> {
  const row = await q1<{ settings: unknown }>(`SELECT settings FROM payguard.users WHERE id = $1`, [userId]);
  return row?.settings ?? {};
}

/* ----------------------------------------------------------- recipients */

export function toRecipient(r: Row): RecipientDTO {
  return {
    id: r.id,
    label: r.label,
    address: cs(r.address)!,
    chainId: Number(r.chain_id),
    notes: r.notes ?? null,
    verificationNote: r.verification_note ?? null,
    verifiedAt: iso(r.verified_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    paymentsCount: Number(r.payments_count ?? 0),
    lastPaidAt: iso(r.last_paid_at),
  };
}

export async function listRecipients(userId: string): Promise<RecipientDTO[]> {
  const rows = await q(
    `SELECT r.*,
            (SELECT count(*) FROM payguard.transactions t WHERE t.user_id = r.user_id AND t.recipient_address = r.address AND t.status = 'confirmed') AS payments_count,
            (SELECT max(t.submitted_at) FROM payguard.transactions t WHERE t.user_id = r.user_id AND t.recipient_address = r.address AND t.status = 'confirmed') AS last_paid_at
       FROM payguard.recipients r WHERE r.user_id = $1 ORDER BY lower(r.label)`,
    [userId],
  );
  return rows.map(toRecipient);
}

export function toSaved(r: RecipientDTO): SavedRecipient {
  return { id: r.id, label: r.label, address: r.address, createdAt: r.createdAt, notes: r.notes };
}

/* --------------------------------------------------------------- drafts */

export function draftPayload(r: Row): PaymentPayload {
  return {
    chainId: Number(r.chain_id),
    token: r.token_address,
    from: r.from_address,
    to: r.recipient_input,
    amount: String(r.amount),
    invoiceRef: r.invoice_ref ?? null,
    method: r.method,
    requestId: r.request_id ?? null,
  };
}

export function toDraft(r: Row): DraftDTO {
  return {
    id: r.id,
    from: cs(r.from_address)!,
    recipientInput: r.recipient_input,
    amount: String(r.amount),
    tokenAddress: r.token_address,
    chainId: Number(r.chain_id),
    invoiceRef: r.invoice_ref ?? null,
    note: r.note ?? null,
    method: r.method,
    requestId: r.request_id ?? null,
    selectedRecipientId: r.selected_recipient_id ?? null,
    status: r.status as DraftStatus,
    payloadHash: r.payload_hash ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    payload: draftPayload(r),
    transactionId: r.transaction_id ?? null,
  };
}

export async function getDraftRow(userId: string, draftId: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) throw new HttpError(404, "Draft not found.", "not_found");
  const row = await q1(
    `SELECT d.*, t.id AS transaction_id FROM payguard.drafts d
       LEFT JOIN payguard.transactions t ON t.draft_id = d.id
      WHERE d.id = $1 AND d.user_id = $2`,
    [draftId, userId],
  );
  if (!row) throw new HttpError(404, "Draft not found.", "not_found");
  return row;
}

/* ---------------------------------------------------------- assessments */

export function toAssessment(r: Row): AssessmentDTO {
  const result = r.result as Assessment & { fee?: AssessmentDTO["fee"] };
  return { ...result, id: r.id, purpose: r.purpose, createdAt: iso(r.created_at)!, fee: result.fee ?? null };
}

export async function saveAssessment(
  userId: string,
  draftId: string,
  purpose: "review" | "authorize",
  a: Assessment,
  fee: AssessmentDTO["fee"],
): Promise<AssessmentDTO> {
  const row = await q1(
    `INSERT INTO payguard.assessments (draft_id, user_id, purpose, payload_hash, category, decision, engine_version, summary, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [draftId, userId, purpose, a.payloadHash, a.category, a.decision, a.engineVersion, a.summary, JSON.stringify({ ...a, fee })],
  );
  if (!row) throw new Error("assessment insert failed");
  // Flatten non-passing results for the Security Centre.
  const notable = a.checks.filter((c) => c.status !== "pass");
  if (notable.length > 0) {
    const values: unknown[] = [];
    const tuples = notable.map((c, i) => {
      values.push(row.id, userId, c.id, c.status, c.severity, c.title, c.explanation);
      const b = i * 7;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    await q(
      `INSERT INTO payguard.check_results (assessment_id, user_id, check_id, status, severity, title, explanation) VALUES ${tuples.join(", ")}
       ON CONFLICT DO NOTHING`,
      values,
    );
  }
  return toAssessment(row);
}

export async function latestAssessment(draftId: string, purpose?: "review" | "authorize"): Promise<AssessmentDTO | null> {
  const row = await q1(
    `SELECT * FROM payguard.assessments WHERE draft_id = $1 ${purpose ? "AND purpose = $2" : ""} ORDER BY created_at DESC LIMIT 1`,
    purpose ? [draftId, purpose] : [draftId],
  );
  return row ? toAssessment(row) : null;
}

/* --------------------------------------------------------- transactions */

export function toTransaction(r: Row): TransactionDTO {
  return {
    id: r.id,
    draftId: r.draft_id,
    txHash: r.tx_hash,
    chainId: Number(r.chain_id),
    from: cs(r.from_address)!,
    recipient: cs(r.recipient_address)!,
    recipientLabel: r.recipient_label ?? null,
    token: cs(r.token_address)!,
    amount: String(r.amount),
    invoiceRef: r.invoice_ref ?? null,
    method: r.method,
    requestId: r.request_id ?? null,
    assessmentId: r.assessment_id ?? null,
    riskCategory: r.risk_category ?? null,
    acknowledgements: Array.isArray(r.acknowledgements) ? r.acknowledgements : [],
    gasLimit: numStr(r.gas_limit),
    status: r.status as TxStatus,
    statusReason: r.status_reason ?? null,
    blockNumber: numStr(r.block_number),
    confirmations: r.confirmations == null ? null : Number(r.confirmations),
    gasUsed: numStr(r.gas_used),
    effectiveGasPrice: numStr(r.effective_gas_price),
    verification: (r.verification as VerificationResult | null) ?? null,
    submittedAt: iso(r.submitted_at)!,
    verifiedAt: iso(r.verified_at),
    lastCheckedAt: iso(r.last_checked_at),
    checkAttempts: Number(r.check_attempts ?? 0),
  };
}

export const TX_SELECT = `SELECT t.*, (SELECT r.label FROM payguard.recipients r WHERE r.user_id = t.user_id AND r.address = t.recipient_address LIMIT 1) AS recipient_label
  FROM payguard.transactions t`;

export async function getTransactionRow(userId: string, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Transaction not found.", "not_found");
  const row = await q1(`${TX_SELECT} WHERE t.id = $1 AND t.user_id = $2`, [id, userId]);
  if (!row) throw new HttpError(404, "Transaction not found.", "not_found");
  return row;
}

export async function historyForEngine(userId: string): Promise<HistoryEntry[]> {
  const rows = await q(
    `SELECT id, recipient_address, amount, invoice_ref_norm, status, submitted_at, tx_hash
       FROM payguard.transactions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 500`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    to: r.recipient_address,
    amount: String(r.amount),
    invoiceRefNorm: r.invoice_ref_norm ?? null,
    status: r.status,
    submittedAt: iso(r.submitted_at)!,
    txHash: r.tx_hash,
  }));
}

/* ------------------------------------------------------------- requests */

export function toRequest(r: Row, viewerUserId?: string | null): RequestDTO {
  return {
    id: r.id,
    creator: cs(r.creator_address)!,
    recipient: cs(r.recipient_address)!,
    payer: cs(r.payer_address),
    amount: String(r.amount),
    token: cs(r.token_address)!,
    chainId: Number(r.chain_id),
    invoiceRef: r.invoice_ref ?? null,
    description: r.description ?? null,
    expiresAt: iso(r.expires_at),
    status: r.status,
    paidTxId: r.paid_tx_id ?? null,
    createdAt: iso(r.created_at)!,
    isMine: !!viewerUserId && r.creator_user_id === viewerUserId,
  };
}

export function requestSnapshot(r: RequestDTO): RequestSnapshot {
  return {
    id: r.id,
    creator: r.creator,
    recipient: r.recipient,
    amount: r.amount,
    token: r.token,
    chainId: r.chainId,
    invoiceRef: r.invoiceRef,
    description: r.description,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    status: r.status,
    paidTxId: r.paidTxId,
  };
}

export async function getRequest(id: string): Promise<Row | null> {
  if (!/^pr_[A-Za-z0-9]{12,32}$/.test(id)) return null;
  return q1(`SELECT * FROM payguard.payment_requests WHERE id = $1`, [id]);
}

/* -------------------------------------------------------- notifications */

export function toNotification(r: Row): NotificationDTO {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link: r.link ?? null,
    readAt: iso(r.read_at),
    createdAt: iso(r.created_at)!,
  };
}
