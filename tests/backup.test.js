// Backup Manager: core inventory/inspection/export plus the shipped UI against a fake host store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/backup-core.js');

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {}; this.style = {}; this.open = false;
    this.disabled = !!attrs.disabled; (children || []).forEach(c => this.appendChild(c));
    if (attrs.onclick) this.events.click = attrs.onclick;
  }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, fn) { this.events[type] = fn; }
  get isConnected() { return true; }
  click() { if (!this.disabled) this.events.click?.(); }
}
const walk = n => [n, ...n.children.flatMap(walk)];
const txt = n => (n.attrs.text || '') + n.children.map(txt).join('');

const SBK = 'weldCompanion:sbk:';
const store = new Map();
const put = (caller, key, value, raw) => store.set(SBK + caller + ':' + key, raw !== undefined ? raw : JSON.stringify(value));
const chat = (gen, at, extra = {}) => Object.assign({ v: 1, at, protocol: 1, generator: gen, folder: gen, savedBy: gen, name: 'Chat ' + at, kind: 'dad-full', size: 100, redacted: 2,
  data: { threads: [{ id: 't1', title: 'Market Week', messages: [{}, {}, {}], characterName: 'Morgana' }], currentThreadId: 't1', config: { apiKey: '[redacted]', model: 'x', webhookUrl: 'https://hooks.example/SECRETVALUE123' } } }, extra);
put('alpha', 'weld:genvault:alpha/snapshot', { v: 1, at: 1700000000000, protocol: 1, generator: 'alpha', folder: 'alpha', savedBy: 'alpha', title: 'Alpha',
  bundle: { name: 'alpha', imports: ['a', 'b'], code: 'x' }, source: { apiUrl: 'u', fetchedAt: 1700000000000, bytes: 10, truncated: true, reason: 'size', coverage: 'lists only' } });
put('alpha', 'weld:genvault:alpha/chat/snap-1700000001000-abc123', chat('alpha', 1700000001000));
put('alpha', 'weld:genvault:alpha/chat/snap-1700000002000-def456', chat('alpha', 1700000002000, { redacted: undefined }));
put('alpha', 'weld:genvault:alpha/chat/index', [{ id: 'snap-1700000001000-abc123' }, { id: 'snap-GONE-zzzzzz' }]);
put('beta', 'weld:genvault:beta/snapshot', { v: 1, at: 1700000005000, protocol: 1, generator: 'beta', folder: 'beta', savedBy: 'beta', title: 'Beta', modelText: 'a\n b', outputTemplate: '<p>', srcManifest: {} });
put('beta', 'weld:genvault:beta/chat/snap-1700000006000-aaaaaa', chat('alpha', 1700000006000));   // owner mismatch
put('beta', 'weld:genvault:beta/chat/snap-1700000007000-bbbbbb', null);                           // tombstone
put('alpha', 'dadchat:vault:index', [{ id: 'old' }]);
put('alpha', 'weld:link-record', { at: 1 });
put('alpha', 'unrelated:key', { keep: true });
put('alpha', 'weld:genvault:beta/snapshot-big', { pad: 'x'.repeat(2.1 * 1024 * 1024) });

// ---- core
assert.deepEqual(C.parseKey('weld:genvault:abc-1/chat/snap-1-xx'), { kind: 'chat-copy', gen: 'abc-1', sub: 'chat/snap-1-xx' });
assert.equal(C.parseKey('weld:genvault:abc/chat/index').kind, 'chat-index');
assert.equal(C.parseKey('weld:genvault:ABC/snapshot').kind, 'other');            // invalid generator name
assert.equal(C.parseKey('dadchat:vault:whatever').kind, 'legacy');
assert.equal(C.inScope('unrelated:key'), false);
assert.equal(C.snapshotShape({ bundle: { code: '' } }), 'bundle');
assert.equal(C.snapshotShape({ modelText: '' }), 'model-text');
assert.equal(C.snapshotShape({ a: 1 }), 'unknown');
assert.deepEqual(C.secretScan({ config: { apiKey: '[redacted]', nested: { Token: 'abc' }, model: 'x', secret: '' } }), [{ path: 'config.nested.Token' }]);
assert.equal(JSON.stringify(C.secretScan({ config: { webhookUrl: 'SECRETVALUE' } })).includes('SECRETVALUE'), false);
const rec = { key: 'weld:genvault:beta/chat/snap-1-a', caller: 'beta', size: 10, value: chat('alpha', 1) };
const rep = C.inspect(rec, { keys: [rec.key] });
assert.ok(rep.anomalies.some(a => /Owner mismatch/.test(a)));
assert.ok(rep.chat.configKeys.includes('apiKey') && !JSON.stringify(rep).includes('SECRETVALUE123'), 'config values must never appear');
assert.ok(!C.inspect({ key: 'weld:genvault:a/chat/snap-1-a', size: 5, value: chat('a', 1, { redacted: undefined }) }, {}).anomalies.some(a => /Missing/.test(a)), 'redacted is optional');
assert.ok(C.inspect({ key: 'weld:genvault:a/snapshot', size: 5, value: { v: 1 } }, {}).anomalies.some(a => /Unknown record shape/.test(a)));
assert.ok(C.inspect({ key: 'weld:genvault:a/snapshot', size: 3 * 1024 * 1024, value: { modelText: 'x' } }, {}).anomalies.some(a => /Oversized/.test(a)));
const ex = C.exportRecord(rec, Date.UTC(2026, 9, 6));
assert.match(ex.filename, /^weld-backup-beta-.*2026-10-06\.json$/); assert.equal(JSON.parse(ex.text).record.key, rec.key);

// ---- envelopes, presence tracker, store-write guard
const now = 1700000000000, beat = (o = {}) => Object.assign({ v: 1, type: 'presence', id: 'tab12345:1', from: 'tab12345', gen: 'alpha', at: now }, o);
assert.equal(C.validateEnvelope('dad-chat:presence', beat(), now).ok, true);
for (const [bad, why] of [[beat({ v: 2 }), 'bad-version'], [beat({ type: 'x' }), 'unknown-type'], [beat({ from: '' }), 'bad-from'], [beat({ id: undefined }), 'bad-id'], [beat({ at: now - 6 * 60000 }), 'bad-time'], [beat({ gen: 5 }), 'bad-gen'], [beat({ gen: 'x'.repeat(3000) }), 'too-large'], ['str', 'not-an-object']])
  assert.equal(C.validateEnvelope('dad-chat:presence', bad, now).reason, why);
assert.equal(C.validateEnvelope('dad:genvault', { v: 1, type: 'vault-updated', generator: 'alpha', at: now, from: 'alpha' }, now).ok, true);
assert.equal(C.validateEnvelope('dad:genvault', { v: 1, type: 'vault-updated', at: now }, now).reason, 'bad-generator');
assert.equal(C.validateEnvelope('other:channel', 'anything', now).known, false, 'unknown channels are not judged');
const pt = C.presenceTracker();
assert.equal(pt.observe(beat(), now), true); assert.equal(pt.observe(beat(), now), false, 'duplicate id ignored');
pt.observe(beat({ from: 'tab99999', id: 'tab99999:1' }), now); pt.observe({ junk: 1 }, now);
assert.deepEqual(pt.snapshot(now), { tabs: { alpha: 2 }, ignored: 2 });
pt.observe(beat({ type: 'presence-bye', id: 'tab12345:2' }), now); assert.deepEqual(pt.snapshot(now).tabs, { alpha: 1 });
assert.deepEqual(pt.snapshot(now + 61000).tabs, {}, 'peers expire after ~60s of silence');
assert.equal(C.checkStoreWrite('weld:genvault:alpha/snapshot', { generator: 'beta' }).reason, 'owner-mismatch');
assert.equal(C.checkStoreWrite('weld:genvault:alpha/snapshot', { generator: 'alpha' }).ok, true);
assert.equal(C.checkStoreWrite('weld:genvault:alpha/chat/snap-1-a', null).ok, true, 'tombstones pass');
assert.equal(C.checkStoreWrite('', {}).reason, 'bad-key'); assert.equal(C.checkStoreWrite('free:form', { generator: 'x' }).ok, true);

// ---- the shipped vault templates validate with the inspector (both generator-copy shapes, redacted optional)
{
  const T = require('../src/dad-templates.js'), tpl = f => JSON.parse(T.byFile[f].text);
  const g = (key, value) => C.inspect({ key, caller: 'example-generator', size: 10, value }, { keys: [key] });
  const gt = (key, value) => C.inspect({ key, caller: 'dad-chat-sync', size: 10, value }, { keys: [key] });
  // the generator's own combined template: its chat copy and generator copy validate under ITS tag, and the truncated pointer is a known shape
  const own = tpl('28-vault-snapshot.json');
  assert.deepEqual(gt('weld:genvault:dad-chat-sync/snapshot', own.generatorCopy.record).anomalies, []);
  assert.deepEqual(gt('weld:genvault:dad-chat-sync/chat/snap-1720000000000-abc123', own.chatCopy.record).anomalies, []);
  const ptr = Object.assign({}, own.generatorCopy.record, { bundle: null, source: Object.assign({}, own.generatorCopy.record.source, { truncated: true, reason: 'over cap' }) });
  assert.deepEqual([gt('weld:genvault:dad-chat-sync/snapshot', ptr).shape, gt('weld:genvault:dad-chat-sync/snapshot', ptr).anomalies], ['bundle-pointer', []]);
  assert.deepEqual(g('weld:genvault:example-generator/snapshot', tpl('29-vault-generator-copy-bundle.json')).anomalies, []);
  assert.deepEqual(g('weld:genvault:example-generator/snapshot', tpl('30-vault-generator-copy-modeltext.json')).anomalies, []);
  assert.equal(g('weld:genvault:example-generator/snapshot', tpl('29-vault-generator-copy-bundle.json')).shape, 'bundle');
  assert.equal(g('weld:genvault:example-generator/snapshot', tpl('30-vault-generator-copy-modeltext.json')).shape, 'model-text');
  const t28 = tpl('28-vault-snapshot.json'), chatTpl = t28.chatCopy.record, noCount = Object.assign({}, chatTpl); delete noCount.redacted;
  for (const v of [chatTpl, noCount]) assert.deepEqual(gt('weld:genvault:dad-chat-sync/chat/snap-1720000000000-abc123', v).anomalies, []);   // redacted is optional
  assert.deepEqual(C.indexRefs(tpl('31-vault-chat-index.json')), ['weld:genvault:example-generator/chat/snap-1720000000000-abc123']);
}

// ---- a sibling generator's own records (dad-chat): chat folder stamped ".../chat/", modelText generator copy, no redacted count
{
  const sib = (gen, at) => ({ chat: { v: 1, at, protocol: 1, generator: gen, folder: 'weld:genvault:' + gen + '/chat/', savedBy: gen, name: 'chats-1', kind: 'dad-full', size: 5, data: { threads: {}, currentThreadId: null, config: { pollinationsApiKey: '[redacted]' } } },
    gen: { v: 1, at, protocol: 0, generator: gen, folder: 'weld:genvault:' + gen + '/', savedBy: 'dad-chat', title: 'T', modelText: 'm', outputTemplate: 'o', srcManifest: { 'app.js': { key: 'h.js', size: 1 } } } });
  const r = sib('dad-chat', 1720000000000);
  assert.deepEqual(C.inspect({ key: 'weld:genvault:dad-chat/chat/snap-1720000000000-ab12cd', size: 9, value: r.chat }, {}).anomalies, []);
  assert.deepEqual(C.inspect({ key: 'weld:genvault:dad-chat/snapshot', size: 9, value: r.gen }, {}).anomalies, []);
  assert.ok(C.inspect({ key: 'weld:genvault:dad-chat/chat/snap-1-a', size: 9, value: Object.assign({}, r.chat, { folder: 'weld:genvault:other/chat/' }) }, {}).anomalies.some(a => /Folder field/.test(a)), 'a folder naming another generator is still flagged');
  assert.equal(C.checkStoreWrite('weld:genvault:dad-chat/snapshot', r.gen).ok, true);
}

// ---- backup-folder layout (pure)
{
  const snap = { key: 'weld:genvault:alpha/snapshot', value: { at: Date.UTC(2026, 9, 6, 12, 30, 5), generator: 'alpha' } };
  assert.match(C.backupTarget(snap).name, /^snapshot-20261006-123005-[0-9a-f]{4}\.json$/); assert.deepEqual(C.backupTarget(snap).dir, ['alpha', 'snapshot']);
  const changed = { key: snap.key, value: { at: snap.value.at, generator: 'alpha', title: 'x' } };
  assert.notEqual(C.backupTarget(snap).name, C.backupTarget(changed).name, 'a changed record gets a new file name');
  assert.equal(C.backupTarget({ key: 'weld:genvault:alpha/chat/snap-1-abc123', value: {} }).name, 'snap-1-abc123.json');
  assert.deepEqual(C.backupTarget({ key: 'dadchat:vault:index', value: [1] }).dir, ['_legacy']);
  assert.deepEqual(C.backupTarget({ key: 'weld:link-record', value: {} }).dir, ['_operational']);
  assert.ok(!/[\\/:]/.test(C.backupTarget({ key: 'weld:genvault:alpha/chat/snap-../../x', value: {} }).name), 'names never carry path separators');
}

// ---- UI against a fake host
const bytes = () => JSON.stringify([...store].sort());
const listeners = [], downloads = []; let listFail = false, removed = [];
class FakeFile { constructor(n) { this.name = n; this.kind = 'file'; this.text = ''; } async createWritable() { let b = ''; return { write: async x => { b += x; }, close: async () => { this.text = b; } }; } }
class FakeDir {
  constructor(n) { this.name = n; this.kind = 'directory'; this.items = new Map(); this.perm = 'granted'; }
  async getDirectoryHandle(n, o = {}) { let d = this.items.get(n); if (!d) { if (!o.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); d = new FakeDir(n); this.items.set(n, d); } return d; }
  async getFileHandle(n, o = {}) { let f = this.items.get(n); if (!f) { if (!o.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); f = new FakeFile(n); this.items.set(n, f); } return f; }
  async queryPermission() { return this.perm; } async requestPermission() { this.perm = 'granted'; return 'granted'; }
  files(prefix = '') { return [...this.items].flatMap(([n, x]) => x.kind === 'directory' ? x.files(prefix + n + '/') : [prefix + n]); }
}
const pickedDir = new FakeDir('MyDrive'); let pickerCalls = 0;
const settings = new Map();
const host = {
  get: (k, d) => settings.has(k) ? settings.get(k) : d, set: (k, v) => { settings.set(k, v); return true; },
  pageWindow: () => ({ showDirectoryPicker: async () => { pickerCalls++; return pickedDir; } }),
  slug: () => 'alpha',
  el: (t, a, c) => new Element(t, a, c),
  vault: {
    list: () => listFail ? { ok: false, reason: 'consent-denied' } : { ok: true, items: [...store.keys()].map(g => { const r = g.slice(SBK.length), i = r.indexOf(':'); return { gmKey: g, caller: r.slice(0, i), key: r.slice(i + 1) }; }) },
    read: g => { if (!store.has(g)) return { ok: true, size: 0, value: null }; const raw = store.get(g); try { return { ok: true, size: raw.length, value: JSON.parse(raw) }; } catch (e) { return { ok: true, size: raw.length, value: null, parseError: true }; } },
    remove: g => { removed.push(g); store.delete(g); return { ok: true }; },
    onChange: fn => { listeners.push(fn); return () => { listeners.splice(listeners.indexOf(fn), 1); }; },
    presence: () => ({ tabs: { 'futuretag-9': 2 }, ignored: 3 }),
    info: () => ({ backend: 'Fake GM' }), download: (n, t) => downloads.push({ n, t })
  }
};
const window = { WeldBackupCore: C, weldProjectHost: host }; window.top = window;
vm.runInNewContext(fs.readFileSync('src/backup-ui.js', 'utf8'), { window, console, setTimeout, clearTimeout });
const parent = new Element('main');
const btn = label => walk(parent).find(n => n.tagName === 'button' && (n.attrs.text === label || n.attrs['aria-label'] === label));
const click = label => { const b = btn(label); assert.ok(b, 'missing ' + label); b.click(); };

window.weldBackup.render(parent);
const t0 = txt(parent);
assert.match(t0, /Fake GM/); assert.ok(!t0.includes('unrelated'), 'out-of-scope keys are hidden');
assert.ok(walk(parent).some(n => n.attrs['data-gen'] === 'alpha') && walk(parent).some(n => n.attrs['data-gen'] === 'beta'));
assert.match(txt(walk(parent).find(n => n.attrs['data-gen'] === 'alpha')), /2 chat copies/);
assert.match(t0, /Legacy \(dadchat:vault\)/); assert.match(t0, /STALE/);
assert.ok(!btn('Delete dadchat:vault:index') && !btn('Delete weld:link-record'), 'legacy and operational keys cannot be deleted');

// inspect: anomaly for owner mismatch + dangling index
click('Inspect weld:genvault:beta/chat/snap-1700000006000-aaaaaa');
assert.match(txt(parent), /Owner mismatch/);
click('Inspect weld:genvault:alpha/chat/snap-1700000002000-def456'); assert.match(txt(parent), /not listed in its generator/);
assert.ok(!txt(parent).includes('SECRETVALUE123'));
click('Inspect weld:genvault:alpha/chat/index'); assert.match(txt(parent), /missing keys: snap-GONE-zzzzzz/);
click('Inspect weld:genvault:alpha/snapshot'); assert.match(txt(parent), /Truncated.*yes/);
click('Inspect weld:genvault:beta/snapshot'); assert.match(txt(parent), /model-text/);
click('Inspect weld:genvault:beta/snapshot-big'); assert.match(txt(parent), /Oversized/);

// secret scan: names only
click('Scan for plaintext secrets');
const sec = txt(parent); assert.match(sec, /config\.webhookUrl \(value hidden\)/); assert.ok(!sec.includes('SECRETVALUE123'));

// family section: picker, four rungs, presence
const fam = () => walk(parent).find(n => n.attrs['data-family']);
assert.ok(fam(), 'family card'); assert.deepEqual(['Live session', 'Named slots', 'Vault copies', 'Cloud Backup mirror'], walk(fam()).filter(n => n.attrs['data-rung']).map(n => n.attrs['data-rung']));
assert.match(txt(fam()), /Live session.*Not visible to the companion/);
const pick = walk(fam()).find(n => n.attrs['aria-label'] === 'Generator'); assert.deepEqual(walk(pick).filter(n => n.tagName === 'option').map(o => o.attrs.value), ['alpha', 'beta', 'futuretag-9']);
pick.value = 'alpha'; pick.events.change(); assert.match(txt(fam().parentNode.children.find(n => n.attrs['data-family']) || fam()), /2 chat copies/);
pick.value = 'futuretag-9'; pick.events.change(); assert.match(txt(fam()), /No vault copies stored/); assert.match(txt(walk(fam()).find(n => n.attrs['data-presence'])), /Presence: 2 open tabs seen for futuretag-9 · 3 malformed/);
assert.ok(!walk(parent).some(n => n.tagName === 'button' && n.attrs.disabled === false), 'never pass disabled:false');

// export
click('Export folder alpha'); const d1 = downloads.pop();
assert.match(d1.n, /^weld-backup-alpha-/); const b1 = JSON.parse(d1.t);
assert.ok(b1.records.every(r => /^weld:genvault:alpha\//.test(r.key))); assert.equal(b1.format, 'weld-backup-bundle');
click('Export all'); const all = JSON.parse(downloads.pop().t); assert.equal(all.count, 10 /* every key but the out-of-scope one */);
click('Download weld:genvault:beta/snapshot'); assert.equal(JSON.parse(downloads.pop().t).record.value.title, 'Beta');

// delete: confirm gate, exact key only, siblings byte-identical
const before = new Map(store), target = 'weld:genvault:beta/chat/snap-1700000007000-bbbbbb';
click('Delete ' + target); assert.ok(btn('Confirm delete'), 'confirm gate shown'); assert.equal(removed.length, 0);
assert.match(txt(parent), /generator "beta" key weld:genvault:beta\/chat\/snap-1700000007000-bbbbbb/); assert.match(txt(parent), /Index cleanup is the generator/);
click('Cancel'); assert.equal(removed.length, 0);
click('Delete ' + target); click('Confirm delete');
assert.deepEqual(removed, [SBK + 'beta:' + target]);
for (const [k, v] of before) { if (k === SBK + 'beta:' + target) assert.equal(store.has(k), false); else assert.equal(store.get(k), v, 'untouched: ' + k); }
assert.equal(store.size, before.size - 1);

// bus-driven refresh
const sizeBefore = txt(parent);
put('gamma', 'weld:genvault:gamma/snapshot', { v: 1, at: 1, protocol: 1, generator: 'gamma', folder: 'gamma', savedBy: 'gamma', title: 'G', modelText: 'x' });
listeners.forEach(fn => fn({ v: 1, type: 'vault-updated', generator: 'gamma' }));
assert.ok(walk(parent).some(n => n.attrs['data-gen'] === 'gamma'), 'auto-refresh on dad:genvault');
assert.equal(C.isVaultUpdate({ type: 'vault-updated' }), true);

// storage denied / unavailable: honest error, no throw
listFail = true; window.weldBackup.render(parent);
assert.match(txt(parent), /Could not list stored backups: consent-denied/);
assert.ok(!walk(parent).some(n => n.attrs['data-gen']));
listFail = false; const vaultApi = host.vault; delete host.vault; window.weldBackup.render(parent); assert.match(txt(parent), /unavailable/);

// no logging of content anywhere in the new sources
for (const f of ['src/backup-core.js', 'src/backup-ui.js']) assert.ok(!/console\.|GM_log|localStorage|sendBeacon|fetch\(|XMLHttpRequest|postMessage/.test(fs.readFileSync(f, 'utf8')), f + ' must not log or transmit');
// ---- save to a user-chosen folder (async tail; restores the vault API removed above)
(async () => {
  host.vault = vaultApi; window.weldBackup.render(parent);
  const sleep = ms => new Promise(r => setTimeout(r, ms)), until = async (fn, what) => { for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(10); } throw new Error('timed out: ' + what); };
  assert.ok(btn('Choose folder...') && !btn('Allow access'), 'no folder yet');
  assert.equal(btn('Save all to folder now').disabled, true);
  click('Choose folder...'); await until(() => pickerCalls === 1 && btn('Change folder...'), 'folder chosen');
  assert.match(txt(walk(parent).find(n => n.attrs['data-folder-state'])), /MyDrive · access allowed/);
  click('Save all to folder now'); await until(() => /Saved \d+ new file/.test(txt(parent)), 'first sync');
  const first = pickedDir.files();
  assert.ok(first.some(f => /^alpha\/snapshot\/snapshot-\d{8}-\d{6}-[0-9a-f]{4}\.json$/.test(f)), 'snapshot file: ' + first.join(', '));
  assert.ok(first.some(f => /^beta\/snapshot\//.test(f)) && first.some(f => /^_legacy\//.test(f)) && first.some(f => /^_operational\//.test(f)) && first.some(f => /^alpha\/chat\/index-/.test(f)));
  assert.ok(!first.some(f => /\/chat\/snap-/.test(f)), 'chat copies with plaintext secret-shaped config are held back');
  assert.match(txt(parent), /Held back \(plaintext secret-shaped values; not copied to your folder\): .*snap-1700000001000-abc123/);
  const onDisk = JSON.parse(pickedDir.items.get('alpha').items.get('snapshot').items.values().next().value.text);
  assert.deepEqual([onDisk.format, onDisk.record.key, onDisk.record.value.generator], ['weld-backup-record', 'weld:genvault:alpha/snapshot', 'alpha']);
  // second pass writes nothing; a changed record is added as a NEW file and the old one is untouched
  const before = new Map(first.map(f => [f, f.split('/').reduce((d, n) => d.items.get(n), pickedDir).text]));
  click('Save all to folder now'); await until(() => /Saved 0 new files/.test(txt(parent)), 'second sync');
  const alphaSnap = [...store.keys()].find(k => k.endsWith('weld:genvault:alpha/snapshot'));
  store.set(alphaSnap, JSON.stringify(Object.assign(JSON.parse(store.get(alphaSnap)), { title: 'Alpha v2' })));
  click('Save all to folder now'); await until(() => /Saved 1 new file /.test(txt(parent)), 'versioned sync');
  const after = pickedDir.files(); assert.equal(after.length, first.length + 1);
  for (const [f, t] of before) assert.equal(f.split('/').reduce((d, n) => d.items.get(n), pickedDir).text, t, 'existing file untouched: ' + f);
  // permission lost after a browser restart: Allow access, and nothing is written while it is missing
  pickedDir.perm = 'prompt'; window.weldBackup._state.perm = 'prompt'; window.weldBackup.render(parent);
  assert.ok(btn('Allow access')); assert.equal(btn('Save all to folder now').disabled, true); click('Allow access'); await until(() => !btn('Allow access'), 'access allowed');
  // automatic mirror: a vault-updated event copies a newly stored record without a click
  const auto = walk(parent).find(n => n.attrs['aria-label'] === 'Save new backups to the folder automatically'); auto.checked = true; auto.events.change();
  assert.equal(settings.get('backupFolderAuto'), true);
  await until(() => pickedDir.files().length === after.length, 'auto settled'); put('delta', 'weld:genvault:delta/snapshot', { v: 1, at: 5, protocol: 1, generator: 'delta', folder: 'delta', savedBy: 'delta', title: 'D', modelText: 'm' });
  listeners.forEach(fn => fn({ v: 1, type: 'vault-updated', generator: 'delta' })); await until(() => pickedDir.files().some(f => f.startsWith('delta/snapshot/')), 'auto mirror');
  // disconnect never deletes
  const kept = pickedDir.files().length; click('Disconnect folder (nothing in it is deleted)'); await until(() => btn('Choose folder...'), 'disconnected'); assert.equal(pickedDir.files().length, kept);
  console.log('backup tests passed');
})().catch(e => { console.error(e); process.exit(1); });
