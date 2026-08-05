import { z } from "zod";

import type { TaxEstimateRequest } from "@/lib/ports/tax-engine";
import type { RuleSetSummary, TaxEstimate } from "@/lib/tax/types";

const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const confirmationStatus = z.enum(["CONFIRMED", "SCHEDULED", "PARTIAL", "UNDETERMINED"]);
const ruleTopic = z.enum(["CAPITAL_GAINS", "STAKING", "AIRDROP", "CRYPTO_TO_CRYPTO", "DEFI_LP", "WRAPPING", "LOSS_OFFSET"]);
const countryCode = z.enum(["DE", "US", "IN", "PT", "GB", "AU", "FR", "IT", "ES", "CA", "JP", "KR"]);
const judgmentGroupSchema = z.enum(["acquire", "income", "taxable", "exempt", "carry", "ignored", "denied", "deferred", "offset", "pending"]);
const judgmentRowSchema = z.object({
  eventId: z.string().min(1),
  at: z.string(),
  asset: z.string(),
  symbol: z.string(),
  quantity: decimalString,
  amount: decimalString,
  amountKind: z.enum(["gain", "cost", "fmv", "carried_cost"]),
  holdingDays: z.number().int().nullable(),
  acquiredAt: z.string().nullable(),
  leg: z.enum(["single", "dispose", "receive"]),
  group: judgmentGroupSchema,
  label: z.string().min(1),
  lots: z.number().int().positive(),
  inPeriod: z.boolean(),
  breakdown: z.object({ proceeds: decimalString, cost: decimalString, fee: decimalString }).optional(),
  basis: z.string(),
});

const topicRuleSchema = z.object({
  topic: ruleTopic,
  status: confirmationStatus,
  basis: z.string().min(1),
  note: z.string().optional(),
});

export const ruleSetSummarySchema: z.ZodType<RuleSetSummary> = z.object({
  code: countryCode,
  label: z.string().min(1),
  currency: z.string().min(1),
  cost_basis: z.string().min(1),
  badge_label: z.string().min(1),
  demoPriority: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
  aggregateAdjustment: z.enum(["offset", "inclusion", "discount", "allowance", "floor", "ignored", "none"]),
  profileFields: z.array(
    z.enum([
      "marginalRatePercent",
      "otherIncome",
      "filingStatus",
      "isBusiness",
      "defiOwnershipTransferred",
      "carriedLosses",
    ]),
  ),
  status: confirmationStatus,
  topics: z.array(topicRuleSchema),
  method: z.string().min(1),
});

export const ruleSetListSchema = z.array(ruleSetSummarySchema);

export const taxEstimateSchema: z.ZodType<TaxEstimate> = z.object({
  country: countryCode,
  countryLabel: z.string().min(1),
  currency: z.string().min(1),
  taxYear: z.number().int(),
  period: z.object({ from: z.string(), to: z.string() }),
  method: z.string().min(1),
  status: confirmationStatus,
  lines: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      amount: decimalString,
      unit: z.enum(["money", "count"]).optional(),
      rate: z.string().optional(),
      basis: z.string().optional(),
    }),
  ),
  totals: z.object({
    taxableGains: decimalString,
    exemptGains: decimalString,
    incomeTotal: decimalString,
    taxableBase: decimalString,
    estimatedCharge: decimalString,
    effectiveRatePercent: decimalString,
  }),
  lossCarryforward: decimalString,
  notes: z.array(z.string()),
  limitations: z.array(
    z.object({
      kind: z.enum(["excluded", "zero_basis", "approximation", "not_reflected", "other"]),
      message: z.string().min(1),
      eventIds: z.array(z.string()),
    }),
  ),
  openQuestions: z.array(
    z.object({
      topic: ruleTopic,
      status: confirmationStatus,
      reason: z.string().min(1),
      affectedEventIds: z.array(z.string()),
      benchmark: z.string().optional(),
    }),
  ),
  requiredInputs: z.array(z.string()),
  excludedEventIds: z.array(z.string()),
  provenance: z.literal("mock"),
  judgments: z.array(judgmentRowSchema),
  marginalContributions: z.record(z.string(), decimalString).optional(),
});

export const taxEstimateRequestSchema: z.ZodType<TaxEstimateRequest> = z.object({
  country: z.string().min(2),
  taxYear: z.number().int().min(2009).max(2100),
  source: z.enum(["scenario", "wallet"]),
  profile: z
    .object({
      marginalRatePercent: decimalString.optional(),
      otherIncome: decimalString.optional(),
      filingStatus: z.enum(["SINGLE", "JOINT"]).optional(),
      isBusiness: z.boolean().optional(),
      defiOwnershipTransferred: z.boolean().optional(),
      carriedLosses: decimalString.optional(),
    })
    .optional(),
  includeMarginal: z.boolean().optional(),
});
