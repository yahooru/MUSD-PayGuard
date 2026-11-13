import { describe, expect, it } from "vitest";
import { isConnectPhaseError, isReadOnlySql, isRetryable, withRetry } from "@/lib/server/retry";

/** Shape of the error Neon raised when the TCP connect to Postgres timed out. */
function neonConnectTimeout() {
  const socket = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause: socket });
  return Object.assign(new Error("Error connecting to database: fetch failed"), { sourceError: fetchFailed });
}

describe("database connect retry", () => {
  it("recognises a connect timeout wrapped by undici and Neon", () => {
    expect(isConnectPhaseError(neonConnectTimeout())).toBe(true);
    expect(isConnectPhaseError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
  });

  it("does not treat mid-request resets, SQL errors or plain errors as safe to retry", () => {
    expect(isConnectPhaseError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(false);
    expect(isConnectPhaseError(Object.assign(new Error("dup"), { code: "23505" }))).toBe(false);
    expect(isConnectPhaseError(new Error("boom"))).toBe(false);
    expect(isConnectPhaseError(null)).toBe(false);
  });

  it("survives a cyclic cause chain", () => {
    const a: { code?: string; cause?: unknown } = {};
    a.cause = a;
    expect(isConnectPhaseError(a)).toBe(false);
  });

  it("retries connect failures, then succeeds", async () => {
    let calls = 0;
    const v = await withRetry(async () => {
      calls++;
      if (calls < 3) throw neonConnectTimeout();
      return "ok";
    }, false, [0, 0]);
    expect(v).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the configured attempts and never retries other errors", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw neonConnectTimeout(); }, false, [0, 0])).rejects.toThrow(/connecting/);
    expect(calls).toBe(3);
    calls = 0;
    await expect(withRetry(async () => { calls++; throw Object.assign(new Error("dup"), { code: "23505" }); }, true, [0, 0])).rejects.toThrow("dup");
    expect(calls).toBe(1);
  });

  it("retries a mid-request reset only for read-only statements", async () => {
    const reset = () => Object.assign(new Error("Error connecting to database: fetch failed"), { sourceError: { cause: { code: "ECONNRESET" } } });
    expect(isRetryable(reset(), true)).toBe(true);
    expect(isRetryable(reset(), false)).toBe(false);
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw reset(); }, false, [0, 0])).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("classifies SQL as read-only conservatively", () => {
    expect(isReadOnlySql("SELECT 1 AS ok")).toBe(true);
    expect(isReadOnlySql("  select * from payguard.users where updated_at > $1")).toBe(true);
    expect(isReadOnlySql("SELECT * FROM payguard.drafts WHERE id = $1 FOR UPDATE")).toBe(false);
    expect(isReadOnlySql("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x")).toBe(false);
    expect(isReadOnlySql("UPDATE payguard.drafts SET status = $2")).toBe(false);
    expect(isReadOnlySql("INSERT INTO payguard.audit_events VALUES ($1)")).toBe(false);
  });
});
