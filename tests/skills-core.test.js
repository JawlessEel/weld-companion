const assert = require('node:assert/strict');
const C = require('../src/skills-core.js');

// Stable catalog IDs support saved favorites; every preset must be runnable and scoped.
assert.equal(C.presets.length, 109);
assert.equal(new Set(C.presets.map(p => p.id)).size, C.presets.length);
assert.equal(C.categories.length, 14);
for (const p of C.presets) {
  assert.ok(C.categories.some(c => c.id === p.category));
  assert.equal(p.steps.length, 3);
  assert.ok(p.check.length > 30);
  assert.ok(p.types.every(id => C.types.some(t => t.id === id)));
  assert.ok(p.sources.every(id => C.sources.some(s => s.id === id)));
  assert.match(p.id, /^[a-z][a-z-]+$/);
  const prompt = C.buildPrompt(p.id, { slug: 'demo' });
  assert.ok(prompt.includes(p.task));
  assert.match(prompt, /current lists and HTML panels/);
  assert.match(prompt, /Preserve unrelated features/);
  assert.match(prompt, /actual plugin APIs/);
  assert.match(prompt, /Do not publish/);
  assert.match(prompt, /Separate observed results/);
  assert.match(prompt, /WORKFLOW/);
  assert.ok(prompt.includes(p.check));
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
// Saved favorites from 1.59 remain resolvable after the catalog expansion.
const original = 'fix-bugs triage-findings broken-controls generation-failures async-races imports-assets modern-ui mobile-layout theme-switcher layout-polish loading-feedback motion custom-feature settings-controls history-favorites copy-download batch-generation search-filter prompt-quality ai-chat image-gallery ai-resilience prompt-presets media-preview remember-settings restore-session import-export storage-audit data-validation organize-collections speed-audit speed-up memory-leaks large-results startup network-budget accessibility security-review input-safety test-workflows output-variety browser-compat explain-code refactor upgrade-roadmap new-feature-plan document release-review'.split(' ');
assert.equal(original.length, 48);
assert.ok(original.every(id => C.get(id)));
const dashboard = C.search('', '', null, { type: 'dashboard', mode: 'review' });
assert.ok(dashboard.some(p => p.id === 'financial-calculations'));
assert.ok(dashboard.some(p => p.id === 'upgrade-roadmap')); // Generic skills remain useful in full applications.
assert.ok(!dashboard.some(p => p.id === 'image-gallery' || p.id === 'create-random'));
assert.ok(dashboard.every(p => p.mode === 'review'));
const grouped = C.group(dashboard);
assert.equal(grouped[0].id, 'dashboards');
assert.deepEqual(grouped.flatMap(g => g.presets).map(p => p.id).sort(), dashboard.map(p => p.id).sort());
assert.equal(C.group([]).length, 0);
assert.ok(C.search('FRED', 'dashboards').some(p => p.id === 'market-feed-adapters'));
assert.ok(C.search('Chat characters', '', null, { type: 'chat' }).length);
assert.match(C.buildPrompt('financial-calculations', { type: 'dashboard' }), /GENERATOR FOCUS\nDashboards & applications/);
assert.match(C.buildPrompt('financial-calculations'), /do not implement changes during this review/);
assert.match(C.buildPrompt('market-feed-adapters'), /without embedding credentials in public generator code/);
assert.match(C.buildPrompt('data-freshness'), /never turn missing values into zero/);
assert.match(C.buildPrompt('feed-recovery'), /bounded reconnect/);
assert.match(C.buildPrompt('create-dashboard'), /rather than forcing random lists/);
assert.match(C.buildPrompt('report-contracts'), /single validated snapshot/);
assert.match(C.buildPrompt('analyst-grounding'), /unsupported probabilities/);
assert.match(C.buildPrompt('chat-branches'), /selected ancestry/);
assert.match(C.buildPrompt('sync-conflicts'), /Preserve unsynced work/);
assert.match(C.buildPrompt('prompt-assembly'), /do not run instructions embedded in imported templates/i);
assert.match(C.buildPrompt('model-capabilities'), /Mark unknowns/);
assert.match(C.buildPrompt('plugin-contracts'), /do not rename public options/i);
assert.match(C.buildPrompt('lorebook-builder'), /actual supported schema/);
assert.match(C.buildPrompt('lore-activation-audit'), /actually reach the prompt/);
assert.match(C.buildPrompt('character-export-fix'), /Never silently substitute a placeholder image/);
assert.ok(C.search('routing', 'agents', null, { type: 'agent' }).some(p => p.id === 'multi-model-routing'));
assert.throws(() => C.buildPrompt('image-gallery', { type: 'dashboard' }), /does not match/);
assert.throws(() => C.buildPrompt('fix-bugs', { type: 'unknown' }), /known generator type/);
const concise = C.buildPrompt('fix-bugs', { concise: true });
assert.match(concise, /Preserve complete code, exact names, error details, verification evidence/);
assert.ok(!C.buildPrompt('fix-bugs').includes('REPLY STYLE'));
for (const s of C.sources) {
  assert.match(s.url, /^https:\/\//);
  if (s.path) assert.match(s.url, /\/blob\/[a-f0-9]{40}\//);
}
console.log('Skills catalog, scope, search and prompt composition passed');
