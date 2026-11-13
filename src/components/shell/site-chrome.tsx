"use client";

import Link from "next/link";
import { useSession } from "../session";
import { ButtonLink } from "../ui/primitives";
import { WalletButton } from "../wallet/wallet";
import { Logo } from "./logo";
import { NetworkStatus } from "./network-status";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { MUSD, PAYGUARD_ROUTER } from "@/config/contracts";

export function SiteHeader() {
  const session = useSession();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-4 md:px-6">
        <Logo />
        <nav aria-label="Site" className="ml-6 hidden items-center gap-1 text-[14px] text-muted md:flex">
          <Link className="rounded-md px-3 py-2 hover:text-text" href="/verify">
            Verify a payment
          </Link>
          <Link className="rounded-md px-3 py-2 hover:text-text" href="/developers">
            Developers
          </Link>
          <Link className="rounded-md px-3 py-2 hover:text-text" href="/help">
            Help
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NetworkStatus className="hidden lg:inline-flex" />
          {session.status === "authenticated" ? (
            <ButtonLink href="/dashboard" variant="secondary" size="md" className="hidden sm:inline-flex">
              Open app
            </ButtonLink>
          ) : null}
          <WalletButton compact />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-6">
        <div>
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-muted">
            Runs on {SUPPORTED_NETWORK.name} with test MUSD that has no monetary value. PayGuard reduces common payment mistakes; it cannot reverse a
            transfer or guarantee that a recipient is who they claim to be.
          </p>
        </div>
        <div>
          <p className="text-[13px] font-semibold">Product</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link className="hover:text-text" href="/send">Send MUSD</Link></li>
            <li><Link className="hover:text-text" href="/requests">Payment requests</Link></li>
            <li><Link className="hover:text-text" href="/verify">Verify a payment</Link></li>
            <li><Link className="hover:text-text" href="/security">Security Centre</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-[13px] font-semibold">Resources</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link className="hover:text-text" href="/help">Help and FAQ</Link></li>
            <li><Link className="hover:text-text" href="/developers">Verification API</Link></li>
            <li><a className="hover:text-text" href={SUPPORTED_NETWORK.faucetUrl} target="_blank" rel="noopener noreferrer">Mezo testnet faucet</a></li>
            <li><a className="hover:text-text" href="https://mezo.org/docs/developers/getting-started/" target="_blank" rel="noopener noreferrer">Mezo developer docs</a></li>
          </ul>
        </div>
        <div>
          <p className="text-[13px] font-semibold">Legal</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link className="hover:text-text" href="/legal#terms">Terms</Link></li>
            <li><Link className="hover:text-text" href="/legal#privacy">Privacy</Link></li>
            <li><Link className="hover:text-text" href="/legal#risk">Risk disclosure</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap gap-x-6 gap-y-1 px-4 py-4 text-[12px] text-faint md:px-6">
          <span>MUSD <span className="mono">{MUSD.address}</span></span>
          <span>PayGuardRouter <span className="mono">{PAYGUARD_ROUTER.address}</span></span>
        </div>
      </div>
    </footer>
  );
}
