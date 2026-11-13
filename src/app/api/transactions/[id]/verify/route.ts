import { requireWriter } from "@/lib/server/auth";
import { getTransactionRow, toTransaction } from "@/lib/server/data";
import { json, route } from "@/lib/server/http";
import { refreshTransaction } from "@/lib/server/tx-verify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

/** "Check now": re-verify against the chain. Cheap no-op for terminal states or very recent checks. */
export const POST = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  const row = await getTransactionRow(s.userId, id);
  const recent = row.last_checked_at && Date.now() - new Date(row.last_checked_at).getTime() < 2500;
  if (row.status === "confirmed" || row.status === "failed" || recent) {
    return json({ transaction: toTransaction(row), refreshed: false });
  }
  const updated = await refreshTransaction(row);
  return json({ transaction: toTransaction({ ...updated, recipient_label: row.recipient_label }), refreshed: true });
});
