import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import type {
  Rule,
  RuleConfig,
  RuleContext,
  RuleId,
  RuleViolation,
} from "../contracts/rule.js";
import { supportsDepthWeight } from "../contracts/rule.js";
import { ruleRegistry } from "../rules/rule-registry.js";
import { RULE_CONFIGS } from "../rules/rule-config.js";

/**
 * Analysis issue with calculated score and metadata
 */
export interface AnalysisIssue {
  violation: RuleViolation;
  rule: Rule;
  config: RuleConfig;
  depth: number;
  maxDepth: number;
  calculatedScore: number;
}

/**
 * Information about a rule that threw during analysis
 */
export interface RuleFailure {
  ruleId: string;
  nodeName: string;
  nodeId: string;
  error: string;
}

/**
 * Analysis result from the rule engine
 */
export interface AnalysisResult {
  file: AnalysisFile;
  issues: AnalysisIssue[];
  failedRules: RuleFailure[];
  maxDepth: number;
  nodeCount: number;
  analyzedAt: string;
}

/**
 * Options for the rule engine
 */
export interface RuleEngineOptions {
  configs?: Record<RuleId, RuleConfig>;
  enabledRules?: RuleId[];
  disabledRules?: RuleId[];
  targetNodeId?: string;
  excludeNodeNames?: string[];
  excludeNodeTypes?: string[];
}

/**
 * Calculate the maximum depth of a node tree
 */
function calculateMaxDepth(node: AnalysisNode, currentDepth = 0): number {
  if (!node.children || node.children.length === 0) {
    return currentDepth;
  }

  let maxChildDepth = currentDepth;
  for (const child of node.children) {
    const childDepth = calculateMaxDepth(child, currentDepth + 1);
    if (childDepth > maxChildDepth) {
      maxChildDepth = childDepth;
    }
  }

  return maxChildDepth;
}

/**
 * Count total nodes in a tree
 */
function countNodes(node: AnalysisNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

/**
 * Find a node by ID in the tree
 */
function findNodeById(node: AnalysisNode, nodeId: string): AnalysisNode | null {
  // Figma node IDs use ":" separator, URL uses "-"
  const normalizedId = nodeId.replace(/-/g, ":");

  if (node.id === normalizedId) {
    return node;
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, nodeId);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Calculate depth weight multiplier for a rule
 * Higher values (closer to 1.5x) at root level, 1.0x at leaf level
 */
function calcDepthWeight(
  depth: number,
  maxDepth: number,
  depthWeight?: number
): number {
  if (!depthWeight || depthWeight <= 1) return 1;
  if (maxDepth === 0) return depthWeight;

  // Linear interpolation: depthWeight at depth 0, 1.0 at maxDepth
  const ratio = depth / maxDepth;
  return depthWeight - (depthWeight - 1) * ratio;
}

/**
 * Rule engine for analyzing Figma files
 */
export class RuleEngine {
  private configs: Record<RuleId, RuleConfig>;
  private enabledRuleIds: Set<RuleId> | null;
  private disabledRuleIds: Set<RuleId>;
  private targetNodeId: string | undefined;
  private excludeNamePattern: RegExp | null;
  private excludeNodeTypes: Set<string> | null;

  constructor(options: RuleEngineOptions = {}) {
    this.configs = options.configs ?? RULE_CONFIGS;
    this.enabledRuleIds = options.enabledRules
      ? new Set(options.enabledRules)
      : null;
    this.disabledRuleIds = new Set(options.disabledRules ?? []);
    this.targetNodeId = options.targetNodeId;
    this.excludeNamePattern = options.excludeNodeNames && options.excludeNodeNames.length > 0
      ? new RegExp(`\\b(${options.excludeNodeNames.join("|")})\\b`, "i")
      : null;
    this.excludeNodeTypes = options.excludeNodeTypes && options.excludeNodeTypes.length > 0
      ? new Set(options.excludeNodeTypes)
      : null;
  }

  /**
   * Analyze a Figma file and return issues
   */
  analyze(file: AnalysisFile): AnalysisResult {
    // Fresh per-analysis state — eliminates module-level mutable state in rules
    const analysisState = new Map<string, unknown>();

    // Find target node if specified
    let rootNode = file.document;
    if (this.targetNodeId) {
      const targetNode = findNodeById(file.document, this.targetNodeId);
      if (!targetNode) {
        throw new Error(`Node not found: ${this.targetNodeId}`);
      }
      rootNode = targetNode;
    }

    // Calculate max depth before analysis
    const maxDepth = calculateMaxDepth(rootNode);
    const nodeCount = countNodes(rootNode);

    const issues: AnalysisIssue[] = [];
    const failedRules: RuleFailure[] = [];
    const enabledRules = this.getEnabledRules();

    // Traverse the tree and run rules on each node
    this.traverseAndCheck(
      rootNode,
      file,
      enabledRules,
      maxDepth,
      issues,
      failedRules,
      0,
      [],
      [],
      0,
      analysisState,
      undefined,
      undefined
    );

    return {
      file,
      issues,
      failedRules,
      maxDepth,
      nodeCount,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Get rules that should be run based on configuration
   */
  private getEnabledRules(): Rule[] {
    return ruleRegistry.getAll().filter((rule) => {
      const ruleId = rule.definition.id as RuleId;

      // Check if explicitly disabled
      if (this.disabledRuleIds.has(ruleId)) return false;

      // Check if we have an explicit enable list
      if (this.enabledRuleIds && !this.enabledRuleIds.has(ruleId)) return false;

      // Check config enabled status
      const config = this.configs[ruleId];
      return config?.enabled ?? true;
    });
  }

  /**
   * Recursively traverse the tree and run rules
   */
  private traverseAndCheck(
    node: AnalysisNode,
    file: AnalysisFile,
    rules: Rule[],
    maxDepth: number,
    issues: AnalysisIssue[],
    failedRules: RuleFailure[],
    depth: number,
    path: string[],
    ancestorTypes: string[],
    componentDepth: number,
    analysisState: Map<string, unknown>,
    parent?: AnalysisNode,
    siblings?: AnalysisNode[]
  ): void {
    const nodePath = [...path, node.name];

    // Reset componentDepth at component boundaries
    const isComponentBoundary = node.type === "COMPONENT" || node.type === "COMPONENT_SET" || node.type === "INSTANCE";
    const currentComponentDepth = isComponentBoundary ? 0 : componentDepth;

    // Skip nodes matching excluded types or name patterns
    if (this.excludeNodeTypes && this.excludeNodeTypes.has(node.type)) {
      return;
    }
    if (this.excludeNamePattern && this.excludeNamePattern.test(node.name)) {
      return;
    }

    // Build context for this node
    const context: RuleContext = {
      file,
      parent,
      depth,
      componentDepth: currentComponentDepth,
      maxDepth,
      path: nodePath,
      ancestorTypes,
      siblings,
      analysisState,
    };

    // Run each rule on this node
    for (const rule of rules) {
      const ruleId = rule.definition.id as RuleId;
      const config = this.configs[ruleId];
      const options = config?.options;

      try {
        const violation = rule.check(node, context, options);

        if (violation) {
          // Calculate score with depth weight if applicable
          let calculatedScore = config.score;

          if (
            supportsDepthWeight(rule.definition.category) &&
            config.depthWeight
          ) {
            const weight = calcDepthWeight(depth, maxDepth, config.depthWeight);
            calculatedScore = Math.round(config.score * weight);
          }

          issues.push({
            violation,
            rule,
            config,
            depth,
            maxDepth,
            calculatedScore,
          });
        }
      } catch (error) {
        // Track failure and continue — never let one rule break the whole analysis
        failedRules.push({
          ruleId,
          nodeName: node.name,
          nodeId: node.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Recurse into children
    if (node.children && node.children.length > 0) {
      const childAncestorTypes = [...ancestorTypes, node.type];
      for (const child of node.children) {
        this.traverseAndCheck(
          child,
          file,
          rules,
          maxDepth,
          issues,
          failedRules,
          depth + 1,
          nodePath,
          childAncestorTypes,
          currentComponentDepth + 1,
          analysisState,
          node,
          node.children
        );
      }
    }
  }
}

/**
 * Create a rule engine with default configuration
 */
export function createRuleEngine(options?: RuleEngineOptions): RuleEngine {
  return new RuleEngine(options);
}

/**
 * Convenience function to analyze a file with default settings
 */
export function analyzeFile(
  file: AnalysisFile,
  options?: RuleEngineOptions
): AnalysisResult {
  const engine = createRuleEngine(options);
  return engine.analyze(file);
}
