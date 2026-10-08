# Dad-native format guideline (normative for this app)

**Rule: Dad-native is the master format. Tavern V2/V3 and other
Tavern-family shapes are share-only opt-ins and must never be the
default export for characters, lore, or worlds — they drop data
(see §9).** Imports keep accepting Tavern shapes; only exports are
restricted. Any authoring tool (human, WELD-side, or AI) targeting
this app must emit Dad-native shapes from this file, not Tavern cards.
Working examples of every envelope in §5 (plus all accepted import shapes)
live in `src/file-templates/` — they shadow this spec, so a change here must
update the matching template(s) in the same pass, and vice versa.

All field behavior below is read from the app source
(`src/app.js`, `src/forge-bridge.js`, `src/forge-studio.js`).
`{{char}}` / `{{user}}` are the only placeholders the engine
substitutes (literal replace in `LoreEngine.resolvePlaceholders`
and prompt assembly). Card/lore text is data: it is never evaluated,
and display paths sanitize it. Do not put code, instructions-to-the
reader, or other placeholder styles in these fields.

---

## 1. Character object (`config.characterBook[id]`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique (`char_…`, `char_preset_…`, `char_imported_…`). Never reuse. |
| `name` | string | Display + `{{char}}` value. |
| `avatar` | string (URL/data) | Portrait only; never reaches the model. |
| `description` | string | **Short bio** (UI + `personality` slot on Tavern export). Import caps at 2000 chars. Keep 1–3 sentences. Never paste the persona here. |
| `systemPrompt` | string | **Persona body** — the main character definition sent every turn as FIXED context (always sent, not budget-trimmed). Keep it canon + voice; move world-simulation doctrine to lore/pre-instruction. |
| `profile` | object | Structured fields compiled into `systemPrompt` by the editor: `name, age, gender, appearance, personality, background, scenario, systemNote, customSections[{header, content}]`. Compiled headings: `# Character Profile: {{char}}`, `## Appearance/Personality/Background`, custom `## …`, `## Scenario`, `[SYSTEM NOTE: …]`. |
| `exampleDialogue` | `[{name1,content1,name2,content2}]` | Few-shot voice pairs → `[Example Dialogue]` + `<START>` blocks. Empty list wires nothing. Keep each turn < ~40 words, in-voice. |
| `firstMessage` | string[] | `[0]` = opening greeting; `[1…]` = alternates. Only the active greeting is used per chat. Plot hooks live here, not prompt cost. |
| `userOverride` | `{name, description}` | Player persona appended to the persona block (skipped for non-roleplay presets). |
| `preInstruction` | string | Preset key (`default`, `roleplay`, `roleplay_v2`, `dad_roleplay`, `author_mode`, …) or `"custom"`. Topmost system block, sent before the persona. |
| `preInstructionCustom` | string | Used only when `preInstruction === "custom"`. |
| `reminderMessage` | string | End-of-prompt steering injection (`post_history_instructions` on Tavern export). One focused directive, not a second persona. |
| `authorNote` | string | Late-prompt note layer (config → char → thread). |
| `tags` | string[] | Search/display only. |
| `chatBackground/bgBlur/bgOpacity` | strings | Display only. |
| `lorebook` | `{[entryId]: entry}` | Embedded book (§2). Authority store; merged with linked books at prompt time. |
| `lorebookRefs` | `[{id, enabled}]` | Links to standalone books (§3). Local composition — flattened to the effective book on share exports; kept in backups. |
| `lorebookArchive/lastLoreRun` | local-only | Undo buffers + maintenance metadata. Stripped on every share/profile export. Never author these. |
| `useCount/lastInjectedAt` (per entry) | runtime-only | Usage stamps for the auto-maintainer. Stripped on export. Never author these. |

## 2. Lore entry (single schema everywhere: characters, books, worlds)

```json
{
  "id": "lore_abc123",
  "name": "Bad Luck",
  "keys": ["bad luck", "bay gelding", "horse"],
  "content": "Bad Luck is {{char}}'s swaybacked bay gelding. Patient, stubborn, and smarter than he looks.",
  "priority": 10,
  "constant": false,
  "vectorized": false,
  "enabled": true,
  "excludeRecursion": false,
  "scanDepth": null
}
```

| Field | Type / default | Meaning |
|---|---|---|
| `id` | string | Stable per entry. |
| `name` | string | Human memo; shown as `[Entry: name]` in-prompt. Use real names (`Settlements`), never `Entry 3`. |
| `keys` | string[] | Trigger keywords. **3–6, lowercase, distinct across entries.** Overlap (`nevada` in 3 entries) co-fires entries and burns the 6,656-char lore budget. |
| `content` | string | Lore text, `{{char}}`/`{{user}}` allowed. Template: `Name — role. Fact 1. Fact 2. Voice cue. Constraint.` Target **≤ 45 words** (maintainer context window); authoring cap is 70. |
| `priority` | 1–100, default 10 | Ranking bonus up to +0.5, sorted descending. Higher = wins ties and budget order. `constant` entries always rank top. |
| `constant` | bool, default false | Always inject, bypasses triggers. Reserve for ≤ 2 entries per book. |
| `vectorized` | bool, default false | Opt-in semantic matching (needs embeddings; otherwise keyword gate). |
| `enabled` | bool, default true | `false` = fully skipped, preserved across import/export. |
| `excludeRecursion` | bool, default false | `true` = hidden from recursive discovery. |
| `scanDepth` | number 1–20 or `null` | Per-entry recent-message window override. **`null` = global (4) — the correct default.** Values clamp to 20 on import. Never author 50. |

Ranking recap: keyword gate (threshold 0.9, typo-tolerant) → +0.1 per extra key match (max 0.3) → +priority bonus → constants first → budget fill in rank order (`injected` / `partial` for priority > 80 / `budget_cut`).

## 3. Standalone lorebooks + links

```json
{ "id": "lorebook_abc", "name": "Frontier Pack", "description": "",
  "enabled": true, "entries": { "lore_x": { } }, "updatedAt": 0 }
```

Merge order into the prompt: (1) active world bible + world entries,
(2) character embedded book, (3) attached standalone books in attach
order (first source wins on duplicates). A book contributes only when
the book is enabled AND its link is enabled AND the entry is enabled.
Export of a standalone book is Dad-native already.

## 4. Worlds (`config.worldBook.worlds[id]`)

Store shape: `{ id, name, description, entries: {…same entry schema…} }`
with `config.worldBook.activeWorldId` selecting the live world.
The world **description is always injected** (ahead of entries, capped
at 50% of the lore budget); entries are ranked like character lore and
get the remainder.

Dad-native world **file** (what `⬇ Dad-native world` writes and the
importer reads back):

```json
{ "type": "dad-world", "version": 1, "exportedAt": "…",
  "world": { "id": "…", "name": "…", "description": "…", "entries": {} } }
```

## 5. File envelopes (Dad-native)

| File | Envelope | Contents |
|---|---|---|
| Character profile | `{ type: "dad-char", version: 2, data: {…char…} }` | Full character object (share-sanitized: refs flattened, counters stripped). |
| Character lorebook | `{ version: "2.0", characterId, characterName, exportedAt, entries: […] }` | Entry array, same schema. |
| Standalone lorebook | `{ version: "2.0", lorebookId, lorebookName, characterName, description, enabled, exportedAt, entries: […] }` | Same. |
| World | `{ type: "dad-world", version: 1, exportedAt, world: {…} }` | §4. |
| Chat + character | `{ type: "dad-char-chat", version: 2, character, thread }` | Full backup path (keeps everything). |

## 6. Prompt assembly (what the model actually receives, in order)

1. `preInstructions` (preset/custom + tone) — FIXED, always sent.
2. `characterPersona` (+ player `userDesc`) — FIXED, always sent.
   **Cost control lives here: every persona char is paid every turn.**
3. Dynamic context: world block → matched lore (`[WORLD/LORE DATABASE]`,
   ≤ 6,656 chars) → manual memory → summaries → retrieved memories → pinned.
4. Recent chat turns, then steering injections (reminder, density,
   ledger, author's note, prose director, scene state).

Budgets: lore block 6,656 chars; world description ≤ 50% of it;
global scan depth 4; per-entry `scanDepth` 1–20; chat→card window 40
messages (`chatToCardMaxMessages`); free-tier total 8,000 (oldest chat
trimmed first, curated content never trimmed). The diagnostics viewer
(`DiagnosticEngine.buildDiagnosticHistory`) runs the same builders
with the same production query, so it shows exactly what reaches the
model.

## 7. Authoring rules (characters, lore, worlds)

- Persona (`systemPrompt`): canon + voice + speech patterns.
  Never duplicate the pre-instruction (agency, no-puppet-`{{user}}`,
  consequences, proactive driving) or the lorebook (living world,
  reputation spreads, indifferent frontier) — those are already sent.
- One fact once: nickname etymology, scars with their stories, and
  signature objects belong in exactly one field.
- `description` (bio) ≠ `systemPrompt` (persona). Never leave
  `personality`/`description` empty on Tavern-sourced cards — the
  importer falls back to `creator_notes` as the bio.
- Greetings/first-messages are hooks, not lore: keep them verbatim,
  don't compress plot out of them.
- `mes_example`-style few-shots are voice data: keep exchanges intact;
  trim only repeated stage-direction openers if you must.
- Lore: real entry names; 3–6 unique keys; `scanDepth: null` default;
  `constant` ≤ 2 per book; one spectrum pass per topic (no "small towns
  … / larger towns … / regardless of size" triple-telling).
- Worlds: bible states what every character knows; entries carry the
  rest. A bible with no entries still injects (description always sent).

## 8. Henry Tucker worked reference (18,896-char persona → target)

`description` → `systemPrompt` (+`[Scenario]`+scenario, +`[Examples]`+
`mes_example` = ~25k FIXED chars/turn). Cut order by saving:
`[SYSTEM INSTRUCTION]` (~8k → ~2.5k, de-dupe vs pre-instruction+lore) →
towns entry (5,397 → ~1,800) → merge frontier entries 1+2 (4,481 →
~1,500) → body/clothing/backstory (~42%) → weather/horses/stagecoach
(~50%) → scenario (752 → ~450). Keep greetings + 13 example exchanges
verbatim. Keys: dedupe `nevada/desert/frontier` to one entry each;
`scanDepth: 50` → `null`. Rename `Entry N` → real names.

## 9. Tavern mapping (import-compatible, export-lossy — reference only)

Import (`convertSTtoDad`): `description` → `systemPrompt` (+`[Scenario]`
+`[Examples]` if markers absent); `personality` → bio `description`;
`scenario` → `profile.scenario`; `first_mes`+`alternate_greetings` →
`firstMessage[]`; `system_prompt` → custom pre-instruction;
`post_history_instructions` → `reminderMessage`; `character_book` →
`lorebook` (keys/priority/`scanDepth`→clamped 20); `extensions.forge`
→ user persona / world bible / kind. Dropped with no Dad slot:
`selective`, `probability`, `group*`, `sticky/cooldown/delay/role`,
book-level `scan_depth`, non-forge `extensions.*`.
Export losses (why Tavern stays opt-in): `mes_example` slot always
empty (text survives inside `description`); `lorebookRefs` flattened;
`scanDepth` > 20 clamped; empty `personality` becomes creator-notes bio.
