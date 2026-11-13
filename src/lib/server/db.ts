import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "./env";
import { isReadOnlySql, withRetry } from "./retry";

/**
 * Neon serverless (HTTP) client. All tables are schema-qualified with `payguard.`
 * because the database is shared with other applications.
 */
let client: NeonQueryFunction<false, false> | null = null;

export function db(): NeonQueryFunction<false, false> {
  if (!client) client = neon(env.databaseUrl());
  return client;
}

export type Row = Record<string, any>;

/** Runs one query, retrying transient network failures where that is provably safe (see retry.ts). */
export async function q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await withRetry(() => db().query(text, params), isReadOnlySql(text))) as T[];
}

export async function q1<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Postgres error code helper (e.g. 23505 unique_violation). */
export function pgCode(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return null;
}

export function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
