export type GateTone = "pass" | "warn";

/** The five gates a payment passes in the hero: the preflight, made visible. */
export const HERO_GATES: { label: string; detail: string; tone: GateTone }[] = [
  { label: "Address", detail: "valid, checksum ok", tone: "pass" },
  { label: "Network", detail: "Mezo Testnet 31611", tone: "pass" },
  { label: "Token", detail: "real MUSD contract", tone: "pass" },
  { label: "Balance", detail: "covers amount + fee", tone: "pass" },
  { label: "Duplicate", detail: "INV-0042 paid before", tone: "warn" },
];
