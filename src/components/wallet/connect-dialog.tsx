"use client";

import { Dialog } from "radix-ui";
import { ExternalLink, Wallet, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useConnect, useConnectors, type Connector } from "wagmi";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { Spinner } from "../ui/primitives";

const Ctx = createContext<{ open: () => void } | null>(null);

export function useConnectDialog() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConnectDialog outside provider");
  return v;
}

function visibleConnectors(all: readonly Connector[]): Connector[] {
  // EIP-6963 discovered wallets have their own ids; keep the generic "Injected" only as a fallback.
  const discovered = all.filter((c) => c.id !== "injected");
  if (discovered.length > 0) return [...new Map(discovered.map((c) => [c.name, c])).values()];
  return all.filter((c) => c.id === "injected");
}

export function ConnectDialogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const connectors = useConnectors();
  const { connectAsync, isPending, variables } = useConnect();
  const list = useMemo(() => visibleConnectors(connectors), [connectors]);
  const hasProvider = typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;

  const connect = useCallback(
    async (c: Connector) => {
      try {
        await connectAsync({ connector: c, chainId: SUPPORTED_NETWORK.chainId }).catch(async (e) => {
          // Some wallets refuse chainId on connect when the chain is unknown to them: connect first, switch later.
          if (/chain|switch|4902/i.test(String(e?.message))) return connectAsync({ connector: c });
          throw e;
        });
        setOpen(false);
        toast.success(`Connected with ${c.name}.`);
      } catch (e) {
        const m = String((e as Error)?.message ?? "");
        toast.error(/reject|denied|cancel/i.test(m) ? "Connection request was declined in your wallet." : `Could not connect: ${m.slice(0, 120)}`);
      }
    },
    [connectAsync],
  );

  return (
    <Ctx.Provider value={useMemo(() => ({ open: () => setOpen(true) }), [])}>
      {children}
      <Dialog.Root open={isOpen} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-deep/75 backdrop-blur-sm" />
          <Dialog.Content className="hull fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 p-6 focus:outline-none">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="heading text-xl">Connect a wallet</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted">
                  PayGuard never sees your keys. Your wallet asks you to approve every signature and payment.
                </Dialog.Description>
              </div>
              <Dialog.Close className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-text" aria-label="Close">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <ul className="mt-5 space-y-2">
              {list.map((c) => {
                const busy = isPending && variables?.connector && "id" in variables.connector && variables.connector.id === c.id;
                return (
                  <li key={c.uid}>
                    <button
                      type="button"
                      onClick={() => connect(c)}
                      disabled={isPending}
                      className="flex w-full items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-cyan/60 hover:bg-surface-2 disabled:opacity-60"
                    >
                      {c.icon ? (
                        <img src={c.icon} alt="" className="size-7 rounded-md" />
                      ) : (
                        <span className="grid size-7 place-items-center rounded-md bg-surface-3 text-cyan">
                          <Wallet className="size-4" aria-hidden />
                        </span>
                      )}
                      <span className="flex-1">
                        <span className="block text-[15px] font-medium">{c.name === "Injected" ? "Browser wallet" : c.name}</span>
                        <span className="block text-[12px] text-faint">{c.id === "injected" ? "Detected injected provider" : "Detected via EIP-6963"}</span>
                      </span>
                      {busy ? <Spinner /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {list.length === 0 || (!hasProvider && list.every((c) => c.id === "injected")) ? (
              <div className="mt-4 rounded-[12px] border border-line bg-bg-deep p-4 text-sm text-muted">
                <p className="font-medium text-text">No browser wallet detected</p>
                <p className="mt-1">Install an EVM wallet extension such as MetaMask or Rabby, then reload this page.</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <a className="link inline-flex items-center gap-1" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
                    MetaMask <ExternalLink className="size-3" aria-hidden />
                  </a>
                  <a className="link inline-flex items-center gap-1" href="https://rabby.io/" target="_blank" rel="noopener noreferrer">
                    Rabby <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>
              </div>
            ) : null}
            <p className="mt-5 text-[12px] leading-relaxed text-faint">
              PayGuard runs on {SUPPORTED_NETWORK.name} (chain {SUPPORTED_NETWORK.chainId}). Testnet MUSD has no monetary value. Never share your seed
              phrase — PayGuard will never ask for it.
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}
