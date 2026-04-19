export {
  stripAnnotations,
  ensureCanicodeCategories,
  upsertCanicodeAnnotation,
} from "./annotations.js";
export { applyWithInstanceFallback } from "./apply-with-instance-fallback.js";
export {
  applyPropertyMod,
  resolveVariableByName,
} from "./apply-property-mod.js";
export { probeDefinitionWritability } from "./probe-definition-writability.js";
export type { DefinitionWritabilityProbe } from "./probe-definition-writability.js";
export {
  extractAcknowledgmentsFromNode,
  readCanicodeAcknowledgments,
} from "./read-acknowledgments.js";
export { computeRoundtripTally } from "./compute-roundtrip-tally.js";
export { applyAutoFix, applyAutoFixes } from "./apply-auto-fix.js";
export type {
  ApplyAutoFixContext,
  AutoFixIssueInput,
  AutoFixOutcome,
  AutoFixOutcomeIcon,
} from "./apply-auto-fix.js";
export {
  isCanicodeAnnotation,
  removeCanicodeAnnotations,
} from "./remove-canicode-annotations.js";
