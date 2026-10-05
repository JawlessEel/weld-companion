// Execute the real Project tab handlers with a small DOM, a fake Perchance API and a fake host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../src/project-core.js');

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag; this.attrs = attrs; this.children = []; this.events = {}; this.open = false;
    this.value = attrs.value == null ? '' : attrs.value; this.disabled = false; this.style = {};
    (children || []).forEach(c => this.appendChild(c));
    if (attrs.onclick) this.events.click = attrs.onclick;
    if (attrs.ontoggle) this.events.toggle = attrs.ontoggle;
  }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'open') this.open = true; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { const prev = this.events[type]; this.events[type] = prev ? (...a) => { prev(...a); fn(...a); } : fn; }
  get isConnected() { return true; }
  click() { if (!this.disabled) this.events.click?.(); }
  remove() {}
}
const parent = new Element('main');
const walk = n => [n, ...n.children.flatMap(walk)];
const text = n => (n.attrs.text || '') + n.children.map(text).join('');
const find = (tag, label) => walk(parent).find(n => n.tagName === tag && (n.attrs.text === label || n.attrs['aria-label'] === label));
const bodyText = () => text(parent);
function click(label) { const n = find('button', label); assert.ok(n, 'missing button ' + label + ' in:\n' + walk(parent).filter(x => x.tagName === 'button').map(x => x.attrs.text).join(' | ')); assert.ok(!n.disabled, label + ' is disabled'); n.click(); }
function openSection(prefix) {
  const d = walk(parent).find(n => n.tagName === 'details' && n.children[0] && text(n.children[0]).startsWith(prefix));
  assert.ok(d, 'missing section ' + prefix);
  d.open = true; d.events.toggle?.({ target: d });
}
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 40; i++) { await tick(); if (!state().loading && !state().sampling && !state().checking) break; } await tick(); }

// ---- fake world ----------------------------------------------------------
let slug = 'demo', edit = false, live = null, version = 1;
const requests = [], store = new Map(), downloads = [], aiCalls = [], nativeCalls = [], applied = [], jumps = [];
const deps = () => ({ success: true, unfound: [], generators: {
  demo: { name: 'demo', imports: ['plug'], code: version === 1 ? 'plug = {import:plug}\noutput\n  [animal] [missing]\nanimal\n  pig\n  cow\n  zebra\n' : 'plug = {import:plug}\noutput\n  [animal]\nanimal\n  pig\n  cow\n', lastEditTime: 1000 + version },
  plug: { name: 'plug', imports: [], code: 'x'.repeat(2000), lastEditTime: 5 + (version === 1 ? 0 : 1) } } });
const htmlPanel = '<p>[output]</p><img src="https://cdn.example.com/a.png"><img src="https://dead.example.com/b.png"><img src="https://auth.example.com/c.png">';
const urlStatus = { 'https://cdn.example.com/a.png': [200], 'https://dead.example.com/b.png': [405, 404], 'https://auth.example.com/c.png': [401] };
let methodSeen = [];
const host = {
  el: (tag, attrs, children) => new Element(tag, attrs, children),
  get: (k, d) => store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : d,
  set: (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); return true; },
  toast() {}, copy: t => { host.copied = t; },
  slug: () => slug, isEdit: () => edit, live: () => live,
  request(o, cb) {
    requests.push(o);
    setTimeout(() => {
      if (/getGeneratorsAndDependencies/.test(o.url)) return cb(null, { status: 200, text: JSON.stringify(deps()) });
      if (/getGeneratorHtml/.test(o.url)) return cb(null, { status: 200, text: htmlPanel });
      const seq = urlStatus[o.url]; if (seq) { methodSeen.push(o.method + ' ' + o.url); const s = o.method === 'HEAD' ? seq[0] : seq[seq.length - 1]; return cb(null, { status: s, text: '' }); }
      cb('network error');
    }, 0);
  },
  jump(pane, line) { jumps.push([pane, line]); return true; },
  apply(dsl, html) { applied.push([dsl, html]); return true; },
  diff(a, b) { const d = a === b ? { add: 0, del: 0 } : { add: 1, del: 1 }; return { rows: [{ cls: 'del', num: 1, text: 'old' }, { cls: 'add', num: 1, text: 'new' }], stats: d }; },
  favorites: () => ['alpha', 'beta'],
  statsMany(names, cb) { cb(host.stats); }, stats: {},
  openAI(prompt, ctx) { aiCalls.push({ prompt, ctx }); },
  openPerchanceAI(prompt) { nativeCalls.push({ prompt }); },
  sample: async (s, via, opts) => ({ samples: ['Red Fox', 'Red Fox', 'Blue Owl', 'Green Cat', 'Red Fox', 'Pink Eel'], ms: 12, requested: opts.n })
};
const confirms = [];
const window = { confirm: m => { confirms.push(m); return true; }, location: { href: '' } }; window.top = window;
const blobs = [];
const context = {
  window, console, setTimeout, Promise, JSON, Date, Math, Object, Array, Set, Map, String, Number, Error, RegExp, Uint8Array, TextEncoder, Blob,
  document: { getElementById: id => walk(parent).find(n => n.attrs.id === id), createElement: () => ({ click() { downloads.push(this); }, remove() {}, set href(v) { this._href = v; }, get href() { return this._href; } }),
    body: { appendChild() {} }, querySelector: () => null, activeElement: null },
  URL: { createObjectURL: b => { blobs.push(b); return 'blob:' + blobs.length; }, revokeObjectURL() {} }
};
window.WeldProjectCore = P; window.weldProjectHost = host;
vm.runInNewContext(fs.readFileSync('src/project-ui.js', 'utf8'), context);
const state = () => window.weldProject.state;
const render = () => window.weldProject.render(parent);

(async () => {
  // ---- first view: nothing loaded, then fetch published ----
  render();
  assert.match(bodyText(), /Nothing is loaded/);
  assert.ok(find('button', 'Analyze editor (live)').disabled, 'live analysis needs the editor');
  click('Fetch published + imports'); await settle();
  assert.equal(state().project.source, 'published');
  assert.ok(find('button', 'Send findings to Perchance AI').disabled, 'native handoff requires the editor');
  assert.equal(state().project.deps.nodes.plug.bytes, 2000);
  assert.match(bodyText(), /Fetched the published version/);
  assert.match(bodyText(), /"missing" is not a list/, 'findings are listed');
  assert.match(bodyText(), /Source: published on Perchance/);
  assert.ok(state().analysis.outputSpace.count >= 1);
  assert.equal(state().history.length, 1, 'first snapshot saved');

  // ---- imports section ----
  openSection('Imports and dependencies');
  assert.match(bodyText(), /1 generator\(s\) are pulled in/);
  assert.match(bodyText(), /plug/);

  // ---- export ----
  openSection('Export and AI context');
  click('Download ZIP bundle');
  assert.ok(downloads.at(-1).download.endsWith('.zip'));
  const zipBytes = Buffer.from(await blobs.at(-1).arrayBuffer());
  assert.equal(zipBytes.toString('latin1', 0, 2), 'PK');
  assert.match(zipBytes.toString('utf8'), /demo\/imports\/plug\.txt/);
  click('Download Markdown');
  assert.match(await blobs.at(-1).text(), /## Lists panel/);
  click('Build pack');
  assert.match(find('textarea', 'Context pack').value, /GENERATOR: demo/);
  click('Copy pack'); assert.match(host.copied, /LISTS PANEL/);
  confirms.length = 0;
  click('Use in AI helper');
  assert.deepEqual(aiCalls.at(-1), { prompt: '', ctx: 'pack' });
  assert.match(confirms[0], /another author/, 'sending someone else’s published source asks first');

  // ---- sampling ----
  openSection('Sample the output');
  click('Run sample'); await settle();
  assert.equal(state().samples.stats.n, 6);
  assert.match(bodyText(), /6 result\(s\), 4 different/);
  assert.equal(find('textarea', 'Samples').value.includes('Blue Owl'), true);

  // ---- asset links ----
  openSection('Assets, hosts and storage');
  assert.match(bodyText(), /cdn\.example\.com/);
  confirms.length = 0;
  click('Check links (3)'); await settle();
  assert.match(confirms[0], /3 anonymous request/);
  assert.deepEqual(Object.fromEntries(Object.entries(state().checks).map(([u, c]) => [u.split('/')[2], c.state])), { 'cdn.example.com': 'ok', 'dead.example.com': 'dead', 'auth.example.com': 'blocked' });
  assert.ok(methodSeen.includes('HEAD https://dead.example.com/b.png') && methodSeen.includes('GET https://dead.example.com/b.png'), 'falls back from HEAD to GET');
  assert.ok(requests.filter(r => /example\.com/.test(r.url)).every(r => r.anonymous), 'link checks send no cookies');
  click('Copy dead links'); assert.equal(host.copied, 'https://dead.example.com/b.png');

  // ---- second version -> snapshot, drift, compare ----
  version = 2;
  click('Fetch published + imports'); await settle();
  assert.equal(state().history.length, 2);
  assert.ok(state().drift && state().drift.changed.includes('plug'), 'a changed import is reported against the first review');
  openSection('Imports and dependencies');
  assert.match(bodyText(), /Since you last reviewed these imports/);
  click('Mark imports as reviewed');
  assert.equal(state().drift, null);
  openSection('Snapshots');
  const compare = walk(parent).filter(n => n.tagName === 'button' && n.attrs.text === 'Compare').filter(n => !n.disabled);
  assert.equal(compare.length, 1, 'only the older snapshot can be compared');
  compare[0].click();
  assert.match(bodyText(), /Snapshot from .* loaded now/);
  assert.match(bodyText(), /Lists panel +\(\+1 −1\)/);
  click('← Back to list');
  assert.ok(find('button', 'Restore').disabled, 'restore needs the editor');

  // ---- live editor: analysis without network, jump, restore ----
  edit = true; live = { dsl: 'output\n  [animal] [oops]\nanimal\n  a\n  b\n', html: '<p>[output]</p>' };
  const before = requests.length;
  render();   // reopening the tab after entering the editor
  click('Analyze editor (live)'); await settle();
  assert.equal(requests.length, before, 'live analysis uses no network');
  assert.equal(state().project.source, 'editor');
  assert.equal(state().project.deps.nodes.demo.imports[0], 'plug', 'import tree is kept for the live copy');
  const jumpRow = walk(parent).find(n => n.attrs.title === 'Jump to this line in the editor');
  assert.ok(jumpRow); jumpRow.events.click(); assert.deepEqual(jumps.at(-1), ['dsl', 2]);
  openSection('Snapshots');
  click('Restore');
  assert.ok(/Replace the editor contents/.test(confirms.at(-1)));
  assert.equal(applied.length, 1);
  const warned = confirms.filter(c => /another author/.test(c)).length;
  const asked = aiCalls.length;
  click('Ask AI about these');
  assert.equal(aiCalls.length, asked + 1);
  assert.equal(aiCalls.at(-1).ctx, 'pack');
  assert.equal(confirms.filter(c => /another author/.test(c)).length, warned, 'an editor source is yours: no extra warning');

  // Repair handoff includes all issues, independent of the visible filter/limit.
  const originalFindings = state().analysis.findings;
  state().analysis.suppressedFindings = [{ id: 'duplicate-id', severity: 'warn', subject: 'pad', message: 'Suppressed only' }];
  state().analysis.findings = Array.from({ length: 65 }, (_, i) => ({ severity: i === 0 ? 'error' : 'warn', pane: i === 0 ? 'dsl' : 'html', line: i + 1, message: 'Issue ' + i, hint: 'Check ' + i }));
  state().analysis.findings.push({ severity: 'info', pane: 'dsl', message: 'Informational only' });
  state().filter = 'error'; render();
  assert.match(bodyText(), /1 finding\(s\) suppressed by explicit weld-ignore comments/);
  const writesBeforeRepair = applied.length;
  const toolsCallsBeforeRepair = aiCalls.length;
  click('Send findings to Perchance AI');
  const repair = nativeCalls.at(-1);
  assert.equal(aiCalls.length, toolsCallsBeforeRepair, 'native handoff bypasses Tools and provider calls');
  assert.match(repair.prompt, /Check and fix the confirmed issues in generator "demo"/);
  assert.match(repair.prompt, /\[ERROR\] dsl line 1: Issue 0/);
  assert.match(repair.prompt, /\[WARN\] html line 65: Issue 64\n  Hint: Check 64/);
  assert.doesNotMatch(repair.prompt, /Informational only/);
  assert.doesNotMatch(repair.prompt, /Suppressed only/);
  assert.match(repair.prompt, /false alarms/);
  assert.equal(applied.length, writesBeforeRepair, 'handoff does not write to the editor');
  state().analysis.findings = [{ severity: 'info', pane: 'dsl', message: 'Just a note' }]; render();
  assert.ok(find('button', 'Send findings to Perchance AI').disabled, 'repair is disabled without warnings/errors');
  state().analysis.findings = originalFindings; state().analysis.suppressedFindings = []; state().filter = 'warn'; render();

  // ---- starred generators ----
  openSection('Starred generators');
  host.stats = { alpha: { lastEditTime: 100 }, beta: { lastEditTime: 200 } };
  click('Check for changes'); await settle();
  assert.match(bodyText(), /Baseline recorded/);
  host.stats = { alpha: { lastEditTime: 100 }, beta: { lastEditTime: Date.now() } };
  click('Check for changes'); await settle();
  assert.match(bodyText(), /1 of 2 changed/);
  assert.equal(state().starred.find(x => x.name === 'beta').changed, true);
  click('Mark all as seen');
  assert.equal(state().starred.some(x => x.changed), false);

  // ---- search saved generators ----
  openSection('Search saved generators');
  find('input', 'Search saved generators').value = 'oops';
  click('Search'); await settle();
  assert.ok(state().results.some(r => r.slug === 'demo' && r.pane === 'dsl' && r.line === 2), 'matches the latest saved copy');

  // ---- slug change resets state; a saved copy is shown without network ----
  slug = 'other'; edit = false; live = null;
  const n = requests.length;
  render(); await settle();
  assert.equal(state().project, null);
  assert.equal(requests.length, n);
  slug = 'demo'; render(); await settle();
  assert.equal(state().project.source, 'cached');
  assert.match(bodyText(), /saved copy/);
  assert.equal(window.weldProject.current().name, 'demo');
  console.log('Project tab fetch/analyze/export/sample/links/history/live/starred/search workflows passed');
})().catch(err => { console.error(err); process.exit(1); });
