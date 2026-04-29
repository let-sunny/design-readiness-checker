---
"canicode": patch
---

Adopt [Changesets](https://github.com/changesets/changesets) for release
notes. New `CHANGELOG.md` (Keep a Changelog format) backfilled from
v0.11.5 through v0.12.3 with curated user-facing entries; per-PR detail
remains on the GitHub Releases page. New `CONTRIBUTING.md` documents the
`pnpm changeset` flow, and `release.yml` gains a tag-vs-package-version
verify step so a stale `package.json` never publishes under a fresh tag.
No runtime changes — bundled SKILLs, MCP server, and CLI behaviour are
unchanged.
