const assert = require('node:assert/strict');
const C = require('../src/skills-core.js');

// Stable catalog IDs support saved favorites; every preset must be runnable and scoped.
assert.equal(C.presets.length, 48);
assert.equal(new Set(C.presets.map(p => p.id)).size, C.presets.length);
assert.equal(C.categories.length, 8);
for (const p of C.presets) {
  assert.ok(C.categories.some(c => c.id === p.category));
  assert.match(p.id, /^[a-z][a-z-]+$/);
  const prompt = C.buildPrompt(p.id, { slug: 'demo' });
  assert.ok(prompt.includes(p.task));
  assert.match(prompt, /current lists and HTML panels/);
  assert.match(prompt, /Preserve unrelated features/);
  assert.match(prompt, /actual plugin APIs/);
  assert.match(prompt, /Do not publish/);
  assert.match(prompt, /Separate observed results/);
  assert.match(prompt, p.mode === 'review' ? /MODE: REVIEW ONLY\. Do not modify/ : /MODE: IMPLEMENT\./);
}
assert.throws(() => C.buildPrompt('not-a-skill'), /Choose a valid skill/);
assert.equal(C.get('not-a-skill'), null);
assert.ok(C.search(' MOBILE ', 'design').some(p => p.id === 'mobile-layout'));
assert.equal(C.search('mobile', 'data').length, 0);
assert.equal(C.search('', '', []).length, 0);
assert.deepEqual(C.search('gallery', '', ['image-gallery', 'fix-bugs']).map(p => p.id), ['image-gallery']);
assert.ok(C.search('input rendering', 'quality').some(p => p.id === 'input-safety'));
assert.equal(C.search('no such elephant preset').length, 0);

const details = 'Keep my gallery intact.\nAdd controls for <wide> images.';
const prompt = C.buildPrompt('custom-feature', { slug: 'my-gen', details, findings: [
  { severity: 'warn', pane: 'html', line: 42, message: 'Unknown [name]', hint: 'Check the list.' },
  { severity: 'error', pane: 'dsl', line: 3, message: 'Broken syntax' },
  { severity: 'info', pane: 'html', message: 'Uses images' }
] });
assert.ok(prompt.includes('USER DETAILS\n' + details));
assert.match(prompt, /\(my-gen\)/);
assert.match(prompt, /\[warn\] html line 42: Unknown \[name\]\n  Hint: Check the list\./);
assert.match(prompt, /\[error\] dsl line 3: Broken syntax/);
assert.ok(!prompt.includes('Uses images'));
assert.match(prompt, /validate against current source/);
assert.match(C.buildPrompt('fix-bugs', { findings: [] }), /not proof of correctness/);
assert.ok(!C.buildPrompt('fix-bugs').includes('WELD HEURISTIC FINDINGS'));
assert.match(C.buildPrompt('custom-feature'), /If no feature is specified, ask one focused question/);
console.log('Skills catalog, scope, search and prompt composition passed');
