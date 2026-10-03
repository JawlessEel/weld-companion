# AGENTS.md

Shared instructions for every AI coding agent in this repo (Codex, Claude Code,
Gemini, Grok, opencode, Copilot).

## Project

Weld Companion: a browser userscript (Tampermonkey / Violentmonkey) that adds
features to any perchance.org generator. It relies on undocumented Perchance
internals, so every feature must be feature-detected and fail soft. Never break
the host page.

- `weld-companion.user.js` is the installable script. Users auto-update from
  the raw GitHub URL in `@updateURL`, so whatever lands on `main` ships.
- `src/studio-*.js` (Studio), `src/project-*.js` (Project tab) and `src/dev-*.js`
  (Dev tab) are copied into the userscript between `/* BEGIN GENERATED STUDIO */`
  ... `/* END GENERATED STUDIO */` and the matching `PROJECT` and `DEV` markers by
  `npm run build`. Edit `src/`, then build. Don't hand-edit the generated blocks.
- `bridge/weld-bridge.js` is the local MCP bridge for AI agents (Node, no
  dependencies; `npm run bridge`). It binds to 127.0.0.1 only and its token lives in
  `bridge/.weld-bridge.json` (git-ignored). Never log the token, put it in a state
  export (`bridge` is in `STATE_SECRET_KEYS`), or let an agent edit the editor
  without a diff review: `weld_propose_edit` only queues a proposal.
- `weld-page/` and `weld-skybridge/` hold Perchance generator code (not plain JS).
  Personal generator backups live in the separate `perchance_backups` repo, not here;
  don't add generator folders to this repo. Guides are in `docs/`.
- Remotes: `origin` = JawlessEel fork (push here); `upstream` =
  therealwestninja/weld-companion (read-only; send changes as PRs from a branch).

## Rules

- Read the surrounding code and its callers before editing; the userscript is
  one large file with shared state.
- Don't remove existing features, settings, storage keys or code paths unless
  asked. Flag dead-looking code instead.
- Storage keys (`GM_setValue`, IndexedDB names) are a compatibility contract with
  installed users. Don't rename them without a migration.
- Secrets: the GitHub token (`weldCompanion:ghToken`) and AI keys must never be
  exported, logged, or sent anywhere except the service they belong to.
- Bump `@version` (and the README badge) when you change the shipped script.
- Keep Perchance-specific syntax intact in generator files; it isn't plain JS.

## Verify

```powershell
npm run check   # stale-bundle check + node --check + all tests (same as CI)
npm test
```

CI (`.github/workflows/test.yml`) runs `npm run check` on every push and PR.
Say plainly when a change was not tried in a real userscript manager.

## Git

Don't push to `main`, force-push, or commit unless the user asks. Preserve
uncommitted work you didn't make.
