# Generator layout and flow (companion to dad-native-format.md)

`dad-native-format.md` is the **data** spec (what a character / lore entry /
world must look like). This file is the **code** map: which files exist, what
each one owns, and how a chat turn flows through them.

## 1. Top-level files

| File | Role |
|---|---|
| `main.pjs` | Plugin imports (`kv`, `generateText`, `image`, `uploadPlugin`, `superFetchPlugin`, `createServerSocket`, `weldSkybridge`, comments `forum`), tuning knobs (`chatToCardMaxMessages = 40`, `chatToCardMaxCast = 6`), theme helpers (`themeStyle`, `forumSubmitStyle`), the public-gallery iframe builder (`galleryEmbedHtml`), `$meta` (title/desc/image/tags), and `commentOptions`. No app logic. |
| `index.html` | Two jobs: (a) the **hub server** — the first `<script type="text/x-server-plugin">` block (card index, ratings, authors, regions presence; runs authoritatively via `server-plugin`, code is public); (b) the app shell — DOM layout, first-paint CSS, then the `src/*.js` scripts in load order (§2). |
| `src/manifest.json` | PWA manifest (name, icons, theme color). Display only. |
| `src/styling.css` | All app CSS. The loading-screen block is duplicated inline in `index.html` for first paint — keep the copies in sync. |

## 2. Script load order (`index.html`, bottom)

Order matters — later files call into earlier ones via `window.*`:

1. `src/pjs-globals.js` — bridges perchance `root.*` imports to `window.*` (`kv`, `generateText`, `image`, `uploadPlugin`, `superFetchPlugin`); `ensureLib`/`ensureCss` lazy loaders; `escHtml`; `pjsLiteral` (must wrap **every** `root.image({prompt})` — the image plugin evaluates prompts as Perchance templates).
2. `src/weld-bridge.js` — optional Weld Companion link (pill + popover indicator, presence). Fully additive.
3. `src/agent-core.js` — VFS tool definitions + arg sanitizers for the chat agent (`window.DadAgentCore`).
4. `src/code-viewer.js`, `src/providers.js` — provider/model catalog (`window.Dad_PROVIDER_GROUPS`: builtin, cloud, hubs, local runtimes).
5. `src/on-device-webgpu.js` — WebGPU model download manager (Profile modal card).
6. Small UI modules: `src/diag.js`, `src/theme-customizer.js`, `src/i18n.js`, `src/secret-vendor.js`, `src/reminder-presets.js`, `src/prefix-styles.js`, `src/persona-dropdown.js`, `src/avatar-generator.js`, `src/tokenizer.js`, `src/regions.js`, `src/image-link.js` helpers, `src/forge-core.js` (Dad-native normalize/repair), `src/forge-bridge.js` (Dad-native ↔ Tavern/Forge conversion + download).
7. `src/henry-tucker.js` — built-in soft preset data (persona, greetings, lore, world bible). Seeded on demand, never force-injected.
8. `src/image-forge.js` — `window.ImageForge`: world/style prompt prepend + AI-crafted negative + CFG. Wraps every image call.
9. **`src/app.js`** (~2.4 MB) — the app itself: state, chat engine, prompt assembly, render, persistence, import/export, hub client, all modals.
10. Studios (depend on `app.js` globals): `src/forge-studio.js` (`window.WS` — World Studio: worlds/entries editor, import, AI build), `src/story-forge.js` (`window.StoryForge` — world/character extraction from text), `src/scene-cast.js` (`window.SceneCast` — characters-from-scene), `src/immersive.js` (voice/SFX/scene image/directors; injects into history).
11. `src/gen-vault.js` — `window.Vault` + `window.openVault()` (generator-source + named `dad-full` snapshots under `weld:genvault:<generator>/`). Last script: it reuses `app.js` live bindings and `weld-bridge.js` storage/bus, so it loads after both.

CDN libs (`lucide`, `marked`, `DOMPurify`, `highlight.js`, `katex`) load eagerly; heavy libs (d3, pdf.js, CropperJS, wllama) lazy-load via `ensureLib` at first use.

## 3. Data model (where things live)

- `config.characterBook[id]` — character objects (§1 of the format doc). Authority store for cards.
- `config.worldBook.worlds[id]` + `activeWorldId` — worlds; description always injects, entries are ranked.
- Standalone lorebooks + `lorebookRefs[]` — linked books, merged after embedded lore.
- Threads → nodes (`threads`, `currentThreadId`) — chat history as a branch tree; renderer walks the **active branch only** (`getRenderPath`).
- `thread.*` settings (`authorNote`, `proseDirector`, `detachFromOrigin`, `userDescOverride`, per-thread toggles) override app/character defaults.
- Persistence: live session in `localStorage`; `kv.chatApp` for slots/index metadata; ImageDB blobs + per-thread VFS workspaces live outside slots; optional Cloud Backup mirrors the last 200 messages to a public editable upload file.

## 4. Chat-turn flow (the path every reply takes)

1. **Input** — `handleSend()` (app.js): composer text + attachments + `@Name` guest summons (`resolveTurnSummonId` — narration/impersonation use the *guest's* persona + lorebook, not the host's).
2. **Prompt assembly** (`MemoryEngine.buildHistory`, same builders the diagnostics viewer runs, so preview == real prompt):
   1. pre-instructions (preset/custom + tone) — FIXED, always sent;
   2. character persona (+ player `userDesc`) — FIXED, always sent (every char paid every turn — cost control lives here);
   3. dynamic context: world block → matched lore (`[WORLD/LORE DATABASE]`, ≤ 6,656 chars, world desc ≤ 50%) → manual memory → summaries → retrieved memories → pinned;
   4. recent chat turns, then steering (reminder, density, ledger, author's note, prose director, scene state).
   - Lore ranking: keyword gate (threshold 0.9, typo-tolerant) → +0.1/extra key (max 0.3) → priority bonus → constants first → budget fill. Roleplay-gated: ledger/prose blocks skip non-roleplay presets (Dad, Schnell Studio).
3. **Generation** — provider route from `providers.js` (cloud / local runtime / on-device); tools available mid-turn: `web_search` (DDG via `superFetch` → SearXNG fallback), `image_gen` (via ImageForge), VFS file tools (via `agent-core.js`).
4. **Render** — nodes → DOM (`createNodeDOM`), markdown via `marked` + `DOMPurify`, speaker-label stripping (`stripKnownSpeakerLabels` via `getCleanNodeContent`), streaming renderer, collapse, action bars (Illustrate, Send-to-Image-Gen, TTS, rating).
5. **Post-turn** — `Immersive.onTurnComplete` (scene state/beat/preference updates), continuity-ledger updater (roleplay only), `_persistThreads` → debounced Cloud Backup sync, embedding warm-start for vectorized lore.

## 5. Builders (chat → reusable data)

All read only the newest `chatToCardMaxMessages` (40) messages, stripped of provenance (`forge.source:null`, neutral filenames):

- **Character/Cast from Chat** (app.js) — single card or group-cast card (≤ `chatToCardMaxCast` voices); `detachFromOrigin` swaps the origin card for the thread's own canon (author note → ledger → played lore → quoted beats → player sheet).
- **World Studio** (`forge-studio.js`) — world CRUD + entry editor + Tavern/Dad-native import + AI lore build + `exportWorldNative` (`{type:"dad-world"}`).
- **Story Forge** (`story-forge.js`) — places + cast extraction from pasted text/fi­c, portraits, PNG/Tavern export.
- **Scene Cast** (`scene-cast.js`) — scan scene → per-character sheets → `applySheetToChar` (new or update-in-place) + portraits.
- **Export dialog** (`exportData`, app.js) — Dad-native JSON/PNG first (lossless), Tavern V2/CCV2/Forge shapes labelled as lossy share copies; chat transcripts (full / last-40, plain / AI-labelled).
- **Weld Vault** (`src/gen-vault.js`, `window.Vault`) — generator-source + named `dad-full` snapshots under `weld:genvault:<generator>/`, ownership-enforced reads/writes, secret-redacting saves, per-copy download.

## 6. Hub (sharing) flow

Client (`app.js` hub section) ↔ server (`index.html` top script) over `createServerSocket()` RPCs: `hubSearch` / `hubGetCard` / `hubGetAuthor` / `hubRegisterAuthor` / `hubBeginUpload` / `hubRegisterCard` / `hubUpdateCard` / `hubMyCards` / `hubRate` / `hubReport` / `hubDownloaded` / `hubStats` (+ admin/backup). Card bodies live in per-user editable upload files (`bodyUrl`); the server index holds only metadata + ratings + owner keys (never returned). Live region counts ride the ephemeral `dad:regions` pubsub channel (`regions.js` beats every ~30 s).

## 7. Conventions for anyone editing (human or AI)

- `window.*` is the cross-file API; `config` is a top-level `const` (a global lexical, **not** `window.config` — `window.config || {}` guards are always empty).
- Text is data: card/lore text is never evaluated; escape untrusted strings with `escHtml` for HTML and `pjsLiteral` for image prompts; only `{{char}}`/`{{user}}` are substituted at prompt time.
- Debug handles: `window.ProseEngine`, `window.ImageForge`, `window.WS`, `window.StoryForge`, `window.SceneCast`, `window.DadAgentCore`, `window.OnDeviceWebGPU`.
- Verify live: `page_refresh` then `page_eval` the touched path (open/close the modal, run the flow) with zero console + zero `perchanceErrors`. For visual work, snapshot and look.
- Formats ship with examples: any change to an import/export shape, a converter, the transcript builder, or a Weld wire shape must update the matching `src/file-templates/*` template(s) + that README's table, plus `dad-native-format.md` for Dad-native changes — in the same pass, re-verified through `ForgeCore.detectType` and the real converters (see *Agent maintenance rule* in `src/README.md`).
