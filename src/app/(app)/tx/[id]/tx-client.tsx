"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Printer, RefreshCw, ScrollText } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { SUPPORTED_NETWORK, explorer } from "@/config/chains";
import { api, ApiError } from "@/lib/client/api";
import type { AssessmentDTO, DraftDTO, TransactionDTO } from "@/lib/dto";
import type { Explanation } from "@/lib/engine/explain";
import { STATUS_LABEL, STATUS_MEANING } from "@/lib/engine/status";
import { formatDateTime, formatGas, relativeTime } from "@/lib/format";
import { AssistantPanel, CheckList, GateRail, Verdict } from "@/components/engine/checks";
import { VerificationSteps } from "@/components/engine/verification-steps";
import { DefinitionList, FullAddress, Musd, TxHash } from "@/components/ui/data";
import { Button, ButtonLink, ErrorNote, SectionTitle, Skeleton, cn } from "@/components/ui/primitives";
import { RiskBadge, StatusOrb, TxStatusPill } from "@/components/ui/status";

interface TxResponse {
  transaction: TransactionDTO;
  assessment: AssessmentDTO | null;
  authorizationAssessment: AssessmentDTO | null;
  explanation: Explanation | null;
  draft: DraftDTO | null;
}

export function TxClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tx", id], queryFn: () => api<TxResponse>(`/api/transactions/${id}`) });
  const tx = q.data?.transaction;
  const open = tx && (tx.status === "pending" || tx.status === "verification_delayed" || tx.status === "unknown");

  const check = useMutation({
    mutationFn: () => api<{ transaction: TransactionDTO }>(`/api/transactions/${id}/verify`, { method: "POST", json: {} }),
    onSuccess: (res) => qc.setQueryData<TxResponse>(["tx", id], (old) => (old ? { ...old, transaction: res.transaction } : old)),
  });

  // Live verification while the page is open. Server-side receipt checks only; nothing is trusted from the client.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (!check.isPending && document.visibilityState === "visible") check.mutate();
    }, SUPPORTED_NETWORK.receiptPollMs);
    return () => clearInterval(t);
  }, [open, check]);

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.isError || !tx) {
    return (
      <ErrorNote title="This payment could not be loaded." action={<ButtonLink href="/history">Open history</ButtonLink>}>
        {q.error instanceof ApiError ? q.error.message : "Try again."}
      </ErrorNote>
    );
  }
  const v = tx.verification;
  return (
    <div className="space-y-8">
      <section className={cn("hull relative overflow-hidden p-6 md:p-8", tx.status === "confirmed" && "flip-in")} aria-labelledby="status-h">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <StatusOrb status={tx.status} />
            <div>
              <h1 id="status-h" className="display text-[28px] md:text-[34px]">
                {STATUS_LABEL[tx.status]}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted">{STATUS_MEANING[tx.status]}</p>
              {tx.statusReason && tx.status !== "confirmed" ? <p className="mt-2 text-[13px] text-faint">Detail: {tx.statusReason}</p> : null}
            </div>
          </div>
          <div className="md:text-right">
            <p className="display text-[30px]">
              <Musd value={tx.amount} maxFraction={6} />
            </p>
            <p className="mt-1 text-[13px] text-muted">to {tx.recipientLabel ?? "an address you entered"}</p>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-2">
          <TxStatusPill status={tx.status} />
          <a href={explorer.tx(tx.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line-strong px-3 text-[13px] hover:border-cyan/60">
            Open in Mezo explorer <ExternalLink className="size-3.5" aria-hidden />
          </a>
          {open ? (
            <Button size="sm" onClick={() => check.mutate()} loading={check.isPending} icon={<RefreshCw className="size-3.5" aria-hidden />}>
              Check now
            </Button>
          ) : null}
          {tx.status === "confirmed" ? (
            <ButtonLink href={`/receipt/${tx.id}`} size="sm" variant="primary" icon={<Printer className="size-3.5" aria-hidden />}>
              Receipt
            </ButtonLink>
          ) : null}
          <ButtonLink href="/history" size="sm" variant="ghost" icon={<ScrollText className="size-3.5" aria-hidden />}>
            History
          </ButtonLink>
        </div>
        {open ? (
          <p className="relative mt-4 text-[12px] text-faint" aria-live="polite">
            Checking the receipt every {SUPPORTED_NETWORK.receiptPollMs / 1000} seconds while this page is open
            {tx.lastCheckedAt ? `; last checked ${relativeTime(tx.lastCheckedAt)}` : ""}. You can close this page: the hash is stored and re-checked on your
            next visit and by a daily server job.
          </p>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="details-h">
          <SectionTitle id="details-h">Transaction</SectionTitle>
          <div className="card px-5">
            <DefinitionList
              items={[
                { term: "Transaction hash", value: <TxHash hash={tx.txHash} short={false} /> },
                { term: "From (you)", value: <FullAddress address={tx.from} /> },
                { term: "To", value: <FullAddress address={tx.recipient} /> },
                { term: "Network", value: `${SUPPORTED_NETWORK.name} (chain ${tx.chainId})` },
                { term: "Token", value: <span className="mono text-[13px]">MUSD {tx.token}</span> },
                { term: "Method", value: tx.method === "router" ? "PayGuardRouter (invoice recorded on-chain)" : "Direct MUSD transfer" },
                { term: "Invoice reference", value: tx.invoiceRef ?? "None" },
                { term: "Risk at review", value: <RiskBadge category={tx.riskCategory} size="sm" /> },
                {
                  term: "Acknowledged warnings",
                  value: tx.acknowledgements.length ? <span className="mono text-[12px]">{tx.acknowledgements.join(", ")}</span> : "None required",
                },
                { term: "Submitted", value: formatDateTime(tx.submittedAt) },
                { term: "Block", value: tx.blockNumber ? <a className="link tnum" href={explorer.block(tx.blockNumber)} target="_blank" rel="noopener noreferrer">{tx.blockNumber}</a> : "Not yet" },
                { term: "Verified", value: tx.verifiedAt ? formatDateTime(tx.verifiedAt) : "Not yet" },
                {
                  term: "Gas",
                  value: tx.gasLimit
                    ? `limit ${formatGas(tx.gasLimit)}${tx.gasUsed ? `, charged ${formatGas(tx.gasUsed)} (Mezo charges at least half the limit)` : ""}`
                    : "—",
                },
              ]}
            />
          </div>
        </section>
        <section aria-labelledby="verify-h">
          <SectionTitle id="verify-h">Verification after payment</SectionTitle>
          {v?.steps?.length ? (
            <VerificationSteps steps={v.steps} />
          ) : (
            <p className="card p-5 text-sm text-muted">No verification result yet. PayGuard is fetching the receipt.</p>
          )}
          {v?.transfers?.length ? (
            <p className="mt-3 text-[12px] text-faint">
              MUSD Transfer events in this receipt: {v.transfers.length}. Matched log index {v.matchedTransfer?.logIndex ?? "none"}.
            </p>
          ) : null}
          <p className="mt-3 text-[12px] text-faint">
            PayGuard fetched this receipt itself from the {SUPPORTED_NETWORK.name} RPC. It does not rely on your wallet, a screenshot or the hash alone.
          </p>
        </section>
      </div>

      {q.data?.assessment ? (
        <section aria-labelledby="checks-h" className="space-y-4">
          <SectionTitle id="checks-h" aside={<span className="text-[12px] text-faint">Run {formatDateTime(q.data.assessment.evaluatedAt)}</span>}>
            Checks performed before payment
          </SectionTitle>
          <Verdict a={q.data.assessment} compact />
          <GateRail checks={q.data.assessment.checks} />
          {q.data.explanation ? <AssistantPanel e={q.data.explanation} /> : null}
          <CheckList checks={q.data.assessment.checks} />
          {q.data.authorizationAssessment ? (
            <p className="text-[12px] text-faint">
              Re-checked immediately before signing at {formatDateTime(q.data.authorizationAssessment.evaluatedAt)}:{" "}
              {q.data.authorizationAssessment.summary} Payload hash <span className="mono">{q.data.authorizationAssessment.payloadHash.slice(0, 18)}…</span>
            </p>
          ) : null}
        </section>
      ) : null}
      <p className="text-[12px] text-faint">
        <Link className="link" href="/help#statuses">
          What each status means
        </Link>
      </p>
    </div>
  );
}
