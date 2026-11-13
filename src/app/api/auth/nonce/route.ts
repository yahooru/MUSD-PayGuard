import { issueNonce } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const nonce = await issueNonce();
  return json({ nonce, expiresInSeconds: 600 });
});
