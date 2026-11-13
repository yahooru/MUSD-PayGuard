import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";
import { HttpError } from "./http";

export const SESSION_COOKIE = "pg_session";
const ISSUER = "musd-payguard";
const AUDIENCE = "musd-payguard-app";
const TTL_SECONDS = 7 * 24 * 3600;

export interface Session {
  userId: string;
  address: `0x${string}`;
}

const key = () => new TextEncoder().encode(env.sessionSecret());

export async function createSessionToken(s: Session): Promise<string> {
  return new SignJWT({ addr: s.address })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(s.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    const addr = payload.addr;
    if (typeof payload.sub !== "string" || typeof addr !== "string" || !/^0x[0-9a-f]{40}$/.test(addr)) return null;
    return { userId: payload.sub, address: addr as `0x${string}` };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction(),
  sameSite: "lax" as const,
  path: "/",
  maxAge: TTL_SECONDS,
});

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Sign in with your wallet to continue.", "unauthenticated");
  return s;
}
