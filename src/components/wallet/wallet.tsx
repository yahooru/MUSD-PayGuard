"use client";

import { DropdownMenu } from "radix-ui";
import { ChevronDown, Coins, Copy, ExternalLink, KeyRound, LogOut, Network, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useBalance, useDisconnect, useReadContract, useSwitchChain, useWatchAsset } from "wagmi";
import { SUPPORTED_NETWORK, chainName, explorer, isSupportedChain } from "@/config/chains";
import { MUSD, musdAbi } from "@/config/contracts";
import { formatAmount } from "@/lib/amount";
import { shortAddress } from "@/lib/format";
import { useSession } from "../session";
import { Button, cn } from "../ui/primitives";
import { useConnectDialog } from "./connect-dialog";

export function useMusdBalance(address: `0x${string}` | undefined) {
  const musd = useReadContract({
    address: MUSD.address,
    abi: musdAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: SUPPORTED_NETWORK.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const native = useBalance({ address, chainId: SUPPORTED_NETWORK.chainId, query: { enabled: !!address, refetchInterval: 15_000 } });
  return { musd, native };
}

export function useNetworkActions() {
  const { switchChainAsync, isPending } = useSwitchChain();
  const { watchAssetAsync } = useWatchAsset();
  return {
    switching: isPending,
    switchToMezo: async () => {
      try {
        // wagmi falls back to wallet_addEthereumChain when the wallet does not know the chain yet.
        await switchChainAsync({ chainId: SUPPORTED_NETWORK.chainId });
        toast.success(`Switched to ${SUPPORTED_NETWORK.name}.`);
        return true;
      } catch (e) {
        const m = String((e as Error)?.message ?? "");
        toast.error(/reject|denied/i.test(m) ? "Network switch was declined in your wallet." : "Your wallet could not switch networks. Add Mezo Testnet manually (see Help).");
        return false;
      }
    },
    addMusd: async () => {
      try {
        await watchAssetAsync({ type: "ERC20", options: { address: MUSD.address, symbol: MUSD.expected.symbol, decimals: MUSD.expected.decimals } });
        toast.success("MUSD added to your wallet's token list.");
      } catch {
        toast.error("Your wallet did not add the token.");
      }
    },
  };
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, chainId, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useConnectDialog();
  const session = useSession();
  const { switchToMezo, addMusd } = useNetworkActions();
  const { musd } = useMusdBalance(address);

  if (!isConnected || !address) {
    return (
      <Button variant="primary" size={compact ? "sm" : "md"} onClick={open} icon={<Wallet className="size-4" aria-hidden />}>
        Connect wallet
      </Button>
    );
  }
  const wrongNetwork = !isSupportedChain(chainId);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-[10px] border bg-surface-2 pl-2.5 pr-2 text-sm transition-colors hover:bg-surface-3",
            wrongNetwork ? "border-warn/60" : "border-line-strong",
          )}
          aria-label="Wallet menu"
        >
          {wrongNetwork ? (
            <TriangleAlert className="size-4 text-warn" aria-hidden />
          ) : (
            <span className="size-2 rounded-full bg-pass shadow-[0_0_8px_var(--pass)]" aria-hidden />
          )}
          <span className="mono text-[13px]">{shortAddress(address)}</span>
          {!compact && musd.data !== undefined ? (
            <span className="tnum hidden border-l border-line pl-2 text-[13px] text-muted lg:inline">{formatAmount(musd.data, { maxFraction: 2 })} MUSD</span>
          ) : null}
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="hull z-50 w-[290px] p-2">
          <div className="px-2.5 py-2">
            <p className="text-[12px] text-faint">Connected with {connector?.name ?? "wallet"}</p>
            <p className="mono mt-0.5 break-all text-[13px]">{address}</p>
            <p className={cn("mt-1.5 text-[12px]", wrongNetwork ? "text-warn" : "text-muted")}>
              Network: {chainName(chainId)}
              {wrongNetwork ? " (unsupported)" : ""}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">
              {session.status === "authenticated"
                ? session.accountMismatch
                  ? "Signed in with a different account"
                  : "Signed in with this wallet"
                : "Not signed in"}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          {wrongNetwork ? (
            <MenuItem onSelect={() => switchToMezo()} icon={<Network className="size-4" />}>
              Switch to {SUPPORTED_NETWORK.name}
            </MenuItem>
          ) : null}
          {session.status !== "authenticated" || session.accountMismatch ? (
            <MenuItem onSelect={() => session.signIn()} icon={<KeyRound className="size-4" />}>
              Sign in with this wallet
            </MenuItem>
          ) : null}
          <MenuItem onSelect={() => addMusd()} icon={<Coins className="size-4" />}>
            Add MUSD to wallet
          </MenuItem>
          <MenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(address);
              toast.success("Address copied.");
            }}
            icon={<Copy className="size-4" />}
          >
            Copy address
          </MenuItem>
          <MenuItem onSelect={() => window.open(explorer.address(address), "_blank", "noopener")} icon={<ExternalLink className="size-4" />}>
            View on explorer
          </MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          {session.status === "authenticated" ? (
            <MenuItem onSelect={() => session.signOut()} icon={<LogOut className="size-4" />}>
              Sign out of PayGuard
            </MenuItem>
          ) : null}
          <MenuItem
            onSelect={async () => {
              if (session.status === "authenticated") await session.signOut();
              disconnect();
            }}
            icon={<LogOut className="size-4" />}
          >
            Disconnect wallet
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({ children, icon, onSelect }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-sm text-text outline-none data-[highlighted]:bg-surface-3"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </DropdownMenu.Item>
  );
}
