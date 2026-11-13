"use client";

import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { Download, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { APP_NAV, SECONDARY_NAV } from "./nav";

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.tagName === "SELECT");
}

/** ⌘K / Ctrl+K command palette and "g <key>" navigation shortcuts. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        setOpen(true);
        return;
      }
      if (e.key === "g") {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
        return;
      }
      if (pendingG.current) {
        const item = APP_NAV.find((n) => n.key === `g ${e.key}`);
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const item = "flex cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-3";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] text-faint hover:text-muted md:inline-flex"
        aria-label="Open command palette"
      >
        <Search className="size-4" aria-hidden />
        <span>Jump to…</span>
        <kbd className="mono ml-4 rounded border border-line px-1.5 text-[11px]">Ctrl K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-bg-deep/70 backdrop-blur-sm" />
          <Dialog.Content className="hull fixed left-1/2 top-[18vh] z-50 w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 overflow-hidden p-0" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Command palette</Dialog.Title>
            <Command label="Command palette" loop>
              <div className="flex items-center gap-2 border-b border-line px-4">
                <Search className="size-4 text-faint" aria-hidden />
                <Command.Input autoFocus placeholder="Type a page or an action" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
              </div>
              <Command.List className="max-h-[50vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matching page or action.</Command.Empty>
                <Command.Group heading="Actions" className="px-1 pb-1 text-[12px] text-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  <Command.Item className={item} onSelect={() => go("/send")}>
                    <Plus className="size-4 text-cyan" aria-hidden /> New payment
                  </Command.Item>
                  <Command.Item className={item} onSelect={() => go("/requests?new=1")}>
                    <Plus className="size-4 text-cyan" aria-hidden /> Create payment request
                  </Command.Item>
                  <Command.Item className={item} onSelect={() => go("/recipients?new=1")}>
                    <Plus className="size-4 text-cyan" aria-hidden /> Save a recipient
                  </Command.Item>
                  <Command.Item
                    className={item}
                    onSelect={() => {
                      setOpen(false);
                      // A file download, not a page: use a download link rather than client navigation.
                      const a = document.createElement("a");
                      a.href = "/api/export";
                      a.download = "";
                      a.click();
                    }}
                  >
                    <Download className="size-4 text-cyan" aria-hidden /> Export history as CSV
                  </Command.Item>
                </Command.Group>
                <Command.Group heading="Go to" className="px-1 text-[12px] text-faint [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {[...APP_NAV, ...SECONDARY_NAV].map((n) => {
                    const Icon = n.icon;
                    return (
                      <Command.Item key={n.href} className={item} onSelect={() => go(n.href)}>
                        <Icon className="size-4 text-muted" aria-hidden />
                        <span className="flex-1">{n.label}</span>
                        {"key" in n ? <kbd className="mono text-[11px] text-faint">{n.key}</kbd> : null}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              </Command.List>
            </Command>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
