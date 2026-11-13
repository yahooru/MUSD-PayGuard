"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleCheck, Info, OctagonX, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { SUPPORTED_NETWORK, isSupportedChain } from "@/config/chains";
import { MUSD, PAYGUARD_ROUTER } from "@/config/contracts";
import { formatAmount, formatUnitsExact, parseAmountInput } from "@/lib/amount";
import { api, ApiError } from "@/lib/client/api";
import type { DraftDTO, RecipientDTO, RequestDTO } from "@/lib/dto";
import { analyzeAddress, lookalikeStrength, sameAddress, sharedEnds } from "@/lib/engine/address";
import { validateInvoiceRef } from "@/lib/invoice";
import { useSession } from "@/components/session";
import { FullAddress } from "@/components/ui/data";
import { Button, Field, Input, PageHeader, Textarea, cn } from "@/components/ui/primitives";
import { useMusdBalance } from "@/components/wallet/wallet";

type Hint = { tone: "ok" | "warn" | "fail" | "info"; text: string };

/** Instant, local hints while typing. The authoritative checks run server-side in the preflight. */
function addressHints(input: string, me: string | null, saved: RecipientDTO[], selected: RecipientDTO | null): Hint[] {
  if (!input.trim()) return [];
  const a = analyzeAddress(input);
  if (!a.valid) return [{ tone: "fail", text: a.problem ?? "Not a valid address." }];
  const out: Hint[] = [];
  if (a.checksum === "invalid") out.push({ tone: "fail", text: "Capitalisation does not match the EIP-55 checksum: a character was probably mistyped." });
  else if (a.checksum === "valid") out.push({ tone: "ok", text: "Valid address with a matching checksum." });
  else out.push({ tone: "info", text: "Valid format. All lower/upper case, so no checksum to verify." });
  if (me && sameAddress(a.lower, me)) out.push({ tone: "warn", text: "This is your own wallet." });
  if (selected && !sameAddress(selected.address, a.lower)) out.push({ tone: "fail", text: `Differs from the address saved for “${selected.label}”.` });
  const exact = saved.find((r) => sameAddress(r.address, a.lower));
  if (exact && !selected) out.push({ tone: "ok", text: `Matches “${exact.label}” in your recipient book (saved by you, not verified).` });
  const look = saved.find((r) => lookalikeStrength(r.address, a.lower!));
  if (look) {
    const e = sharedEnds(look.address, a.lower!);
    out.push({ tone: "fail", text: `Looks like “${look.label}” (first ${e.prefix} and last ${e.suffix} characters match) but is a different address.` });
  }
  return out;
}

const HINT_ICON = { ok: CircleCheck, warn: TriangleAlert, fail: OctagonX, info: Info } as const;
const HINT_CLS = { ok: "text-pass", warn: "text-warn", fail: "text-fail", info: "text-muted" } as const;

export function SendForm() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const { address, chainId } = useAccount();
  const { musd, native } = useMusdBalance(address);

  const editId = params.get("edit");
  const requestId = params.get("request");
  const [recipient, setRecipient] = useState(params.get("to") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("recipient"));
  const [amount, setAmount] = useState(params.get("amount") ?? "");
  const [ref, setRef] = useState(params.get("ref") ?? "");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<"direct" | "router">("direct");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const recipients = useQuery({ queryKey: ["recipients"], queryFn: () => api<{ recipients: RecipientDTO[] }>("/api/recipients") });
  const saved = useMemo(() => recipients.data?.recipients ?? [], [recipients.data]);
  const selected = saved.find((r) => r.id === selectedId) ?? null;

  const editDraft = useQuery({
    queryKey: ["draft", editId],
    queryFn: () => api<{ draft: DraftDTO }>(`/api/drafts/${editId}`),
    enabled: !!editId,
  });
  const request = useQuery({
    queryKey: ["request-lite", requestId],
    queryFn: () => api<{ request: RequestDTO }>(`/api/requests/${requestId}`),
    enabled: !!requestId,
  });

  useEffect(() => {
    const d = editDraft.data?.draft;
    if (!d) return;
    setRecipient(d.recipientInput);
    setAmount(formatUnitsExact(BigInt(d.amount)));
    setRef(d.invoiceRef ?? "");
    setNote(d.note ?? "");
    setMethod(d.method);
    setSelectedId(d.selectedRecipientId);
  }, [editDraft.data]);

  useEffect(() => {
    const r = request.data?.request;
    if (!r) return;
    setRecipient(r.recipient);
    setAmount(formatUnitsExact(BigInt(r.amount)));
    setRef(r.invoiceRef ?? "");
  }, [request.data]);

  useEffect(() => {
    if (selected && !recipient) setRecipient(selected.address);
  }, [selected, recipient]);

  const hints = addressHints(recipient, session.address, saved, selected);
  const amt = amount ? parseAmountInput(amount) : null;
  const overBalance = amt?.ok && musd.data !== undefined && amt.value > musd.data;

  const submit = useMutation({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      if (!recipient.trim()) errs.recipient = "Enter or select a recipient.";
      const a = parseAmountInput(amount);
      if (!a.ok) errs.amount = a.error;
      if (ref.trim()) {
        const v = validateInvoiceRef(ref);
        if (!v.ok) errs.invoiceRef = v.error;
      } else if (method === "router") errs.invoiceRef = "On-chain invoice recording needs a reference.";
      setErrors(errs);
      if (Object.keys(errs).length) throw new Error("validation");
      const body = {
        recipient: recipient.trim(),
        amount: amount.trim(),
        invoiceRef: ref.trim() || null,
        note: note.trim() || null,
        selectedRecipientId: selectedId,
      };
      if (editId) return api<{ draft: DraftDTO }>(`/api/drafts/${editId}`, { method: "PATCH", json: body });
      return api<{ draft: DraftDTO }>("/api/drafts", { method: "POST", json: { ...body, method, requestId } });
    },
    onSuccess: ({ draft }) => router.push(`/review/${draft.id}`),
    onError: (e) => {
      if (e instanceof ApiError) {
        const d = e.details as { path: string; message: string }[] | undefined;
        if (Array.isArray(d)) setErrors(Object.fromEntries(d.map((x) => [x.path, x.message])));
        toast.error(e.message);
      }
    },
  });

  const wrongNetwork = !!address && !isSupportedChain(chainId);

  return (
    <div>
      <PageHeader
        title={editId ? "Edit payment" : "Send MUSD"}
        lede="Enter the payment, then PayGuard runs every check before your wallet is asked to sign anything."
      />
      {request.data ? (
        <div className="mb-5 flex items-start gap-3 rounded-[12px] border border-violet/40 bg-violet/5 p-4 text-sm">
          <Info className="mt-0.5 size-4 text-violet" aria-hidden />
          <p>
            Paying request <span className="mono">{request.data.request.id}</span>. Details were filled in from the request; the review will flag any change
            you make.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <form
          className="hull space-y-6 p-5 md:p-7"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
          noValidate
        >
          {saved.length > 0 ? (
            <Field label="Saved recipient" htmlFor="saved" hint="Choosing a contact lets PayGuard warn you if the address below differs from what you saved.">
              <div className="relative">
                <Users className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                <select
                  id="saved"
                  value={selectedId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    setSelectedId(id);
                    const r = saved.find((x) => x.id === id);
                    if (r) setRecipient(r.address);
                  }}
                  className="h-11 w-full appearance-none rounded-[10px] border border-line bg-bg-deep pl-10 pr-3 text-[15px] focus:border-cyan/70 focus:outline-none"
                >
                  <option value="">No saved contact (enter an address)</option>
                  {saved.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({r.address.slice(0, 6)}…{r.address.slice(-4)})
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          ) : null}

          <Field label="Recipient address" htmlFor="recipient" error={errors.recipient}>
            <Input
              id="recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              className="mono text-[14px]"
              aria-invalid={!!errors.recipient || hints.some((h) => h.tone === "fail")}
              aria-describedby="recipient-hints"
            />
            <ul id="recipient-hints" className="space-y-1" aria-live="polite">
              {hints.map((h, i) => {
                const Icon = HINT_ICON[h.tone];
                return (
                  <li key={i} className={cn("flex items-start gap-2 text-[13px]", HINT_CLS[h.tone])}>
                    <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{h.text}</span>
                  </li>
                );
              })}
            </ul>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Amount (MUSD)"
              htmlFor="amount"
              error={errors.amount ?? (amt && !amt.ok ? amt.error : null)}
              hint={overBalance ? "More than your current MUSD balance." : undefined}
              aside={
                musd.data !== undefined ? (
                  <button type="button" className="text-[12px] text-cyan hover:underline" onClick={() => setAmount(formatUnitsExact(musd.data!))}>
                    Balance {formatAmount(musd.data, { maxFraction: 4 })}
                  </button>
                ) : null
              }
            >
              <Input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="tnum text-[17px]"
                aria-invalid={!!errors.amount || (amt ? !amt.ok : false)}
              />
            </Field>
            <Field label="Invoice or payment reference" htmlFor="ref" error={errors.invoiceRef} hint="Used to detect paying the same invoice twice.">
              <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="INV-2026-0042" maxLength={64} autoComplete="off" />
            </Field>
          </div>

          <Field label="Note (private, optional)" htmlFor="note">
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="What this payment is for" />
          </Field>

          {!editId ? (
            <fieldset>
              <legend className="text-[13px] font-medium">How to send</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["direct", "Direct MUSD transfer", "A plain transfer from your wallet. No token approval needed. Recommended."],
                    [
                      "router",
                      "Transfer and record invoice on-chain",
                      "Uses PayGuardRouter with a one-time permit signature. The invoice reference is recorded on-chain, so paying it twice reverts from any device.",
                    ],
                  ] as const
                ).map(([value, label, desc]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-[12px] border p-3.5 transition-colors",
                      method === value ? "border-cyan/60 bg-cyan/[0.05]" : "border-line hover:border-line-strong",
                    )}
                  >
                    <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className="mt-1 accent-[var(--cyan)]" />
                    <span>
                      <span className="block text-[14px] font-medium">{label}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">{desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button type="submit" variant="primary" size="lg" loading={submit.isPending} icon={<ShieldCheck className="size-4" aria-hidden />}>
              Run security review
            </Button>
            <p className="text-[13px] text-faint">Nothing is signed or sent at this step.</p>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-[13px] font-semibold">Payment network and token</p>
            <dl className="mt-3 space-y-2.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Network</dt>
                <dd>
                  {SUPPORTED_NETWORK.name} <span className="text-faint">({SUPPORTED_NETWORK.chainId})</span>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Token</dt>
                <dd>
                  {MUSD.expected.name} ({MUSD.expected.symbol})
                </dd>
              </div>
              <div>
                <dt className="text-muted">Contract</dt>
                <dd className="mt-1">
                  <FullAddress address={MUSD.address} />
                </dd>
              </div>
              {method === "router" ? (
                <div>
                  <dt className="text-muted">Router</dt>
                  <dd className="mt-1">
                    <FullAddress address={PAYGUARD_ROUTER.address} />
                  </dd>
                </div>
              ) : null}
            </dl>
            {wrongNetwork ? (
              <p className="mt-3 rounded-[10px] border border-warn/40 bg-warn/5 p-2.5 text-[12px] text-warn">
                Your wallet is on another network. You can prepare the payment, but the review will block sending until you switch.
              </p>
            ) : null}
          </div>
          <div className="card p-5">
            <p className="text-[13px] font-semibold">Your balances</p>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted">MUSD</dt>
                <dd className="tnum">{musd.data !== undefined ? formatAmount(musd.data, { maxFraction: 4 }) : address ? "…" : "Connect wallet"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">BTC (for fees)</dt>
                <dd className="tnum">{native.data ? formatAmount(native.data.value, { maxFraction: 8, minFraction: 0 }) : address ? "…" : "—"}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] text-faint">MUSD and BTC are separate balances. Network fees on Mezo are paid in BTC.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
