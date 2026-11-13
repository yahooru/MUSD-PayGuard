export const SITE = {
  name: "MUSD PayGuard",
  tagline: "Check before you send.",
  description:
    "A transaction-safety and payment-verification layer for MUSD on Mezo. PayGuard checks the recipient, network, token, balance and duplicates before you sign, then verifies the on-chain receipt before calling a payment confirmed.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://musd-payguard.vercel.app",
};
