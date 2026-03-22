// Main entry point

export const VERSION = "0.1.0";

// Contracts (types and schemas)
export * from "./core/contracts/index.js";

// Core analysis engine
export * from "./core/index.js";

// Rules (must be imported to register with registry)
export * from "./core/rules/index.js";

// Adapters for Figma API
export * from "./core/adapters/index.js";

// Calibration agents
export * from "./agents/index.js";
