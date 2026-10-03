const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('weld-companion.user.js', 'utf8');
const start = source.indexOf('function isCmView(');
const end = source.indexOf('function viewText(', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const code = source.slice(start, end);

function view() {
  return { state: { doc: {} }, dispatch() {}, destroyed: false };
}
function load(window, unsafeWindow, contents = []) {
  const context = { window, unsafeWindow, $$: () => contents };
  vm.createContext(context); vm.runInContext(code, context);
  return context;
}

const sandboxView = view();
const pageView = view();
let api = load({ docIdToView: { modelText: sandboxView } }, { docIdToView: { modelText: pageView } });
assert.equal(api.dslView(), pageView, 'real page window wins over sandbox registry');

const dsl = view(), html = view();
api = load({}, {}, [{ cmView: { view: dsl } }, { cmView: { view: html } }]);
assert.equal(api.dslView(), dsl, 'first CM pane resolves DSL');
assert.equal(api.htmlView(), html, 'second CM pane resolves HTML');

const mapped = view();
api = load({}, { editorViewsByDocId: { outputTemplate: [mapped] } });
assert.equal(api.htmlView(), mapped, 'page map resolves HTML');

console.log('Perchance editor page-window and CodeMirror fallback tests passed');
