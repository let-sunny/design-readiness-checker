# Contributing to canicode

## Releases & changelog

canicode uses [Changesets](https://github.com/changesets/changesets) to
maintain a curated [`CHANGELOG.md`](./CHANGELOG.md). Every PR that affects
user-visible behaviour (CLI flags, MCP tool shape, SKILL prose, rule
output, bundle contents) needs a changeset.

### Adding a changeset to your PR

```bash
pnpm changeset
```

The interactive prompt asks:

1. Which package(s) bump (we have one — `canicode`)
2. Bump type:
   - `patch` — bug fix, internal refactor that does not change observable
     behaviour, doc-only change. The vast majority of PRs.
   - `minor` — new user-facing capability, additive surface change. New
     rule, new CLI flag, new SKILL section that adds a question shape.
   - `major` — breaking change to a public surface (CLI flag removed/
     renamed, MCP tool shape change consumers must adapt to, SKILL prose
     contract change downstream agents would notice). Until v1, prefer to
     batch breaking changes and call them out explicitly in the changeset
     body.
3. Summary — one or two short sentences. **This becomes the
   `CHANGELOG.md` entry.** Write it from the user's perspective, not as a
   PR title.

The command writes `.changeset/<random-name>.md`. Commit it as part of
the PR.

PRs that need **no** changeset (rare): pure CI / workflow tweaks that do
not ship to npm, README typo fixes, internal log message tweaks. Use
judgement — when in doubt, add a `patch`.

### Releasing

This repo uses **manual releases** to keep the npm publish step
reviewable. The flow:

1. Run `pnpm changeset version` locally — Changesets consumes every
   pending `.changeset/*.md`, bumps `package.json` + `server.json`, and
   appends entries to `CHANGELOG.md`.
2. Open a PR titled `chore: release vX.Y.Z`. Review the diff and merge
   when satisfied.
3. After the merge lands on `main`, tag locally and push:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. The `release.yml` workflow runs on the tag push: it verifies the tag
   matches `package.json` version, builds, runs lint + tests, and
   publishes to npm with provenance.

`canicode-mcp` (the MCP server binary) ships from the same package, so a
single version bump covers both the CLI and the MCP server.

## Code conventions

See [`CLAUDE.md`](./CLAUDE.md) for the full convention guide. The short
version:

- TypeScript strict mode; ESM only; `.js` extension on relative imports.
- Validate external inputs with Zod schemas in `contracts/`.
- Co-located `*.test.ts` files; `vitest` globals available.
- Conventional commit messages (`feat:` / `fix:` / `docs:` / `chore:` /
  `refactor:` / `test:`).

## Releases (CI + provenance)

`npm publish` runs only from CI on tag push (ADR-007). Do **not**
`npm publish` locally. Tag verification ensures the tag matches the
checked-in `package.json` version.
