"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { Bell } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import type { NotificationDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { useSession } from "../session";
import { cn } from "../ui/primitives";

export function Notifications() {
  const session = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ notifications: NotificationDTO[]; unread: number }>("/api/notifications"),
    enabled: session.status === "authenticated",
    refetchInterval: 30_000,
  });
  const markAll = useMutation({
    mutationFn: () => api("/api/notifications", { method: "POST", json: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  if (session.status !== "authenticated") return null;
  const unread = q.data?.unread ?? 0;
  return (
    <Popover.Root onOpenChange={(o) => !o && unread > 0 && markAll.mutate()}>
      <Popover.Trigger
        className="relative grid size-10 place-items-center rounded-[10px] border border-line bg-surface text-muted hover:text-text"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 ? (
          <span className="tnum absolute -right-1 -top-1 min-w-5 rounded-full bg-cyan px-1 text-center text-[11px] font-semibold leading-5 text-cyan-ink">{unread}</span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="hull z-50 w-[340px] max-w-[calc(100vw-24px)] p-2">
          <p className="px-2.5 pb-2 pt-1.5 text-sm font-semibold">Payment updates</p>
          {q.data && q.data.notifications.length === 0 ? (
            <p className="px-2.5 pb-3 text-sm text-muted">Status changes of your payments appear here.</p>
          ) : null}
          <ul className="max-h-[360px] space-y-1 overflow-y-auto">
            {q.data?.notifications.map((n) => (
              <li key={n.id}>
                <Popover.Close asChild>
                  <Link href={n.link ?? "/history"} className={cn("block rounded-[10px] px-2.5 py-2 hover:bg-surface-3", !n.readAt && "bg-surface-2")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{n.title}</span>
                      <span className="text-[11px] text-faint">{relativeTime(n.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted">{n.body}</span>
                  </Link>
                </Popover.Close>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
