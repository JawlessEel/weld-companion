# DadChat file templates

> MAINTENANCE RULE: these templates shadow the code. Any change to an
> import/export shape, a converter (`forge-core.js` / `forge-bridge.js` /
> `PngUtils`), the transcript builder, the user-profile or cloud-backup
> format, or a Weld wire shape must update the matching template(s) in the
> SAME pass — then re-verify (`ForgeCore.tolerantParse` + `detectType`, plus
> the round-trip checks in this README's table).

Copy-paste starters for **every file shape DadChat writes and reads**, so work
done outside the generator (Claude, Codex, scripts) intakes and outputs
correctly. Files are prefixed in intake/output groups:

| # | File | Direction | detectType | Notes |
|---|---|---|---|---|
| 01 | `dad-char.json` | EXPORT (option 2) + IMPORT | `dad-char` | Master character shape. Dad-native. |
| 02 | `dad-char-chat.json` | EXPORT (option 3) + IMPORT | `dad-chat` | Character + one thread. Restores both. |
| 03 | `dad-full.json` | EXPORT (option 4) + IMPORT | `dad-full` | Whole backup. Wipes + restores. Backup-only fields kept. |
| 04 | `dad-world.json` | World Studio ⬇ Dad-native + IMPORT | `dad-world` | Lossless world file. |
| 05 | `lorebook-dad-native.json` | Lore tab ⬇ DadChat + IMPORT | `lorebook` | Character-lorebook export (fmt 1). Entries = array. |
| 06 | `lorebook-standalone.json` | Standalone ⬇ Export + IMPORT | `lorebook` | Linked-book export. Has `lorebookId`. |
| 07 | `lore-entry.json` | AUTHORING fragment | — (one entry) | Single entry schema used in 01/04/05/06. |
| 08 | `tavern-v1.json` | IMPORT only (flat card) | `tavern-v1` | Legacy flat shape. Never author exports in this. |
| 09 | `tavern-v2.json` | EXPORT PNG-card payload + IMPORT | `tavern-v2` | `chara_card_v2`. PNG `chara` chunk holds this (base64). |
| 10 | `forge-character-card.json` | EXPORT Forge & Lore + IMPORT | `tavern-v2` + forge | CCV2 + `extensions.forge` (kind/world_bible/user_persona). |
| 11 | `forge-lorebook-file.json` | EXPORT ⬇ Lorebook + IMPORT | `lorebook` | Dual-cue file: dad keys + `character_book` wrapper. |
| 12 | `st-world-info.json` | IMPORT (lore tab + Studio) | `lorebook` | SillyTavern World Info: `entries` is an OBJECT. |
| 13 | `ccv2-book.json` | IMPORT (lore tab + Studio) | `lorebook` | Bare CCV2 book: `entries` is an ARRAY. |
| 14 | `janitorai-array.json` | IMPORT (lore tab) | `array` → JanitorAI branch | Top-level array. Lore-tab importer checks arrays first. |
| 15 | `dexie-perchance.json` | IMPORT (character) | `dexie` | Perchance-AI dexie export. |
| 16 | `generic-chatlog.json` | IMPORT (Studio → AI build) | `chatlog` | `{messages:[{role,name,content}]}` transcript source. |
| 17 | `chat-transcript-stripped.txt` | EXPORT (options 5/7) | — (text) | Default: no header, neutral filename `transcript_YYYY-MM-DD_HH-MM.txt`, UTF-8 BOM. |
| 18 | `chat-transcript-header.txt` | EXPORT variant (`header:true`) | — (text) | Same turns + title block + footer link. |
| 19 | `dad-user-profile.json` | Profile ⬇/⬆ `.UserProfile.json` | — | `{type:"dad-user-profile"}`. Avatar https-only on import. |
| 20 | `cloud-backup.json` | Cloud Backup mirror file | — | `{app,exported,count,items[]}` ≤200 msgs, text ≤2000 chars. |
| 21 | `storyforge-characters.json` | Story Forge ZIP part | — | ZIP also holds `*_World.png`, `*_Name.png`, `worldbook.json` (= 04), `README.txt`. |
| 22 | `dad-char-hub.json` | Hub publish payload | `dad-char` | `{type:"dad-char",version:3.0,timestamp,data,meta}`. Card bodies live in per-user editable files. |
| 23–27 | `weld-*.json` | Weld Skybridge wire shapes | — | `ai` request/result, `modelInfo` result, storage link record, bus envelope. |
| 28 | `vault-snapshot.json` | Vault chat copy (Weld storage) | — | `{v:1, at, protocol, generator, folder, savedBy, name, kind:"dad-full", size, redacted, data:{…}}` at `weld:genvault:<generator>/chat/snap-<at>-<rand6>`. `redacted` (a count of redacted secret values) is OPTIONAL: some generators omit it. The tag in the example is a placeholder; every generator stamps its own. |
| 29 | `vault-generator-copy-bundle.json` | Vault generator copy, bundle shape | — | `{v, at, protocol, generator, folder, savedBy, title, bundle:{name,imports,code}, source:{apiUrl,fetchedAt,bytes,truncated,reason,coverage}}` at `weld:genvault:<generator>/snapshot`. Covers the lists panel and imports only. |
| 30 | `vault-generator-copy-modeltext.json` | Vault generator copy, modelText shape | — | `{v, at, protocol, generator, folder, savedBy, title, modelText, outputTemplate, srcManifest}` at the same key. A different generator may write this shape instead of 29; readers must accept both. |
| 31 | `vault-chat-index.json` | Vault chat index | — | Array of `{name, key, takenAt, threadCount, charCount}` at `weld:genvault:<generator>/chat/index`. |

## Rules for anything you build (human or AI)

- **Dad-native is the master.** Tavern/CCV2/Forge shapes are share-only
  opt-ins and drop data. Author 01/04/05/06/07, convert to the rest.
- **Text is data.** Card/lore text is never evaluated. Only `{{char}}` /
  `{{user}}` are substituted at prompt time. No code, no other placeholders.
- **Lore entries** (see 07): 3–6 lowercase keys, distinct across entries;
  `scanDepth: null` = global (correct default, never author 50);
  `constant` ≤ 2 per book; content ≤ ~45 words; real names, never `Entry 3`.
- **`description` (short bio, ≤2000 chars) ≠ `systemPrompt` (persona body).**
  Never paste the persona into the bio.
- **Share-sanitized vs backup:** exports strip `favorite`, `folder`,
  `lorebookArchive`, `lastLoreRun`, `lorebookRefs` (flattened to the effective
  book), and per-entry `useCount`/`lastInjectedAt`. Full Backup (03) keeps them.
- **Validate:** paste any JSON file into World Studio → Import → Parse & Route,
  or run `ForgeCore.tolerantParse(text)` + `ForgeCore.detectType(obj)` in the
  console — expected values are in the table above.
- **Weld:** prompts go up, completions come down; keys never cross. Results are
  data (`{ok, …}`), never exceptions. With no companion, storage falls back
  (kv → persist → memory) and `ai` reports `{ok:false, reason}`.
