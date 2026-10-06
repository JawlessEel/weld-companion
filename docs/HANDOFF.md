# Handoff: Skybridge bridge and Dev tooling

Last updated: 2026-10-06. Read `AGENTS.md` first; it is the rulebook. This file is a snapshot of where work stands, not a rule source. Claims are marked VERIFIED (seen in this repo or its output) or UNVERIFIED.

## State of the fork

- Fork `JawlessEel/weld-companion`, branch `main` at `8730527` ("pair the token automatically and add a hidden login autostart (1.67.0)"), VERIFIED on 2026-10-06.
- `origin` and `upstream` (`therealwestninja/weld-companion`) are both configured as of 2026-10-06. `main` is 56 commits ahead of and 1 behind `upstream/main`.
- Trial merge of `upstream/main` into `main` (aborted, nothing committed) hit 18 conflicts, mostly add/add. The one upstream-only commit (`aa68ab5`, PR #7, a squash of an earlier snapshot of this fork's own Dev/Skills/Studio work) differs from the fork mostly by lines the fork added later. Do not plain-merge it; decide between recording it with `git merge -s ours upstream/main` or leaving it.
- Not run yet by the person writing this: `npm install`, `npm run build`, the tests.
- Many feature branches exist on origin (`codex/*`, `feat/*`, `fix/*`, `pr/*`). Which are merged or stale is unchecked.

## How the generator side connects (VERIFIED from the plugin's source, v1.4.1)

- A generator imports `weld-skybridge-plugin` and must CALL `root.weldSkybridge()` once; an import alone never runs it.
- The plugin sends `hello` to the top frame; the companion answers `here` with protocol range and capabilities. Highest shared protocol wins.
- A capability-less `here` is presence only; the plugin re-handshakes (fixed in plugin 1.4.1).
- Capabilities seen advertised by this companion (reported by a helper's live probe, UNVERIFIED here): storage, ai, fetch, search, model, bus.
- Consent is the companion's job: per capability, per generator. Secrets never cross the bridge.
- Debug: `weld.skybridge.diagnostics()`, `weld.skybridge.debug(true)`, or `?sbdebug` in the URL.

## Things worth checking in this repo

- Which code answers the skybridge `hello` in `weld-companion.user.js`, and whether the capability list and `anchorVersion` it reports match what generators see.
- Whether `weld-skybridge/` (plugin source copies here) matches the live plugin (v1.4.1, build `sb-plugin/2026-06-25.2`).
- Whether the consent prompt can be reset or inspected per generator from the Weld UI; a denied or never-shown consent looks like "standalone" to a generator.
- `bridge/install-autostart.ps1` and `start-bridge.cmd` start the local agent bridge on Windows. It is a different channel from the browser skybridge handshake; don't conflate them.

## Open items

1. Decide how to handle the upstream squash commit (see above) and which branches to keep.
2. Run install/build/tests on a clean checkout and record the results here.
3. Confirm the skybridge responder behavior above with a real browser session.

## Update this file

Keep it short. Replace stale lines rather than appending. Log nothing secret (bridge token, GitHub token, AI keys).
