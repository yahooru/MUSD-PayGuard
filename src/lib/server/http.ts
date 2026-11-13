import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
    public details?: unknown,
  ) {
    super(message);
  }
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export function json(data: unknown, init: ResponseInit = {}): NextResponse {
  return new NextResponse(JSON.stringify(data, replacer), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

export function errorJson(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
  return json({ error: { code, message, details } }, { status, headers });
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler: maps HttpError / ZodError to JSON, hides internal errors. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return errorJson(e.status, e.code, e.message, e.details);
      if (e instanceof ZodError) {
        return errorJson(
          400,
          "invalid_input",
          "Some fields are invalid.",
          e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      console.error("[api] unhandled error", e);
      return errorJson(500, "internal", "Something went wrong on the server. Nothing was signed or sent.");
    }
  };
}

const MAX_BODY = 32 * 1024;

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Request body too large.", "too_large");
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.", "bad_json");
  }
  return schema.parse(data);
}

/**
 * CSRF defence for cookie-authenticated writes: the Origin (or Referer) must match this host.
 * Session cookies are also SameSite=Lax.
 */
export function assertSameOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);
  if (!origin) {
    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site request rejected.", "csrf");
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Invalid Origin header.", "csrf");
  }
  if (!host || originHost !== host) throw new HttpError(403, "Cross-site request rejected.", "csrf");
}

export function requestOrigin(req: NextRequest): { host: string; origin: string } {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return { host, origin: `${proto}://${host}` };
}

export function ipHash(req: NextRequest, salt: string): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}
