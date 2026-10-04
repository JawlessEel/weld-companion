# Project tab: read, check and export any generator

Available in Weld → **Project**, starting with userscript **1.57.0**.

The Project tab works on the generator you are looking at. Before 1.57.0 the Companion could only read source from the editor panes of a generator you were editing. Now it can also read the **published** lists panel, HTML panel and imports of any public generator, then analyze, export and track it.

## Where the source comes from

| Button | Source | Network |
|---|---|---|
| **Analyze editor (live)** | The two editor panes, including unsaved edits. Opens automatically when you open the tab on an `#edit` page. | none |
| **Fetch published + imports** | Perchance's public `getGeneratorsAndDependencies` (lists panel plus the whole import tree) and `getGeneratorHtml` (HTML panel). | two GET requests |

A copy of every analyzed generator is kept in this browser (IndexedDB `weldCompanionProjects`), so reopening the tab shows the last copy immediately. These copies and the snapshots are not part of the Library's full state export; only the small import-review baselines (`projDeps:<slug>`) and the starred-change baselines (`projSeen`) are. **Search saved generators → Forget all saved generators** deletes them; **Snapshots → Delete all snapshots** deletes the history. Nothing is uploaded anywhere.

If Perchance marks a generator private, the tab says so and asks before putting its source into an AI request. Exports and the AI helper always treat a published copy as another author's work.

## Findings

The analyzer reads the lists panel the way Perchance does (indentation, `[blocks]`, `{curly}` shorthand, odds, imports, functions) and the HTML panel (scripts, ids, inline handlers). It is heuristic: a finding is a prompt to look, not a verdict. Severity is **warning** for things that usually break at runtime and **note** for things worth knowing.

Warnings: names that resolve to nothing, a list mentioned before the last statement of a block (a silent no-op), `if/else` sharing a block with other statements, a stored selection that re-randomizes when reused (`.evaluateItem` missing), duplicate list names, empty lists, mixed tab/space indentation, unclosed `[`, ambiguous bare element access, shadowed browser-member access, duplicate IDs with detected consumers, HTML inside a `[block]` in the HTML panel, Perchance template-parser traps inside scripts, insecure `http://` addresses, and inline handlers calling functions that do not exist. ID/list name overlaps alone and duplicate IDs without detected consumers are informational flow checks.

Notes: unused lists and imports (they may still be used by generators that import this one), duplicate items, malformed odds, a missing `$meta` or `output`, and `root.X` names that nothing defines.

When only the lists panel is loaded, unresolved names are downgraded to notes because the HTML panel may define them. On a real corpus of public generators the analyzer reports no warnings for working code; the tests in `tests/project-core.test.js` show each rule firing on a synthetic positive case.

Click a finding or an outline row to jump to that line in the editor (needs the **live** copy).

**Send findings to Perchance AI** sits beside **Ask AI about these** and puts every warning and error, including findings hidden by the filter or **Show more**, directly into the native Perchance AI helper input. It opens the helper, preserves any existing draft, and asks it to inspect the current source, fix confirmed problems, check for false alarms, preserve existing behavior, and verify the live preview. Press the native **Send** button when ready. It does not use Weld's Tools workspace or call a provider. The button requires the editor (`#edit`) and at least one warning or error. An explicit native handoff stays native even if Weld's optional provider interception is enabled. **Ask AI about these** remains available for a general review in Weld's workspace.

With **Perchance built-in** selected in Tools, **Ask selected model** also puts the prepared request into the native helper input. External and local providers continue to use Weld's review workspace.

Each native Perchance AI reply has a **Copy reply** button. It copies that reply's text with paragraph and code formatting, independently of the preview's busy overlay. If the browser blocks clipboard access, Weld tries its fallback and reports failure instead of claiming success.

## Scope-aware findings (1.59.1)

An element ID sharing a list name is an **informational flow check**, not proof of a collision. Explicit DOM lookups can coexist with same-named list data. Bare access to element properties such as `species.value` is still flagged when both a list and element exist; verify its intended target before changing it.

Repeated IDs are **warnings** when a detected single-element lookup (`document.getElementById` or `document.querySelector`), template reference, label, ARIA reference or fragment link consumes that ID. Without detected consumers, they are **notes**. CSS and `querySelectorAll` can intentionally match multiple elements. Duplicate IDs still violate uniqueness; dynamic or external consumers may be missed, so notes do not prove safety.

Weld warns about bare browser-member access such as `location.reload()` when a same-named list or element could shadow it. `window.location.reload()` explicitly selects the browser API. Detected local declarations and function/arrow parameters exclude unrelated uses; strings, comments and regex literals are not lookup evidence. These checks are conservative lexical heuristics, not a complete JavaScript scope/type analysis. Destructuring, computed selectors and expressions inside template literals are not fully resolved.

Inline handlers writing a name detected only as a module-private declaration receive a warning unless there is a detected classic-script or Perchance data interface. This does **not** flag classic global `let`/`const` bindings merely because they are lexical; module bindings have different visibility.

After manually verifying a finding, an optional HTML comment can suppress one rule and subject, for example:

```html
<!-- weld-ignore: duplicate-id scratchpad-bar -->
```

Supported rules: `duplicate-id`, `id-collision`, `browser-global-shadow`, `implicit-element-ref`, `inline-module-write`. Suppressions apply only to matching HTML findings. No blanket ignore or automatic suppressions are added. Project displays the number hidden; `analysis.json` retains their evidence in `suppressedFindings`, including the suppression line. Revisit a suppression if consumers or behavior change.

## Estimates and sampling

**About N distinct outputs** multiplies choices through references and sums over items, ignoring odds. It is marked *rough* when imports or dynamic parts could not be counted.

**Sample the output** calls the generator's own `update()` N times (5 to 200) inside its sandbox frame and reads each result, then reports repeats, length spread, and the repeats you would expect from the list sizes. It can run on a hidden copy of the published generator or on the visible preview. It refuses chat generators, asks first if the generator uses AI, web or upload plugins, and does not touch stored data. Do not use it on generators whose `update()` has side effects. This runs in the generator's frame, so it needs the userscript manager to run the Companion in frames (the default).

## Imports and drift

The tree shows every generator pulled in, its size and last-edit time, flags cycles and missing imports, and highlights heavy imports. After you load the tree once, later loads compare each import against what you last reviewed and show **changed / new / removed**. **Mark imports as reviewed** resets the baseline. This is the early warning for a plugin changing under your generator.

## Assets, hosts and storage

Lists every external address in the HTML panel grouped by host, external scripts and stylesheets, and where the generator keeps data (`localStorage`, `sessionStorage`, `kv` stores, IndexedDB names, cookies). **Check links** sends one anonymous (no cookies) request per address after you confirm the host list, and labels each OK, DEAD, BLOCKED or UNREACHABLE. A userscript manager may ask you to allow each site once.

## Export and AI context

- **ZIP bundle**: `dsl.txt`, `html.html`, `README.md` (overview and findings), `manifest.json`, `analysis.json`, and `imports/<name>.txt` for every dependency. File names are sanitized; the archive uses only stored (uncompressed) entries and opens in any extractor.
- **Markdown**, **DSL**, **HTML**: single files.
- **AI context pack**: a prompt-ready summary (counts, findings, list outline, import sizes, the lists panel, and the HTML panel or, when it is too large, a structural map of ids, functions, `root.*` use, storage and hosts) sized to a character budget you choose. In **Tools → AI Helper**, the context menu now also offers *Summary + findings + source* and *Only the code I selected*, and shows an estimate of the tokens a request will use. Nothing is sent until you press Ask, and replies still go through the existing diff-before-apply review.

## Snapshots

Each analysis whose source differs from the last copy saves a snapshot (newest 20, at most 8 MB per generator). Repeated live analyses within five minutes replace each other. **Compare** diffs a snapshot against what is loaded; **Restore** writes it into the editor through CodeMirror's own undoable transaction (you still press Save).

## Starred generators

**Check for changes** reads the last-edited time of your starred generators from Perchance's public stats and marks the ones that changed since you last marked them seen. The first check records a baseline.

## Development

Sources: `src/project-core.js` (pure logic, no DOM) and `src/project-ui.js`. `npm run build` copies them into the userscript between `/* BEGIN GENERATED PROJECT */` and `/* END GENERATED PROJECT */`, next to the Studio block. Tests:

    node tests/project-core.test.js      analyzer, estimates, dependencies, export, ZIP, context pack
    node tests/project-ui.test.js        every Project tab workflow against a fake DOM and fake API
    node tests/project-sample.test.js    the in-frame sampling op against stubs

Not covered by automated tests: the sampling op inside a real Perchance sandbox frame, and behaviour in a real userscript manager. The tab was exercised in a browser with the built script, real IndexedDB and Perchance's live API through a local shim.
