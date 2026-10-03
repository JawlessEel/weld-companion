# Generator skills

Open **Weld → Skills** on a Perchance generator. The catalog contains 48 presets in eight categories:

| Category | Presets |
| --- | --- |
| Debug & repair | Find & fix bugs; triage analyzer findings; repair controls; generation failures; async races; imports/assets |
| Design & modernize | Modern interface; mobile layout; themes; navigation; loading feedback; motion |
| Add features | Custom feature; settings; history/favorites; copy/downloads; batches; search/filters |
| AI & media | Prompt quality; AI chat; image gallery; AI recovery; prompt presets; media previews |
| Data & persistence | Remember settings; session recovery; import/export; storage audit; validation; collections |
| Performance & reliability | Bottleneck audit; speed; memory leaks; large result sets; startup; request coordination |
| Accessibility & quality | Accessibility; input/privacy review; safe rendering; workflow checks; output variety; browser compatibility |
| Code & planning | Explain code; refactor; upgrade roadmap; feature planning; documentation; release review |

## Run a skill

1. Open the generator editor (`#edit`) and its native AI helper.
2. Choose a preset. Search and category filters narrow the catalog; favorites are saved locally as preset IDs.
3. Add your goal, constraints or reproduction steps. **Build my feature** and **Plan a new feature** need a specific goal.
4. Optionally enable **Include live findings**, then select **Build prompt**. This reads the current editor through Weld's existing adapter and performs fresh analysis. Findings are heuristics; the prompt asks the helper to validate them. Rebuild if the editor changes.
5. Review or edit **Instructions to send**. Changes to goal/findings settings disable handoff until you rebuild so they cannot silently be omitted. Rebuilding or choosing another preset replaces your edited prompt.
6. Select **Send to Perchance AI**. Weld opens the native helper, appends the prompt to any existing draft, verifies the input retained it and focuses the input. It does not submit the request.
7. Review the helper input and press its **Send** button to run the skill. The native helper controls its own code edits and execution; Weld does not apply a proposal or guarantee model behavior.

**Copy prompt** uses the same editable instructions and works without the editor. Clipboard failure is reported with a manual-copy fallback. Unavailable native input produces an actionable error in Skills; there is no silent fallback to an unrelated model or window.

## Scope and persistence

Each preset identifies **Review only** or **Makes changes**. Review prompts request evidence and recommendations without edits. Implementation prompts request the smallest complete change, preserved features/storage, verified integration points and honest validation. These are AI instructions, not enforcement of the helper's behavior.

Weld does not transmit source, findings or prompts while you browse this tab. Optional analysis is local. The handoff writes only to the native input; sending through the helper uses Perchance's AI service. No additional provider setup is required.

Favorites persist through Weld storage and contain only catalog IDs. Search, selection, goal and edited prompt are kept in memory for the page session. Changing generators clears the goal, findings option and draft so instructions for one generator are not reused accidentally. Reloading clears session drafts. No credentials or API settings are included in prompts.

## Development

Edit `src/skills-core.js` (catalog and pure prompt composition) and `src/skills-ui.js` (interface), then run `npm run build` and `npm run check`. The generated `SKILLS` block belongs to the build. Native helper internals are feature-detected by the shared `openPerchanceAI` adapter; live validation and installation in a userscript manager are separate checks.
