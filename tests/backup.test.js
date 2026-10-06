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

// ---- UI against a fake host
const bytes = () => JSON.stringify([...store].sort());
const listeners = [], downloads = []; let listFail = false, removed = [];
const host = {
  el: (t, a, c) => new Element(t, a, c),
  vault: {
    list: () => listFail ? { ok: false, reason: 'consent-denied' } : { ok: true, items: [...store.keys()].map(g => { const r = g.slice(SBK.length), i = r.indexOf(':'); return { gmKey: g, caller: r.slice(0, i), key: r.slice(i + 1) }; }) },
    read: g => { if (!store.has(g)) return { ok: true, size: 0, value: null }; const raw = store.get(g); try { return { ok: true, size: raw.length, value: JSON.parse(raw) }; } catch (e) { return { ok: true, size: raw.length, value: null, parseError: true }; } },
    remove: g => { removed.push(g); store.delete(g); return { ok: true }; },
    onChange: fn => { listeners.push(fn); return () => { listeners.splice(listeners.indexOf(fn), 1); }; },
    info: () => ({ backend: 'Fake GM' }), download: (n, t) => downloads.push({ n, t })
  }
};
const window = { WeldBackupCore: C, weldProjectHost: host }; window.top = window;
vm.runInNewContext(fs.readFileSync('src/backup-ui.js', 'utf8'), { window, console });
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
listFail = false; delete host.vault; window.weldBackup.render(parent); assert.match(txt(parent), /unavailable/);

// no logging of content anywhere in the new sources
for (const f of ['src/backup-core.js', 'src/backup-ui.js']) assert.ok(!/console\.|GM_log|localStorage|sendBeacon|fetch\(|XMLHttpRequest|postMessage/.test(fs.readFileSync(f, 'utf8')), f + ' must not log or transmit');
console.log('backup tests passed');
