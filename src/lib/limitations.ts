/** Honest product limitations, shown in the Security Centre, Help and README. */
export const LIMITATIONS = [
  "PayGuard cannot know who controls an address. A valid, saved or previously paid address can still belong to the wrong person.",
  "It cannot reverse a blockchain transfer or stop a transaction after you approve it in your wallet.",
  "Duplicate detection only sees payments recorded in PayGuard and, for router payments, the on-chain invoice registry. Payments made elsewhere are invisible to it.",
  "A successful simulation does not guarantee the real transaction succeeds; state can change before it is mined.",
  "Lookalike detection compares against your saved recipients, your PayGuard history and recent on-chain MUSD transfers from the explorer. It cannot catch an attacker who never touched your history.",
  "Explorer labels are third-party data. PayGuard never invents threat intelligence and never calls an address malicious on its own.",
  "Background verification runs once per day on the free hosting plan; while a payment page is open it is checked every few seconds.",
];
