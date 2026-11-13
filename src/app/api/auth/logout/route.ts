import { assertSameOrigin, json, route } from "@/lib/server/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const res = json({ authenticated: false });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
});
