# Dad-Chat reference documents

Source documents for the Dad-Chat skills in Weld > Skills (1.65.0).

| File | What it is |
| --- | --- |
| [architecture.md](architecture.md) | The **code** map of a Dad Chat (dad-chat-v2) Perchance project: files, load order, data stores, chat-turn flow, builders, hub flow, editing conventions. |
| [dad-native-format.md](dad-native-format.md) | The **data** spec: character, lore entry, lorebook, world, file envelopes, prompt assembly budgets, authoring rules and the Tavern mapping. Normative for any tool that writes Dad-native files. |

These are copies of the documents kept with the Dad-Chat project. The prompts that Skills builds do not read these files at run time; they carry condensed packs from `src/skills-refs.js` (`dad-layout`, `dad-flow`, `dad-data`, `dad-character`, `dad-lore`, `dad-world`, `dad-rules`, `dad-code-rules`, `dad-hub`, `st-dad-map`).

When the Dad-Chat project changes, replace the copies here and update the packs. `npm test` fails if the packs and these documents stop agreeing on the checked file names, numbers and field names.
