import { getSession } from "@/lib/server/session";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await getSession();
  return json(s ? { authenticated: true, address: s.address, userId: s.userId } : { authenticated: false });
});
