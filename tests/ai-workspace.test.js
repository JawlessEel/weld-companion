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

const defaults = load(
  ['aiConfig'],
  between('function aiConfig(', '// D4 consumer:'),
  { gget: () => ({ provider: 'localai' }) },
).aiConfig();

assert.equal(defaults.provider, 'localai');
assert.equal(defaults.interceptAgent, false);
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

console.log('review-first AI workspace contract tests passed');
