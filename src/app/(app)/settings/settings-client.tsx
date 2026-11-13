"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Network } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { SUPPORTED_NETWORK, chainName } from "@/config/chains";
import { MUSD, PAYGUARD_ROUTER } from "@/config/contracts";
import { api, ApiError } from "@/lib/client/api";
import { formatDateTime } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import { useSession } from "@/components/session";
import { DefinitionList, FullAddress } from "@/components/ui/data";
import { Button, Field, Input, PageHeader, SectionTitle, Skeleton } from "@/components/ui/primitives";
import { useNetworkActions } from "@/components/wallet/wallet";

function Toggle({ id, label, desc, checked, onChange }: { id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-3.5">
      <span>
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="block text-[13px] text-muted">{desc}</span>
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--cyan)]" />
    </label>
  );
}

export function SettingsClient() {
  const qc = useQueryClient();
  const session = useSession();
  const { connector, chainId } = useAccount();
  const { switchToMezo, addMusd } = useNetworkActions();
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: Settings; account: { address: string; createdAt: string | null; lastLoginAt: string | null } }>("/api/settings"),
  });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data) setS(q.data.settings);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (next: Settings) => api<{ settings: Settings }>("/api/settings", { method: "PUT", json: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved.");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save."),
  });
  if (!s) return <Skeleton className="h-96" />;
  const setSec = (k: keyof Settings["security"], v: boolean | string) => setS({ ...s, security: { ...s.security, [k]: v } });
  const setNot = (k: keyof Settings["notifications"], v: boolean) => setS({ ...s, notifications: { ...s.notifications, [k]: v } });

  return (
    <div className="space-y-10">
      <PageHeader title="Settings" lede="Wallet, network and safety preferences. Preferences are stored with your wallet's PayGuard account." />

      <section aria-labelledby="wallet-h">
        <SectionTitle id="wallet-h">Wallet</SectionTitle>
        <div className="card px-5">
          <DefinitionList
            items={[
              { term: "Signed-in wallet", value: <FullAddress address={session.address ?? ""} /> },
              { term: "Connected with", value: connector?.name ?? "Not connected" },
              { term: "Wallet network", value: chainName(chainId) },
              { term: "PayGuard account since", value: formatDateTime(q.data?.account.createdAt) },
              { term: "Last sign-in", value: formatDateTime(q.data?.account.lastLoginAt) },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="net-h">
        <SectionTitle id="net-h">Supported network</SectionTitle>
        <div className="card px-5">
          <DefinitionList
            items={[
              { term: "Network", value: `${SUPPORTED_NETWORK.name} (chain ${SUPPORTED_NETWORK.chainId}, ${SUPPORTED_NETWORK.hexChainId})` },
              { term: "RPC", value: <span className="mono text-[13px]">{SUPPORTED_NETWORK.rpcUrl}</span> },
              { term: "Explorer", value: <a className="link" href={SUPPORTED_NETWORK.explorerUrl} target="_blank" rel="noopener noreferrer">{SUPPORTED_NETWORK.explorerUrl}</a> },
              { term: "Gas token", value: "BTC (18 decimals)" },
              { term: "MUSD contract", value: <FullAddress address={MUSD.address} /> },
              { term: "PayGuardRouter", value: <FullAddress address={PAYGUARD_ROUTER.address} /> },
              { term: "Confirmations required", value: String(SUPPORTED_NETWORK.requiredConfirmations) },
            ]}
          />
          <div className="flex flex-wrap gap-2 pb-4">
            <Button size="sm" onClick={switchToMezo} icon={<Network className="size-3.5" aria-hidden />}>
              Add or switch to Mezo Testnet
            </Button>
            <Button size="sm" onClick={addMusd} icon={<Coins className="size-3.5" aria-hidden />}>
              Add MUSD to wallet
            </Button>
          </div>
        </div>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(s);
        }}
        className="space-y-10"
      >
        <section aria-labelledby="sec-h">
          <SectionTitle id="sec-h">Security preferences</SectionTitle>
          <div className="card divide-y divide-line px-5">
            <Toggle
              id="cfa"
              label="Require full-address comparison"
              desc="Before every signature, tick that you compared the complete recipient address."
              checked={s.security.confirmFullAddress}
              onChange={(v) => setSec("confirmFullAddress", v)}
            />
            <Toggle
              id="ueh"
              label="Use on-chain history for lookalike detection"
              desc="PayGuard reads your public MUSD transfers from the Mezo explorer to spot address-poisoning lookalikes. Turning this off weakens that check."
              checked={s.security.useExplorerHistory}
              onChange={(v) => setSec("useExplorerHistory", v)}
            />
            <div className="py-3.5">
              <Field
                label="Large-payment threshold (MUSD)"
                htmlFor="lpt"
                hint="Above this amount you must type the last 4 characters of the recipient address before signing. Use 0 to require it always."
              >
                <Input id="lpt" value={s.security.largePaymentThreshold} onChange={(e) => setSec("largePaymentThreshold", e.target.value)} className="tnum max-w-40" inputMode="decimal" />
              </Field>
            </div>
          </div>
        </section>

        <section aria-labelledby="not-h">
          <SectionTitle id="not-h">Notifications</SectionTitle>
          <div className="card divide-y divide-line px-5">
            <Toggle id="nc" label="Payment confirmed" desc="In-app notification when PayGuard verifies a payment on-chain." checked={s.notifications.confirmed} onChange={(v) => setNot("confirmed", v)} />
            <Toggle id="nf" label="Payment failed" desc="When a transaction reverts or does not match the reviewed payment." checked={s.notifications.failed} onChange={(v) => setNot("failed", v)} />
            <Toggle id="nd" label="Verification delayed or unknown" desc="When the network cannot be reached or a hash disappears." checked={s.notifications.delayed} onChange={(v) => setNot("delayed", v)} />
          </div>
          <p className="mt-2 text-[12px] text-faint">Notifications are shown inside PayGuard only. No email or phone number is collected.</p>
        </section>

        <Button type="submit" variant="primary" loading={save.isPending}>
          Save settings
        </Button>
      </form>

      <section aria-labelledby="priv-h">
        <SectionTitle id="priv-h">Privacy</SectionTitle>
        <div className="card space-y-2 p-5 text-sm text-muted">
          <p>PayGuard stores only what it needs: your wallet address, saved recipients, payment drafts, review results, transaction hashes and these preferences.</p>
          <p>It never asks for or stores seed phrases or private keys, and it never signs anything for you.</p>
          <p>Your data is visible only to a session signed by your wallet. Public payment-request links show the request details to anyone with the link.</p>
          <p>
            Blockchain data is public: anyone can see transfers to and from your address on the Mezo explorer, with or without PayGuard.
          </p>
        </div>
      </section>
    </div>
  );
}
