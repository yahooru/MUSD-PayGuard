/**
 * Transient-failure handling for the database client.
 *
 * Only failures that happen BEFORE a request reaches the server are retried: a TCP connect
 * timeout, a refused connection or a DNS miss. In those cases the query was never sent, so a
 * retry is safe even for writes. A reset in the middle of a request is not retried, because the
 * write may already have been applied.
 */
const CONNECT_PHASE = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

/** Walks `cause` / `sourceError` chains (undici and Neon wrap the socket error several times). */
export function isConnectPhaseError(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && CONNECT_PHASE.has(code)) return true;
    const next = (cur as { sourceError?: unknown; cause?: unknown }).sourceError ?? (cur as { cause?: unknown }).cause;
    cur = next;
  }
  return false;
}

export async function withConnectRetry<T>(fn: () => Promise<T>, delaysMs: readonly number[] = [300, 900]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delaysMs.length || !isConnectPhaseError(e)) throw e;
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
  }
}
