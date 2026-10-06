// Dad Chat starter file templates: the docs folder, the generated Studio module and the Skills references must agree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../src/dad-templates.js');
const D = require('../src/studio-dad.js');
const Refs = require('../src/skills-refs.js');
const C = require('../src/skills-core.js');

const dir = path.join(__dirname, '..', 'docs', 'dad-chat', 'file-templates');
const onDisk = fs.readdirSync(dir).filter(f => /^\d\d-/.test(f)).sort();
assert.equal(T.rows.length, 28);
assert.deepEqual(T.rows.map(r => r.file), onDisk, 'module and docs folder list the same files');
for (const r of T.rows) {
  assert.equal(r.text, fs.readFileSync(path.join(dir, r.file), 'utf8').replace(/\r\n/g, '\n'), r.file + ' matches the docs copy');
  assert.ok(r.label && r.direction && r.group, r.file + ' has metadata');
  assert.ok(!/(api[_-]?key|token|secret|password|bearer)\s*["']?\s*:(?!\s*"\[redacted\]")/i.test(r.text), r.file + ' must not carry credentials');
}
assert.equal(new Set(T.rows.map(r => r.file)).size, T.rows.length);
assert.ok(Object.isFrozen(T.rows) && T.byFile['01-dad-char.json'].label);

// Every JSON template parses, and Studio recognises the shapes the generator says it reads.
for (const r of T.rows.filter(r => r.file.endsWith('.json'))) {
  const raw = JSON.parse(r.text);
  if (r.detect) assert.equal(D.detect(raw).kind, r.detect, r.file + ' detect kind');
}
// Dad-native files must obey the Dad-native rules the templates describe.
const character = JSON.parse(T.byFile['01-dad-char.json'].text).data;
assert.ok(character.description.length <= 2000 && character.systemPrompt && character.description !== character.systemPrompt);
for (const e of Object.values(character.lorebook)) {
  assert.equal(e.scanDepth, null);
  assert.ok(e.keys.length >= 3 && e.keys.length <= 6 && e.keys.every(k => k === k.toLowerCase()));
}
for (const key of ['lorebookArchive', 'lastLoreRun', 'useCount', 'lastInjectedAt', 'favorite', 'folder']) assert.ok(!(key in character), key + ' is runtime/backup only');
const chat = JSON.parse(T.byFile['02-dad-char-chat.json'].text).thread;
let node = chat.nodes[chat.rootId], seen = 0;
assert.equal(node.role, 'system-root');
while (node) { seen++; node = node.nextId ? chat.nodes[node.nextId] : null; }
assert.equal(seen, Object.keys(chat.nodes).length, 'thread nodes form one linked list');

// Studio imports the Dad-native templates it advertises as importable.
const file = (name, text) => ({ name, size: text.length, type: '', text: async () => text, arrayBuffer: async () => Buffer.from(text) });
(async () => {
  for (const name of ['01-dad-char.json', '02-dad-char-chat.json', '04-dad-world.json', '05-lorebook-dad-native.json', '09-tavern-v2.json', '12-st-world-info.json', '19-dad-user-profile.json']) {
    const plan = await D.readFile(file(name, T.byFile[name].text));
    assert.ok(plan.items.length >= 1, name + ' imports at least one item');
  }
  const txt = await D.readFile(file('chat.txt', T.byFile['17-chat-transcript-stripped.txt'].text));
  assert.ok(txt.items.some(i => i.kind === 'session'), 'stripped transcript imports as a chat');

  // Skills: the reference packs name every template file type and parse where they hold JSON.
  for (const id of ['dad-file-index', 'dad-file-chat', 'dad-file-interop', 'dad-file-weld']) assert.ok(Refs.byId[id], id);
  for (const word of ['dad-char-chat', 'dad-full', 'dad-world', 'dexie', 'JanitorAI', 'World Info', 'Cloud Backup', 'transcript', 'hub publish']) {
    assert.ok(Refs.packs.filter(p => /^dad-file/.test(p.id)).some(p => p.text.includes(word)), 'packs mention ' + word);
  }
  const blocks = Refs.byId['dad-file-chat'].text.match(/^\{[\s\S]*?^\}/gm) || [];
  const parsed = JSON.parse(blocks[0]);
  assert.equal(parsed.type, 'dad-char-chat'); assert.equal(parsed.version, 2);
  assert.equal(D.detect(parsed).kind, 'dad-char-chat');
  for (const id of ['dad-file-validate', 'dad-file-chat', 'dad-file-backup', 'dad-file-convert', 'dad-weld-wire']) {
    const p = C.get(id);
    assert.ok(p && p.category === 'dad' && p.refs.length >= 2 && p.example.length > 80, id);
    assert.match(C.buildPrompt(id), /PROJECT CONTEXT: DAD-CHAT/);
  }
  assert.equal(C.get('dad-weld-wire').mode, 'change');
  for (const id of ['dad-file-validate', 'dad-file-chat', 'dad-file-backup', 'dad-file-convert']) assert.equal(C.get(id).mode, 'review');
  assert.match(C.buildPrompt('dad-file-backup'), /replaces everything/);
  console.log('dad-templates tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
