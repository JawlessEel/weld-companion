// Optional live smoke test against an already-running LM Studio server.
// Sends only a synthetic world; never reads user project data or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/studio-core.js');
async function main() {
  const endpoint = process.argv[2] || 'http://127.0.0.1:1234';
  const models = await (await fetch(endpoint + '/v1/models', { signal: AbortSignal.timeout(10000) })).json();
  const model = process.argv[3] || models.data?.[0]?.id;
  if (!model) throw new Error('No local model listed.');
  const p = C.project('Synthetic harbor test', 'character'), c = p.characters[0];
  c.name = 'Arin'; c.voice = 'Concise'; p.world.description = 'Silver Harbor is a coastal town.';
  p.lore.push({ id: C.id(), title: 'Tower key', body: 'The tower key is blue.', keywords: 'tower', activation: 'keywords',
    visibility: 'public', knownBy: [], priority: 1, kind: 'item', entity: '', attribute: '', value: '', source: '' });
  const ctx = C.context(p, C.session(p, c.id), 'What color is the tower key? Answer with just the color.');
  assert.equal(ctx.selected.length, 1);
  const source = fs.readFileSync('weld-companion.user.js', 'utf8');
  // Exercise the real production provider adapter with fetch standing in for GM transport.
  let cfg = { provider: 'localai', endpoints: { localai: endpoint }, models: { localai: model }, keys: {} };
  const sandbox = {
    gget: () => cfg,
    GM_xmlhttpRequest(options) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout);
      fetch(options.url, { method: options.method, headers: options.headers, body: options.data, signal: controller.signal })
        .then(async res => options.onload({ status: res.status, responseText: await res.text() }))
        .catch(err => controller.signal.aborted ? options.ontimeout() : options.onerror({ status: 0, responseText: err.message }))
        .finally(() => clearTimeout(timeout));
      return { abort: () => controller.abort() };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('  var PROVIDERS ='), source.indexOf('  // ---- D3:')), sandbox);
  const answer = await new Promise((resolve, reject) => sandbox.callOwnAI(cfg, ctx.system, ctx.user,
    (err, reply) => err ? reject(new Error(err)) : resolve(reply), false, 4096, 0));
  assert.match(answer.toLowerCase(), /\bblue\b/);
  console.log(JSON.stringify({ model, selectedLore: ctx.selected.map(l => l.title), answer: answer.trim(), passed: true }));
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
