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

function load(names, code, extras = {}) {
  const context = { ...extras };
  vm.createContext(context);
  vm.runInContext(code, context);
  return Object.fromEntries(names.map((name) => [name, context[name]]));
}

const extraction = load(
  ['aiExtractCode'],
  between('function aiExtractCode(', 'function aiWorkspaceSystem('),
);

const mixedReply = [
  'Here is the change.',
  '```html',
  '<main>new</main>',
  '```',
  '```perchance',
  'output = new value',
  '```',
].join('\n');

assert.equal(extraction.aiExtractCode(mixedReply, 'dsl'), 'output = new value');
assert.equal(extraction.aiExtractCode(mixedReply, 'html'), '<main>new</main>');
assert.equal(extraction.aiExtractCode('plain proposed code', 'dsl'), 'plain proposed code');
assert.throws(() => extraction.aiExtractCode('```html\n<p>wrong pane</p>\n```', 'dsl'), /differently labeled/);
assert.throws(() => extraction.aiExtractCode('```dsl\none\n```\n```dsl\ntwo\n```', 'dsl'), /ambiguous/);
assert.equal(extraction.aiExtractCode('```dsl\n  indented\n```', 'dsl'), '  indented');

const defaults = load(
  ['aiConfig'],
  between('function aiConfig(', '// D4 consumer:'),
  { gget: () => ({ provider: 'localai' }) },
).aiConfig();

assert.equal(defaults.provider, 'localai');
assert.equal(defaults.interceptAgent, false);
assert.equal(defaults.maxTokens, 4096);
assert.equal(JSON.stringify(defaults.keys), '{}');
assert.equal(JSON.stringify(defaults.models), '{}');
assert.equal(JSON.stringify(defaults.endpoints), '{}');

const hookSource = between('function aiAgentButton(', '// ============================================================ bootstrap');
assert.match(hookSource, /#aiAgentSendBtn/);
assert.match(hookSource, /#aiAgentInputEl/);
assert.match(hookSource, /cfg\.interceptAgent/);
assert.doesNotMatch(hookSource, /viewSet\s*\(/);

const instructionSource = between('function applyHelperInstruction(', 'function aiAgentButton(');
assert.doesNotMatch(instructionSource, /aiHelperInputEl/);

// Exercise actual asynchronous request and review handlers without a browser.
let pending, aborts = 0, writes = 0, throwsOnStart = false;
let doc = 'original';
const view = {};
const roots = [];
function node(tag, attrs = {}, children = []) {
  return { tag, attrs, children, appendChild(child) { this.children.push(child); },
    addEventListener() {}, remove() {} };
}
const runtime = load(
  ['AI_WORKSPACE', 'aiAskWorkspace', 'aiStopWorkspace', 'renderAIReviewModal'],
  between('var AI_WORKSPACE =', 'function renderAI(body)'),
  {
    aiConfig: () => ({ provider: 'localai', maxTokens: 8192 }),
    PROVIDERS: { localai: { label: 'Local' } },
    WC_TAB: null, $: () => null, toast() {},
    dslView: () => view, htmlView: () => view, viewText: () => doc,
    genName: () => 'test-project', el: node,
    document: { addEventListener() {}, removeEventListener() {}, body: { appendChild(n) { roots.push(n); } } },
    lineDiffOps: () => [], diffStats: () => ({ add: 1, del: 1 }), diffRows: () => [],
    muteBugFinderError: () => () => {}, setTimeout() {},
    viewSet(v, text) { writes++; doc = text; return true; },
    callOwnAI(cfg, sys, user, callback, json, maxTokens) {
      if (throwsOnStart) throw new Error('transport unavailable');
      assert.equal(maxTokens, 8192);
      pending = callback;
      return { abort() { aborts++; } };
    },
  },
);
const state = runtime.AI_WORKSPACE;
state.prompt = 'fix it'; state.response = 'previous answer';
assert.equal(runtime.aiAskWorkspace(), true);
assert.equal(state.response, 'previous answer');
assert.equal(runtime.aiAskWorkspace(), false, 'duplicate request is blocked');
const oldCallback = pending;
runtime.aiStopWorkspace(true);
assert.equal(aborts, 1);
oldCallback(null, 'late reply');
assert.equal(state.response, '', 'clear cannot be undone by a late callback');
state.prompt = 'retry';
runtime.aiAskWorkspace();
oldCallback(null, 'stale reply during a newer request');
assert.equal(state.busy, true);
pending(null, 'new answer');
assert.equal(state.response, 'new answer');
assert.equal(state.busy, false);
throwsOnStart = true;
runtime.aiAskWorkspace();
assert.equal(state.busy, false, 'synchronous errors release the busy state');
assert.match(state.status, /transport unavailable/);
assert.equal(state.response, 'new answer', 'failure preserves the previous reply');

function findApply(n) {
  if (n.attrs.text === 'Apply to DSL') return n;
  for (const child of n.children) { const found = findApply(child); if (found) return found; }
}
state.response = '```dsl\nreplacement\n```';
runtime.renderAIReviewModal('dsl');
assert.equal(writes, 0, 'opening review must not write');
doc = 'new user edits';
findApply(roots.at(-1)).attrs.onclick();
assert.equal(writes, 0, 'stale diff must not overwrite newer edits');
runtime.renderAIReviewModal('dsl');
findApply(roots.at(-1)).attrs.onclick();
assert.equal(writes, 1, 'explicit apply on a fresh diff writes once');
assert.equal(doc, 'replacement');

let transport, adapterResult;
const adapter = load(['callOwnAI'], between('function callOwnAI(', '// ---- D3:'), {
  PROVIDERS: { localai: {
    noKey: true, defaultModel: 'test', defaultEndpoint: 'http://localhost:1234',
    body: () => '{}', url: () => 'http://localhost:1234/v1/chat/completions',
    headers: () => ({}), extract: (j) => j.choices[0].message.content,
  } },
  GM_xmlhttpRequest(options) { transport = options; return { abort() {} }; },
});
adapter.callOwnAI({ provider: 'localai' }, '', '', (err, text) => { adapterResult = { err, text }; });
transport.onload({ status: 200, responseText: JSON.stringify({
  choices: [{ message: { content: 'partial code' }, finish_reason: 'length' }],
}) });
assert.match(adapterResult.err, /incomplete/);
assert.equal(adapterResult.text, null);
transport.onload({ status: 200, responseText: JSON.stringify({
  choices: [{ message: { content: 'complete answer' }, finish_reason: 'stop' }],
}) });
assert.deepEqual(adapterResult, { err: null, text: 'complete answer' });

console.log('AI workspace extraction, cancellation, failure recovery, truncation, and stale-review tests passed');
