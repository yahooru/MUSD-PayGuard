import { z } from "zod";
import { requireWriter } from "@/lib/server/auth";
import { toNotification } from "@/lib/server/data";
import { q } from "@/lib/server/db";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await requireSession();
  const rows = await q(`SELECT * FROM payguard.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [s.userId]);
  return json({ notifications: rows.map(toNotification), unread: rows.filter((r) => !r.read_at).length });
});

const schema = z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().optional() });

export const POST = route(async (req) => {
  const s = await requireWriter(req);
  const body = await readJson(req, schema);
  if (body.all) {
    await q(`UPDATE payguard.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [s.userId]);
  } else if (body.ids?.length) {
    await q(`UPDATE payguard.notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`, [s.userId, body.ids]);
  }
  return json({ ok: true });
});
