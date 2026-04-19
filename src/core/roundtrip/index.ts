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
