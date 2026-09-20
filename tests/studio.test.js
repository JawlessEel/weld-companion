const assert = require('node:assert/strict');
const C = require('../src/studio-core.js');
const p = C.project('Test world', 'adventure');
const hero = p.characters[0], other = C.character('Other');
p.characters.push(other);
hero.personality = 'Careful'; hero.notes = 'AUTHOR_ONLY_SENTINEL';
const makeLore = (title, overrides = {}) => ({
  id: C.id(), title, kind: 'world', body: title, keywords: 'tower', activation: 'keywords', priority: 0,
  visibility: 'public', knownBy: [], entity: '', attribute: '', value: '', source: '', ...overrides
});
p.lore.push(makeLore('public tower'), makeLore('SECRET_SENTINEL', { visibility: 'private', knownBy: [other.id] }),
  makeLore('Known secret', { visibility: 'private', knownBy: [hero.id] }),
  makeLore('Disabled entry', { activation: 'manual' }));
const s = C.session(p, hero.id, 'A');
p.sessions.push(s);
s.memories.push({ id: C.id(), text: 'APPROVED_SENTINEL' });
s.proposals.push({ id: C.id(), text: 'UNAPPROVED_SENTINEL' });
let ctx = C.context(p, s, 'Explore the tower');
assert.match(ctx.system, /public tower/);
assert.match(ctx.system, /Known secret/);
assert.match(ctx.system, /APPROVED_SENTINEL/);
assert.doesNotMatch(ctx.system, /SECRET_SENTINEL|UNAPPROVED_SENTINEL|AUTHOR_ONLY_SENTINEL|Disabled entry/);
assert.equal(C.context(p, C.session(p, hero.id), 'hello').selected.length, 0);
assert.doesNotMatch(C.context(p, C.session(p, hero.id), 'tower').system, /APPROVED_SENTINEL/);
s.messages.push({ role: 'user', content: 'Visit the tower' });
assert.equal(C.context(p, s, 'Continue').selected.length, 2, 'recent history activates lore');
p.settings.loreChars = 1000;
p.lore.push(makeLore('Too large', { body: 'x'.repeat(1200), priority: 100 }));
assert.ok(C.context(p, s, 'tower').skipped.includes('Too large'));
p.world.rules = 'z'.repeat(25000);
assert.throws(() => C.context(p, s, 'hi'), /exceeds/);
p.world.rules = '';
const suggestions = C.parseMemories('["The hero met a baker."]');
assert.equal(suggestions.length, 1);
assert.throws(() => C.parseMemories('{"shell":"bad"}'), /array/);
assert.throws(() => C.parseMemories('[{"text":"bad"}]'), /nonempty/);
s.proposals.push(...suggestions);
C.approve(s, suggestions[0].id, 'The hero met a baker named Lee.');
assert.equal(s.proposals.some(x => x.id === suggestions[0].id), false);
assert.equal(s.memories.at(-1).text, 'The hero met a baker named Lee.');
assert.throws(() => C.approve(s, suggestions[0].id, 'again'), /no longer/);
p.lore.push(makeLore('Age 20', { entity: 'Hero', attribute: 'age', value: '20' }),
  makeLore('Age 21', { entity: 'hero', attribute: 'Age', value: '21' }));
p.timeline.push({ id: 'first', title: 'Birth', order: 10, after: '', description: '', visibility: 'public', knownBy: [] },
  { id: 'second', title: 'Earlier', order: 5, after: 'first', description: '', visibility: 'public', knownBy: [] });
assert.ok(C.audit(p).some(i => i.message.includes('Conflicting fact')));
assert.ok(C.audit(p).some(i => i.message.includes('come earlier')));
const restored = C.importBundle(C.bundle(p));
assert.deepEqual(restored, p, 'bundle preserves complete project state');
assert.throws(() => C.importBundle('{"format":"wrong"}'), /supported/);
const broken = C.copy(p); broken.characters.push(broken.characters[0]);
assert.throws(() => C.validate(broken), /duplicate/);
assert.equal(C.characterFromAICC({ character: { name: 'Imported', roleInstruction: 'Voice', firstMessage: 'Hello' } }).opening, 'Hello');
assert.doesNotMatch(C.characterToAICC(p, hero).roleInstruction, /SECRET_SENTINEL|AUTHOR_ONLY_SENTINEL/);
for (const template of Object.keys(C.templates)) assert.equal(C.validate(C.project('Template', template)).template, template);
const ensemble = C.project('Cast', 'ensemble');
const castMember = C.character('Mira'); castMember.voice = 'Short sentences'; castMember.notes = 'CAST_AUTHOR_SECRET';
ensemble.characters.push(castMember);
const ensembleContext = C.context(ensemble, C.session(ensemble, ensemble.characters[0].id), 'Begin');
assert.match(ensembleContext.system, /Mira/);
assert.doesNotMatch(ensembleContext.system, /CAST_AUTHOR_SECRET/);
const invalidMemory = C.copy(p);
invalidMemory.sessions[0].memories.push(invalidMemory.sessions[0].memories[0]);
assert.throws(() => C.validate(invalidMemory), /duplicate/);
console.log('Studio project, knowledge isolation, retrieval, memory approval, consistency, and round-trip tests passed');
