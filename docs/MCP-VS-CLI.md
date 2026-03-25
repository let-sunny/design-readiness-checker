# canicode Analysis: MCP vs CLI Comparison Report

## Overview

This report documents a side-by-side comparison of analyzing the same Figma design using two different canicode (v0.8.2) analysis paths:

1. **MCP path** — Using the official Figma MCP server (`get_metadata` + `get_design_context`) to retrieve design data, then passing it to canicode's `analyze` tool via MCP.
2. **CLI path** — Using `npx canicode analyze <figma-url> --json` which fetches data directly from the Figma REST API.

### Test Subject

- **File**: `Untitled`
- **Node**: `127:2` (Frame 2)
- **URL**: `https://www.figma.com/design/KVCLAjaqxDqJw8e7H5YgIe/Untitled?node-id=127-2`
- **Structure**: A parent frame (`Frame 2`, red background `#b21e1e`) containing a child frame (`Frame 3`, white background `#ffffff`) with 10px padding.

---

## Results Comparison

### Scores

| Category | MCP | CLI | Match |
|----------|-----|-----|-------|
| **Overall** | C (67%) | C (67%) | Yes |
| Structure | 100% | 100% | Yes |
| Token | 21% | 21% | Yes |
| Component | 100% | 100% | Yes |
| Naming | 24% | 24% | Yes |
| Behavior | 100% | 100% | Yes |

### Issue Counts

| Category | MCP | CLI | Match |
|----------|-----|-----|-------|
| **Total Issues** | **5** | **6** | **No** |
| Token issues | 2 | 3 | No |
| Naming issues | 2 | 2 | Yes |
| Structure issues | 1 | 1 | Yes |

### Issues by Rule

| Rule | MCP | CLI | Match |
|------|-----|-----|-------|
| `raw-color` | **1** | **2** | **No** |
| `inconsistent-spacing` | 1 | 1 | Yes |
| `default-name` | 2 | 2 | Yes |
| `unnecessary-node` | 1 | 1 | Yes |

---

## Root Cause of Discrepancy

The difference comes down to **one missed `raw-color` issue** in the MCP path.

### What happened

The Figma MCP's `get_design_context` tool generates React + Tailwind reference code as its output. During this code generation, Figma's server performs its own color mapping:

| Node | Original Figma Fill | MCP Code Output | CLI Raw Data |
|------|---------------------|-----------------|--------------|
| Frame 2 (127:2) | `#b21e1e` | `bg-[#b21e1e]` | `#b21e1e` |
| Frame 3 (127:3) | `#ffffff` | `bg-white` | `#ffffff` |

The critical transformation: **`#ffffff` was converted to the Tailwind utility class `bg-white`** by Figma's code generation layer.

### Why this matters

When canicode analyzes the MCP-provided code:
- `bg-[#b21e1e]` — contains a raw hex value → flagged as `raw-color`
- `bg-white` — is a named Tailwind color, not a raw hex → **not flagged**

When canicode analyzes via CLI (direct Figma REST API):
- `#b21e1e` — raw hex → flagged as `raw-color`
- `#ffffff` — raw hex → **flagged as `raw-color`**

The Figma MCP's code generation layer effectively "sanitized" the white color before canicode could evaluate it, causing a false negative.

---

## Data Flow Comparison

### MCP Path

```
Figma Design
  → Figma MCP get_metadata (XML structure)
  → Figma MCP get_design_context (React + Tailwind code)
     ⚠️  Color mapping happens here (#ffffff → bg-white)
  → canicode analyze (designData + designContext)
  → Result: 5 issues
```

### CLI Path

```
Figma Design
  → Figma REST API (raw node data with original fill values)
  → canicode analyze (direct from API response)
  → Result: 6 issues
```

---

## Key Takeaway

| | MCP Path | CLI Path |
|-|----------|----------|
| **Data source** | Figma MCP (code generation layer) | Figma REST API (raw data) |
| **Accuracy** | May miss issues due to intermediate transformations | More accurate — analyzes original design values |
| **Token required** | No (uses MCP server auth) | Yes (`FIGMA_TOKEN` required) |
| **Convenience** | Integrated into AI coding workflows | Standalone, CI/CD friendly |
| **Best for** | Quick checks during development | Authoritative audits and reports |

### Recommendation

- Use **CLI** when you need the most accurate and complete analysis — especially for audits, CI pipelines, or generating reports.
- Use **MCP** for quick feedback during development workflows where convenience matters and minor discrepancies are acceptable.
- Be aware that **any intermediate code generation layer** (Figma MCP, design-to-code tools) may transform raw design values before canicode sees them, potentially masking token-related issues.

---

*Report generated on 2026-03-22 using canicode v0.8.2*
