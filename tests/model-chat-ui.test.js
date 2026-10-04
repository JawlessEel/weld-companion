const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('weld-companion.user.js', 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
function node(tag, attrs = {}, children = []) {
  const events = {};
  const n = { tag, attrs, children: children.filter(Boolean), value: attrs.value || '',
    appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) { (events[type] ||= []).push(fn); },
    fire(type) { if (attrs['on' + type]) attrs['on' + type]({}); for (const fn of events[type] || []) fn({}); },
    set innerHTML(value) { this.children = []; },
  };
  if (tag === 'select') n.value = (n.children.find(c => c.selected) || n.children[0]).attrs.value;
  return n;
}
const body = node('div');
function all(n = body) { return [n, ...n.children.flatMap(c => all(c))]; }
function find(predicate) { const n = all().find(predicate); assert.ok(n, 'control exists'); return n; }
function click(text) { find(n => n.tag === 'button' && n.attrs.text === text).fire('click'); }
function fill(id, text) { const n = find(n => n.attrs.id === id); n.value = text; n.fire('input'); }
let stored = { provider: 'localai', models: { localai: 'test-model' }, endpoints: { localai: 'http://localhost:1234' }, keys: {}, maxTokens: 4096 };
let pending, requests = [], aborted = 0, copies = [], native = '';
const context = {
  el: node, aiConfig: () => JSON.parse(JSON.stringify(stored)),
  gset(key, cfg) { stored = JSON.parse(JSON.stringify(cfg)); return true; },
  PROVIDERS: { localai: { label: 'Local / LM Studio', noKey: true, defaultModel: 'local-model', defaultEndpoint: 'http://localhost:1234' } },
  genName: () => 'chat-test', WC_TAB: 'tools', $: () => body, window: {},
  applyHelperInstruction() {}, toast() {}, copyText(text) { copies.push(text); },
  dslView: () => null, htmlView: () => null, openPerchanceAI(prompt) { native = prompt; },
  callOwnAI(cfg, sys, user, cb) { requests.push({ cfg, user }); pending = cb; return { abort() { aborted++; } }; },
  renderTab() { body.children = []; context.renderAI(body); },
};
vm.createContext(context);
vm.runInContext(between('var AI_WORKSPACE =', '// Pre-fill only'), context);
context.renderAI(body);
assert.equal(body.children[0].children[0].attrs.text, 'Conversation with selected model');
assert.equal(body.children[1].tag, 'details', 'connection settings follow the visible chat');
assert.ok(all().some(n => n.tag === 'label' && n.attrs.for === 'wc-model-chat-prompt'));
fill('wc-model-chat-prompt', 'Hello model'); click('Ask selected model');
assert.equal(requests.length, 1);
assert.equal(requests[0].cfg.models.localai, 'test-model');
assert.equal(requests[0].cfg.endpoints.localai, 'http://localhost:1234');
assert.equal(find(n => n.attrs.text === 'Working\u2026').disabled, true);
pending(null, 'Hello user');
assert.equal(find(n => n.attrs.id === 'wc-model-chat-reply').value, 'Hello user');
click('Copy reply'); assert.equal(copies[0], 'Hello user');
fill('wc-model-chat-prompt', 'Explain more'); click('Ask selected model');
assert.match(requests[1].user, /USER:\nHello model\nASSISTANT:\nHello user/);
const late = pending; click('Stop'); late(null, 'discarded');
assert.equal(aborted, 1);
assert.equal(find(n => n.attrs.id === 'wc-model-chat-reply').value, 'Hello user');
fill('wc-model-chat-prompt', 'Unsent draft'); context.renderTab();
assert.equal(find(n => n.attrs.id === 'wc-model-chat-prompt').value, 'Unsent draft');
click('Clear');
assert.equal(find(n => n.attrs.id === 'wc-model-chat-reply').value, '');
assert.equal(context.AI_WORKSPACE.history.length, 0);
stored.provider = 'builtin'; context.renderTab();
assert.ok(all().some(n => String(n.textContent || '').includes('native AI panel')));
fill('wc-model-chat-prompt', 'Native request'); click('Ask selected model');
assert.match(native, /Native request/);
assert.equal(requests.length, 2, 'built-in handoff never calls the external provider');
console.log('Model chat UI: send, reply, follow-up, copy, stop, draft, clear and native handoff passed');
