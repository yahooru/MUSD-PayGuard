import { q1 } from "./db";

/**
 * Fixed-window rate limiter backed by Postgres (works across serverless instances).
 * Returns remaining requests and the reset time. Fails open on DB errors so a
 * database hiccup does not take the public API down, but logs it.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const reset = Math.ceil((windowStart.getTime() + windowSeconds * 1000) / 1000);
  try {
    const row = await q1<{ count: number }>(
      `INSERT INTO payguard.rate_limits (bucket, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET count = payguard.rate_limits.count + 1
       RETURNING count`,
      [bucket, windowStart.toISOString()],
    );
    const count = Number(row?.count ?? 1);
    if (Math.random() < 0.02) {
      void q1(`DELETE FROM payguard.rate_limits WHERE window_start < now() - interval '1 day'`).catch(() => undefined);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit, reset };
  } catch (e) {
    console.error("[rate-limit] failing open", e);
    return { allowed: true, remaining: limit, limit, reset };
  }
}
