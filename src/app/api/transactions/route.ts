import { z } from "zod";
import { parseAmountInput } from "@/lib/amount";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { getDraftRow, toTransaction, TX_SELECT } from "@/lib/server/data";
import { pgCode, q, q1 } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { refreshTransaction } from "@/lib/server/tx-verify";
import { withTimeout } from "@/lib/server/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const submitSchema = z.object({
  draftId: z.string().uuid(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Not a transaction hash"),
});

/**
 * Record a submitted transaction hash for an authorized draft — immediately after the wallet
 * returns it. Idempotent for the same (draft, hash); rejects a hash already recorded elsewhere
 * and a second, different hash for the same draft (double-submit guard). The payment details
 * stored come from the server-side draft, never from the client.
 */
export const POST = route(async (req) => {
  const s = await requireWriter(req);
  const { draftId, txHash } = await readJson(req, submitSchema);
  const hash = txHash.toLowerCase();
  const draft = await getDraftRow(s.userId, draftId);

  const existing = await q1(`SELECT * FROM payguard.transactions WHERE tx_hash = $1`, [hash]);
  if (existing) {
    if (existing.draft_id === draftId && existing.user_id === s.userId) {
      return json({ transaction: toTransaction(existing), idempotent: true });
    }
    throw new HttpError(409, "This transaction hash is already recorded for another payment. A hash can only prove one payment.", "duplicate_tx_hash");
  }
  if (draft.transaction_id) {
    throw new HttpError(409, "A different transaction was already submitted for this payment. Open it to follow its status before paying again.", "already_submitted", {
      transactionId: draft.transaction_id,
    });
  }
  if (draft.status !== "authorized") {
    throw new HttpError(409, "This payment was not confirmed on the review screen.", "not_authorized");
  }

  let row;
  try {
    row = await q1(
      `WITH ins AS (
         INSERT INTO payguard.transactions
           (user_id, draft_id, tx_hash, chain_id, from_address, recipient_address, token_address, amount, invoice_ref, invoice_ref_norm,
            method, request_id, assessment_id, risk_category, acknowledgements, gas_limit)
         SELECT d.user_id, d.id, $3, d.chain_id, d.from_address, lower(trim(d.recipient_input)), lower(d.token_address), d.amount, d.invoice_ref, d.invoice_ref_norm,
                d.method, d.request_id, d.latest_assessment_id, a.category, d.acknowledgements,
                (SELECT ((x.result->'fee'->>'gasLimit'))::numeric FROM payguard.assessments x WHERE x.draft_id = d.id ORDER BY x.created_at DESC LIMIT 1)
           FROM payguard.drafts d
           LEFT JOIN payguard.assessments a ON a.id = d.latest_assessment_id
          WHERE d.id = $1 AND d.user_id = $2 AND d.status = 'authorized'
         RETURNING *
       ), upd AS (
         UPDATE payguard.drafts SET status = 'submitted', updated_at = now() WHERE id IN (SELECT draft_id FROM ins)
       )
       SELECT * FROM ins`,
      [draftId, s.userId, hash],
    );
  } catch (e) {
    if (pgCode(e) === "23505") {
      const again = await q1(`SELECT * FROM payguard.transactions WHERE tx_hash = $1 OR draft_id = $2`, [hash, draftId]);
      if (again && again.tx_hash === hash && again.draft_id === draftId) return json({ transaction: toTransaction(again), idempotent: true });
      throw new HttpError(409, "This payment or transaction hash was already recorded.", "duplicate_tx_hash");
    }
    throw e;
  }
  if (!row) throw new HttpError(409, "This payment was not confirmed on the review screen.", "not_authorized");
  await audit(s.userId, "transaction.submitted", { type: "transaction", id: row.id }, { txHash: hash, draftId });

  // First verification attempt right away (bounded); the client keeps polling after this.
  let fresh = row;
  try {
    fresh = await withTimeout(refreshTransaction(row), 15_000, "verification");
  } catch {
    /* stays pending; polling continues */
  }
  return json({ transaction: toTransaction(fresh) }, { status: 201 });
});

const STATUS = ["pending", "confirmed", "failed", "verification_delayed", "unknown"] as const;
const listSchema = z.object({
  status: z.string().optional(),
  risk: z.string().optional(),
  q: z.string().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  min: z.string().max(30).optional(),
  max: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const GET = route(async (req) => {
  const s = await requireSession();
  const p = listSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const where: string[] = ["t.user_id = $1"];
  const args: unknown[] = [s.userId];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("?", `$${args.length}`));
  };
  const statuses = (p.status ?? "").split(",").filter((x) => (STATUS as readonly string[]).includes(x));
  if (statuses.length) add("t.status = ANY(?)", statuses);
  const risks = (p.risk ?? "").split(",").filter((x) => ["low", "caution", "high"].includes(x));
  if (risks.length) add("t.risk_category = ANY(?)", risks);
  if (p.q && p.q.trim()) {
    args.push(`%${p.q.trim().toLowerCase()}%`);
    const i = args.length;
    where.push(
      `(lower(t.recipient_address) LIKE $${i} OR lower(t.tx_hash) LIKE $${i} OR lower(coalesce(t.invoice_ref, '')) LIKE $${i}
        OR EXISTS (SELECT 1 FROM payguard.recipients r WHERE r.user_id = t.user_id AND r.address = t.recipient_address AND lower(r.label) LIKE $${i}))`,
    );
  }
  if (p.from) add("t.submitted_at >= ?::date", p.from);
  if (p.to) add("t.submitted_at < (?::date + interval '1 day')", p.to);
  if (p.min) {
    const v = parseAmountInput(p.min);
    if (v.ok) add("t.amount >= ?::numeric", v.value.toString());
  }
  if (p.max) {
    const v = parseAmountInput(p.max);
    if (v.ok) add("t.amount <= ?::numeric", v.value.toString());
  }
  args.push(p.limit + 1, p.offset);
  const rows = await q(`${TX_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.submitted_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  const hasMore = rows.length > p.limit;
  return json({ transactions: rows.slice(0, p.limit).map(toTransaction), hasMore });
});
