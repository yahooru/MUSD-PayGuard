import { z } from "zod";
import { verifySiwe } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { upsertUser } from "@/lib/server/data";
import { assertSameOrigin, ipHash, json, readJson, route } from "@/lib/server/http";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

const schema = z.object({
  message: z.string().min(50).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(4000),
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { message, signature } = await readJson(req, schema);
  const address = await verifySiwe(req, message, signature as `0x${string}`);
  const user = await upsertUser(address);
  const token = await createSessionToken({ userId: user.id, address });
  await audit(user.id, "auth.sign_in", { type: "user", id: user.id }, { address }, ipHash(req, env.sessionSecret()));
  const res = json({ authenticated: true, address, userId: user.id });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
