const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const B = require('../src/github-backup');

(async () => {
  for (const p of ['../x', 'a/../x', 'a//x', 'C:/x', 'a\\x', '.git/config', '/x', 'src/.env', 'src/private.pem']) assert.equal(B.safePath(p), false);
  assert.equal(B.safePath('dad/src/sub/module.js'), true);
  const model = Buffer.alloc(B.PART + 11); for (let i = 0; i < model.length; i++) model[i] = i % 251;
  let listing = { 'main.js': { size: 4, rev: 1 } };
  const opts = { name: 'dad', dslPath: 'dad/dad-top-panel.txt', htmlPath: 'dad/dad-html-panel.html', dsl: 'x', html: 'src/main.js',
    state: { ready: async () => {}, list: () => listing, readFile: async () => Uint8Array.of(0, 255, 13, 10).buffer }, crypto: webcrypto,
    evaluate: async (op, a) => op === 'inventory' ? { origin: 'https://x.perchance.org', entries: [{ kind: 'opfs', path: 'browser-model/model.gguf', size: model.length, modified: 1 }], unavailable: [] }
      : model.subarray(a.offset, a.offset + a.length).toString('base64') };
  const result = await B.collect(opts);
  const sourceOnly = await B.collect({ ...opts, includeCache: false, evaluate: async () => { throw new Error('GitHub must not inspect browser storage'); } });
  assert.equal(sourceOnly.manifest.includeCache, false);
  assert.ok(sourceOnly.manifest.files.every(f => f.kind === 'project'));
  assert.ok(!sourceOnly.files.some(f => /\/assets\//.test(f.path)), 'GitHub source-only backups contain no cached assets');
  for (const f of sourceOnly.files) if (f.read) await f.read();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weld-backup-test-')), root = path.join(tmp, 'dad');
  for (const file of result.files) {
    const content = file.read ? await file.read() : file.content;
    const dest = path.join(tmp, file.path); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.encoding === 'base64' ? Buffer.from(content, 'base64') : content);
  }
  const rec = result.manifest.files.find(f => f.kind === 'opfs');
  assert.equal(rec.parts.length, 2); assert.ok(rec.parts.every(p => /^[a-f0-9]{64}$/.test(p.sha256)));
  const out = path.join(tmp, 'restored');
  const restored = spawnSync('python', [path.join(root, '.weld-backup/restore.py'), '--output', out], { encoding: 'utf8' });
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(fs.readFileSync(path.join(out, '.weld-backup/assets/0/model.gguf')), model);
  assert.deepEqual(fs.readFileSync(path.join(out, 'src/main.js')), Buffer.from([0, 255, 13, 10]));
  const again = spawnSync('python', [path.join(root, '.weld-backup/restore.py'), '--output', out], { encoding: 'utf8' });
  assert.notEqual(again.status, 0, 'restore never overwrites existing files');
  fs.writeFileSync(path.join(tmp, rec.parts[0].path), 'broken');
  const broken = spawnSync('python', [path.join(root, '.weld-backup/restore.py'), '--output', path.join(tmp, 'bad')], { encoding: 'utf8' });
  assert.notEqual(broken.status, 0); assert.match(broken.stderr, /integrity/);
  listing = { 'main.js': { size: 4, rev: 2 } };
  assert.throws(result.validate, /changed/);
  await assert.rejects(result.files.find(f => f.path.endsWith('src/main.js')).read(), /changed/);
  await assert.rejects(B.collect({ ...opts, state: null }), /unavailable/);
  await assert.rejects(B.collect({ ...opts, state: { ready: async () => {}, list: () => ({}) } }), /manifest empty/);
  await assert.rejects(B.collect({ ...opts, evaluate: async () => { throw new Error('unreadable'); } }), /unreadable/);

  const url = 'https://huggingface.co/example/model/resolve/main/model.onnx';
  const cache = new Map([[url, new Response(Buffer.from([0, 255, 1]))], ['https://example.com/api/session.json', new Response('private')]]);
  const env = { URL, Uint8Array, Number, btoa, location: { origin: 'https://x.perchance.org' },
    navigator: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => { const e = new Error(); e.name = 'NotFoundError'; throw e; } }) } },
    caches: { keys: async () => ['models'], open: async () => ({ keys: async () => [...cache.keys()].map(url => new Request(url)), match: async r => cache.get(typeof r === 'string' ? r : r.url).clone() }) } };
  vm.createContext(env); vm.runInContext('var run = ' + B.runtime.toString(), env);
  const inventory = await env.run('inventory'); assert.equal(inventory.entries.length, 1, 'private/unrelated cache is excluded');
  assert.equal(await env.run('read', { ...inventory.entries[0], offset: 0, length: 3 }), 'AP8B');
  await assert.rejects(env.run('read', { ...inventory.entries[0], size: 4, offset: 0, length: 3 }), /changed/);
  await assert.rejects(env.run('read', { kind: 'cache', url: 'https://example.com/api/session.json' }), /Unsafe/);
  // Failed lazy reads or changed source must never advance the branch.
  const shipped = fs.readFileSync(path.join(__dirname, '../weld-companion.user.js'), 'utf8');
  const collected = [];
  const collectorContext = { Promise, setTimeout, clearTimeout, toast() {}, pageProp() {}, ghBackupEval() {},
    window: { crypto: webcrypto, WeldGitHubBackup: { collect: async options => { collected.push(options); return {}; } } } };
  vm.createContext(collectorContext);
  vm.runInContext(shipped.slice(shipped.indexOf('function ghCollectBackup('), shipped.indexOf('function ghBackupNote(')), collectorContext);
  await collectorContext.ghCollectBackup('dad', opts.dslPath, opts.htmlPath, opts.dsl, opts.html);
  assert.equal(collected[0].includeCache, false, 'shared collector disables cache capture unless requested');
  const localAdapter = shipped.match(/backup:\s*\{\s*collect:\s*(function[^\n]+),\s*\n\s*crypto:/)[1];
  vm.runInContext('var localCollect = ' + localAdapter, collectorContext);
  await collectorContext.localCollect('dad', { dsl: opts.dslPath, html: opts.htmlPath }, { dsl: opts.dsl, html: opts.html }, true);
  assert.equal(collected[1].includeCache, true, 'local download continues to capture requested assets');
  const panelPushes = [];
  const rollbackContext = { console, genName: () => 'dad', ghToken: () => 'test-token',
    dslView: () => ({ state: { doc: { toString: () => 'output' } } }), htmlView: () => ({ state: { doc: { toString: () => '<p>hi</p>' } } }),
    ghResolve: () => ({ cfg: { owner: 'o', repo: 'r', branch: 'main', dslPath: '{name}/{name}-top-panel.txt', htmlPath: '{name}/{name}-html-panel.html' } }),
    window: {}, Date, confirm: () => true, toast() {}, lintHtmlScripts: () => [], ghGateNote: () => '',
    ghCollectBackup: () => { throw new Error('Restored Push must not collect src or cache'); },
    ghPushFilesAtomic: (owner, repo, branch, files) => panelPushes.push(files) };
  vm.createContext(rollbackContext);
  vm.runInContext(shipped.slice(shipped.indexOf('function pushAsPullRequest('), shipped.indexOf('function ghConfigure(')), rollbackContext);
  rollbackContext.pushToGitHub(); rollbackContext.pushAsPullRequest();
  assert.equal(panelPushes.length, 2);
  for (const files of panelPushes) assert.deepEqual(JSON.parse(JSON.stringify(files)), [
    { path: 'dad/dad-top-panel.txt', content: 'output' }, { path: 'dad/dad-html-panel.html', content: '<p>hi</p>' }
  ], 'restored Push and PR contain exactly the two editor panels');
  const uploader = shipped.slice(shipped.indexOf('function ghApiError('), shipped.indexOf('function ghGateNote('));
  async function push(file, validate) {
    const calls = [];
    const context = { console, Promise, ghApi(method, url, token, body, cb) {
      calls.push({ method, url, body });
      cb(null, method === 'POST' ? 201 : 200, method === 'GET' && url.includes('/ref/') ? { object: { sha: 'parent' } } : { sha: 'new', tree: { sha: 'tree' } });
    } };
    vm.createContext(context); vm.runInContext(uploader, context);
    const error = await new Promise(resolve => context.ghPushFilesAtomic('o', 'r', 'main', [file], 'test-token', 'test', e => resolve(e), { validate }));
    return { error, calls };
  }
  const binaryPush = await push({ path: 'dad/src/x.bin', encoding: 'base64', read: async () => 'AP8B' });
  assert.equal(binaryPush.error, null);
  assert.equal(binaryPush.calls.find(c => c.url.endsWith('/blobs')).body.encoding, 'base64');
  assert.equal(binaryPush.calls.filter(c => c.method === 'PATCH').length, 1);
  const failedPush = await push({ path: 'dad/src/x.bin', read: async () => { throw new Error('unreadable'); } });
  assert.ok(failedPush.error); assert.equal(failedPush.calls.filter(c => c.method === 'PATCH').length, 0);
  const changedPush = await push({ path: 'dad/x', content: 'x' }, () => { throw new Error('changed'); });
  assert.match(changedPush.error.message, /changed/); assert.equal(changedPush.calls.filter(c => c.method === 'PATCH').length, 0);
  console.log('GitHub backup binary, chunk restore, integrity, mutation and cache privacy tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
