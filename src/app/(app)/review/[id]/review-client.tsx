"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, Pencil, RefreshCw, Send, Trash, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { parseSignature, type Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSignTypedData, useWriteContract } from "wagmi";
import { SUPPORTED_NETWORK, isSupportedChain } from "@/config/chains";
import { MUSD, PAYGUARD_ROUTER, gasLimitFor, musdAbi, routerAbi } from "@/config/contracts";
import { formatAmount, parseAmountInput } from "@/lib/amount";
import { api, ApiError } from "@/lib/client/api";
import type { AssessmentDTO, DraftDTO, RequestDTO } from "@/lib/dto";
import { analyzeAddress } from "@/lib/engine/address";
import type { Explanation } from "@/lib/engine/explain";
import { checkSignRequest } from "@/lib/engine/sign-guard";
import { formatGas } from "@/lib/format";
import { invoiceRefHash } from "@/lib/invoice";
import type { Settings } from "@/lib/settings";
import { AssistantPanel, CheckList, GateRail, Verdict } from "@/components/engine/checks";
import { useSession } from "@/components/session";
import { CopyButton, FullAddress, Musd } from "@/components/ui/data";
import { Button, ButtonLink, ErrorNote, Input, Skeleton, cn } from "@/components/ui/primitives";
import { useNetworkActions } from "@/components/wallet/wallet";

interface DraftResponse {
  draft: DraftDTO;
  assessment: AssessmentDTO | null;
  explanation: Explanation | null;
  request: RequestDTO | null;
}
interface PreflightResponse {
  draft: DraftDTO;
  assessment: AssessmentDTO;
  explanation: Explanation;
  settings: Settings;
}
interface Authorization {
  draftId: string;
  payloadHash: string;
  expiresAt: string;
  chainId: number;
  from: string;
  token: string;
  recipient: string;
  amount: string;
  method: "direct" | "router";
  gas: string;
  maxFee: string;
  call: { kind: "direct"; to: string; data: Hex } | { kind: "router"; to: string; invoiceRefHash: Hex };
}

type Phase = "idle" | "authorizing" | "permit" | "simulating" | "wallet" | "recording";
const PHASE_TEXT: Record<Phase, string> = {
  idle: "",
  authorizing: "Re-checking everything against the live network…",
  permit: "Sign the permit in your wallet (a signature, not a transaction)…",
  simulating: "Simulating the exact router call with your permit…",
  wallet: "Confirm the transaction in your wallet…",
  recording: "Recording the transaction hash so tracking survives a refresh…",
};

const pendingKey = (draftId: string) => `payguard:pending:${draftId}`;

function isUserRejection(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur; i++) {
    const o = cur as { name?: string; code?: number; message?: string; cause?: unknown };
    if (o.name === "UserRejectedRequestError" || o.code === 4001 || /user rejected|user denied|rejected the request/i.test(o.message ?? "")) return true;
    cur = o.cause;
  }
  return false;
}

function shortError(e: unknown): string {
  const o = e as { shortMessage?: string; message?: string };
  return (o.shortMessage ?? o.message ?? "Unknown error").split("\n")[0]!.slice(0, 220);
}

export function ReviewClient({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: SUPPORTED_NETWORK.chainId });
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchToMezo, switching } = useNetworkActions();

  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [compared, setCompared] = useState(false);
  const [suffix, setSuffix] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [unrecorded, setUnrecorded] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const draftQ = useQuery({ queryKey: ["draft", id], queryFn: () => api<DraftResponse>(`/api/drafts/${id}`) });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Settings }>("/api/settings") });
  const draft = draftQ.data?.draft;
  const assessment = draftQ.data?.assessment ?? null;

  const preflight = useMutation({
    mutationFn: () => api<PreflightResponse>(`/api/drafts/${id}/preflight`, { method: "POST", json: { walletChainId: chainId ?? null } }),
    onSuccess: (res) => {
      qc.setQueryData<DraftResponse>(["draft", id], (old) => ({ draft: res.draft, assessment: res.assessment, explanation: res.explanation, request: old?.request ?? null }));
      setAcks({});
      setSignError(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "The review could not run."),
  });

  // Run the preflight automatically when the draft has no current review.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!draft || autoRan.current || preflight.isPending) return;
    if (draft.transactionId) return;
    if (!assessment || draft.status === "draft") {
      autoRan.current = true;
      preflight.mutate();
    }
  }, [draft, assessment, preflight]);

  // Re-run when the wallet network changes, so the network check reflects reality.
  const lastChain = useRef(chainId);
  useEffect(() => {
    if (lastChain.current !== chainId && assessment && !preflight.isPending && phase === "idle") preflight.mutate();
    lastChain.current = chainId;
  }, [chainId, assessment, preflight, phase]);

  useEffect(() => {
    if (draft?.transactionId) router.replace(`/tx/${draft.transactionId}`);
  }, [draft?.transactionId, router]);

  const record = useCallback(
    async (hash: string) => {
      setPhase("recording");
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await api<{ transaction: { id: string } }>("/api/transactions", { method: "POST", json: { draftId: id, txHash: hash } });
          try {
            localStorage.removeItem(pendingKey(id));
          } catch {}
          setUnrecorded(null);
          router.push(`/tx/${res.transaction.id}`);
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            const details = e.details as { transactionId?: string } | undefined;
            if (details?.transactionId) {
              router.push(`/tx/${details.transactionId}`);
              return;
            }
            toast.error(e.message);
            break;
          }
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      setUnrecorded(hash);
      setPhase("idle");
    },
    [id, router],
  );

  // Resume recording a hash that was signed but not yet stored (e.g. tab closed mid-way).
  useEffect(() => {
    if (!draft || draft.transactionId) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(pendingKey(id));
    } catch {}
    if (stored && !inFlight.current) {
      inFlight.current = true;
      setUnrecorded(stored);
      void record(stored).finally(() => (inFlight.current = false));
    }
  }, [draft, id, record]);

  const settings = settingsQ.data?.settings;
  const amount = draft ? BigInt(draft.amount) : 0n;
  const threshold = settings ? parseAmountInput(settings.security.largePaymentThreshold) : null;
  const needsSuffix = !!threshold && threshold.ok && amount > threshold.value;
  const recipientInfo = draft ? analyzeAddress(draft.recipientInput) : null;
  const expectedSuffix = recipientInfo?.checksummed?.slice(-4).toLowerCase() ?? "";

  const requiredAcks = assessment?.acknowledgementsRequired ?? [];
  const allAcked = requiredAcks.every((a) => acks[a]);
  const wrongNetwork = isConnected && !isSupportedChain(chainId);
  const blockers: string[] = [];
  if (!isConnected) blockers.push("Connect your wallet.");
  if (wrongNetwork) blockers.push(`Switch your wallet to ${SUPPORTED_NETWORK.name}.`);
  if (session.accountMismatch) blockers.push("Your connected account differs from the signed-in account.");
  if (assessment?.decision === "blocked") blockers.push("The review found blocking problems.");
  if (!allAcked) blockers.push("Acknowledge each serious warning.");
  if (settings?.security.confirmFullAddress && !compared) blockers.push("Confirm you compared the full address.");
  if (needsSuffix && suffix.trim().toLowerCase() !== expectedSuffix) blockers.push("Type the last 4 characters of the recipient address.");
  const stale = draft?.status === "draft" || (assessment && draft?.payloadHash !== assessment.payloadHash);
  if (stale) blockers.push("The review is out of date: run it again.");
  const canConfirm = !!assessment && blockers.length === 0 && phase === "idle" && !preflight.isPending;

  async function confirmAndSign() {
    if (!draft || !assessment || !address || inFlight.current) return;
    inFlight.current = true;
    setSignError(null);
    try {
      setPhase("authorizing");
      let auth: Authorization;
      try {
        const res = await api<{ authorization: Authorization; assessment: AssessmentDTO }>(`/api/drafts/${id}/authorize`, {
          method: "POST",
          json: {
            payloadHash: assessment.payloadHash,
            acknowledgements: Object.keys(acks).filter((k) => acks[k]),
            walletChainId: chainId ?? null,
            walletAddress: address,
            addressConfirmation: needsSuffix ? suffix.trim() : null,
            fullAddressCompared: compared,
          },
        });
        auth = res.authorization;
      } catch (e) {
        if (e instanceof ApiError) {
          const d = e.details as { assessment?: AssessmentDTO } | undefined;
          if (d?.assessment) {
            qc.setQueryData<DraftResponse>(["draft", id], (old) => (old ? { ...old, assessment: { ...d.assessment!, purpose: "review" } } : old));
          }
          if (e.code === "submitted") {
            const tid = (e.details as { transactionId?: string } | undefined)?.transactionId;
            if (tid) router.push(`/tx/${tid}`);
          }
          setSignError(e.message);
        } else setSignError("Authorization failed.");
        return;
      }

      const payload = draft.payload;
      const expected = { chainId: SUPPORTED_NETWORK.chainId, token: MUSD.address, router: PAYGUARD_ROUTER.address };
      let hash: Hex;
      if (auth.call.kind === "direct") {
        const guard = checkSignRequest({
          reviewedPayloadHash: assessment.payloadHash,
          payload,
          account: address,
          walletChainId: chainId,
          expected,
          call: { kind: "direct", to: auth.call.to, data: auth.call.data },
        });
        if (!guard.ok) {
          setSignError(`PayGuard refused to request a signature: ${guard.problems.join(" ")}`);
          return;
        }
        setPhase("wallet");
        hash = await sendTransactionAsync({ to: auth.call.to as Hex, data: auth.call.data, gas: BigInt(auth.gas), chainId: SUPPORTED_NETWORK.chainId });
      } else {
        if (!publicClient) throw new Error("No RPC client");
        const to = recipientInfo!.checksummed as Hex;
        const refHash = invoiceRefHash(payload.invoiceRef ?? "");
        const guard = checkSignRequest({
          reviewedPayloadHash: assessment.payloadHash,
          payload,
          account: address,
          walletChainId: chainId,
          expected,
          call: { kind: "router", to: auth.call.to, args: { to, amount, invoiceRefHash: auth.call.invoiceRefHash }, expectedRefHash: refHash },
        });
        if (!guard.ok) {
          setSignError(`PayGuard refused to request a signature: ${guard.problems.join(" ")}`);
          return;
        }
        setPhase("permit");
        const nonce = await publicClient.readContract({ address: MUSD.address, abi: musdAbi, functionName: "nonces", args: [address] });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
        const sig = await signTypedDataAsync({
          domain: { name: MUSD.permit.name, version: MUSD.permit.version, chainId: SUPPORTED_NETWORK.chainId, verifyingContract: MUSD.address },
          types: {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "Permit",
          message: { owner: address, spender: PAYGUARD_ROUTER.address, value: amount, nonce, deadline },
        });
        const { r, s, v, yParity } = parseSignature(sig);
        const vNum = Number(v ?? BigInt(yParity + 27));
        const args = [to, amount, refHash, deadline, vNum, r, s] as const;
        setPhase("simulating");
        try {
          await publicClient.simulateContract({ address: PAYGUARD_ROUTER.address, abi: [...routerAbi, ...musdAbi.filter((x) => x.type === "error")], functionName: "payWithPermit", args, account: address });
        } catch (e) {
          setSignError(`Simulation of the router call failed, so nothing was sent: ${shortError(e)}`);
          return;
        }
        const est = await publicClient
          .estimateContractGas({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "payWithPermit", args, account: address })
          .catch(() => null);
        const { gas } = gasLimitFor("routerPayWithPermit", est);
        setPhase("wallet");
        hash = await writeContractAsync({ address: PAYGUARD_ROUTER.address, abi: routerAbi, functionName: "payWithPermit", args, gas, chainId: SUPPORTED_NETWORK.chainId });
      }
      try {
        localStorage.setItem(pendingKey(id), hash);
      } catch {}
      await record(hash);
    } catch (e) {
      if (isUserRejection(e)) {
        toast.info("You rejected the request in your wallet. Nothing was sent.");
        setSignError("You rejected the request in your wallet. Nothing was signed or sent; you can try again.");
      } else {
        setSignError(`The wallet reported an error and nothing was recorded as sent: ${shortError(e)}`);
      }
    } finally {
      inFlight.current = false;
      setPhase((p) => (p === "recording" ? p : "idle"));
    }
  }

  const discard = useMutation({
    mutationFn: () => api(`/api/drafts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Draft discarded.");
      router.push("/send");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not discard."),
  });

  const explanation = useMemo(() => draftQ.data?.explanation ?? null, [draftQ.data]);

  if (draftQ.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        <Skeleton className="h-[520px]" />
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-14" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (draftQ.isError || !draft) {
    return (
      <ErrorNote title="This payment draft could not be loaded." action={<ButtonLink href="/send">Start a new payment</ButtonLink>}>
        {draftQ.error instanceof ApiError ? draftQ.error.message : "Try again."}
      </ErrorNote>
    );
  }

  const fee = assessment?.fee;
  const busy = phase !== "idle";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/send" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> Send
        </Link>
        <span className="text-faint">/</span>
        <h1 className="display text-[26px] md:text-[30px]">Security review</h1>
      </div>

      {unrecorded ? (
        <div className="mb-5">
          <ErrorNote
            title="Your transaction was sent, but PayGuard has not recorded it yet."
            action={
              <Button variant="primary" size="sm" onClick={() => record(unrecorded)}>
                Retry recording
              </Button>
            }
          >
            Do not send again. Transaction hash: <span className="mono break-all">{unrecorded}</span>. PayGuard keeps this hash in your browser and retries
            automatically.
          </ErrorNote>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Manifest: exactly what will be signed */}
        <section className="hull lg:sticky lg:top-24" aria-labelledby="manifest-h">
          <div className="border-b border-line p-5">
            <h2 id="manifest-h" className="text-[13px] font-semibold text-muted">
              You are about to send
            </h2>
            <p className="display mt-2 text-[34px]">
              <Musd value={draft.amount} maxFraction={6} />
            </p>
            <p className="mt-1 text-[13px] text-faint">{draft.method === "router" ? "Through PayGuardRouter, invoice recorded on-chain" : "Direct MUSD transfer"}</p>
          </div>
          <dl className="divide-y divide-line px-5 text-[13px]">
            <div className="py-3.5">
              <dt className="text-muted">To (compare every group)</dt>
              <dd className="mt-1.5">
                {recipientInfo?.valid ? <FullAddress address={recipientInfo.checksummed!} /> : <span className="mono break-all text-fail">{draft.recipientInput}</span>}
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">Network</dt>
              <dd>
                {SUPPORTED_NETWORK.name} <span className="text-faint">(chain {draft.chainId})</span>
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">Token</dt>
              <dd className="text-right">
                {MUSD.expected.name} ({MUSD.expected.symbol})
                <span className="mono block text-[11px] text-faint">{MUSD.address}</span>
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">Maximum network fee</dt>
              <dd className="text-right">
                {fee ? (
                  <>
                    <span className="tnum">{formatAmount(BigInt(fee.maxFee), { maxFraction: 12, minFraction: 0 })} BTC</span>
                    <span className="block text-[11px] text-faint">
                      gas limit {formatGas(fee.gasLimit)} × {fee.maxFeePerGas} wei
                    </span>
                  </>
                ) : (
                  <span className="text-faint">Estimating…</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">Reference</dt>
              <dd className="text-right">{draft.invoiceRef ?? <span className="text-faint">None</span>}</dd>
            </div>
            {draft.note ? (
              <div className="flex justify-between gap-3 py-3">
                <dt className="text-muted">Note</dt>
                <dd className="text-right">{draft.note}</dd>
              </div>
            ) : null}
            {draftQ.data?.request ? (
              <div className="flex justify-between gap-3 py-3">
                <dt className="text-muted">Pays request</dt>
                <dd>
                  <Link className="link mono" href={`/pay/${draftQ.data.request.id}`}>
                    {draftQ.data.request.id}
                  </Link>
                </dd>
              </div>
            ) : null}
            {assessment ? (
              <div className="py-3">
                <dt className="flex items-center gap-1 text-muted">
                  <Lock className="size-3" aria-hidden /> Reviewed payload hash
                </dt>
                <dd className="mt-1 flex items-center gap-1">
                  <span className="mono break-all text-[11px] text-faint">{assessment.payloadHash}</span>
                  <CopyButton value={assessment.payloadHash} label="Copy payload hash" />
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="space-y-3 border-t border-line p-5">
            {settings?.security.confirmFullAddress !== false ? (
              <label className="flex cursor-pointer items-start gap-3 text-[13px]">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--cyan)]" checked={compared} onChange={(e) => setCompared(e.target.checked)} disabled={busy} />
                <span>I compared the full recipient address above with the one I was given through a channel I trust.</span>
              </label>
            ) : null}
            {needsSuffix ? (
              <div>
                <label htmlFor="suffix" className="text-[13px]">
                  This is above your large-payment threshold ({settings?.security.largePaymentThreshold} MUSD). Type the last 4 characters of the address:
                </label>
                <Input
                  id="suffix"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                  maxLength={4}
                  className="mono mt-2 w-32"
                  autoComplete="off"
                  disabled={busy}
                />
              </div>
            ) : null}

            {wrongNetwork ? (
              <Button variant="secondary" className="w-full" onClick={switchToMezo} loading={switching}>
                Switch wallet to {SUPPORTED_NETWORK.name}
              </Button>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!canConfirm}
              loading={busy}
              onClick={confirmAndSign}
              icon={<Send className="size-4" aria-hidden />}
            >
              {assessment?.decision === "blocked" ? "Sending blocked" : "Confirm and sign in wallet"}
            </Button>
            {busy ? (
              <p className="text-[13px] text-cyan" aria-live="polite">
                {PHASE_TEXT[phase]}
              </p>
            ) : blockers.length > 0 && assessment ? (
              <ul className="space-y-1 text-[12px] text-muted" aria-live="polite">
                {blockers.map((b) => (
                  <li key={b} className="flex gap-1.5">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warn" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-faint">
                PayGuard re-runs every check and re-verifies the exact payload right before your wallet opens. It never signs for you.
              </p>
            )}
            {signError ? (
              <p role="alert" className="rounded-[10px] border border-fail/40 bg-fail/5 p-3 text-[13px] text-fail">
                {signError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <ButtonLink href={`/send?edit=${id}`} variant="ghost" size="sm" icon={<Pencil className="size-3.5" aria-hidden />}>
                Edit details
              </ButtonLink>
              <Button variant="ghost" size="sm" onClick={() => preflight.mutate()} loading={preflight.isPending} disabled={busy} icon={<RefreshCw className="size-3.5" aria-hidden />}>
                Run checks again
              </Button>
              <Button variant="ghost" size="sm" onClick={() => discard.mutate()} disabled={busy} icon={<Trash className="size-3.5" aria-hidden />}>
                Discard
              </Button>
            </div>
          </div>
        </section>

        {/* Findings */}
        <section aria-labelledby="findings-h" className="min-w-0 space-y-5">
          <h2 id="findings-h" className="sr-only">
            Findings
          </h2>
          {preflight.isPending && !assessment ? (
            <div className="space-y-3" aria-busy>
              <p className="text-sm text-cyan">Running {" "}checks against Mezo Testnet: recipient, network, token, balances, simulation, duplicates…</p>
              <Skeleton className="h-28" />
              <Skeleton className="h-14" />
              <Skeleton className="h-64" />
            </div>
          ) : assessment ? (
            <>
              <div className={cn(preflight.isPending && "opacity-60 transition-opacity")}>
                <Verdict a={assessment} />
              </div>
              <GateRail checks={assessment.checks} />
              {explanation ? <AssistantPanel e={explanation} /> : null}
              <CheckList
                checks={assessment.checks}
                acks={acks}
                onAck={(cid, v) => setAcks((s) => ({ ...s, [cid]: v }))}
                ackDisabled={busy || assessment.decision === "blocked"}
              />
              <p className="text-[12px] text-faint">
                Checked at {new Date(assessment.evaluatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC. Saved with this payment so you can inspect
                it later.
              </p>
            </>
          ) : preflight.isError ? (
            <ErrorNote title="The review could not run." action={<Button onClick={() => preflight.mutate()}>Try again</Button>}>
              {preflight.error instanceof ApiError ? preflight.error.message : "Network error."}
            </ErrorNote>
          ) : null}
        </section>
      </div>
    </div>
  );
}
