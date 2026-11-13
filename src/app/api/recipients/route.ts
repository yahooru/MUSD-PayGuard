import { z } from "zod";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { analyzeAddress } from "@/lib/engine/address";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { listRecipients, toRecipient } from "@/lib/server/data";
import { pgCode, q1 } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { lookalikeStrength } from "@/lib/engine/address";

export const dynamic = "force-dynamic";

const recipientSchema = z.object({
  label: z.string().trim().min(1, "Enter a name").max(60),
  address: z.string().trim().max(128),
  notes: z.string().trim().max(500).optional().nullable(),
  verificationNote: z.string().trim().max(200).optional().nullable(),
});

export const GET = route(async () => {
  const s = await requireSession();
  return json({ recipients: await listRecipients(s.userId) });
});

export const POST = route(async (req) => {
  const s = await requireWriter(req);
  const body = await readJson(req, recipientSchema);
  const a = analyzeAddress(body.address);
  if (!a.valid) throw new HttpError(400, a.problem ?? "Invalid address.", "invalid_address");
  if (a.checksum === "invalid") {
    throw new HttpError(400, "The address capitalisation does not match its EIP-55 checksum, which usually means a typo. Paste it again unchanged.", "bad_checksum");
  }
  if (a.lower === s.address) throw new HttpError(400, "That is your own connected wallet.", "self");
  // Warn (not block) if the new address is a lookalike of an existing saved one.
  const existing = await listRecipients(s.userId);
  const look = existing.find((r) => lookalikeStrength(r.address, a.lower!));
  try {
    const row = await q1(
      `INSERT INTO payguard.recipients (user_id, label, address, chain_id, notes, verification_note, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [s.userId, body.label, a.lower, SUPPORTED_NETWORK.chainId, body.notes || null, body.verificationNote || null, body.verificationNote ? new Date().toISOString() : null],
    );
    await audit(s.userId, "recipient.created", { type: "recipient", id: row!.id }, { address: a.lower, label: body.label });
    return json(
      {
        recipient: toRecipient(row!),
        warning: look
          ? `This address shares its first and last characters with “${look.label}” (${look.address}) but is a different address. Make sure both are correct.`
          : null,
      },
      { status: 201 },
    );
  } catch (e) {
    if (pgCode(e) === "23505") throw new HttpError(409, "This address is already in your recipient book.", "duplicate");
    throw e;
  }
});
