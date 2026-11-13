import { explorer } from "@/config/chains";
import { formatUnitsExact } from "@/lib/amount";
import { q } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { TX_SELECT } from "@/lib/server/data";

export const dynamic = "force-dynamic";

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV export of the signed-in wallet's PayGuard transaction history. */
export const GET = route(async () => {
  const s = await requireSession();
  const rows = await q(`${TX_SELECT} WHERE t.user_id = $1 ORDER BY t.submitted_at DESC LIMIT 5000`, [s.userId]);
  const header = [
    "submitted_at_utc",
    "status",
    "amount_musd",
    "recipient",
    "recipient_label",
    "invoice_ref",
    "risk_category",
    "method",
    "tx_hash",
    "block_number",
    "verified_at_utc",
    "explorer_url",
  ];
  const lines = rows.map((r) =>
    [
      new Date(r.submitted_at).toISOString(),
      r.status,
      formatUnitsExact(BigInt(String(r.amount))),
      r.recipient_address,
      r.recipient_label,
      r.invoice_ref,
      r.risk_category,
      r.method,
      r.tx_hash,
      r.block_number,
      r.verified_at ? new Date(r.verified_at).toISOString() : "",
      explorer.tx(r.tx_hash),
    ]
      .map(cell)
      .join(","),
  );
  const body = [header.join(","), ...lines].join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payguard-history-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
