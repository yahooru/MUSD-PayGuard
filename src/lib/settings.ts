import { z } from "zod";

/** User preferences. Stored server-side per wallet; defaults favour safety. */
export const settingsSchema = z.object({
  security: z
    .object({
      /** Require ticking "I compared the full address" on every review. */
      confirmFullAddress: z.boolean().default(true),
      /** Above this many MUSD, the review requires typing the last 4 characters of the address. "0" disables. */
      largePaymentThreshold: z
        .string()
        .regex(/^\d{1,9}(\.\d{1,2})?$/, "Use a whole number of MUSD, optionally with 2 decimals")
        .default("100"),
      /** Use public on-chain history from the Mezo explorer for lookalike detection. */
      useExplorerHistory: z.boolean().default(true),
    })
    .default({ confirmFullAddress: true, largePaymentThreshold: "100", useExplorerHistory: true }),
  notifications: z
    .object({
      confirmed: z.boolean().default(true),
      failed: z.boolean().default(true),
      delayed: z.boolean().default(true),
    })
    .default({ confirmed: true, failed: true, delayed: true }),
});

export type Settings = z.infer<typeof settingsSchema>;

export function parseSettings(raw: unknown): Settings {
  const r = settingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : settingsSchema.parse({});
}
