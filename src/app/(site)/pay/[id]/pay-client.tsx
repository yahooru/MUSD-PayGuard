"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, KeyRound, Send, Wallet } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { SUPPORTED_NETWORK, chainName, explorer } from "@/config/chains";
import { api, ApiError } from "@/lib/client/api";
import type { RequestDTO } from "@/lib/dto";
import type { Explanation } from "@/lib/engine/explain";
import type { Assessment } from "@/lib/engine/types";
import { formatDateTime } from "@/lib/format";
import { AssistantPanel, CheckList, Verdict } from "@/components/engine/checks";
import { useSession } from "@/components/session";
import { CopyButton, FullAddress, Musd } from "@/components/ui/data";
import { Button, ButtonLink, ErrorNote, Skeleton, cn } from "@/components/ui/primitives";
import { useConnectDialog } from "@/components/wallet/connect-dialog";

interface PayData {
  request: RequestDTO;
  assessment: Assessment;
  explanation: Explanation;
  viewer: { address: string; isCreator: boolean } | null;
  paidTx: { txHash: string; blockNumber: string | null } | null;
}

export function PayClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const session = useSession();
  const { isConnected } = useAccount();
  const { open } = useConnectDialog();
  const q = useQuery({ queryKey: ["pay", id, session.address], queryFn: () => api<PayData>(`/api/requests/${id}`) });
  const cancel = useMutation({
    mutationFn: () => api(`/api/requests/${id}`, { method: "PATCH", json: { action: "cancel" } }),
    onSuccess: () => {
      toast.success("Request cancelled.");
      qc.invalidateQueries({ queryKey: ["pay", id] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not cancel."),
  });

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Skeleton className="h-[460px]" />
        <Skeleton className="h-[460px]" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ErrorNote title="Payment request not found" action={<ButtonLink href="/">Go to PayGuard</ButtonLink>}>
        {q.error instanceof ApiError ? q.error.message : "Check the link with the person who sent it."}
      </ErrorNote>
    );
  }
  const { request: r, assessment, explanation, viewer, paidTx } = q.data;
  // Expiry is judged by the server-side review (request.expiry), not the browser clock.
  const expired = assessment.checks.some((c) => c.id === "request.expiry" && c.status === "warn");
  const statusLabel = r.status === "paid" ? "Paid (verified on-chain)" : r.status === "cancelled" ? "Cancelled by creator" : expired ? "Expired" : "Open";
  const url = typeof window !== "undefined" ? window.location.href : "";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] text-muted">Payment request</p>
        <h1 className="display mt-1 text-[30px] md:text-[38px]">{r.invoiceRef ?? "Payment request"}</h1>
        <p className="mt-2 text-sm text-muted">
          Checked live just now. A valid request proves which wallet created it, not that the requester is who they claim to be.
        </p>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <section className="hull lg:sticky lg:top-24" aria-labelledby="req-h">
          <div className="border-b border-line p-5">
            <h2 id="req-h" className="text-[13px] text-muted">
              Amount requested
            </h2>
            <p className="display mt-1 text-[36px]">
              <Musd value={r.amount} maxFraction={6} />
            </p>
            <p
              className={cn(
                "mt-2 inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-medium",
                r.status === "paid" ? "border-pass/40 text-pass" : r.status === "cancelled" || expired ? "border-warn/40 text-warn" : "border-cyan/40 text-cyan",
              )}
            >
              {statusLabel}
            </p>
          </div>
          <dl className="divide-y divide-line px-5 text-[13px]">
            <div className="py-3">
              <dt className="text-muted">Pay to</dt>
              <dd className="mt-1">
                <FullAddress address={r.recipient} />
              </dd>
            </div>
            <div className="py-3">
              <dt className="text-muted">Created by wallet</dt>
              <dd className="mt-1">
                <FullAddress address={r.creator} />
              </dd>
            </div>
            {r.description ? (
              <div className="py-3">
                <dt className="text-muted">Description</dt>
                <dd className="mt-1">{r.description}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">Network and token</dt>
              <dd className="text-right">
                {chainName(r.chainId)}, MUSD
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">Created</dt>
              <dd>{formatDateTime(r.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">Expires</dt>
              <dd>{r.expiresAt ? formatDateTime(r.expiresAt) : "Never"}</dd>
            </div>
            {paidTx ? (
              <div className="py-3">
                <dt className="text-muted">Paid by transaction</dt>
                <dd className="mt-1">
                  <a className="mono link break-all text-[12px]" href={explorer.tx(paidTx.txHash)} target="_blank" rel="noopener noreferrer">
                    {paidTx.txHash}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="space-y-3 border-t border-line p-5">
            {viewer?.isCreator ? (
              <>
                <p className="text-[13px] text-muted">You created this request. Share the link or QR code with the payer.</p>
                {r.status === "open" ? (
                  <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending} icon={<Ban className="size-4" aria-hidden />}>
                    Cancel request
                  </Button>
                ) : null}
              </>
            ) : session.status === "authenticated" ? (
              <ButtonLink
                href={`/send?request=${r.id}`}
                variant="primary"
                size="lg"
                className={cn("w-full", assessment.decision === "blocked" && "pointer-events-none opacity-50")}
                icon={<Send className="size-4" aria-hidden />}
              >
                {assessment.decision === "blocked" ? "Payment blocked" : "Pay with full preflight"}
              </ButtonLink>
            ) : isConnected ? (
              <Button variant="primary" size="lg" className="w-full" onClick={() => session.signIn()} loading={session.signingIn} icon={<KeyRound className="size-4" aria-hidden />}>
                Sign in to check and pay
              </Button>
            ) : (
              <Button variant="primary" size="lg" className="w-full" onClick={open} icon={<Wallet className="size-4" aria-hidden />}>
                Connect wallet to pay
              </Button>
            )}
            {!viewer ? (
              <p className="text-[12px] text-faint">Signing in adds checks against your own history (duplicate payments, lookalike addresses).</p>
            ) : null}
            <div className="flex items-center gap-3 pt-2">
              <div className="rounded-[10px] bg-white p-2">
                <QRCodeSVG value={url || `/pay/${r.id}`} size={84} level="M" />
              </div>
              <div className="min-w-0 text-[12px] text-muted">
                <p className="mono truncate">{r.id}</p>
                <span className="inline-flex items-center gap-1">
                  Copy link <CopyButton value={url} label="Copy request link" />
                </span>
              </div>
            </div>
          </div>
        </section>
        <section className="min-w-0 space-y-5" aria-label="Request validation">
          <Verdict a={assessment} compact />
          <AssistantPanel e={explanation} />
          <CheckList checks={assessment.checks} />
          <p className="text-[12px] text-faint">
            Validated against {SUPPORTED_NETWORK.name} at {formatDateTime(assessment.evaluatedAt)}. Paying runs the full preflight against your wallet
            (balance, gas, simulation, duplicates) before anything is signed. <Link className="link" href="/help">How PayGuard works</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
