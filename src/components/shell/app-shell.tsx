"use client";

import { Dialog } from "radix-ui";
import { BadgeCheck, Ellipsis, ExternalLink, KeyRound, Menu, Network, Send, TriangleAlert, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { SUPPORTED_NETWORK, chainName, explorer, isSupportedChain } from "@/config/chains";
import { PAYGUARD_ROUTER } from "@/config/contracts";
import { shortAddress } from "@/lib/format";
import { useSession } from "../session";
import { Button, ButtonLink, Skeleton, cn } from "../ui/primitives";
import { useConnectDialog } from "../wallet/connect-dialog";
import { useNetworkActions, WalletButton } from "../wallet/wallet";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
import { APP_NAV, MOBILE_TABS, SECONDARY_NAV } from "./nav";
import { NetworkStatus } from "./network-status";
import { Notifications } from "./notifications";

function useIsActive() {
  const path = usePathname();
  return (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/send" && path.startsWith("/review"));
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const active = useIsActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {APP_NAV.map((n) => {
        const Icon = n.icon;
        const on = active(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={on ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] transition-colors",
              on ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {on ? <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-cyan" aria-hidden /> : null}
            <Icon className={cn("size-[18px]", on ? "text-cyan" : "text-faint group-hover:text-muted")} aria-hidden />
            <span className="flex-1">{n.label}</span>
            <span className="kbd hidden opacity-0 transition-opacity group-hover:opacity-100 lg:inline" aria-hidden>
              {n.key}
            </span>
          </Link>
        );
      })}
      <div className="my-3 h-px bg-line" />
      {SECONDARY_NAV.map((n) => {
        const Icon = n.icon;
        const on = active(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={on ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-[10px] px-3 py-2 text-[14px]", on ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text")}
          >
            <Icon className="size-[18px] text-faint" aria-hidden />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-cyan focus:px-3 focus:py-2 focus:text-cyan-ink">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-bg-deep/60 px-4 py-5 lg:flex">
        <Logo href="/dashboard" />
        <div className="mt-8 flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="mt-4 rounded-[12px] border border-line bg-surface/60 p-3">
          <a
            href={explorer.address(PAYGUARD_ROUTER.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 text-[12px] font-medium text-text"
          >
            <BadgeCheck className="size-4 text-violet" aria-hidden />
            Router source verified
            <ExternalLink className="ml-auto size-3 text-faint group-hover:text-muted" aria-hidden />
          </a>
          <p className="mono mt-1 text-[11px] text-faint">{shortAddress(PAYGUARD_ROUTER.address)}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {SUPPORTED_NETWORK.name} only. Test MUSD has no value. PayGuard reduces mistakes; it cannot vouch for a recipient.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 md:px-6">
            <button
              type="button"
              className="hidden size-10 place-items-center rounded-[10px] border border-line text-muted sm:grid lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <div className="lg:hidden">
              <Logo href="/dashboard" compact />
            </div>
            <div className="hidden flex-1 items-center gap-3 lg:flex">
              <CommandPalette />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <NetworkStatus className="hidden md:inline-flex" />
              <NewPaymentButton />
              <Notifications />
              <WalletButton />
            </div>
          </div>
        </header>
        <StatusBanners />
        <main id="main" className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-28 md:px-6 md:pt-8 lg:pb-12">
          {children}
        </main>
      </div>

      <MobileTabs onMore={() => setMobileOpen(true)} />

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-deep/70 backdrop-blur-sm lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[290px] max-w-[85vw] overflow-y-auto border-r border-line bg-bg p-5 lg:hidden" aria-describedby={undefined}>
            <div className="mb-6 flex items-center justify-between">
              <Dialog.Title asChild>
                <div>
                  <Logo href="/dashboard" />
                </div>
              </Dialog.Title>
              <Dialog.Close className="grid size-9 place-items-center rounded-lg text-muted" aria-label="Close menu">
                <X className="size-5" />
              </Dialog.Close>
            </div>
            <NetworkStatus className="mb-5 inline-flex" />
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** Header shortcut to start a payment; hidden while already in the payment flow. */
function NewPaymentButton() {
  const path = usePathname();
  // The dashboard and the payment flow already carry their own primary action.
  if (path === "/dashboard" || path.startsWith("/send") || path.startsWith("/review")) return null;
  return (
    <ButtonLink href="/send" size="md" className="hidden xl:inline-flex" icon={<Send className="size-4" aria-hidden />}>
      New payment
    </ButtonLink>
  );
}

/** Thumb-reach navigation for phones and small tablets. The drawer keeps everything else. */
function MobileTabs({ onMore }: { onMore: () => void }) {
  const active = useIsActive();
  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
        {MOBILE_TABS.map((t) => {
          const Icon = t.icon;
          const on = active(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn("flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium", on ? "text-cyan" : "text-muted")}
              >
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", on && "bg-cyan/12")}>
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onMore} className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted">
            <span className="grid h-7 w-12 place-items-center rounded-full">
              <Ellipsis className="size-[18px]" aria-hidden />
            </span>
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** Wrong-network and account-switch banners: always text, never colour alone. */
function StatusBanners() {
  const { isConnected, chainId, address } = useAccount();
  const session = useSession();
  const { switchToMezo, switching } = useNetworkActions();
  const wrong = isConnected && !isSupportedChain(chainId);
  if (!wrong && !session.accountMismatch) return null;
  return (
    <div className="space-y-px">
      {wrong ? (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-sm md:px-6">
          <TriangleAlert className="size-4 text-warn" aria-hidden />
          <span className="flex-1">
            Your wallet is on <strong>{chainName(chainId)}</strong>. PayGuard only builds payments on {SUPPORTED_NETWORK.name}; sending is disabled until you switch.
          </span>
          <Button size="sm" variant="secondary" onClick={switchToMezo} loading={switching} icon={<Network className="size-3.5" aria-hidden />}>
            Switch network
          </Button>
        </div>
      ) : null}
      {session.accountMismatch ? (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-sm md:px-6">
          <TriangleAlert className="size-4 text-warn" aria-hidden />
          <span className="flex-1">
            Your wallet switched to <span className="mono">{shortAddress(address)}</span>, but you are signed in as{" "}
            <span className="mono">{shortAddress(session.address)}</span>. Sending is disabled until they match.
          </span>
          <Button size="sm" variant="secondary" onClick={() => session.signIn()} loading={session.signingIn} icon={<KeyRound className="size-3.5" aria-hidden />}>
            Sign in as this account
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Gate for pages that need a signed-in wallet. Explains each step instead of a blank redirect. */
export function RequireSession({ children, title = "Sign in to continue" }: { children: ReactNode; title?: string }) {
  const session = useSession();
  const { isConnected } = useAccount();
  const { open } = useConnectDialog();
  if (session.status === "loading") {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (session.status === "authenticated") return <>{children}</>;
  return (
    <div className="hull relative mx-auto mt-6 max-w-xl overflow-hidden p-8">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative">
        <h1 className="display text-[28px]">{title}</h1>
        <ol className="mt-5 space-y-4">
          <li className="flex gap-3">
            <span className={cn("mono grid size-7 shrink-0 place-items-center rounded-full border text-[12px]", isConnected ? "border-pass/60 text-pass" : "border-cyan/60 text-cyan")}>1</span>
            <div>
              <p className="font-medium">Connect your wallet</p>
              <p className="text-sm text-muted">{isConnected ? "Connected." : "PayGuard is non-custodial: it never sees or stores your keys."}</p>
              {!isConnected ? (
                <Button className="mt-3" variant="primary" onClick={open} icon={<Wallet className="size-4" aria-hidden />}>
                  Connect wallet
                </Button>
              ) : null}
            </div>
          </li>
          <li className="flex gap-3">
            <span className="mono grid size-7 shrink-0 place-items-center rounded-full border border-line-strong text-[12px] text-muted">2</span>
            <div>
              <p className="font-medium">Sign in with Ethereum</p>
              <p className="text-sm text-muted">
                A free signature (no transaction, no gas) proves you control the wallet, so your recipient book and payment history stay private to you.
              </p>
              {isConnected ? (
                <Button className="mt-3" variant="primary" onClick={() => session.signIn()} loading={session.signingIn} icon={<KeyRound className="size-4" aria-hidden />}>
                  Sign in
                </Button>
              ) : null}
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}
