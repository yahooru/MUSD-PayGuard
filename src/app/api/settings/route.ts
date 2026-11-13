import { parseSettings, settingsSchema } from "@/lib/settings";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { getUserSettingsRaw } from "@/lib/server/data";
import { q1 } from "@/lib/server/db";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await requireSession();
  const user = await q1(`SELECT created_at, last_login_at FROM payguard.users WHERE id = $1`, [s.userId]);
  return json({
    settings: parseSettings(await getUserSettingsRaw(s.userId)),
    account: { address: s.address, createdAt: user?.created_at ?? null, lastLoginAt: user?.last_login_at ?? null },
  });
});

export const PUT = route(async (req) => {
  const s = await requireWriter(req);
  const settings = await readJson(req, settingsSchema);
  await q1(`UPDATE payguard.users SET settings = $2 WHERE id = $1`, [s.userId, JSON.stringify(settings)]);
  await audit(s.userId, "settings.updated", { type: "user", id: s.userId }, settings);
  return json({ settings });
});
