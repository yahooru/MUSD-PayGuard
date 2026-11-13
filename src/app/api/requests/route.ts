import { randomBytes } from "node:crypto";
import { z } from "zod";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { MUSD } from "@/config/contracts";
import { parseAmountInput } from "@/lib/amount";
import { analyzeAddress } from "@/lib/engine/address";
import { validateInvoiceRef } from "@/lib/invoice";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { toRequest } from "@/lib/server/data";
import { pgCode, q, q1 } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function requestId(): string {
  const bytes = randomBytes(16);
  let s = "pr_";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

const createSchema = z.object({
  recipient: z.string().max(128).optional().nullable(),
  payer: z.string().max(128).optional().nullable(),
  amount: z.string().max(64),
  invoiceRef: z.string().max(200).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  expiresInDays: z.number().int().min(1).max(365).optional().nullable(),
});

function validAddress(input: string, field: string) {
  const a = analyzeAddress(input);
  if (!a.valid) throw new HttpError(400, a.problem ?? "Invalid address.", "invalid_address", [{ path: field, message: a.problem }]);
  if (a.checksum === "invalid") throw new HttpError(400, "The address does not match its checksum; paste it again unchanged.", "bad_checksum", [{ path: field, message: "Checksum mismatch" }]);
  return a.lower!;
}

export const POST = route(async (req) => {
  const s = await requireWriter(req);
  const body = await readJson(req, createSchema);
  const recipient = body.recipient && body.recipient.trim() ? validAddress(body.recipient, "recipient") : s.address;
  const payer = body.payer && body.payer.trim() ? validAddress(body.payer, "payer") : null;
  if (payer && payer === recipient) throw new HttpError(400, "The payer and the recipient are the same address.", "same_address");
  const amount = parseAmountInput(body.amount);
  if (!amount.ok) throw new HttpError(400, amount.error, "invalid_amount", [{ path: "amount", message: amount.error }]);
  let ref: string | null = null;
  let refNorm: string | null = null;
  if (body.invoiceRef && body.invoiceRef.trim()) {
    const v = validateInvoiceRef(body.invoiceRef);
    if (!v.ok) throw new HttpError(400, v.error, "invalid_reference", [{ path: "invoiceRef", message: v.error }]);
    ref = body.invoiceRef.trim();
    refNorm = v.normalized;
  }
  const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString() : null;
  try {
    const row = await q1(
      `INSERT INTO payguard.payment_requests (id, creator_user_id, creator_address, recipient_address, payer_address, amount, token_address, chain_id, invoice_ref, invoice_ref_norm, description, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [requestId(), s.userId, s.address, recipient, payer, amount.value.toString(), MUSD.address.toLowerCase(), SUPPORTED_NETWORK.chainId, ref, refNorm, body.description || null, expiresAt],
    );
    await audit(s.userId, "request.created", { type: "request", id: row!.id }, { amount: amount.value.toString(), ref });
    return json({ request: toRequest(row!, s.userId) }, { status: 201 });
  } catch (e) {
    if (pgCode(e) === "23505") {
      const dup = await q1(
        `SELECT id FROM payguard.payment_requests WHERE creator_user_id = $1 AND invoice_ref_norm = $2 AND status <> 'cancelled' LIMIT 1`,
        [s.userId, refNorm],
      );
      throw new HttpError(409, `You already have a live request with reference “${refNorm}”. Cancel it first or use a different reference.`, "duplicate_reference", {
        requestId: dup?.id ?? null,
      });
    }
    throw e;
  }
});

export const GET = route(async () => {
  const s = await requireSession();
  const [sent, incoming] = await Promise.all([
    q(`SELECT * FROM payguard.payment_requests WHERE creator_user_id = $1 ORDER BY created_at DESC LIMIT 200`, [s.userId]),
    q(`SELECT * FROM payguard.payment_requests WHERE payer_address = $1 AND creator_user_id <> $2 ORDER BY created_at DESC LIMIT 200`, [s.address, s.userId]),
  ]);
  return json({ sent: sent.map((r) => toRequest(r, s.userId)), incoming: incoming.map((r) => toRequest(r, s.userId)) });
});
