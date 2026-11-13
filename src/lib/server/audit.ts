import { q } from "./db";

/** Append-only audit trail. Failures to audit never break the user action, but are logged. */
export async function audit(
  userId: string | null,
  event: string,
  entity: { type?: string; id?: string } = {},
  data: Record<string, unknown> = {},
  ipHash?: string | null,
) {
  try {
    await q(
      `INSERT INTO payguard.audit_events (user_id, event, entity_type, entity_id, data, ip_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, event, entity.type ?? null, entity.id ?? null, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), ipHash ?? null],
    );
  } catch (e) {
    console.error("[audit] failed", event, e);
  }
}

export async function notify(userId: string, kind: string, title: string, body: string, link?: string) {
  try {
    await q(`INSERT INTO payguard.notifications (user_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5)`, [
      userId,
      kind,
      title,
      body,
      link ?? null,
    ]);
  } catch (e) {
    console.error("[notify] failed", kind, e);
  }
}
