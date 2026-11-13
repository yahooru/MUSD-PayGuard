import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAddress, recoverMessageAddress, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage, verifySiweMessage } from "viem/siwe";
import { SUPPORTED_NETWORK } from "../../config/chains";
import { publicClient } from "./chain";
import { q, q1 } from "./db";
import { assertSameOrigin, HttpError, requestOrigin } from "./http";
import { requireSession, type Session } from "./session";

const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function issueNonce(): Promise<string> {
  const nonce = randomBytes(16).toString("hex"); // 32 alphanumeric chars (EIP-4361 requires ≥8)
  await q(`INSERT INTO payguard.auth_nonces (nonce, expires_at) VALUES ($1, $2)`, [nonce, new Date(Date.now() + NONCE_TTL_MS).toISOString()]);
  if (Math.random() < 0.05) {
    void q(`DELETE FROM payguard.auth_nonces WHERE expires_at < now() - interval '1 day'`).catch(() => undefined);
  }
  return nonce;
}

/**
 * Verify a Sign-In With Ethereum message. Checks, in order:
 * structure, domain and URI (this host), chain id (Mezo Testnet), issuedAt/expiration,
 * single-use unexpired server nonce (consumed atomically), and the signature
 * (EOA via ecrecover; smart accounts via ERC-1271/6492).
 */
export async function verifySiwe(req: NextRequest, message: string, signature: Hex): Promise<`0x${string}`> {
  const { host, origin } = requestOrigin(req);
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || !parsed.domain || !parsed.uri || !parsed.chainId || !parsed.issuedAt) {
    throw new HttpError(400, "The sign-in message is incomplete.", "siwe_invalid");
  }
  if (parsed.domain !== host) throw new HttpError(401, `Sign-in message is for ${parsed.domain}, not ${host}.`, "siwe_domain");
  let uriOrigin: string;
  try {
    uriOrigin = new URL(parsed.uri).origin;
  } catch {
    throw new HttpError(400, "The sign-in URI is invalid.", "siwe_invalid");
  }
  if (uriOrigin !== origin) throw new HttpError(401, "Sign-in URI does not match this site.", "siwe_uri");
  if (parsed.chainId !== SUPPORTED_NETWORK.chainId) {
    throw new HttpError(401, `Sign in on ${SUPPORTED_NETWORK.name} (chain ${SUPPORTED_NETWORK.chainId}).`, "siwe_chain");
  }
  const now = Date.now();
  if (parsed.issuedAt.getTime() > now + MAX_CLOCK_SKEW_MS || parsed.issuedAt.getTime() < now - NONCE_TTL_MS - MAX_CLOCK_SKEW_MS) {
    throw new HttpError(401, "The sign-in message is too old or from the future. Try again.", "siwe_time");
  }
  if (!validateSiweMessage({ message: parsed, domain: host, time: new Date() })) {
    throw new HttpError(401, "The sign-in message has expired or is not yet valid.", "siwe_time");
  }

  // Consume the nonce atomically: a nonce can authenticate exactly one session.
  const consumed = await q1(
    `UPDATE payguard.auth_nonces SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING nonce`,
    [parsed.nonce],
  );
  if (!consumed) throw new HttpError(401, "This sign-in request was already used or has expired. Try again.", "siwe_nonce");

  const address = getAddress(parsed.address);
  let valid = false;
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    valid = recovered.toLowerCase() === address.toLowerCase();
  } catch {
    valid = false;
  }
  if (!valid) {
    // Smart-contract wallets (ERC-1271 / ERC-6492).
    valid = await verifySiweMessage(publicClient(), { message, signature, domain: host, nonce: parsed.nonce, address }).catch(() => false);
  }
  if (!valid) throw new HttpError(401, "The signature does not match the address in the message.", "siwe_signature");
  return address.toLowerCase() as `0x${string}`;
}

/** Session + CSRF check for cookie-authenticated write requests. */
export async function requireWriter(req: NextRequest): Promise<Session> {
  assertSameOrigin(req);
  return requireSession();
}
