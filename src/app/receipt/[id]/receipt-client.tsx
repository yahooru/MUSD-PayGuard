"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { SUPPORTED_NETWORK, explorer } from "@/config/chains";
import { formatUnitsExact } from "@/lib/amount";
import { api } from "@/lib/client/api";
import type { TransactionDTO } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { LogoMark } from "@/components/shell/logo";
import { CopyButton, Musd } from "@/components/ui/data";
import { Button, ErrorNote, Skeleton } from "@/components/ui/primitives";

export function ReceiptClient({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["tx", id, "receipt"], queryFn: () => api<{ transaction: TransactionDTO }>(`/api/transactions/${id}`) });
  if (q.isLoading) return <Skeleton className="h-[640px]" />;
  const tx = q.data?.transaction;
  if (!tx) return <ErrorNote title="Receipt not found." />;
  if (tx.status !== "confirmed") {
    return (
      <ErrorNote title="No receipt yet" action={<Link className="link" href={`/tx/${id}`}>Open payment status</Link>}>
        A receipt is only issued after PayGuard has verified the transaction on-chain. Current status: {tx.status.replace("_", " ")}.
      </ErrorNote>
    );
  }
  const verifyUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/verify?tx=${tx.txHash}&to=${tx.recipient}&amount=${formatUnitsExact(BigInt(tx.amount))}`
      : "";
  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/tx/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> Back to payment
        </Link>
        <Button variant="primary" onClick={() => window.print()} icon={<Printer className="size-4" aria-hidden />}>
          Print or save as PDF
        </Button>
      </div>
      <article className="hull flip-in p-6 md:p-10" aria-labelledby="receipt-h">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <LogoMark className="size-9" />
            <div>
              <h1 id="receipt-h" className="heading text-[22px]">
                Payment receipt
              </h1>
              <p className="text-[13px] text-muted">MUSD PayGuard, {SUPPORTED_NETWORK.name}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pass/40 bg-pass/10 px-3 py-1 text-[13px] font-medium text-pass">
            <BadgeCheck className="size-4" aria-hidden /> Verified on-chain
          </span>
        </header>
        <div className="grid gap-8 py-6 md:grid-cols-[1fr_auto]">
          <dl className="grid gap-4 text-[14px]">
            <div>
              <dt className="text-[12px] text-muted">Amount</dt>
              <dd className="display mt-1 text-[30px]">
                <Musd value={tx.amount} maxFraction={18} />
              </dd>
            </div>
            {[
              ["Sender", tx.from],
              ["Recipient", tx.recipient],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="mono mt-0.5 break-all text-[13px]">{v}</dd>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-[12px] text-muted">Network</dt>
                <dd>
                  {SUPPORTED_NETWORK.name} (chain {tx.chainId})
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Token</dt>
                <dd>MUSD</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Block</dt>
                <dd className="tnum">{tx.blockNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Confirmation status</dt>
                <dd>Confirmed ({tx.confirmations ?? 1}+ confirmations at verification)</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Invoice reference</dt>
                <dd>{tx.invoiceRef ?? "None"}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Verified at</dt>
                <dd>{formatDateTime(tx.verifiedAt)}</dd>
              </div>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Transaction hash</dt>
              <dd className="mt-0.5 flex items-start gap-1">
                <span className="mono break-all text-[13px]">{tx.txHash}</span>
                <span className="no-print">
                  <CopyButton value={tx.txHash} label="Copy transaction hash" />
                </span>
              </dd>
              <dd className="no-print mt-1">
                <a className="link inline-flex items-center gap-1 text-[13px]" href={explorer.tx(tx.txHash)} target="_blank" rel="noopener noreferrer">
                  Open in Mezo explorer <ExternalLink className="size-3" aria-hidden />
                </a>
              </dd>
            </div>
          </dl>
          {verifyUrl ? (
            <div className="text-center">
              <div className="inline-block rounded-[12px] bg-white p-3">
                <QRCodeSVG value={verifyUrl} size={132} level="M" />
              </div>
              <p className="mt-2 max-w-[160px] text-[11px] text-muted">Scan to re-verify this payment live against the chain.</p>
            </div>
          ) : null}
        </div>
        <footer className="border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
          This receipt is an off-chain summary, not a cryptographic proof by itself. Its evidence is independently verifiable: anyone can look up the
          transaction hash on the Mezo explorer, or use PayGuard&apos;s public verification (the QR code above), which re-reads the receipt and the MUSD
          Transfer event from the chain. Testnet MUSD has no monetary value.
        </footer>
      </article>
    </div>
  );
}
