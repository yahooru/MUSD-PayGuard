/**
 * Live end-to-end test against a running PayGuard (local `next start` or production) and the
 * real Mezo Testnet.
 *
 *   TEST_WALLETS_FILE=/path/wallets.json E2E_BASE_URL=http://localhost:3000 npx tsx scripts/e2e-testnet.ts
 *
 * Two modes, chosen from alice's on-chain MUSD balance:
 *  - funded (>= 4 MUSD): the full suite, including real direct and PayGuardRouter payments
 *    (spends about 3 test MUSD);
 *  - unfunded: everything that does not move tokens. It sends NO transaction: preflights run
 *    against the live RPC, the router call is simulated with a real permit signature, and the
 *    public API is checked against earlier real payments (including one made through the
 *    retired router).
 *
 * Wallets file: { "payguard": [ { "role": "alice", "privateKey": "0x…" }, { "role": "bob", … } ] }.
 * Keys are read at runtime (never copied into the project, never printed).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, decodeEventLog, http, parseSignature, parseUnits, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { MEZO_TESTNET, explorer, mezoTestnet } from "../src/config/chains";
import { MUSD, PAYGUARD_ROUTER, PAYGUARD_ROUTER_LEGACY, gasLimitFor, musdAbi, routerAbi } from "../src/config/contracts";
import { formatAmount } from "../src/lib/amount";
import { invoiceRefHash } from "../src/lib/invoice";

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WALLETS = process.env.TEST_WALLETS_FILE ?? "";
/** Real payments made through PayGuard earlier, used to check the public API without spending. */
const HISTORIC = {
  direct: "0xbae1ee76315a66277c252bda7f951c350f6b605cc7e7f00f7ba15256d4a95b2c" as Hex,
  legacyRouter: { hash: "0x4139a5a1c5e4adf5701dd29eb68e74957a04d97326935dc14dc8b75ff41accfc" as Hex, invoiceRef: "REQ-MVPC07MU" },
};
const RUN = Date.now().toString(36).toUpperCase();
const pub = createPublicClient({ chain: mezoTestnet, transport: http(MEZO_TESTNET.rpcUrl, { retryCount: 3 }) });

/* ------------------------------------------------------------ reporting */
const results: { step: string; ok: boolean; detail: string }[] = [];
const skipped: string[] = [];
const txs: Record<string, string> = {};
function record(step: string, ok: boolean, detail = "") {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? `  — ${detail}` : ""}`);
}
function expect(cond: unknown, step: string, detail = ""): asserts cond {
  record(step, !!cond, detail);
  if (!cond) throw new Error(`Assertion failed: ${step} ${detail}`);
}
const soft = (cond: unknown, step: string, detail = "") => record(step, !!cond, detail);

/* ------------------------------------------------------------ HTTP actor */
interface Res<T = any> {
  status: number;
  body: T;
}
class Actor {
  cookie = "";
  constructor(
    public name: string,
    public account: PrivateKeyAccount,
  ) {}
  async req<T = any>(method: string, path: string, json?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        accept: "application/json",
        origin: BASE,
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = setCookie.match(/pg_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `pg_session=${m[1]}` : "";
    }
    const text = await res.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    return { status: res.status, body };
  }
  async siweMessage() {
    const { body } = await this.req<{ nonce: string }>("GET", "/api/auth/nonce");
    const message = createSiweMessage({
      domain: new URL(BASE).host,
      address: this.account.address,
      statement: "Sign in to MUSD PayGuard (automated e2e test).",
      uri: BASE,
      version: "1",
      chainId: MEZO_TESTNET.chainId,
      nonce: body.nonce,
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 10 * 60 * 1000),
    });
    const signature = await this.account.signMessage({ message });
    return { message, signature };
  }
  async login() {
    const sm = await this.siweMessage();
    const r = await this.req("POST", "/api/auth/verify", sm);
    if (r.status !== 200) throw new Error(`${this.name} login failed: ${r.status} ${JSON.stringify(r.body)}`);
    return sm;
  }
}

function loadAccounts() {
  if (!WALLETS) throw new Error("Set TEST_WALLETS_FILE to a wallets JSON file (see the header of this script).");
  const w = JSON.parse(readFileSync(WALLETS, "utf8")) as Record<string, { role: string; address: string; privateKey: string }[]>;
  const find = (role: string) => {
    const e = w.payguard?.find((x) => x.role === role);
    if (!e) throw new Error(`payguard.${role} not found in wallets file`);
    const pk = (e.privateKey.startsWith("0x") ? e.privateKey : `0x${e.privateKey}`) as Hex;
    return privateKeyToAccount(pk);
  };
  return { alice: find("alice"), bob: find("bob") };
}

/* ------------------------------------------------------------ flow helpers */
const checkOf = (assessment: any, id: string) => assessment.checks.find((c: any) => c.id === id);

async function draftAndReview(actor: Actor, body: Record<string, unknown>, walletChainId: number | null = MEZO_TESTNET.chainId) {
  const d = await actor.req("POST", "/api/drafts", body);
  if (d.status !== 201) throw new Error(`draft failed ${d.status} ${JSON.stringify(d.body)}`);
  const p = await actor.req("POST", `/api/drafts/${d.body.draft.id}/preflight`, { walletChainId });
  if (p.status !== 200) throw new Error(`preflight failed ${p.status} ${JSON.stringify(p.body)}`);
  return { draft: p.body.draft, assessment: p.body.assessment, explanation: p.body.explanation };
}

async function authorize(actor: Actor, draftId: string, payloadHash: string, acknowledgements: string[] = [], walletChainId = MEZO_TESTNET.chainId) {
  return actor.req("POST", `/api/drafts/${draftId}/authorize`, {
    payloadHash,
    acknowledgements,
    walletChainId,
    walletAddress: actor.account.address,
    fullAddressCompared: true,
    addressConfirmation: null,
  });
}

async function waitConfirmed(actor: Actor, txId: string, label: string) {
  const started = Date.now();
  let last: any;
  while (Date.now() - started < 120_000) {
    const r = await actor.req("POST", `/api/transactions/${txId}/verify`, {});
    last = r.body.transaction;
    if (last && (last.status === "confirmed" || last.status === "failed")) break;
    await new Promise((res) => setTimeout(res, 3000));
  }
  expect(last?.status === "confirmed", `${label}: server verified receipt + MUSD Transfer log → confirmed`, `status=${last?.status} block=${last?.blockNumber}`);
  const steps = (last.verification?.steps ?? []) as { id: string; state: string }[];
  expect(steps.length >= 7 && steps.every((s) => s.state === "pass" || s.state === "skipped"), `${label}: every verification step passed`, steps.map((s) => `${s.id}:${s.state}`).join(" "));
  return last;
}

async function sendDirect(actor: Actor, auth: any): Promise<Hex> {
  const wallet = createWalletClient({ account: actor.account, chain: mezoTestnet, transport: http(MEZO_TESTNET.rpcUrl) });
  // Explicit gas from PayGuard's authorization (estimate * 1.3, floored at 90,000).
  return wallet.sendTransaction({ to: auth.call.to, data: auth.call.data, gas: BigInt(auth.gas), chain: mezoTestnet });
}

/* ------------------------------------------------------------ main */
async function main() {
  console.log(`PayGuard live e2e against ${BASE} (run ${RUN})`);
  const { alice: aliceAcc, bob: bobAcc } = loadAccounts();
  const alice = new Actor("alice", aliceAcc);
  const bob = new Actor("bob", bobAcc);
  const startBal = await pub.readContract({ address: MUSD.address, abi: musdAbi, functionName: "balanceOf", args: [aliceAcc.address] });
  console.log(`alice ${aliceAcc.address} on-chain MUSD ${formatAmount(startBal)}; bob ${bobAcc.address}`);

  // 0. Health
  const health = await alice.req("GET", "/api/health");
  expect(health.status === 200 && health.body.db === "ok" && health.body.rpc === "ok" && health.body.chainId === 31611, "health: db ok, rpc ok, chain 31611", `HTTP ${health.status} db=${health.body.db} rpc=${health.body.rpc} block ${health.body.blockNumber}`);

  // 1. Auth
  const unauth = await alice.req("GET", "/api/recipients");
  expect(unauth.status === 401, "unauthenticated request rejected (401)");
  const sm = await alice.login();
  const me = await alice.req("GET", "/api/auth/session");
  expect(me.body.authenticated && me.body.address === aliceAcc.address.toLowerCase(), "alice signed in with SIWE");
  const replay = await new Actor("replayer", aliceAcc).req("POST", "/api/auth/verify", sm);
  expect(replay.status === 401, "replayed SIWE message rejected (single-use nonce)", replay.body?.error?.code);
  const csrf = await alice.req("POST", "/api/drafts", { recipient: bobAcc.address, amount: "1" }, { origin: "https://evil.example" });
  expect(csrf.status === 403, "cross-site write rejected (CSRF origin check)");

  // 2. Save bob as a recipient
  let rec = await alice.req("POST", "/api/recipients", { label: "Bob (e2e)", address: bobAcc.address, notes: "PayGuard e2e test recipient" });
  if (rec.status === 409) {
    const list = await alice.req("GET", "/api/recipients");
    rec = { status: 200, body: { recipient: list.body.recipients.find((r: any) => r.address.toLowerCase() === bobAcc.address.toLowerCase()) } };
  }
  expect(rec.body.recipient?.id, "bob saved in recipient book", rec.body.recipient?.id);
  const bobId = rec.body.recipient.id as string;

  if (startBal < parseUnits("4", 18)) {
    console.log(`alice holds ${formatAmount(startBal)} MUSD (< 4): running the UNFUNDED suite. No transaction is sent.`);
    await unfundedSuite({ alice, bob, aliceAcc, bobAcc, bobId, startBal });
    return;
  }

  // 3. A previously confirmed payment to duplicate. Reuse one from history when it exists
  //    (saves test MUSD across runs); otherwise make a real 1 MUSD payment first.
  const prior = await alice.req("GET", "/api/transactions?status=confirmed&limit=20");
  let t1 = (prior.body.transactions ?? []).find((t: any) => t.invoiceRef && t.method === "direct" && t.recipient.toLowerCase() === bobAcc.address.toLowerCase());
  let ref1: string;
  if (t1) {
    ref1 = t1.invoiceRef;
    txs.payment1_reused = t1.txHash;
    record("reusing an earlier confirmed payment as the 'previously paid' invoice", true, `${ref1} ${t1.txHash}`);
    const p1 = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: `INV-${RUN}-PRE`, selectedRecipientId: bobId });
    const bal = checkOf(p1.assessment, "funds.balance");
    expect(bal?.status === "pass" && bal.evidence.some((e: any) => e.value.startsWith(formatAmount(startBal, { maxFraction: 6 }))), "preflight read alice's REAL MUSD balance", bal?.evidence?.[0]?.value);
    for (const id of ["recipient.format", "recipient.checksum", "network.wallet", "token.config", "token.onchain", "simulation.call", "recipient.book"]) {
      expect(checkOf(p1.assessment, id)?.status === "pass", `preflight ${id} passed`);
    }
    await alice.req("DELETE", `/api/drafts/${p1.draft.id}`);
  } else {
    ref1 = `INV-${RUN}-001`;
    const p1 = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: ref1, selectedRecipientId: bobId });
    const bal = checkOf(p1.assessment, "funds.balance");
    expect(bal?.status === "pass" && bal.evidence.some((e: any) => e.value.startsWith(formatAmount(startBal, { maxFraction: 6 }))), "preflight read alice's REAL MUSD balance", bal?.evidence?.[0]?.value);
    for (const id of ["recipient.format", "recipient.checksum", "network.wallet", "token.config", "token.onchain", "simulation.call", "recipient.book"]) {
      expect(checkOf(p1.assessment, id)?.status === "pass", `preflight ${id} passed`);
    }
    expect(p1.assessment.decision !== "blocked", "payment 1 not blocked", `${p1.assessment.categoryLabel}/${p1.assessment.decision}`);
    const a1 = await authorize(alice, p1.draft.id, p1.assessment.payloadHash, p1.assessment.acknowledgementsRequired);
    expect(a1.status === 200 && BigInt(a1.body.authorization.gas) >= 90_000n, "payment 1 authorized with explicit gas ≥ 90,000", `gas ${a1.body.authorization?.gas}`);
    const h1 = await sendDirect(alice, a1.body.authorization);
    const s1 = await alice.req("POST", "/api/transactions", { draftId: p1.draft.id, txHash: h1 });
    expect(s1.status === 201 || s1.status === 200, "payment 1 hash recorded immediately", h1);
    txs.payment1 = h1;
    t1 = await waitConfirmed(alice, s1.body.transaction.id, "payment 1");
  }

  // 4. Spec §22 demo: duplicate invoice reference is flagged
  const dup = await draftAndReview(alice, { recipient: bobAcc.address, amount: "2", invoiceRef: ` ${ref1.toLowerCase()} `, selectedRecipientId: bobId });
  const dupCheck = checkOf(dup.assessment, "duplicates.invoice_paid");
  expect(dupCheck?.status === "warn" && dupCheck.severity === "high", "duplicate invoice reference flagged (case/spacing-insensitive)", dupCheck?.explanation?.slice(0, 90));
  expect(dupCheck.related?.[0]?.id === t1.id, "warning links to the earlier payment for inspection");
  expect(dup.assessment.category === "high" && dup.assessment.decision === "acknowledge", "duplicate → High risk, explicit acknowledgement required");
  const noAck = await authorize(alice, dup.draft.id, dup.assessment.payloadHash, []);
  expect(noAck.status === 409 && noAck.body.error.code === "acknowledgement_required", "signing refused without acknowledgement");

  // 5. Alice corrects the reference → passes
  const patched = await alice.req("PATCH", `/api/drafts/${dup.draft.id}`, { invoiceRef: `INV-${RUN}-002` });
  expect(patched.status === 200 && patched.body.draft.status === "draft", "editing invalidates the review");
  const unreviewed = await authorize(alice, dup.draft.id, dup.assessment.payloadHash, dup.assessment.acknowledgementsRequired);
  expect(unreviewed.status === 409 && unreviewed.body.error.code === "not_reviewed", "edited payment cannot be signed before a new review");
  const fixed = await alice.req("POST", `/api/drafts/${dup.draft.id}/preflight`, { walletChainId: MEZO_TESTNET.chainId });
  expect(fixed.body.assessment.payloadHash !== dup.assessment.payloadHash, "new review is bound to a new payload hash");
  const stale = await authorize(alice, dup.draft.id, dup.assessment.payloadHash, dup.assessment.acknowledgementsRequired);
  expect(stale.status === 409 && stale.body.error.code === "review_stale", "signing with the OLD reviewed hash is refused (details changed after review)");
  expect(checkOf(fixed.body.assessment, "duplicates.invoice_paid")?.status === "pass", "corrected payment: duplicate check passes");
  expect(fixed.body.assessment.decision === "proceed", "corrected payment may proceed", fixed.body.assessment.summary);

  // 6. Real 2 MUSD transfer with explicit gas → receipt verification
  const a2 = await authorize(alice, dup.draft.id, fixed.body.assessment.payloadHash, []);
  expect(a2.status === 200, "payment 2 authorized after final re-check");
  const h2 = await sendDirect(alice, a2.body.authorization);
  const s2 = await alice.req("POST", "/api/transactions", { draftId: dup.draft.id, txHash: h2 });
  expect(s2.status === 201 || s2.status === 200, "payment 2 hash recorded immediately", h2);
  txs.payment2 = h2;
  const t2 = await waitConfirmed(alice, s2.body.transaction.id, "payment 2");
  console.log(`      explorer: ${explorer.tx(h2)}`);

  // 7. Idempotency / duplicate submission guards
  const again = await alice.req("POST", "/api/transactions", { draftId: dup.draft.id, txHash: h2 });
  expect(again.status === 200 && again.body.idempotent, "re-submitting the same hash is idempotent");
  const other = await alice.req("POST", "/api/transactions", { draftId: dup.draft.id, txHash: `0x${"ab".repeat(32)}` });
  expect(other.status === 409 && other.body.error.code === "already_submitted", "second hash for the same payment rejected (double-submit guard)");
  const p3 = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: `INV-${RUN}-003`, selectedRecipientId: bobId });
  const a3 = await authorize(alice, p3.draft.id, p3.assessment.payloadHash, p3.assessment.acknowledgementsRequired);
  expect(a3.status === 200, "third draft authorized (never signed)");
  const reuse = await alice.req("POST", "/api/transactions", { draftId: p3.draft.id, txHash: h2 });
  expect(reuse.status === 409 && reuse.body.error.code === "duplicate_tx_hash", "an already-recorded tx hash cannot be reused for another payment");
  const unsigned = await alice.req("GET", `/api/drafts/${p3.draft.id}`);
  expect(unsigned.body.draft.transactionId === null, "authorized-but-unsigned payment (e.g. rejected in wallet) records no transaction");
  await alice.req("DELETE", `/api/drafts/${p3.draft.id}`);

  // 8. Refresh survival: a brand-new session re-fetches the payment by id
  const fresh = new Actor("alice-2", aliceAcc);
  await fresh.login();
  const refetch = await fresh.req("GET", `/api/transactions/${t2.id}`);
  expect(refetch.status === 200 && refetch.body.transaction.status === "confirmed" && refetch.body.assessment?.checks?.length > 10, "status + checks survive a refresh / new session (re-fetch by id)");

  // 9. Public verification API
  const v = (expected: Record<string, string>) => alice.req("POST", "/api/v1/verify", { txHash: h2, expected });
  const vOk = await v({ recipient: bobAcc.address, amount: "2", from: aliceAcc.address });
  expect(vOk.body.verdict === "verified", "public API: correct expectation → verified");
  const vAmt = await v({ recipient: bobAcc.address, amount: "3" });
  expect(vAmt.body.verdict === "mismatch", "public API: wrong amount → mismatch", vAmt.body.reason);
  const vTo = await v({ recipient: aliceAcc.address, amount: "2" });
  expect(vTo.body.verdict === "mismatch", "public API: wrong recipient → mismatch");
  const vNf = await alice.req("GET", `/api/v1/verify?txHash=0x${"12".repeat(32)}&recipient=${bobAcc.address}&amount=2`);
  expect(vNf.body.verdict === "not_found", "public API: unknown hash → not_found");

  // 10. Negative preflight cases
  const bad = await draftAndReview(alice, { recipient: "0x123", amount: "1", invoiceRef: `INV-${RUN}-BAD` });
  expect(checkOf(bad.assessment, "recipient.format")?.status === "fail" && bad.assessment.decision === "blocked", "invalid address → blocked");
  const badAuth = await authorize(alice, bad.draft.id, bad.assessment.payloadHash, bad.assessment.checks.map((c: any) => c.id));
  expect(badAuth.status === 409 && badAuth.body.error.code === "blocked", "blocked payment cannot be authorized even with acknowledgements");
  const wrongChain = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: `INV-${RUN}-WC` }, 1);
  expect(checkOf(wrongChain.assessment, "network.wallet")?.status === "fail" && wrongChain.assessment.decision === "blocked", "wallet on wrong chain (1) → blocked");
  const tampered = bobAcc.address.replace(/[a-f]/, (c) => c.toUpperCase()) === bobAcc.address ? bobAcc.address.replace(/[A-F]/, (c) => c.toLowerCase()) : bobAcc.address.replace(/[a-f]/, (c) => c.toUpperCase());
  const cs = await draftAndReview(alice, { recipient: tampered, amount: "1" });
  expect(checkOf(cs.assessment, "recipient.checksum")?.status === "fail", "mixed-case address with invalid EIP-55 checksum → failed");
  const look = `0x${bobAcc.address.slice(2, 6)}${"7".repeat(32)}${bobAcc.address.slice(-4)}`;
  const lk = await draftAndReview(alice, { recipient: look, amount: "1", invoiceRef: `INV-${RUN}-LK` });
  const lkc = checkOf(lk.assessment, "recipient.lookalike");
  expect(lkc?.status === "warn" && lkc.severity === "critical", "address-poisoning lookalike of saved bob flagged (critical)", lkc?.explanation?.slice(0, 80));
  const tokenSelf = await draftAndReview(alice, { recipient: MUSD.address, amount: "1" });
  expect(checkOf(tokenSelf.assessment, "recipient.destination")?.status === "fail", "paying the MUSD token contract itself → blocked");
  const tooMuch = await draftAndReview(alice, { recipient: bobAcc.address, amount: "100000", invoiceRef: `INV-${RUN}-BIG` });
  expect(checkOf(tooMuch.assessment, "funds.balance")?.status === "fail" && checkOf(tooMuch.assessment, "simulation.call")?.status === "fail", "insufficient balance → balance + simulation fail", checkOf(tooMuch.assessment, "simulation.call")?.evidence?.[0]?.value);

  // 11. Authorization boundary: bob cannot see alice's payment
  await bob.login();
  const peek = await bob.req("GET", `/api/transactions/${t2.id}`);
  expect(peek.status === 404, "another wallet cannot read alice's payment (404)");

  // 12. Payment request + PayGuardRouter (on-chain invoice registry, permit, one tx)
  const reqRef = `REQ-${RUN}`;
  const created = await bob.req("POST", "/api/requests", { amount: "1", invoiceRef: reqRef, description: "e2e router invoice", expiresInDays: 7, payer: aliceAcc.address });
  expect(created.status === 201, "bob created a payment request", created.body.request?.id);
  const dupReq = await bob.req("POST", "/api/requests", { amount: "1", invoiceRef: reqRef.toLowerCase() });
  expect(dupReq.status === 409 && dupReq.body.error.code === "duplicate_reference", "duplicate request reference rejected");
  const reqId = created.body.request.id as string;
  const opened = await alice.req("GET", `/api/requests/${reqId}`);
  expect(opened.status === 200 && opened.body.assessment.decision !== "blocked", "request re-validated on open", opened.body.assessment.summary);
  const incoming = await alice.req("GET", "/api/requests");
  soft(incoming.body.incoming.some((r: any) => r.id === reqId), "request appears in alice's incoming list");

  const rp = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: reqRef, method: "router", requestId: reqId, selectedRecipientId: bobId });
  expect(["request.status", "request.amount", "request.recipient", "request.token", "request.network"].every((id) => checkOf(rp.assessment, id)?.status === "pass"), "router payment matches the request (status, amount, recipient, token, network)");
  expect(checkOf(rp.assessment, "duplicates.onchain_registry")?.status === "pass", "on-chain registry: not paid yet");
  const ra = await authorize(alice, rp.draft.id, rp.assessment.payloadHash, rp.assessment.acknowledgementsRequired);
  expect(ra.status === 200 && ra.body.authorization.call.kind === "router", "router payment authorized");
  const amount = parseUnits("1", 18);
  const nonce = await pub.readContract({ address: MUSD.address, abi: musdAbi, functionName: "nonces", args: [aliceAcc.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const sig = await aliceAcc.signTypedData({
    domain: { name: MUSD.permit.name, version: MUSD.permit.version, chainId: MEZO_TESTNET.chainId, verifyingContract: MUSD.address },
    types: { Permit: [ { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] },
    primaryType: "Permit",
    message: { owner: aliceAcc.address, spender: PAYGUARD_ROUTER.address, value: amount, nonce, deadline },
  });
  const { r, s, v: vv, yParity } = parseSignature(sig);
  const args = [bobAcc.address, amount, ra.body.authorization.call.invoiceRefHash as Hex, deadline, Number(vv ?? BigInt(yParity + 27)), r, s] as const;
  await pub.simulateContract({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "payWithPermit", args, account: aliceAcc.address });
  record("router call simulated with the real permit before sending", true);
  const est = await pub.estimateContractGas({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "payWithPermit", args, account: aliceAcc.address }).catch(() => null);
  const { gas } = gasLimitFor("routerPayWithPermit", est);
  const wallet = createWalletClient({ account: aliceAcc, chain: mezoTestnet, transport: http(MEZO_TESTNET.rpcUrl) });
  const h3 = await wallet.writeContract({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "payWithPermit", args, gas, chain: mezoTestnet });
  const s3 = await alice.req("POST", "/api/transactions", { draftId: rp.draft.id, txHash: h3 });
  expect(s3.status === 201 || s3.status === 200, "router payment hash recorded", `${h3} (gas limit ${gas}, estimate ${est})`);
  txs.routerPayWithPermit = h3;
  const t3 = await waitConfirmed(alice, s3.body.transaction.id, "router payment");
  expect(t3.verification.steps.some((x: any) => x.id === "invoice_ref" && x.state === "pass"), "router payment: InvoicePaid event with the invoice reference verified");
  const paidReq = await bob.req("GET", `/api/requests/${reqId}`);
  expect(paidReq.body.request.status === "paid", "request marked paid only after verified on-chain payment");
  const onchain = await pub.readContract({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "isPaid", args: [aliceAcc.address, bobAcc.address, args[2]] });
  expect(onchain === true, "PayGuardRouter.isPaid(alice, bob, ref) == true on-chain");
  const vRef = await alice.req("POST", "/api/v1/verify", { txHash: h3, expected: { recipient: bobAcc.address, amount: "1", invoiceRef: reqRef } });
  expect(vRef.body.verdict === "verified" && vRef.body.invoice?.recordedOnChain === true, "public API verifies the on-chain invoice reference");
  const vRefBad = await alice.req("POST", "/api/v1/verify", { txHash: h3, expected: { recipient: bobAcc.address, amount: "1", invoiceRef: `${reqRef}-X` } });
  expect(vRefBad.body.verdict === "mismatch", "public API: wrong invoice reference on a router payment → mismatch");

  // 13. Cross-device duplicate: the registry blocks paying the same invoice again
  const rp2 = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: reqRef, method: "router", selectedRecipientId: bobId });
  expect(checkOf(rp2.assessment, "duplicates.onchain_registry")?.status === "warn", "second payment of the same invoice: on-chain registry flags it");
  const nonce2 = await pub.readContract({ address: MUSD.address, abi: musdAbi, functionName: "nonces", args: [aliceAcc.address] });
  const sig2 = await aliceAcc.signTypedData({
    domain: { name: MUSD.permit.name, version: MUSD.permit.version, chainId: MEZO_TESTNET.chainId, verifyingContract: MUSD.address },
    types: { Permit: [ { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] },
    primaryType: "Permit",
    message: { owner: aliceAcc.address, spender: PAYGUARD_ROUTER.address, value: amount, nonce: nonce2, deadline },
  });
  const p2 = parseSignature(sig2);
  let reverted = "";
  try {
    await pub.simulateContract({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "payWithPermit", args: [args[0], amount, args[2], deadline, Number(p2.v ?? BigInt(p2.yParity + 27)), p2.r, p2.s], account: aliceAcc.address });
  } catch (e: any) {
    reverted = e?.cause?.data?.errorName ?? (/AlreadyPaid/.test(String(e?.message)) ? "AlreadyPaid" : String(e?.shortMessage ?? e));
  }
  expect(reverted === "AlreadyPaid", "re-paying the invoice through the router reverts on-chain with AlreadyPaid (simulated, no gas spent)", reverted);

  const endBal = await pub.readContract({ address: MUSD.address, abi: musdAbi, functionName: "balanceOf", args: [aliceAcc.address] });
  console.log(`alice MUSD ${formatAmount(startBal)} → ${formatAmount(endBal)} (spent ${formatAmount(startBal - endBal)})`);
}

/* ------------------------------------------------------------ unfunded suite */
/** The public Mezo RPC is load-balanced: a lagging node can briefly miss a mined receipt. */
async function receiptOf(hash: Hex) {
  for (let i = 0; ; i++) {
    try {
      return await pub.getTransactionReceipt({ hash });
    } catch (e) {
      if (i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function permitArgs(owner: PrivateKeyAccount, to: Hex, amount: bigint, refHash: Hex) {
  const nonce = await pub.readContract({ address: MUSD.address, abi: musdAbi, functionName: "nonces", args: [owner.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const sig = await owner.signTypedData({
    domain: { name: MUSD.permit.name, version: MUSD.permit.version, chainId: MEZO_TESTNET.chainId, verifyingContract: MUSD.address },
    types: { Permit: [ { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] },
    primaryType: "Permit",
    message: { owner: owner.address, spender: PAYGUARD_ROUTER.address, value: amount, nonce, deadline },
  });
  const { r, s, v, yParity } = parseSignature(sig);
  return [to, amount, refHash, deadline, Number(v ?? BigInt(yParity + 27)), r, s] as const;
}

async function unfundedSuite({
  alice,
  bob,
  aliceAcc,
  bobAcc,
  bobId,
  startBal,
}: {
  alice: Actor;
  bob: Actor;
  aliceAcc: PrivateKeyAccount;
  bobAcc: PrivateKeyAccount;
  bobId: string;
  startBal: bigint;
}) {
  // A. The newly deployed router, read straight from the chain and the explorer.
  const code = await pub.getCode({ address: PAYGUARD_ROUTER.address });
  const token = await pub.readContract({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "token" });
  expect(!!code && code.length > 2 && token.toLowerCase() === MUSD.address.toLowerCase(), "new PayGuardRouter has code on-chain and routes MUSD", PAYGUARD_ROUTER.address);
  for (const legacy of PAYGUARD_ROUTER_LEGACY) {
    const lt = await pub.readContract({ address: legacy.address, abi: routerAbi, functionName: "token" });
    expect(lt.toLowerCase() === MUSD.address.toLowerCase(), "retired PayGuardRouter is still readable on-chain", legacy.address);
  }
  const bs = await fetch(`${MEZO_TESTNET.explorerApiUrl}/smart-contracts/${PAYGUARD_ROUTER.address}`).then((r) => r.json()).catch(() => null);
  soft(bs?.is_verified === true && bs?.name === "PayGuardRouter", "router source is verified on the Mezo explorer", bs ? `${bs.name} verified=${bs.is_verified}` : "explorer unreachable");

  // B. Preflight against the live RPC: real balances, every structural check passes, funds block it.
  const ref = `INV-${RUN}-U1`;
  const p1 = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: ref, selectedRecipientId: bobId });
  const bal = checkOf(p1.assessment, "funds.balance");
  expect(bal?.status === "fail" && bal.evidence.some((e: any) => e.value.startsWith(formatAmount(startBal, { maxFraction: 6 }))), "preflight read alice's REAL MUSD balance and blocks the shortfall", bal?.evidence?.[0]?.value);
  for (const id of ["recipient.format", "recipient.checksum", "recipient.destination", "network.wallet", "network.payment", "token.config", "token.onchain", "recipient.book"]) {
    expect(checkOf(p1.assessment, id)?.status === "pass", `preflight ${id} passed`);
  }
  soft(checkOf(p1.assessment, "funds.gas")?.status === "pass", "alice's testnet BTC covers the network fee", checkOf(p1.assessment, "funds.gas")?.evidence?.[0]?.value);
  expect(checkOf(p1.assessment, "simulation.call")?.status === "fail", "eth_call simulation of the exact transfer fails without MUSD", checkOf(p1.assessment, "simulation.call")?.evidence?.[0]?.value);
  expect(checkOf(p1.assessment, "duplicates.onchain_registry")?.status === "pass", "new router registry read: invoice not paid");
  expect(p1.assessment.decision === "blocked", "insufficient MUSD → sending blocked");
  const blockedAuth = await authorize(alice, p1.draft.id, p1.assessment.payloadHash, p1.assessment.checks.map((c: any) => c.id));
  expect(blockedAuth.status === 409 && blockedAuth.body.error.code === "blocked", "server re-check refuses to authorize a blocked payment, even with every acknowledgement");

  // C. Review integrity: editing invalidates the review, the old hash is refused.
  const patched = await alice.req("PATCH", `/api/drafts/${p1.draft.id}`, { invoiceRef: `INV-${RUN}-U2` });
  expect(patched.status === 200 && patched.body.draft.status === "draft", "editing invalidates the review");
  const unreviewed = await authorize(alice, p1.draft.id, p1.assessment.payloadHash, []);
  expect(unreviewed.status === 409 && unreviewed.body.error.code === "not_reviewed", "edited payment cannot be signed before a new review");
  const again = await alice.req("POST", `/api/drafts/${p1.draft.id}/preflight`, { walletChainId: MEZO_TESTNET.chainId });
  expect(again.body.assessment.payloadHash !== p1.assessment.payloadHash, "new review is bound to a new payload hash");
  const stale = await authorize(alice, p1.draft.id, p1.assessment.payloadHash, []);
  expect(stale.status === 409 && stale.body.error.code === "review_stale", "signing with the OLD reviewed hash is refused");

  // D. Session survival and isolation.
  const fresh = new Actor("alice-2", aliceAcc);
  await fresh.login();
  const refetch = await fresh.req("GET", `/api/drafts/${p1.draft.id}`);
  expect(refetch.status === 200 && refetch.body.draft.id === p1.draft.id, "draft and its review survive a new session");
  await bob.login();
  const peek = await bob.req("GET", `/api/drafts/${p1.draft.id}`);
  expect(peek.status === 404, "another wallet cannot read alice's draft (404)");
  await alice.req("DELETE", `/api/drafts/${p1.draft.id}`);

  // E. Negative preflight cases.
  const bad = await draftAndReview(alice, { recipient: "0x123", amount: "1", invoiceRef: `INV-${RUN}-BAD` });
  expect(checkOf(bad.assessment, "recipient.format")?.status === "fail" && bad.assessment.decision === "blocked", "invalid address → blocked");
  const wrongChain = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: `INV-${RUN}-WC` }, 1);
  expect(checkOf(wrongChain.assessment, "network.wallet")?.status === "fail", "wallet on wrong chain (1) → blocked");
  const tampered = bobAcc.address.replace(/[a-f]/, (c) => c.toUpperCase()) === bobAcc.address ? bobAcc.address.replace(/[A-F]/, (c) => c.toLowerCase()) : bobAcc.address.replace(/[a-f]/, (c) => c.toUpperCase());
  const cs = await draftAndReview(alice, { recipient: tampered, amount: "1" });
  expect(checkOf(cs.assessment, "recipient.checksum")?.status === "fail", "mixed-case address with invalid EIP-55 checksum → failed");
  const look = `0x${bobAcc.address.slice(2, 6)}${"7".repeat(32)}${bobAcc.address.slice(-4)}`;
  const lk = await draftAndReview(alice, { recipient: look, amount: "1", invoiceRef: `INV-${RUN}-LK` });
  const lkc = checkOf(lk.assessment, "recipient.lookalike");
  expect(lkc?.status === "warn" && lkc.severity === "critical", "address-poisoning lookalike of saved bob flagged (critical)", lkc?.explanation?.slice(0, 80));
  const tokenSelf = await draftAndReview(alice, { recipient: MUSD.address, amount: "1" });
  expect(checkOf(tokenSelf.assessment, "recipient.destination")?.status === "fail", "paying the MUSD token contract itself → blocked");
  const toRouter = await draftAndReview(alice, { recipient: PAYGUARD_ROUTER.address, amount: "1" });
  expect(checkOf(toRouter.assessment, "recipient.destination")?.status === "fail", "paying the new PayGuardRouter itself → blocked");
  const toOld = await draftAndReview(alice, { recipient: PAYGUARD_ROUTER_LEGACY[0].address, amount: "1" });
  expect(checkOf(toOld.assessment, "recipient.destination")?.status === "fail", "paying the retired PayGuardRouter → blocked");
  for (const d of [bad, wrongChain, cs, lk, tokenSelf, toRouter, toOld]) await alice.req("DELETE", `/api/drafts/${d.draft.id}`);

  // F. Payment request + router path up to the signature.
  const reqRef = `REQ-${RUN}`;
  const created = await bob.req("POST", "/api/requests", { amount: "1", invoiceRef: reqRef, description: "e2e router invoice (unfunded)", expiresInDays: 7, payer: aliceAcc.address });
  expect(created.status === 201, "bob created a payment request", created.body.request?.id);
  const dupReq = await bob.req("POST", "/api/requests", { amount: "1", invoiceRef: reqRef.toLowerCase() });
  expect(dupReq.status === 409 && dupReq.body.error.code === "duplicate_reference", "duplicate request reference rejected (case-insensitive)");
  const reqId = created.body.request.id as string;
  const opened = await alice.req("GET", `/api/requests/${reqId}`);
  expect(opened.status === 200 && opened.body.request?.id === reqId, "request opens for the payer and is re-validated", opened.body.assessment?.summary);
  const incoming = await alice.req("GET", "/api/requests");
  soft(incoming.body.incoming?.some((r: any) => r.id === reqId), "request appears in alice's incoming list");
  const rp = await draftAndReview(alice, { recipient: bobAcc.address, amount: "1", invoiceRef: reqRef, method: "router", requestId: reqId, selectedRecipientId: bobId });
  expect(["request.status", "request.amount", "request.recipient", "request.token", "request.network"].every((id) => checkOf(rp.assessment, id)?.status === "pass"), "router payment matches the request (status, amount, recipient, token, network)");
  const args = await permitArgs(aliceAcc, bobAcc.address, parseUnits("1", 18), invoiceRefHash(reqRef));
  let revert = "";
  try {
    await pub.simulateContract({ address: PAYGUARD_ROUTER.address, abi: [...routerAbi, ...musdAbi.filter((x) => x.type === "error")], functionName: "payWithPermit", args, account: aliceAcc.address });
    revert = "no revert";
  } catch (e: any) {
    revert = e?.cause?.data?.errorName ?? e?.cause?.reason ?? String(e?.shortMessage ?? e).slice(0, 120);
  }
  expect(revert === "ERC20InsufficientBalance", "new router: payWithPermit simulated with a real permit gets past the allowance and stops at the balance", revert);
  const cancelled = await bob.req("PATCH", `/api/requests/${reqId}`, { action: "cancel" });
  expect(cancelled.status === 200, "bob cancelled the request (it was never paid)");
  await alice.req("DELETE", `/api/drafts/${rp.draft.id}`);

  // G. Public verification API against real, earlier PayGuard payments.
  const dRc = await receiptOf(HISTORIC.direct);
  const dTr = dRc.logs
    .filter((l) => l.address.toLowerCase() === MUSD.address.toLowerCase())
    .map((l) => decodeEventLog({ abi: musdAbi, data: l.data, topics: l.topics }))
    .find((e) => e.eventName === "Transfer")!.args as { from: Hex; to: Hex; value: bigint };
  const vOk = await alice.req("POST", "/api/v1/verify", { txHash: HISTORIC.direct, expected: { recipient: dTr.to, amountBaseUnits: dTr.value.toString(), from: dTr.from } });
  expect(vOk.body.verdict === "verified" && vOk.body.transaction?.calledContract === "MUSD", "public API: earlier direct payment → verified", HISTORIC.direct);
  const vAmt = await alice.req("POST", "/api/v1/verify", { txHash: HISTORIC.direct, expected: { recipient: dTr.to, amountBaseUnits: (dTr.value + 1n).toString() } });
  expect(vAmt.body.verdict === "mismatch", "public API: amount off by 1 wei → mismatch", vAmt.body.reason);
  const vTo = await alice.req("POST", "/api/v1/verify", { txHash: HISTORIC.direct, expected: { recipient: aliceAcc.address, amountBaseUnits: dTr.value.toString() } });
  expect(vTo.body.verdict === "mismatch", "public API: wrong recipient → mismatch");
  const vNf = await alice.req("GET", `/api/v1/verify?txHash=0x${"12".repeat(32)}&recipient=${bobAcc.address}&amount=2`);
  expect(vNf.body.verdict === "not_found", "public API: unknown hash → not_found");

  const lRc = await receiptOf(HISTORIC.legacyRouter.hash);
  const inv = lRc.logs
    .filter((l) => l.address.toLowerCase() === PAYGUARD_ROUTER_LEGACY[0].address.toLowerCase())
    .map((l) => decodeEventLog({ abi: routerAbi, data: l.data, topics: l.topics }))
    .find((e) => e.eventName === "InvoicePaid")!.args as { payer: Hex; recipient: Hex; invoiceRef: Hex; amount: bigint };
  expect(inv.invoiceRef === invoiceRefHash(HISTORIC.legacyRouter.invoiceRef), "retired-router payment carries the expected invoice reference hash on-chain");
  const vLegacy = await alice.req("POST", "/api/v1/verify", {
    txHash: HISTORIC.legacyRouter.hash,
    expected: { recipient: inv.recipient, amountBaseUnits: inv.amount.toString(), invoiceRef: HISTORIC.legacyRouter.invoiceRef },
  });
  expect(
    vLegacy.body.verdict === "verified" && vLegacy.body.transaction?.calledContract === "PayGuardRouter" && vLegacy.body.invoice?.recordedOnChain === true,
    "public API: payment through the RETIRED router still verifies, invoice reference included",
    vLegacy.body.reason,
  );
  const vLegacyBad = await alice.req("POST", "/api/v1/verify", {
    txHash: HISTORIC.legacyRouter.hash,
    expected: { recipient: inv.recipient, amountBaseUnits: inv.amount.toString(), invoiceRef: `${HISTORIC.legacyRouter.invoiceRef}-X` },
  });
  expect(vLegacyBad.body.verdict === "mismatch", "public API: wrong invoice reference on a router payment → mismatch");
  skipped.push("Funded steps (real direct + router payments, receipt verification of new payments, AlreadyPaid on re-pay): alice has no test MUSD. Fund alice with >= 4 MUSD to run them.");
  console.log(`SKIP  ${skipped[skipped.length - 1]}`);
}

main()
  .catch((e) => {
    record("unexpected error", false, e instanceof Error ? e.message.slice(0, 300) : String(e));
  })
  .finally(() => {
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    console.log(`\n${passed} passed, ${failed} failed`);
    for (const [k, h] of Object.entries(txs)) console.log(`tx ${k}: ${explorer.tx(h)}`);
    const out = `e2e-results-${new URL(BASE).host.replace(/[^a-z0-9.-]/gi, "_")}.json`;
    if (skipped.length) console.log(`${skipped.length} group(s) skipped`);
    writeFileSync(out, JSON.stringify({ base: BASE, run: RUN, at: new Date().toISOString(), passed, failed, skipped, txs, results }, null, 2));
    process.exitCode = failed ? 1 : 0;
  });
