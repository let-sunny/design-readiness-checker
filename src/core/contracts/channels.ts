import { z } from "zod";

/**
 * #402 shared output-channel vocabulary.
 * Detection stays rule-based; output channel and persistence intent vary by
 * consumer payload (score/transient vs annotation/durable).
 */
export const DetectionSchema = z.literal("rule-based");
export const OutputChannelSchema = z.enum(["score", "annotation"]);
export const PersistenceIntentSchema = z.enum(["transient", "durable"]);

export type Detection = z.infer<typeof DetectionSchema>;
export type OutputChannel = z.infer<typeof OutputChannelSchema>;
export type PersistenceIntent = z.infer<typeof PersistenceIntentSchema>;

/**
 * #406 rule purpose classification.
 * - `violation`: score-primary. Node is violating a best-practice expectation;
 *   fixing the violation removes the rule fire. Gotcha question is secondary
 *   context about how to resolve the violation.
 * - `info-collection`: annotation-primary. Node is not necessarily "wrong,"
 *   but implementation-critical context is absent from Figma (e.g. click
 *   target, interaction states). Gotcha question is the primary output;
 *   score impact is intentionally minimal (typically -1 or 0).
 *
 * Detection stays `rule-based` in both cases — see ADR-017.
 */
export const RulePurposeSchema = z.enum(["violation", "info-collection"]);
export type RulePurpose = z.infer<typeof RulePurposeSchema>;
