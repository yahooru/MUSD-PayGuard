"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog } from "radix-ui";
import { Info, Pencil, Plus, Search, Send, Trash, Users, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getAddress } from "viem";
import { api, ApiError } from "@/lib/client/api";
import type { RecipientDTO } from "@/lib/dto";
import { analyzeAddress } from "@/lib/engine/address";
import { formatDate, groupHex } from "@/lib/format";
import { FullAddress } from "@/components/ui/data";
import { Button, ButtonLink, Empty, Field, Input, PageHeader, SectionTitle, Skeleton, Textarea, cn } from "@/components/ui/primitives";

function RecipientForm({ onDone, initial }: { onDone: () => void; initial?: RecipientDTO }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [vnote, setVnote] = useState(initial?.verificationNote ?? "");
  const [err, setErr] = useState<Record<string, string>>({});
  const a = address ? analyzeAddress(address) : null;
  const m = useMutation({
    mutationFn: () =>
      initial
        ? api<{ recipient: RecipientDTO }>(`/api/recipients/${initial.id}`, { method: "PATCH", json: { label, notes: notes || null, verificationNote: vnote || null } })
        : api<{ recipient: RecipientDTO; warning?: string | null }>("/api/recipients", {
            method: "POST",
            json: { label, address, notes: notes || null, verificationNote: vnote || null },
          }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["recipients"] });
      const warning = (res as { warning?: string | null }).warning;
      if (warning) toast.warning(warning, { duration: 10000 });
      else toast.success(initial ? "Contact updated." : "Recipient saved.");
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErr({ form: e.message });
      }
    },
  });
  return (
    <form
      className="hull space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (!label.trim()) errs.label = "Enter a name.";
        if (!initial) {
          if (!a?.valid) errs.address = a?.problem ?? "Enter an address.";
          else if (a.checksum === "invalid") errs.address = "Checksum mismatch: paste the address again unchanged.";
        }
        setErr(errs);
        if (!Object.keys(errs).length) m.mutate();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="heading text-[17px]">{initial ? `Edit ${initial.label}` : "Save a recipient"}</h2>
        <button type="button" onClick={onDone} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label="Close form">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" htmlFor="r-label" error={err.label}>
          <Input id="r-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Bob (design contractor)" />
        </Field>
        <Field
          label="Wallet address"
          htmlFor="r-address"
          error={err.address}
          hint={initial ? "Addresses cannot be edited. Delete and re-add the contact so the change is reviewed." : "Copy it from the recipient directly, not from your transaction history."}
        >
          <Input id="r-address" value={address} onChange={(e) => setAddress(e.target.value)} className="mono text-[14px]" disabled={!!initial} spellCheck={false} placeholder="0x…" />
        </Field>
      </div>
      <Field label="Business or invoice notes (optional)" htmlFor="r-notes">
        <Textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </Field>
      <Field label="How you confirmed this address (optional)" htmlFor="r-vnote" hint="For example: “Read back by phone on 26 Oct”. This is your own note; PayGuard does not verify identities.">
        <Input id="r-vnote" value={vnote} onChange={(e) => setVnote(e.target.value)} maxLength={200} />
      </Field>
      {err.form ? <p role="alert" className="text-[13px] text-fail">{err.form}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={m.isPending}>
          {initial ? "Save changes" : "Save recipient"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Compare({ saved }: { saved: RecipientDTO[] }) {
  const [id, setId] = useState(saved[0]?.id ?? "");
  const [other, setOther] = useState("");
  const r = saved.find((x) => x.id === id);
  const a = other ? analyzeAddress(other) : null;
  const left = r ? groupHex(getAddress(r.address)) : [];
  const right = a?.valid ? groupHex(a.checksummed!) : [];
  const identical = a?.valid && r && a.lower === r.address.toLowerCase();
  return (
    <section className="card p-5" aria-labelledby="cmp-h">
      <SectionTitle id="cmp-h">Compare an address</SectionTitle>
      <p className="-mt-1 mb-4 text-[13px] text-muted">Paste an address you received to compare it with a saved contact, group by group.</p>
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <select value={id} onChange={(e) => setId(e.target.value)} className="h-11 rounded-[10px] border border-line bg-bg-deep px-3 text-sm" aria-label="Saved contact">
          {saved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="0x… address to compare" className="mono text-[14px]" aria-label="Address to compare" />
      </div>
      {a && !a.valid ? <p className="mt-3 text-[13px] text-fail">{a.problem}</p> : null}
      {a?.valid && r ? (
        <div className="mt-4 space-y-2" aria-live="polite">
          {[
            ["Saved", left],
            ["Pasted", right],
          ].map(([k, groups]) => (
            <div key={k as string} className="flex flex-wrap items-center gap-1">
              <span className="w-16 text-[12px] text-faint">{k as string}</span>
              {(groups as string[]).map((g, i) => {
                const same = left[i]?.toLowerCase() === right[i]?.toLowerCase();
                return (
                  <span key={i} className={cn("mono rounded px-1 text-[13px]", i === 0 ? "text-faint" : same ? "text-text" : "bg-fail/15 text-fail underline decoration-2")}>
                    {g}
                  </span>
                );
              })}
            </div>
          ))}
          <p className={cn("text-[13px] font-medium", identical ? "text-pass" : "text-fail")}>
            {identical ? "Identical to the saved address." : "Different addresses: highlighted groups do not match. Do not pay this address as this contact."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function RecipientsClient() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(params.get("new") === "1");
  const [editing, setEditing] = useState<RecipientDTO | null>(null);
  const [query, setQuery] = useState("");
  const q = useQuery({ queryKey: ["recipients"], queryFn: () => api<{ recipients: RecipientDTO[] }>("/api/recipients") });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/recipients/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipients"] });
      toast.success("Recipient removed.");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not remove."),
  });
  const list = useMemo(() => {
    const all = q.data?.recipients ?? [];
    const s = query.trim().toLowerCase();
    if (!s) return all;
    return all.filter((r) => r.label.toLowerCase().includes(s) || r.address.toLowerCase().includes(s) || (r.notes ?? "").toLowerCase().includes(s));
  }, [q.data, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trusted recipients"
        lede="Saved addresses are compared with every payment you make. Saving an address only means you saved it; it does not prove who controls it."
        actions={
          <Button variant="primary" onClick={() => { setEditing(null); setAdding(true); }} icon={<Plus className="size-4" aria-hidden />}>
            Save a recipient
          </Button>
        }
      />
      <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface p-4 text-[13px] text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
        For important transfers, confirm the full address through a channel you already trust (a call, or a contact you know), never only through the message
        that sent it.
      </div>
      {adding || editing ? <RecipientForm initial={editing ?? undefined} onDone={() => { setAdding(false); setEditing(null); }} /> : null}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, address or note" className="pl-10" aria-label="Search recipients" />
      </div>

      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : list.length === 0 ? (
        <Empty
          icon={<Users className="size-4" />}
          title={query ? "No recipient matches your search" : "Your recipient book is empty"}
          body={query ? "Try part of the name or address." : "Save people you pay regularly. PayGuard will then warn you when an address differs from the one you saved or only looks like it."}
          action={!query ? <Button variant="primary" onClick={() => setAdding(true)}>Save a recipient</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((r) => (
            <li key={r.id} id={r.id} className="card scroll-mt-24 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.label}</p>
                  <p className="text-[12px] text-faint">
                    Saved {formatDate(r.createdAt)} on Mezo Testnet. {r.paymentsCount ? `${r.paymentsCount} verified payment(s).` : "Not paid yet."}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label={`Edit ${r.label}`} onClick={() => { setAdding(false); setEditing(r); }}>
                    <Pencil className="size-4" />
                  </button>
                  <AlertDialog.Root>
                    <AlertDialog.Trigger className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-fail" aria-label={`Remove ${r.label}`}>
                      <Trash className="size-4" />
                    </AlertDialog.Trigger>
                    <AlertDialog.Portal>
                      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-bg-deep/70" />
                      <AlertDialog.Content className="hull fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 p-6">
                        <AlertDialog.Title className="heading text-lg">Remove {r.label}?</AlertDialog.Title>
                        <AlertDialog.Description className="mt-2 text-sm text-muted">
                          Future payments to this address will no longer be compared with this contact. Your payment history is kept.
                        </AlertDialog.Description>
                        <div className="mt-5 flex justify-end gap-2">
                          <AlertDialog.Cancel asChild>
                            <Button variant="ghost">Keep</Button>
                          </AlertDialog.Cancel>
                          <AlertDialog.Action asChild>
                            <Button variant="danger" onClick={() => del.mutate(r.id)}>
                              Remove
                            </Button>
                          </AlertDialog.Action>
                        </div>
                      </AlertDialog.Content>
                    </AlertDialog.Portal>
                  </AlertDialog.Root>
                </div>
              </div>
              <div className="mt-3">
                <FullAddress address={r.address} />
              </div>
              {r.notes ? <p className="mt-2 text-[13px] text-muted">{r.notes}</p> : null}
              {r.verificationNote ? <p className="mt-1 text-[12px] text-faint">Your confirmation note: {r.verificationNote}</p> : null}
              <div className="mt-3">
                <ButtonLink href={`/send?recipient=${r.id}`} size="sm" icon={<Send className="size-3.5" aria-hidden />}>
                  Pay {r.label}
                </ButtonLink>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(q.data?.recipients.length ?? 0) > 0 ? <Compare saved={q.data!.recipients} /> : null}
    </div>
  );
}
