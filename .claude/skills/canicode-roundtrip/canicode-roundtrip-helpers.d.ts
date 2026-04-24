/**
 * Editor-only ambient types for the bundled roundtrip IIFE global (#473).
 * Figma's plugin sandbox never loads this file; it exists so agents and humans
 * get autocomplete when authoring `use_figma` batches in a TypeScript-aware
 * editor. Signatures are intentionally loose (`unknown`) — tighten against
 * `src/core/roundtrip/*.ts` when a surface changes.
 *
 * Optional: `/// <reference path="./canicode-roundtrip-helpers.d.ts" />` at the
 * top of a scratch `.ts` file next to pasted batch code (path relative to that file).
 */

type CicUnknown = unknown;
type CicRecord = Record<string, CicUnknown>;

/** Public surface registered by `helpers.js` / installer + bootstrap eval. */
interface CanICodeRoundtripGlobal {
  stripAnnotations(annotations: readonly CicUnknown[]): CicUnknown[];
  ensureCanicodeCategories(): Promise<CicRecord>;
  upsertCanicodeAnnotation(node: CicRecord, input: CicRecord): boolean;
  applyWithInstanceFallback(
    question: CicRecord,
    writeFn: (target: CicRecord) => CicUnknown,
    context?: CicRecord,
  ): Promise<CicRecord>;
  applyPropertyMod(
    question: CicRecord,
    answerValue: CicUnknown,
    context?: CicRecord,
  ): Promise<CicRecord>;
  resolveVariableByName(name: string): Promise<CicRecord | null>;
  probeDefinitionWritability(questions: readonly CicRecord[]): Promise<CicRecord>;
  extractAcknowledgmentsFromNode(
    node: CicRecord,
    canicodeCategoryIds?: ReadonlySet<string>,
  ): CicRecord[];
  readCanicodeAcknowledgments(
    rootNodeId: string,
    categories?: CicRecord,
  ): Promise<CicRecord[]>;
  computeRoundtripTally(args: CicRecord): CicRecord;
  applyAutoFix(issue: CicRecord, context: CicRecord): Promise<CicRecord>;
  applyAutoFixes(issues: readonly CicRecord[], context: CicRecord): Promise<CicRecord[]>;
  isCanicodeAnnotation(annotation: CicRecord, categories: CicRecord): boolean;
  removeCanicodeAnnotations(
    annotations: readonly CicUnknown[],
    categories: CicRecord,
  ): CicUnknown[];
}

declare global {
  var CanICodeRoundtrip: CanICodeRoundtripGlobal;
}

export {};
