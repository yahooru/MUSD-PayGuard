"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Link2, Plus, QrCode, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/client/api";
import type { RequestDTO } from "@/lib/dto";
import { formatDate, relativeTime } from "@/lib/format";
import { CopyButton, Musd, ShortAddress } from "@/components/ui/data";
import { Button, Empty, Field, Input, PageHeader, SectionTitle, Skeleton, Textarea, cn } from "@/components/ui/primitives";

function statusOf(r: RequestDTO): { label: string; cls: string } {
  if (r.status === "paid") return { label: "Paid (verified)", cls: "text-pass border-pass/40" };
  if (r.status === "cancelled") return { label: "Cancelled", cls: "text-na border-na/40" };
  if (r.expiresAt && Date.parse(r.expiresAt) < Date.now()) return { label: "Expired", cls: "text-warn border-warn/40" };
  return { label: "Open", cls: "text-cyan border-cyan/40" };
}

function RequestRow({ r }: { r: RequestDTO }) {
  const s = statusOf(r);
  return (
    <li>
      <Link href={`/pay/${r.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[10px] px-3 py-3 hover:bg-surface-2">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.invoiceRef ?? "No reference"}</span>
            <span className={cn("rounded-full border px-2 py-px text-[11px] font-medium", s.cls)}>{s.label}</span>
          </span>
          <span className="block truncate text-[12px] text-faint">
            {r.description ? `${r.description}. ` : ""}Created {relativeTime(r.createdAt)}
            {r.expiresAt ? `, expires ${formatDate(r.expiresAt)}` : ""}
          </span>
          <span className="mt-0.5 block text-[12px] text-muted">
            {r.isMine ? "Pays out to " : "From "}
            <ShortAddress address={r.isMine ? r.recipient : r.creator} />
          </span>
        </span>
        <Musd value={r.amount} maxFraction={2} className="font-medium" />
      </Link>
    </li>
  );
}

function ShareCard({ r, onClose }: { r: RequestDTO; onClose: () => void }) {
  const url = `${window.location.origin}/pay/${r.id}`;
  return (
    <section className="hull flex flex-col gap-6 p-6 md:flex-row" aria-labelledby="share-h">
      <div className="rounded-[14px] bg-white p-3 self-start">
        <QRCodeSVG value={url} size={156} level="M" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h2 id="share-h" className="heading text-lg">
            Request created
          </h2>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Share this link or QR code with the payer. When they open it, PayGuard re-validates the request and checks their own history for a duplicate
          payment before they can pay.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-[10px] border border-line bg-bg-deep px-3 py-2">
          <Link2 className="size-4 shrink-0 text-faint" aria-hidden />
          <span className="mono min-w-0 flex-1 truncate text-[13px]">{url}</span>
          <CopyButton value={url} label="Copy link" />
        </div>
        <p className="mt-3 text-[12px] text-faint">A request proves that a signed-in wallet created it. It does not prove the requester is who they say they are.</p>
      </div>
    </section>
  );
}

export function RequestsClient() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [created, setCreated] = useState<RequestDTO | null>(null);
  const [form, setForm] = useState({ amount: "", invoiceRef: "", description: "", recipient: "", payer: "", expiresInDays: "14" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupId, setDupId] = useState<string | null>(null);
  const [openId, setOpenId] = useState("");
  const q = useQuery({ queryKey: ["requests"], queryFn: () => api<{ sent: RequestDTO[]; incoming: RequestDTO[] }>("/api/requests") });

  const create = useMutation({
    mutationFn: () =>
      api<{ request: RequestDTO }>("/api/requests", {
        method: "POST",
        json: {
          amount: form.amount,
          invoiceRef: form.invoiceRef || null,
          description: form.description || null,
          recipient: form.recipient || null,
          payer: form.payer || null,
          expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : null,
        },
      }),
    onSuccess: ({ request }) => {
      setCreated(request);
      setCreating(false);
      setForm({ amount: "", invoiceRef: "", description: "", recipient: "", payer: "", expiresInDays: "14" });
      qc.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const d = e.details as { path: string; message: string }[] | { requestId?: string } | undefined;
        if (Array.isArray(d)) setErrors(Object.fromEntries(d.map((x) => [x.path, x.message])));
        if (e.code === "duplicate_reference") setDupId((d as { requestId?: string })?.requestId ?? null);
        toast.error(e.message);
      }
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Payment requests"
        lede="Ask for MUSD with a shareable link and QR code. Every open of the link re-validates the request against the chain."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
            New request
          </Button>
        }
      />
      {created ? <ShareCard r={created} onClose={() => setCreated(null)} /> : null}
      {creating ? (
        <form
          className="hull space-y-5 p-5 md:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            setDupId(null);
            create.mutate();
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="heading text-[17px]">Create a payment request</h2>
            <button type="button" onClick={() => setCreating(false)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label="Close form">
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Amount (MUSD)" htmlFor="q-amount" error={errors.amount}>
              <Input id="q-amount" inputMode="decimal" value={form.amount} onChange={set("amount")} placeholder="250.00" className="tnum" required />
            </Field>
            <Field
              label="Invoice reference"
              htmlFor="q-ref"
              error={errors.invoiceRef}
              hint={dupId ? undefined : "Must be unique among your live requests."}
            >
              <Input id="q-ref" value={form.invoiceRef} onChange={set("invoiceRef")} placeholder="INV-2026-0042" maxLength={64} />
            </Field>
            <Field label="Expires after" htmlFor="q-exp">
              <select id="q-exp" value={form.expiresInDays} onChange={set("expiresInDays")} className="h-11 w-full rounded-[10px] border border-line bg-bg-deep px-3 text-sm">
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="">Never</option>
              </select>
            </Field>
          </div>
          {dupId ? (
            <p className="text-[13px] text-warn">
              Duplicate reference.{" "}
              <Link className="link" href={`/pay/${dupId}`}>
                Open the existing request
              </Link>
            </p>
          ) : null}
          <Field label="Description" htmlFor="q-desc">
            <Textarea id="q-desc" value={form.description} onChange={set("description")} maxLength={500} placeholder="Logo design, October" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Pay out to (optional)" htmlFor="q-to" error={errors.recipient} hint="Defaults to your signed-in wallet.">
              <Input id="q-to" value={form.recipient} onChange={set("recipient")} className="mono text-[14px]" placeholder="0x… (your wallet)" spellCheck={false} />
            </Field>
            <Field label="Expected payer (optional)" htmlFor="q-payer" error={errors.payer} hint="If set, the request appears in their incoming list.">
              <Input id="q-payer" value={form.payer} onChange={set("payer")} className="mono text-[14px]" placeholder="0x…" spellCheck={false} />
            </Field>
          </div>
          <Button type="submit" variant="primary" loading={create.isPending} icon={<QrCode className="size-4" aria-hidden />}>
            Create request and link
          </Button>
        </form>
      ) : null}

      <section className="card flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <p className="text-sm font-medium md:w-56">Review a request you received</p>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const m = openId.match(/pr_[A-Za-z0-9]{12,32}/);
            if (m) router.push(`/pay/${m[0]}`);
            else toast.error("Paste a PayGuard request link or id (it starts with pr_).");
          }}
        >
          <Input value={openId} onChange={(e) => setOpenId(e.target.value)} placeholder="Paste a request link or id" aria-label="Request link or id" />
          <Button type="submit">Open</Button>
        </form>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="sent-h">
          <SectionTitle id="sent-h">Sent requests</SectionTitle>
          {q.isLoading ? (
            <Skeleton className="h-40" />
          ) : q.data?.sent.length ? (
            <ul className="card divide-y divide-line p-1">{q.data.sent.map((r) => <RequestRow key={r.id} r={r} />)}</ul>
          ) : (
            <Empty icon={<ReceiptText className="size-4" />} title="No requests yet" body="Create a request to get paid in MUSD with a link the payer can verify." />
          )}
        </section>
        <section aria-labelledby="inc-h">
          <SectionTitle id="inc-h">Incoming requests</SectionTitle>
          {q.isLoading ? (
            <Skeleton className="h-40" />
          ) : q.data?.incoming.length ? (
            <ul className="card divide-y divide-line p-1">{q.data.incoming.map((r) => <RequestRow key={r.id} r={r} />)}</ul>
          ) : (
            <Empty icon={<Inbox className="size-4" />} title="Nothing addressed to you" body="Requests that name your wallet as the payer appear here. Links shared with you can be opened above." />
          )}
        </section>
      </div>
    </div>
  );
}
