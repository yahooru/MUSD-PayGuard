import { BadgeCheck, CodeXml, LayoutDashboard, LifeBuoy, ReceiptText, ScrollText, Send, Settings, ShieldCheck, Users } from "lucide-react";

/** The four destinations used most on a phone; everything else lives behind "More". */
export const MOBILE_TABS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/send", label: "Send", icon: Send },
  { href: "/requests", label: "Requests", icon: ReceiptText },
  { href: "/history", label: "History", icon: ScrollText },
] as const;

export const APP_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, key: "g d" },
  { href: "/send", label: "Send MUSD", icon: Send, key: "g s" },
  { href: "/requests", label: "Payment requests", icon: ReceiptText, key: "g r" },
  { href: "/recipients", label: "Recipients", icon: Users, key: "g c" },
  { href: "/history", label: "History", icon: ScrollText, key: "g h" },
  { href: "/security", label: "Security Centre", icon: ShieldCheck, key: "g x" },
  { href: "/settings", label: "Settings", icon: Settings, key: "g ," },
] as const;

export const SECONDARY_NAV = [
  { href: "/verify", label: "Verify a payment", icon: BadgeCheck },
  { href: "/developers", label: "Developers", icon: CodeXml },
  { href: "/help", label: "Help", icon: LifeBuoy },
] as const;
