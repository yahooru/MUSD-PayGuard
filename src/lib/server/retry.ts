/**
 * Transient-failure handling for the database client.
 *
 * - Failures BEFORE a request reaches the server (connect timeout, refused, DNS) are always
 *   retried: the query was never sent, so even a write is safe to repeat.
 * - A socket dropped mid-request (reset, socket error, read timeout) is retried only for
 *   read-only statements, because a write may already have been applied.
 * SQL errors are never retried.
 */
const CONNECT_PHASE = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);
const MID_REQUEST = new Set(["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT", "EPIPE"]);

/** Error codes along `cause` / `sourceError` chains (undici and Neon wrap the socket error several times). */
function codes(e: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") out.push(code);
    cur = (cur as { sourceError?: unknown }).sourceError ?? (cur as { cause?: unknown }).cause;
  }
  return out;
}

export function isConnectPhaseError(e: unknown): boolean {
  return codes(e).some((c) => CONNECT_PHASE.has(c));
}

export function isRetryable(e: unknown, readOnly: boolean): boolean {
  const cs = codes(e);
  return cs.some((c) => CONNECT_PHASE.has(c)) || (readOnly && cs.some((c) => MID_REQUEST.has(c)));
}

const STARTS_WITH_SELECT = /^\s*select\b/i;
const WRITE_KEYWORD = /\b(insert|update|delete|merge|truncate|alter|create|drop)\b/i;

/** A single SELECT with no data-modifying keyword (conservative: "FOR UPDATE" counts as a write). */
export function isReadOnlySql(text: string): boolean {
  return STARTS_WITH_SELECT.test(text) && !WRITE_KEYWORD.test(text);
}

export async function withRetry<T>(fn: () => Promise<T>, readOnly: boolean, delaysMs: readonly number[] = [300, 900]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delaysMs.length || !isRetryable(e, readOnly)) throw e;
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
  }
}
