const assert = require('node:assert/strict');
const P = require('../src/project-core.js');
const D = require('../src/dev-core.js');

const DSL = [
  '$meta',
  '  title = Zoo',
  'output',
  '  A [animal] and [animal.pluralForm] met [name]',
  '  {big|small} [animal]',
  'animal',
  '  pig',
  '  cow',
  'name = {import:name-plugin}',
  'describe(x) =>',
  '  return animal.selectOne + x',
  ''
].join('\n');
const HTML = [
  '<p id="out">[output]</p>',
  '<button onclick="show(animal)">go</button>',
  '<script>',
  'function show(a) { console.log(root.animal.selectOne, a, "animal"); var t = animal.length; }',
  '</script>'
].join('\n');
const src = { name: 'zoo', dsl: DSL, html: HTML, deps: null };

// ---- primer -----------------------------------------------------------------
assert.match(D.PRIMER, /evaluateItem/);
assert.match(D.PRIMER, /Do not add content filters/);
assert.match(D.PRIMER, /\$output/);
assert.ok(D.PRIMER.length > 2500 && D.PRIMER.length < 9000, 'primer is substantial but bounded: ' + D.PRIMER.length);
assert.ok(D.PRIMER_SHORT.length < 600);

// ---- toolbox ------------------------------------------------------------------
const box = D.makeToolbox(() => src);
assert.deepEqual(box.names.sort(), ['find_usages', 'get_findings', 'get_html_map', 'get_imports', 'get_lines', 'get_outline', 'get_primer', 'get_source', 'search']);
const lines = box.call('get_lines', { pane: 'dsl', start: 3, end: 5 });
assert.equal(lines.start_line, 3);
assert.match(lines.text, /^3: output\n4: {3}A \[animal\]/);
assert.equal(lines.total_lines, DSL.split('\n').length);
const big = D.makeToolbox(() => ({ dsl: Array.from({ length: 900 }, (_, i) => 'line' + i).join('\n'), html: null }));
const capped = big.call('get_lines', { start: 1, end: 900 });
assert.equal(capped.end_line, 400, 'at most 400 lines per call');
assert.equal(capped.more, true);
assert.throws(() => big.call('get_lines', { pane: 'html' }), /HTML panel is not loaded/);
const both = box.call('get_source', {});
assert.ok(both.dsl.text && both.html.text);
assert.equal(box.call('get_outline').lists.find(l => l.name === 'animal').items, 2);
assert.equal(box.call('get_findings', { min_severity: 'info' }).counts.warn, 0, 'a clean generator has no warnings');
const flawed = D.makeToolbox(() => ({ name: 'f', dsl: 'output\n  [missing]\n', html: '<p>[output]</p>' })).call('get_findings', {});
assert.equal(flawed.findings[0].message.includes('missing'), true);
assert.equal(flawed.counts.warn, 1);
assert.ok(box.call('search', { query: 'PIG' }).matches.some(m => m.pane === 'dsl' && m.line === 7));
assert.ok(box.call('get_html_map').includes('Element ids'));
assert.ok(box.call('get_imports').imports.includes('name-plugin'));
assert.throws(() => box.call('rm_rf', {}), /Unknown tool/);
assert.throws(() => D.makeToolbox(() => null).call('get_outline'), /No generator is loaded/);

// ---- investigate protocol ----------------------------------------------------
assert.deepEqual(D.parseToolCalls('text\n```weld-tool\n{"tool":"get_lines","args":{"start":1}}\n```\nmore\n```weld-tool\n{"tool":"get_outline"}\n```').calls.map(c => c.tool), ['get_lines', 'get_outline']);
assert.equal(D.parseToolCalls('```weld-tool\n{not json}\n```').errors.length, 1);
assert.equal(D.parseToolCalls('plain answer with ```js\ncode\n``` only').calls.length, 0);
(async () => {
  const asked = [];
  let step = 0;
  const out = await D.investigate({
    system: 'SYS', user: 'USER', toolbox: box,
    ask: async (sys, user) => { asked.push({ sys, user }); step++; return step === 1 ? '```weld-tool\n{"tool":"get_lines","args":{"pane":"dsl","start":1,"end":3}}\n```' : 'FINAL ANSWER'; }
  });
  assert.equal(out.reply, 'FINAL ANSWER');
  assert.equal(asked.length, 2);
  assert.match(asked[0].sys, /weld-tool/, 'the protocol is appended to the system prompt');
  assert.match(asked[1].user, /RESULT of get_lines/);
  assert.match(asked[1].user, /1: \$meta/);
  assert.deepEqual(out.steps, ['get_lines']);

  // only read-only tools in the allow-list, even if the model asks for others
  step = 0;
  const bad = await D.investigate({ system: 's', user: 'u', toolbox: box, ask: async (s, u) => (++step === 1 ? '```weld-tool\n{"tool":"get_primer"}\n```\n```weld-tool\n{"tool":"apply_edit","args":{}}\n```' : (/Tool not available/.test(u) ? 'handled' : 'missed')) });
  assert.equal(bad.reply, 'handled');

  // a model that never stops asking is cut off
  let rounds = 0;
  const loop = await D.investigate({ system: 's', user: 'u', toolbox: box, maxRounds: 2, ask: async () => { rounds++; return 'thinking\n```weld-tool\n{"tool":"get_outline"}\n```'; } });
  assert.equal(loop.exhausted, true);
  assert.equal(rounds, 3);
  // cancellation
  let cancelled = false;
  await assert.rejects(D.investigate({ system: 's', user: 'u', toolbox: box, isCancelled: () => cancelled, ask: async () => { cancelled = true; return '```weld-tool\n{"tool":"get_outline"}\n```'; } }), /Stopped/);

  console.log('Dev core: primer, toolbox and investigate protocol passed');
})().catch(e => { console.error(e); process.exit(1); });

// ---- find usages / rename --------------------------------------------------------
const uses = D.findUsages(DSL, HTML, 'animal');
const kinds = uses.hits.map(h => h.pane + ':' + h.line + ':' + h.kind);
assert.ok(kinds.includes('dsl:6:definition'), kinds.join());
assert.ok(kinds.includes('dsl:4:reference') && kinds.includes('dsl:5:reference'));
assert.ok(kinds.includes('dsl:11:code'), 'a use inside a function body');
assert.ok(kinds.includes('html:2:code'), 'inline handler');
assert.ok(kinds.some(k => k.startsWith('html:4:')), 'script uses');
assert.ok(D.findUsages(DSL, HTML, 'nope').hits.length === 0);
assert.match(D.findUsages(DSL, HTML, '$bad').error, /not a valid/);

const rn = D.rename(DSL, HTML, 'animal', 'beast');
assert.ok(!rn.error, rn.error);
assert.match(rn.dsl, /^beast$/m, 'definition renamed');
assert.match(rn.dsl, /A \[beast\] and \[beast\.pluralForm\] met \[name\]/, 'references and property chains renamed');
assert.match(rn.dsl, /\{big\|small\} \[beast\]/);
assert.match(rn.dsl, /return beast\.selectOne \+ x/, 'function body renamed');
assert.match(rn.html, /onclick="show\(beast\)"/);
assert.match(rn.html, /root\.beast\.selectOne/);
assert.match(rn.html, /var t = beast\.length/);
assert.match(rn.html, /"animal"\)/, 'string literals are untouched');
assert.doesNotMatch(rn.dsl, /\banimal\b/);
assert.equal(rn.counts.definition, 1);
assert.ok(rn.total >= 6);
// property names after a dot are not references
const prop = D.rename('output\n  [thing.name] [name]\nname\n  x\nthing\n  name = y\n', '<p>[output]</p>', 'name', 'label');
assert.match(prop.dsl, /\[thing\.name\] \[label\]/);
assert.match(prop.dsl, /^label$/m);
assert.match(prop.dsl, /^ {2}name = y$/m, 'a nested property of the same name is a different thing');
// guards
assert.match(D.rename(DSL, HTML, 'animal', 'name').error, /already exists/);
assert.match(D.rename(DSL, HTML, 'animal', 'out').error || '', /^$|id/, 'allowed unless an element has the id');
assert.match(D.rename(DSL, HTML, 'animal', 'out').error || 'ok', /ok|id/);
assert.match(D.rename(DSL, HTML, 'animal', 'class').error, /not a valid name/);
assert.match(D.rename(DSL, HTML, 'animal', '9x').error, /not a valid name/);
assert.match(D.rename(DSL, HTML, 'ghost', 'x2').error, /not defined/);
assert.match(D.rename(DSL, HTML, 'animal', 'animal').error, /same/);
assert.match(D.rename(DSL, '<p id="beast"></p>' + HTML, 'animal', 'beast').error, /id "beast"/);
// the <script> tag line is never edited
const tagLine = D.rename('script\n  a\noutput\n  [script]\n', '<script type="module">root.script.selectOne</script>', 'script', 'story');
assert.match(tagLine.html, /<script type="module">root\.story\.selectOne<\/script>/);

// ---- sample comparison ------------------------------------------------------------
const before = Array.from({ length: 40 }, (_, i) => (i % 2 ? 'Red Fox runs' : 'Blue Owl flies') + ' ' + (i % 7));
const afterSame = before.slice().reverse();
assert.equal(D.compareSamples(before, afterSame).changed, false);
const afterChanged = Array.from({ length: 40 }, (_, i) => 'Green Dragon breathes fire loudly ' + (i % 3));
const cmp = D.compareSamples(before, afterChanged);
assert.equal(cmp.changed, true);
assert.ok(cmp.lost.some(w => w.word === 'fox') && cmp.gained.some(w => w.word === 'dragon'));
assert.ok(cmp.lines.some(l => /length/.test(l)));
assert.match(D.compareSamples([], ['a']).error, /at least one/);

// ---- edit proposals ---------------------------------------------------------------
const text = 'a\nb\nc\nd';
assert.equal(D.applyLineEdits(text, [{ start_line: 2, end_line: 3, text: 'X\nY\nZ' }]), 'a\nX\nY\nZ\nd');
assert.equal(D.applyLineEdits(text, [{ start_line: 2, end_line: 1, text: 'new' }]), 'a\nnew\nb\nc\nd', 'end = start - 1 inserts');
assert.equal(D.applyLineEdits(text, [{ start_line: 5, end_line: 4, text: 'tail' }]), 'a\nb\nc\nd\ntail', 'insert after the last line');
assert.equal(D.applyLineEdits(text, [{ start_line: 2, end_line: 3, text: '' }]), 'a\nd', 'empty text deletes');
assert.equal(D.applyLineEdits(text, [{ start_line: 1, end_line: 1, text: '1' }, { start_line: 4, end_line: 4, text: '4' }]), '1\nb\nc\n4', 'several edits use original line numbers');
assert.throws(() => D.applyLineEdits(text, [{ start_line: 2, end_line: 3, text: 'x' }, { start_line: 3, end_line: 3, text: 'y' }]), /overlap/);
assert.throws(() => D.applyLineEdits(text, [{ start_line: 9, end_line: 9, text: 'x' }]), /outside the document/);
assert.throws(() => D.applyLineEdits(text, [{ start_line: 2, end_line: 9, text: 'x' }]), /invalid/);
assert.throws(() => D.applyLineEdits(text, []), /non-empty/);
assert.equal(D.applyLineEdits('a\r\nb', [{ start_line: 2, end_line: 2, text: 'B' }]), 'a\nB', 'CRLF is normalized');
const prop1 = D.makeProposal({ id: 'p1', pane: 'dsl', current: text, edits: [{ start_line: 1, end_line: 1, text: 'A' }], note: 'why', agent: 'claude-code' });
assert.equal(prop1.after, 'A\nb\nc\nd'); assert.equal(prop1.status, 'pending'); assert.equal(D.proposalState(prop1, text), 'fresh');
assert.equal(D.proposalState(prop1, text + '\nchanged'), 'stale');
assert.throws(() => D.makeProposal({ id: 'p', pane: 'dsl', current: text, new_text: text }), /does not change/);
assert.throws(() => D.makeProposal({ id: 'p', pane: 'dsl', current: text, new_text: 'x', edits: [] }), /either new_text or edits/);
assert.equal(D.makeProposal({ id: 'p', pane: 'html', current: text, new_text: 'whole' }).pane, 'html');
assert.equal(D.makeProposal({ id: 'p', pane: 'weird', current: text, new_text: 'whole' }).pane, 'dsl');

// ---- folder sync ----------------------------------------------------------------------
assert.deepEqual(D.folderPaths('dad-chat'), { dsl: 'dad-chat/dad-chat-top-panel.txt', html: 'dad-chat/dad-chat-html-panel.html' });
['../x', 'a/b', '', '.hidden', 'a b', 'C:evil'].forEach(s => assert.throws(() => D.folderPaths(s), /not a safe/, s));
assert.throws(() => D.folderPaths('ok', { dslPath: '../{name}.txt' }), /Unsafe path/);
assert.throws(() => D.folderPaths('ok', { dslPath: 'C:/x/{name}.txt' }), /Unsafe path/);
assert.equal(D.safeSlug('abc_DEF-9'), 'abc_DEF-9');
const E = { dsl: 'a\nb', html: '<p>' }, B = { dsl: 'a', html: '<p>' };
assert.equal(D.syncPlan(null, E, B).state, 'no-editor');
assert.equal(D.syncPlan(E, null, B).state, 'no-disk');
assert.equal(D.syncPlan(E, { dsl: 'a\r\nb\r\n', html: '<p>\n' }, B).state, 'in-sync', 'CRLF and trailing newlines do not count as changes');
assert.equal(D.syncPlan(E, { dsl: 'a', html: '<p>' }, { dsl: 'a', html: '<p>' }).state, 'editor-ahead');
assert.equal(D.syncPlan({ dsl: 'a', html: '<p>' }, { dsl: 'a\nb', html: '<p>' }, { dsl: 'a', html: '<p>' }).state, 'disk-ahead');
assert.equal(D.syncPlan({ dsl: 'x', html: '<p>' }, { dsl: 'y', html: '<p>' }, { dsl: 'a', html: '<p>' }).state, 'conflict');
assert.equal(D.syncPlan({ dsl: 'x', html: '<p>' }, { dsl: 'y', html: '<p>' }, null).state, 'unknown');
assert.equal(D.syncPlan({ dsl: 'x', html: null }, { dsl: 'x', html: '<p>' }, null).state, 'in-sync', 'a missing HTML pane is not compared');

// ---- agent hand-off ----------------------------------------------------------------------
const base = { slug: 'dad-chat', request: 'Make the greeting list longer and fix any bugs', repo: { owner: 'me', repo: 'perchance_backups', branch: 'main' }, paths: D.folderPaths('dad-chat'), findings: [{ severity: 'warn', pane: 'dsl', line: 4, message: 'bad thing' }, { severity: 'info', pane: 'dsl', line: 0, message: 'skip me' }] };
const cop = D.buildAgentIssue({ ...base, agent: 'copilot' });
assert.deepEqual(cop.assignees, ['copilot-swe-agent[bot]']);
assert.deepEqual(Object.keys(cop.agent_assignment), ['target_repo', 'base_branch', 'custom_instructions']);
assert.equal(cop.agent_assignment.target_repo, 'me/perchance_backups');
assert.match(cop.title, /^\[Weld\] dad-chat: Make the greeting/);
assert.match(cop.body, /dad-chat\/dad-chat-top-panel\.txt/);
assert.match(cop.body, /bad thing/); assert.doesNotMatch(cop.body, /skip me/, 'notes are not sent to agents');
assert.match(cop.body, /Do not add content filters/i);
assert.equal(cop.comment, '');
const cl = D.buildAgentIssue({ ...base, agent: 'claude' });
assert.match(cl.comment, /^@claude /); assert.deepEqual(cl.assignees, []);
assert.match(D.buildAgentIssue({ ...base, agent: 'codex' }).comment, /^@codex /);
assert.equal(D.buildAgentIssue({ ...base, agent: 'nonsense' }).agent, 'plain');
assert.throws(() => D.buildAgentIssue({ ...base, request: '  ' }), /Describe/);
assert.throws(() => D.buildAgentIssue({ ...base, slug: '../x' }), /normal name/);
assert.ok(D.buildAgentIssue({ ...base, request: 'x'.repeat(500) }).title.length < 100);
const overview = 'analyze and tell me what this project is overall, a short quick explanation';
for (const request of [overview, 'Review the code', 'Explain how to fix the errors', 'Analyze and make recommendations', 'Create a report', 'Fix the bug without modifying files', 'Read-only: analyze and fix nothing', 'What is this project?']) {
  assert.equal(D.agentTaskMode(request), 'analysis', request);
}
for (const request of [base.request, 'Add more animals', 'Please fix the errors', 'Can you update the styles?', 'Analyze the source and fix the confirmed bugs']) {
  assert.equal(D.agentTaskMode(request), 'change', request);
}
assert.equal(D.agentTaskMode('Fix the bug', 'analysis'), 'analysis');
assert.equal(D.agentTaskMode('Improve the layout', 'change'), 'change');
assert.throws(() => D.agentTaskMode(overview, 'invalid'), /valid task mode/);
for (const agent of ['copilot', 'claude', 'codex', 'plain']) {
  const issue = D.buildAgentIssue({ ...base, request: overview, agent });
  assert.equal(issue.mode, 'analysis');
  assert.match(issue.body, /Analyze and report \(read-only\)/);
  assert.match(issue.body, /Do not edit any files/);
  assert.match(issue.body, /Automatic findings are context to inspect/);
  assert.doesNotMatch(issue.body, /Rules for the change|Edit only|After the change is merged/);
  if (agent === 'copilot') assert.match(issue.agent_assignment.custom_instructions, /Read-only analysis/);
  if (agent === 'claude' || agent === 'codex') {
    assert.match(issue.comment, /without editing files/);
    assert.doesNotMatch(issue.comment, /please implement|and open a pull request/);
  }
}
assert.equal(cop.mode, 'change');
assert.match(cop.body, /After the change is merged/);
assert.match(cl.comment, /please implement/);
assert.equal(D.pushBranchName('dad-chat', Date.UTC(2026, 9, 3, 7, 5)), 'weld/dad-chat-20261003-0705');

// ---- gate -----------------------------------------------------------------------------
const gate = D.gateReport(P.analyze({ dsl: 'output\n  [missing]\n', html: '<p>[output]</p>' }), 'warn');
assert.equal(gate.count, 1); assert.match(gate.lines[0], /missing/);
assert.equal(D.gateReport(P.analyze({ dsl: 'output\n  ok\n' }), 'warn').count, 0);

// ---- bridge tool table ------------------------------------------------------------------
const names = D.BRIDGE_TOOLS.map(t => t.name);
assert.equal(new Set(names).size, names.length);
D.BRIDGE_TOOLS.forEach(t => {
  assert.match(t.name, /^weld_[a-z_]+$/); assert.ok(t.description.length > 20); assert.equal(t.inputSchema.type, 'object');
  if (t.run) assert.ok(box.names.includes(t.run), t.name + ' maps to a real toolbox tool');
});
assert.equal(D.BRIDGE_TOOLS.filter(t => !t.readOnly).map(t => t.name).join(), 'weld_propose_edit', 'the only write-capable tool only proposes');
console.log('Dev core: refactoring, proposals, folder sync, agent hand-off and tool table passed');
