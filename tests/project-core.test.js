const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const P = require('../src/project-core.js');

const ids = a => a.findings.map(f => f.id);
const find = (a, id) => a.findings.filter(f => f.id === id);

// ---- DSL structure ---------------------------------------------------------
const dsl = [
  '$meta',
  '  title = Test',
  'output',
  '  [animal] and [animal]',
  '  [a = flower.selectOne] loves [a]',
  '  {big|small} [animal.pluralForm]',
  '  [missing.selectOne] here',
  '  [init, ""] done',
  '  [n = animal.selectOne, if (n == "pig") {"x"} else {"y"}]',
  'animal',
  '  pig ^2',
  '  cow // trailing comment',
  '  pig',
  '  zebra',
  'flower',
  '  {red|blue} rose',
  '  {1-5} tulips',
  'init',
  '  a',
  '  b',
  'unusedList',
  '  x',
  'emptyList',
  'greet(who) =>',
  '  return "hi " + who',
  '// a comment at column 0 inside nothing',
  'oddOdds',
  '  one ^abc',
  'stray text here'
].join('\n');
const parsed = P.parseDsl(dsl);
assert.deepEqual(parsed.lists.filter(n => n.kind === 'list').map(n => n.name), ['output', 'animal', 'flower', 'init', 'unusedList', 'emptyList', 'oddOdds']);
assert.equal(parsed.functions.length, 1);
assert.equal(parsed.functions[0].codeLines.length, 1, 'function body lines are code, not items');
assert.equal(parsed.lists.find(n => n.name === 'animal').children.length, 4, 'trailing // comment stripped; items kept');

const a = P.analyze({ name: 't', dsl, html: '<p id="animal">[output]</p><button onclick="go()">x</button><p>[typo]</p>' });
['re-randomize', 'unresolved-ref', 'silent-noop', 'if-else-shared-block', 'duplicate-items', 'unused-list', 'empty-list', 'bad-odds', 'stray-line', 'id-collision', 'missing-function', 'html-unresolved-ref']
  .forEach(id => assert.ok(ids(a).includes(id), 'expected finding ' + id + ' in ' + ids(a).join(',')));
assert.equal(find(a, 'unresolved-ref')[0].line, 7);
assert.equal(find(a, 'unused-list').some(f => /unusedList/.test(f.message)), true);
assert.equal(find(a, 'unused-list').some(f => /"animal"|"flower"|"init"/.test(f.message)), false, 'referenced lists are not reported');
assert.equal(find(a, 'html-unresolved-ref')[0].message.includes('typo'), true);
assert.ok(a.counts.warn >= 8);
assert.equal(a.findings[0].severity === 'info', false, 'warnings sort before info');

// no false positives on clean, idiomatic code
const clean = P.analyze({ name: 'c', dsl: ['$meta', '  title = T', 'output', '  [f = flower.evaluateItem] and [f]', '  [n = {1-3}, n]', 'flower', '  {red|blue} rose', ''].join('\n'), html: '<div>[output]</div><button onclick="update()">go</button>' });
assert.deepEqual(clean.findings.filter(f => f.severity !== 'info').map(f => f.id), []);
// DSL-only analysis never claims a hard unresolved warning (the HTML panel may define the name)
assert.equal(find(P.analyze({ dsl: 'output\n  [fromHtml]\n' }), 'unresolved-ref')[0].severity, 'info');
// HTML ids and inline handler assignments count as defined
assert.equal(find(P.analyze({ dsl: 'output\n  hi [name] [box.checked]\n', html: '<input id="box" type="checkbox"><input oninput="name = this.value">' }), 'unresolved-ref').length, 0);
// functions, aliases, local variables and JS globals resolve
assert.equal(find(P.analyze({ dsl: 'p = {import:plug}\nfn() => return 1\noutput\n  [p.x] [fn()] [Math.floor(2.5)] [v = {1-3}, v + 1] [this.getName]\n' }), 'unresolved-ref').length, 0);
// function body lines never produce reference findings; column-0 comments do not end a body
const body = P.parseDsl('f() =>\n  let x = [1,2][0]\n// note\n  return x\nlist\n  item\n');
assert.equal(body.functions[0].codeLines.length, 3);
assert.equal(body.lists.map(n => n.name).join(), 'f,list');

// mixed indentation
assert.ok(ids(P.analyze({ dsl: 'a\n\t b\n' })).includes('mixed-indent'));
assert.ok(ids(P.analyze({ dsl: 'a\n\tb\nc\n  d\n' })).includes('mixed-indent'));
// duplicate list
assert.ok(ids(P.analyze({ dsl: 'a\n  x\na\n  y\n' })).includes('duplicate-list'));
// unclosed bracket
assert.ok(ids(P.analyze({ dsl: 'output\n  hello [oops\n' })).includes('unclosed-block'));
assert.equal(ids(P.analyze({ dsl: 'output\n  hello \\[ok\n' })).includes('unclosed-block'), false, 'escaped bracket is fine');

// ---- helpers -----------------------------------------------------------
assert.deepEqual(P.splitOdds('salt ^2'), { body: 'salt', odds: '2' });
assert.deepEqual(P.splitOdds('Frigid^1/2'), { body: 'Frigid', odds: '1/2' });
assert.equal(P.splitOdds('blue ^[c == "blue"]').odds, '[c == "blue"]');
assert.deepEqual(P.collectImports('a = {import:foo-plugin}\n {import: bar }'), ['foo-plugin', 'bar']);
assert.deepEqual(P.identifiers('x = list.selectOne, y.z("a b") + q').used, ['x', 'list', 'y', 'q']);
assert.deepEqual(P.identifiers('(a, b) => a + c').declared.sort(), ['a', 'b']);
assert.deepEqual(P.identifiers('({k: v})').used, ['v'], 'object keys are not references');
assert.equal(P.squareBlocks('a [b[c]] \\[no] [d]').blocks.length, 2);

// ---- output-space estimate -------------------------------------------------
const space = P.analyze({ dsl: 'output\n  [a] [b]\na\n  x\n  y\n  z\nb\n  {1-10} q\n  r\n' }).outputSpace;
assert.equal(space.count, 3 * 11, 'sum over items, product over references');
assert.equal(P.analyze({ dsl: 'output\n  {a|b|c} {1-4}\n' }).outputSpace.count, 12);
assert.equal(P.analyze({ dsl: 'output\n  [x = a, x] [x]\na\n  p\n  q\n' }).outputSpace.count, 2, 'a stored variable is not re-counted');
assert.equal(P.analyze({ dsl: 'output\n  [a.selectMany(2)]\na\n  p\n  q\n  r\n' }).outputSpace.count, 9);
assert.equal(P.analyze({ dsl: 'output\n  [a]\na\n  [b]\nb\n  [a]\n  z\n' }).outputSpace.cycle, true, 'cycles are reported, not looped');
assert.equal(P.analyze({ dsl: 'x\n  y\n' }).outputSpace, null);
assert.equal(P.formatCount(1234567), '1.2 \u00d7 10^6');
assert.equal(P.formatCount(1500), '1,500');

// ---- HTML panel -------------------------------------------------------------
const html = [
  '<script src="https://cdn.example.com/lib.js"></script>',
  '<div id="out">[output]</div><div id="out"></div>',
  '<img src="http://insecure.example.com/a.png">',
  '<p>[p = "<b>bad</b>"]</p>',
  '<script>',
  'function go() { localStorage.setItem("save", "1"); kv.scores.get("x"); root.aiTextPlugin({}); }',
  'root.custom = 1; var counter = 0;',
  'const bad = "\\u{1F600}";',
  '</script>',
  '<button onclick="go(); missing()">x</button>'
].join('\n');
const h = P.analyzeHtml(html);
assert.deepEqual(h.duplicateIds.map(d => d.id), ['out']);
assert.deepEqual(h.storage.localStorage, ['save']);
assert.deepEqual(h.storage.kv, ['scores']);
assert.ok(h.hosts.includes('cdn.example.com'));
assert.equal(h.externalScripts.length, 1);
assert.ok(h.rootRefs.aiTextPlugin && h.rootAssigned.includes('custom'));
assert.ok(h.functions.includes('go'));
assert.ok(h.findings.some(f => f.id === 'insecure-url'));
assert.ok(h.findings.some(f => f.id === 'html-in-square'));
assert.ok(h.findings.some(f => f.id === 'perchance-trap'));
assert.ok(!h.urls.some(u => /w3\.org/.test(u.url)));
const full = P.analyze({ dsl: 'output\n  hi\n', html });
assert.ok(ids(full).includes('missing-function') || ids(full).includes('duplicate-id'));
assert.ok(ids(full).includes('duplicate-id'));
assert.match(P.htmlMap(html), /Element ids \(1\): out/);
assert.match(P.htmlMap(html), /root\.\* used: aiTextPlugin/);

// ---- dependencies ----------------------------------------------------------
const deps = P.normalizeDeps({ success: true, generators: {
  top: { name: 'top', imports: ['a', 'b', 'top'], code: 'x'.repeat(10), lastEditTime: 5 },
  a: { name: 'a', imports: ['c'], code: 'y'.repeat(150000), lastEditTime: 6 },
  b: { name: 'b', imports: ['c', 'top'], code: 'zz', lastEditTime: 7 },
  c: { name: 'c', imports: [], code: 'c', lastEditTime: 8 }
}, unfound: ['gone'] }, 'top');
assert.deepEqual(deps.nodes.top.imports, ['a', 'b'], 'self-imports are dropped');
const tree = P.dependencyTree(deps, 'top');
assert.equal(tree.children.length, 2);
assert.equal(tree.children[1].children[1].cycle, true, 'cycle back to the root is marked');
assert.equal(tree.children[1].children[0].repeated, true, 'a shared import is shown once');
const st = P.dependencyStats(deps, 'top');
assert.equal(st.count, 3);
assert.equal(st.heavy[0].name, 'a');
assert.equal(st.depth, 2);
const sig = P.depSignature(deps);
deps.nodes.c.code = 'changed';
const drift = P.depDrift(sig, P.depSignature(deps));
assert.deepEqual(drift.changed, ['c']);
assert.equal(P.depDrift(sig, sig).any, false);
assert.throws(() => P.normalizeDeps({ nope: 1 }, 'x'), /Unexpected/);
assert.throws(() => P.parseHtmlResponse('<!DOCTYPE html><html><head><title>Just a moment...</title>'), /browser check/);
assert.equal(P.parseHtmlResponse('<p>[output]</p>'), '<p>[output]</p>');

// ---- sampling statistics --------------------------------------------------
const s = P.sampleStats(['Red Fox', 'Red Fox', 'Blue Owl', 'Green Cat', 'Red Fox', 'x'], { count: 10000 });
assert.equal(s.n, 6); assert.equal(s.unique, 4); assert.equal(s.duplicates, 2);
assert.equal(s.topRepeated[0].count, 3);
assert.equal(s.lowVariety, true, 'duplicates far above the birthday expectation');
assert.equal(P.sampleStats(['a', 'b', 'c'], { count: 3 }).lowVariety, false);
assert.equal(P.sampleStats([]).n, 0);

// ---- export -----------------------------------------------------------------
const project = { name: 'top', dsl: 'output\n  hi\n', html: '<p>[output]</p>', source: 'published', deps };
const analysis = P.analyze({ name: project.name, dsl: project.dsl, html: project.html, deps });
const md = P.toMarkdown(project, analysis);
assert.match(md, /```perchance\noutput\n {2}hi\n```/);
assert.match(md, /```html\n<p>\[output\]<\/p>\n```/);
const files = P.bundleFiles(project, analysis);
assert.deepEqual(files.map(f => f.name).slice(0, 2), ['top/dsl.txt', 'top/html.html']);
assert.ok(files.some(f => f.name === 'top/imports/a.txt'), 'import sources are included');
assert.ok(!files.some(f => /imports\/top\.txt/.test(f.name)));
assert.equal(JSON.parse(files.find(f => f.name.endsWith('manifest.json')).data).format, 'weld-project');

// ZIP: parse our own output back with an independent reader
const zipped = P.zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/\u00e9.txt', data: new Uint8Array([1, 2, 3]) }], Date.UTC(2026, 0, 2, 3, 4, 6));
const view = new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength);
const eocd = zipped.length - 22;
assert.equal(view.getUint32(eocd, true), 0x06054b50);
assert.equal(view.getUint16(eocd + 10, true), 2);
let pos = view.getUint32(eocd + 16, true), seen = [];
for (let i = 0; i < 2; i++) {
  assert.equal(view.getUint32(pos, true), 0x02014b50);
  const crc = view.getUint32(pos + 16, true), size = view.getUint32(pos + 24, true), nlen = view.getUint16(pos + 28, true), off = view.getUint32(pos + 42, true);
  const name = Buffer.from(zipped.slice(pos + 46, pos + 46 + nlen)).toString('utf8');
  assert.equal(view.getUint32(off, true), 0x04034b50);
  const lnlen = view.getUint16(off + 26, true), start = off + 30 + lnlen;
  const data = Buffer.from(zipped.slice(start, start + size));
  if (zlib.crc32) assert.equal(zlib.crc32(data), crc, 'crc of ' + name);
  assert.equal(P.crc32(data), crc);
  seen.push([name, data.length]); pos += 46 + nlen;
}
assert.deepEqual(seen, [['a.txt', 5], ['dir/\u00e9.txt', 3]]);
assert.equal(P.crc32(Buffer.from('123456789')), 0xcbf43926, 'standard CRC-32 check value');

// ---- AI context pack -------------------------------------------------------
const pack = P.aiPack(project, analysis, { budget: 50000 });
assert.match(pack.text, /GENERATOR: top/);
assert.match(pack.text, /LISTS PANEL/);
assert.match(pack.text, /HTML PANEL/);
assert.equal(pack.dropped.length, 0);
const bigHtml = '<div id="x">[output]</div>\n' + '<script>function f' + 'a'.repeat(10) + '(){}</script>\n'.repeat(3000);
const small = P.aiPack({ name: 'big', dsl: 'output\n  ' + 'word '.repeat(30000) + '\n', html: bigHtml }, null, { budget: 8000 });
assert.ok(small.length <= 8600, 'stays near the budget, got ' + small.length);
assert.ok(small.dropped.length >= 1);
assert.match(small.text, /truncated/);
assert.match(small.text, /HTML PANEL STRUCTURE/);
assert.equal(P.aiPack(project, analysis, { html: false }).text.includes('HTML PANEL'), false);

assert.equal(P.fileSafe('my gen/1'), 'my_gen_1');
assert.equal(P.fileSafe('..'), 'generator', 'a dot-only name cannot escape the folder');
assert.doesNotMatch(P.fileSafe('../../etc/passwd'), /[\/\\]|^\./);
assert.ok(P.bundleFiles({ name: '..', dsl: 'x', html: null }, null).every(f => !/(^|\/)\.\.(\/|$)/.test(f.name) && !f.name.startsWith('/')), 'no zip-slip paths');
assert.equal(P.hash('abc'), P.hash('abc'));
assert.notEqual(P.hash('abc'), P.hash('abd'));
console.log('Project extraction, analysis, dependency, export and context-pack tests passed');
