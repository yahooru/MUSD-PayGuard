"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Same-origin JSON fetch with structured errors. Writes always send the Origin header (browser default). */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json: body, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: body !== undefined ? JSON.stringify(body) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "PayGuard's server could not be reached. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status}).`, err?.details);
  }
  return data as T;
}
