const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('weld-companion.user.js', 'utf8');

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

function load(names, code, extras) {
  const context = { URL, Number, isFinite, Array, console, ...extras };
  vm.createContext(context);
  vm.runInContext(code, context);
  return Object.fromEntries(names.map((name) => [name, context[name]]));
}

const fetchGuard = load(
  ['sbPrivateIpv4', 'sbIpv6Parts', 'sbPrivateIpv6', 'sbFetchGuard'],
  between('function sbPrivateIpv4(', 'function sbServiceFetch('),
);

for (const url of [
  'http://127.0.0.1:1234/v1/models',
  'http://10.0.0.1/',
  'http://[::1]/',
  'http://[fe81::1]/',
  'http://[fc00::1]/',
  'http://[::ffff:127.0.0.1]:1234/v1/models',
]) {
  assert.equal(fetchGuard.sbFetchGuard(url).ok, false, `must block ${url}`);
}
assert.equal(fetchGuard.sbFetchGuard('https://example.com/resource').ok, true);

const providerOptions = load(
  ['sbApplyMaxTokens', 'sbApplyTemperature'],
  between('function sbApplyMaxTokens(', 'function classifyAIError('),
);

const localAi = {};
providerOptions.sbApplyMaxTokens('localai', localAi, 77);
providerOptions.sbApplyTemperature('localai', localAi, 0.25);
assert.equal(JSON.stringify(localAi), JSON.stringify({ max_tokens: 77, temperature: 0.25 }));

const ollama = {};
providerOptions.sbApplyMaxTokens('ollama', ollama, 88);
providerOptions.sbApplyTemperature('ollama', ollama, 0);
assert.equal(JSON.stringify(ollama), JSON.stringify({ options: { num_predict: 88, temperature: 0 } }));

const google = {};
providerOptions.sbApplyMaxTokens('google', google, 99);
providerOptions.sbApplyTemperature('google', google, 0.5);
assert.equal(JSON.stringify(google), JSON.stringify({ generationConfig: { maxOutputTokens: 99, temperature: 0.5 } }));

assert.match(source, /redirect:\s*'error'/);
assert.match(source, /request\.abort\(\)/);
assert.match(source, /callOwnAIStream\(cfg, sys, user, !!payload\.json, maxTokens, temperature, emit, done\)/);

const calls = [];
const atomicPush = load(
  ['ghPushFilesAtomic'],
  between('function ghApiError(', 'function pushToGitHub('),
  {
    ghApi(method, path, token, body, done) {
      calls.push({ method, path, token, body });
      if (path.endsWith('/ref/heads/main')) return done(null, 200, { object: { sha: 'parent' } });
      if (path.endsWith('/commits/parent')) return done(null, 200, { tree: { sha: 'base-tree' } });
      if (path.endsWith('/blobs')) return done(null, 201, { sha: `blob-${calls.filter((call) => call.path.endsWith('/blobs')).length}` });
      if (path.endsWith('/trees')) return done(null, 201, { sha: 'new-tree' });
      if (path.endsWith('/commits')) return done(null, 201, { sha: 'new-commit' });
      if (path.endsWith('/refs/heads/main')) return done(null, 200, { object: { sha: 'new-commit' } });
      throw new Error(`unexpected API request: ${method} ${path}`);
    },
  },
);

let result;
atomicPush.ghPushFilesAtomic('owner', 'repo', 'main', [
  { path: 'generator/a.txt', content: 'dsl' },
  { path: 'generator/b.html', content: 'html' },
], 'token', 'Update generator', (err, value) => { result = { err, value }; });

assert.deepEqual(result, { err: null, value: 'updated' });
assert.equal(calls.filter((call) => call.path.endsWith('/blobs')).length, 2);
assert.equal(calls.at(-1).method, 'PATCH');
assert.match(calls.at(-1).path, /\/refs\/heads\/main$/);

console.log('skybridge and GitHub push contract tests passed');
