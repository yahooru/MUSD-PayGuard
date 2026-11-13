import type { Metadata } from "next";
import { SUPPORTED_NETWORK, explorer } from "@/config/chains";
import { MUSD, PAYGUARD_ROUTER } from "@/config/contracts";
import { SITE } from "@/config/site";

export const metadata: Metadata = {
  title: "Developers: payment verification API",
  description: "Public API to verify a MUSD payment on Mezo Testnet: receipt, exact Transfer event, and on-chain invoice reference.",
};

function Code({ children }: { children: string }) {
  return (
    <pre className="inset mono mt-3 overflow-x-auto p-4 text-[12.5px] leading-relaxed text-muted">
      <code>{children}</code>
    </pre>
  );
}

export default function DevelopersPage() {
  const base = SITE.url;
  return (
    <div className="mx-auto max-w-[920px] px-4 py-12 md:px-6">
      <h1 className="display text-[38px] md:text-[48px]">Payment verification API</h1>
      <p className="mt-4 text-[16px] text-muted">
        Check whether a transaction on {SUPPORTED_NETWORK.name} really paid the expected MUSD amount to the expected address. The response is computed
        live from the RPC receipt and the MUSD contract&apos;s own Transfer events. It never trusts the caller, a screenshot or a hash on its own.
      </p>

      <section className="mt-12" aria-labelledby="ep-h">
        <h2 id="ep-h" className="heading text-[22px]">Endpoint</h2>
        <Code>{`POST ${base}/api/v1/verify
GET  ${base}/api/v1/verify?txHash=…&recipient=…&amount=…[&from=…][&invoiceRef=…]`}</Code>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[14px] text-muted">
          <li>No API key. CORS is open (no cookies are read), so it can be called from a browser checkout page.</li>
          <li>Rate limit: 30 requests per minute per client. Headers: x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset. Over the limit: HTTP 429 with retry-after.</li>
          <li>Never put secrets in client-side code. This API does not need any.</li>
        </ul>
      </section>

      <section className="mt-12" aria-labelledby="req-h">
        <h2 id="req-h" className="heading text-[22px]">Request</h2>
        <Code>{`{
  "txHash": "0x…",                 // 32-byte transaction hash
  "expected": {
    "recipient": "0x…",            // required; mixed case must pass EIP-55
    "amount": "2.5",               // decimal MUSD, or use amountBaseUnits
    "amountBaseUnits": "2500000000000000000",
    "from": "0x…",                 // optional expected payer
    "invoiceRef": "INV-0042"       // optional; provable only for PayGuardRouter payments
  }
}`}</Code>
      </section>

      <section className="mt-12" aria-labelledby="res-h">
        <h2 id="res-h" className="heading text-[22px]">Response</h2>
        <Code>{`{
  "verdict": "verified",           // verified | mismatch | reverted | pending | not_found | unavailable
  "verified": true,
  "summary": "The transaction succeeded on Mezo Testnet and contains exactly the expected MUSD transfer.",
  "network": { "chainId": ${SUPPORTED_NETWORK.chainId}, "name": "${SUPPORTED_NETWORK.name}" },
  "token": { "address": "${MUSD.address}", "symbol": "MUSD", "decimals": 18 },
  "transaction": { "hash": "0x…", "from": "0x…", "to": "0x…", "calledContract": "MUSD",
                   "blockNumber": "16372500", "confirmations": 3, "explorerUrl": "${explorer.tx("0x…")}" },
  "transfer": { "from": "0x…", "to": "0x…", "value": "2500000000000000000", "logIndex": 0 },
  "invoice": null,
  "steps": [ { "id": "execution", "label": "Execution", "state": "pass", "detail": "Receipt status is success." }, … ],
  "checkedAt": "2026-10-26T12:00:00.000Z"
}`}</Code>
        <dl className="card mt-4 divide-y divide-line text-[14px]">
          {[
            ["verified", "Success receipt, called MUSD or PayGuardRouter, and a MUSD Transfer event with exactly the expected recipient and amount (and sender, if given)."],
            ["mismatch", "The transaction exists but does not prove the expected payment. The failing step says why."],
            ["reverted", "The transaction failed on-chain. No MUSD moved."],
            ["pending", "Not mined yet or below the required confirmations. Treat as unpaid."],
            ["not_found", "The network does not know the hash: fake, dropped, or another chain."],
            ["unavailable", "The RPC could not be reached. Nothing was concluded. Retry."],
          ].map(([k, v]) => (
            <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr]">
              <dt className="mono text-cyan">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12" aria-labelledby="ex-h">
        <h2 id="ex-h" className="heading text-[22px]">Examples</h2>
        <h3 className="mt-5 text-[14px] font-semibold">curl</h3>
        <Code>{`curl -s ${base}/api/v1/verify -H 'content-type: application/json' \\
  -d '{"txHash":"0x…","expected":{"recipient":"0x…","amount":"2"}}'`}</Code>
        <h3 className="mt-5 text-[14px] font-semibold">JavaScript (server or browser)</h3>
        <Code>{`const res = await fetch("${base}/api/v1/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ txHash, expected: { recipient: merchantAddress, amount: "49.90", invoiceRef: orderId } }),
});
const result = await res.json();
if (result.verdict === "verified") markOrderPaid(orderId, result.transaction.hash);
else if (result.verdict === "pending") retryLater();
else rejectPayment(result.reason);`}</Code>
        <h3 className="mt-5 text-[14px] font-semibold">Python</h3>
        <Code>{`import requests
r = requests.get("${base}/api/v1/verify", params={
    "txHash": tx_hash, "recipient": merchant, "amount": "49.90"}, timeout=20)
print(r.json()["verdict"])`}</Code>
      </section>

      <section className="mt-12" aria-labelledby="router-h">
        <h2 id="router-h" className="heading text-[22px]">On-chain invoice registry (PayGuardRouter)</h2>
        <p className="mt-3 text-[14px] text-muted">
          <span className="mono">{PAYGUARD_ROUTER.address}</span> on {SUPPORTED_NETWORK.name}. A non-custodial router with no owner: it moves MUSD
          from payer to recipient with <span className="mono">transferFrom</span> in one transaction and records the invoice reference. Paying the same
          reference to the same recipient again from the same wallet reverts. Duplicate blocking is per payer on purpose: a stranger paying dust with
          your invoice reference cannot block the real payer.
        </p>
        <Code>{`invoiceRef = keccak256(utf8(normalize(ref)))   // NFKC, trim, collapse spaces, upper-case

pay(address to, uint256 amount, bytes32 invoiceRef)
payWithPermit(address to, uint256 amount, bytes32 invoiceRef, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
isPaid(address payer, address recipient, bytes32 invoiceRef) view returns (bool)
getPayment(address payer, address recipient, bytes32 invoiceRef) view returns (bool paid, uint256 amount, uint256 paidAt, uint256 blockNumber)
totalPaidTo(address recipient, bytes32 invoiceRef) view returns (uint256)   // merchants: compare with the invoice amount
event InvoicePaid(address indexed payer, address indexed recipient, bytes32 indexed invoiceRef, uint256 amount, uint256 totalPaidForRef)`}</Code>
        <p className="mt-3 text-[13px] text-faint">
          Deployed in{" "}
          <a className="link" href={explorer.tx(PAYGUARD_ROUTER.deployTx)} target="_blank" rel="noopener noreferrer">
            this transaction
          </a>
          . Source and tests are in the repository under contracts/.
        </p>
      </section>
    </div>
  );
}
