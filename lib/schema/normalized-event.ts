import { z } from "zod";

const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const classificationSchema = z.enum([
  "RECEIVE",
  "SEND",
  "EXCHANGE",
  "INTERNAL_TRANSFER",
  "UNKNOWN",
]);

export const normalizedEventSchema = z
  .object({
    id: z.string().min(1),
    tx_hash: z.string().min(1),
    chain_id: z.number().int().positive(),
    log_index: z.number().int().nonnegative(),
    block_timestamp: z.string().datetime(),
    wallet_address: z.string().min(1),
    direction: z.enum(["IN", "OUT"]),
    asset_type: z.enum(["NATIVE", "ERC20", "ERC721", "ERC1155"]),
    asset_contract: z.string().nullable(),
    token_id: z.string().nullable(),
    decimals: z.number().int().nonnegative(),
    raw_amount: decimalString,
    counterparty: z.string().min(1),
    gas_fee_native: decimalString,
    classification: classificationSchema,
    confidence: z.number().min(0).max(1),
    user_override: z
      .object({
        classification: classificationSchema,
        reason: z.string().nullable(),
        overridden_at: z.string().datetime(),
      })
      .nullable(),
    price_status: z.enum(["RESOLVED", "UNKNOWN", "ESTIMATED"]),
    fiat_value: decimalString.nullable(),
    fiat_currency: z.string().min(1),
  })
  .superRefine((event, ctx) => {
    if (event.price_status === "UNKNOWN" && event.fiat_value !== null) {
      ctx.addIssue({ code: "custom", path: ["fiat_value"], message: "UNKNOWN prices require a null fiat_value" });
    }
    if (event.price_status !== "UNKNOWN" && event.fiat_value === null) {
      ctx.addIssue({ code: "custom", path: ["fiat_value"], message: "Resolved prices require a fiat_value" });
    }
  });

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type Classification = z.infer<typeof classificationSchema>;
