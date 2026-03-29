# Privacy Policy

**Last updated:** 2026-03-29

CanICode is an open-source CLI tool that analyzes Figma design structures. This document explains what data is collected, how it is used, and how to opt out.

## Data We Collect

CanICode includes optional, pseudonymous telemetry to help us understand usage patterns and improve the tool. The following events are tracked via PostHog analytics:

| Event | When it fires |
|-------|---------------|
| `cic_analysis_started` | An analysis run begins |
| `cic_analysis_completed` | An analysis run finishes successfully |
| `cic_analysis_failed` | An analysis run encounters an error |
| `cic_report_generated` | An HTML report is generated |
| `cic_comment_posted` | A comment is posted to Figma via the API |
| `cic_comment_failed` | A Figma comment post fails |
| `cic_mcp_tool_called` | An MCP server tool is invoked |
| `cic_cli_command` | A CLI command is executed |
| `cic_cli_init` | The `canicode init` command is run |

Each event may include metadata such as node count, issue count, grade, and error messages. Error tracking is handled via Sentry for crash reports and stack traces.

## Data We Do NOT Collect

- **No design data.** We never send Figma file contents, node trees, screenshots, or any design information.
- **No tokens or credentials.** Figma API tokens and other secrets are never transmitted to our servers.
- **No personally identifiable information (PII).** We never collect names, emails, or account information. See [Pseudonymous Tracking](#pseudonymous-tracking) below for details on how each channel identifies sessions.
- **No file contents.** HTML reports, config files, and analysis results stay on your machine.
- **No IP-based tracking.** We do not attempt to correlate analytics data with IP addresses or locations.

## Pseudonymous Tracking

Telemetry uses **pseudonymous identifiers** that vary by channel. These allow us to understand usage patterns (e.g., how many sessions a device generates) but cannot identify you personally.

| Channel | Identifier | How it works | Persistence |
|---------|-----------|--------------|-------------|
| **CLI** | Random UUID | Generated once via `randomUUID()`, stored in `~/.canicode/config.json` | Persists across sessions on the same machine |
| **MCP Server** | Random UUID | Same device ID as CLI (shared config file) | Same as CLI |
| **Figma Plugin** | Hashed Figma user ID | FNV-1a hash of `figma.currentUser.id` → `"fp-XXXXXXXX"` | Consistent per Figma account |
| **Web App** | `"anonymous"` | Fixed string, no device or user identification | None — truly anonymous |

**What this means:**
- For CLI/MCP: we can see that "the same device" ran multiple analyses, but we cannot link this to a person, email, or account. Deleting `~/.canicode/config.json` resets the identifier.
- For Figma Plugin: we can see that "the same hashed ID" used the plugin across sessions. FNV-1a is a non-cryptographic hash, but Figma user IDs have sufficient entropy to make practical reversal infeasible.
- For Web App: all users share the same identifier — we see only aggregate counts.

## How to Opt Out

Disable telemetry entirely with a single command:

```bash
canicode config --no-telemetry
```

When telemetry is disabled, no data is sent to PostHog or Sentry. All monitoring functions become silent no-ops.

You can re-enable telemetry at any time:

```bash
canicode config --telemetry
```

Telemetry status is stored in your local config file at `~/.canicode/config.json`.

## Local Data

CanICode stores data locally on your machine:

| Location | Contents |
|----------|----------|
| `~/.canicode/config.json` | User configuration (Figma token, telemetry preference) |
| `~/.canicode/reports/` | Generated HTML analysis reports (default; override with `--output`) |
| `logs/calibration/` | Calibration run data — each run in its own directory (internal/development use) |
| `logs/rule-discovery/` | Rule discovery run data (internal/development use) |
| `logs/activity/` | Nightly orchestration logs (internal/development use) |

No local data is uploaded or shared unless you explicitly choose to do so.

## Figma API Usage

CanICode interacts with the Figma API **only when you provide a Figma API token**. When used:

- **Fetching design data:** The token is used to retrieve file structure and node metadata from the Figma REST API. This data is processed locally and never forwarded to third parties.
- **Posting comments:** When you click a "Comment on Figma" button in an HTML report, the token is used to post an analysis finding as a comment on the specific Figma node. This is an explicit, user-initiated action.

Your Figma token is stored locally in `~/.canicode/config.json` and is never sent to CanICode servers or any third party.

## Third-Party Services

| Service | Purpose | Data sent |
|---------|---------|-----------|
| [PostHog](https://posthog.com/) | Product analytics | Pseudonymous event names and metadata (node count, issue count, grade) |
| [Sentry](https://sentry.io/) | Error tracking | Pseudonymous crash reports and stack traces |

Both services receive only pseudonymous, non-PII data. No design content, tokens, or personal identity is ever included. See [Pseudonymous Tracking](#pseudonymous-tracking) for how identifiers work per channel.

## Data Retention

- **PostHog:** Event data is retained according to PostHog's standard data retention policies. Since identifiers are pseudonymous and contain no PII, data cannot be linked to individual users.
- **Sentry:** Error reports are retained according to Sentry's standard retention policies (typically 90 days).
- **Local data:** Data stored on your machine persists until you delete it. Uninstalling CanICode does not remove `~/.canicode/` -- delete it manually if desired.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last updated" date at the top of this document and committed to the repository.

## Contact

- **Bug reports and questions:** [GitHub Issues](https://github.com/let-sunny/canicode/issues)
- **Repository:** [github.com/let-sunny/canicode](https://github.com/let-sunny/canicode)
