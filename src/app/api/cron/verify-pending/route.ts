import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { q } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { errorJson, json } from "@/lib/server/http";
import { refreshTransaction } from "@/lib/server/tx-verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret()}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily safety net (Vercel Hobby cron runs at most once per day): re-verify any payment that is
 * still pending, delayed or unknown. While a payment page is open the browser polls much more often.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return errorJson(401, "unauthorized", "Missing or invalid cron secret.");
  const rows = await q(
    `SELECT * FROM payguard.transactions WHERE status IN ('pending', 'verification_delayed', 'unknown')
      ORDER BY last_checked_at NULLS FIRST LIMIT 40`,
  );
  const results: { id: string; from: string; to: string }[] = [];
  for (const row of rows) {
    try {
      const u = await refreshTransaction(row);
      results.push({ id: row.id, from: row.status, to: u.status });
    } catch (e) {
      console.error("[cron] verify failed", row.id, e);
    }
  }
  return json({ checked: results.length, results, at: new Date().toISOString() });
}
