/* Project extraction + analysis: pure logic for reading, checking and exporting a Perchance generator. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeldProjectCore = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const VERSION = 1;

  // ---------------------------------------------------------------- vocabulary
  const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends finally for ' +
    'function if import in instanceof let new return super switch this throw try typeof var void while with yield await async of ' +
    'true false null undefined NaN Infinity').split(' '));
  const JS_GLOBALS = new Set(('Math Number String Array Object JSON Date RegExp Boolean Set Map WeakMap WeakSet Symbol Promise Error ' +
    'parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI window document console ' +
    'setTimeout setInterval clearTimeout clearInterval localStorage sessionStorage navigator location history alert confirm prompt ' +
    'fetch Intl BigInt crypto performance').split(' '));
  const PERCH_GLOBALS = new Set(['root', 'update', 'generatorName', 'generatorPublicId', 'generatorLastEditTime',
    'generatorIsInEditMode', 'createPerchanceTree', 'ignorePerchanceErrors', 'clearPerchanceErrors', 'moduleSpace']);
  const SELECTORS = new Set(['selectOne', 'selectMany', 'selectUnique', 'evaluateItem', 'consumableList', 'joinItems',
    'getLength', 'getOdds', 'getName', 'getParent', 'getChildNames', 'getPropertyNames', 'getFunctionNames', 'getAllKeys',
    'getRawListText', 'createClone', 'pluralForm', 'singularForm', 'pastTense', 'presentTense', 'futureTense', 'upperCase',
    'lowerCase', 'sentenceCase', 'titleCase']);
  const KNOWN_PLUGINS = {
    'ai-text-plugin': { label: 'AI text', network: true },
    'text-to-image-plugin': { label: 'AI images', network: true },
    'upload-plugin': { label: 'File uploads', network: true },
    'super-fetch-plugin': { label: 'Web requests', network: true },
    'comments-plugin': { label: 'Comments', network: true },
    'tabbed-comments-plugin-v1': { label: 'Comments', network: true },
    'kv-plugin': { label: 'Durable storage' },
    'remember-plugin': { label: 'Remembered values' },
    'url-params-plugin': { label: 'URL parameters' },
    'dynamic-import-plugin': { label: 'Lazy imports' }
  };
  const HTML_BUILTINS = new Set(['update', 'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval', 'console', 'window', 'document',
    'this', 'event', 'Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'Math', 'JSON', 'Array', 'Object', 'location',
    'history', 'navigator', 'localStorage', 'sessionStorage', 'fetch', 'return', 'if', 'for', 'while', 'void', 'typeof',
    'encodeURIComponent', 'decodeURIComponent', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'open', 'close',
    'focus', 'blur', 'print', 'scrollTo', 'getSelection', 'root', 'true', 'false', 'null', 'undefined']);

  // ------------------------------------------------------------- text helpers
  function lines(text) { return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n'); }
  function lineOf(text, index) {
    let n = 1;
    for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }
  function bytes(text) {
    text = String(text || '');
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return text.length;
  }
  function hash(text) {
    text = String(text || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0') + ':' + text.length;
  }
  function uniq(list) { return Array.from(new Set(list)); }

  // Index of the bracket that closes the one at s[i], or -1. Honors backslash escapes, and inside
  // square blocks (which hold JavaScript) skips quoted strings.
  function matchClose(s, i, open, close) {
    let depth = 0;
    for (let k = i; k < s.length; k++) {
      const c = s[k];
      if (c === '\\') { k++; continue; }
      if (open === '[' && (c === '"' || c === "'" || c === '`')) {
        k++; while (k < s.length && s[k] !== c) { if (s[k] === '\\') k++; k++; }
        if (k >= s.length) return -1;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return k; }
    }
    return -1;
  }
  // Every top-level [ ... ] block in a string: { start, end, content }, plus unclosed openers.
  function squareBlocks(text) {
    const blocks = [], unclosed = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '[') {
        const end = matchClose(text, i, '[', ']');
        if (end === -1) { unclosed.push(i); continue; }
        blocks.push({ start: i, end, content: text.slice(i + 1, end) });
        i = end;
      }
    }
    return { blocks, unclosed };
  }
  function curlyBlocks(text) {
    const blocks = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '[') { const e = matchClose(text, i, '[', ']'); if (e !== -1) i = e; continue; }
      if (c === '{') {
        const end = matchClose(text, i, '{', '}');
        if (end === -1) continue;
        blocks.push({ start: i, end, content: text.slice(i + 1, end) });
        i = end;
      }
    }
    return blocks;
  }
  // Split on a separator at bracket depth 0, honoring strings and escapes.
  function splitTop(s, sep) {
    const out = []; let depth = 0, last = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i++;
        while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; }
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === sep && depth <= 0) { out.push(s.slice(last, i)); last = i + 1; }
    }
    out.push(s.slice(last));
    return out;
  }
  // "//" starts a comment when it begins the text or follows whitespace, outside [square blocks].
  function stripComment(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '[') { const e = matchClose(s, i, '[', ']'); if (e !== -1) { i = e; continue; } }
      if (c === '/' && s[i + 1] === '/' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).replace(/\s+$/, '');
    }
    return s;
  }
  // Identifiers read as variables in a JavaScript fragment, plus names it declares itself.
  function identifiers(expr) {
    const used = [], declared = [];
    const params = /\(([^()]*)\)\s*=>|function\s*[\w$]*\s*\(([^()]*)\)|catch\s*\(\s*([\w$]+)\s*\)/g;
    let m;
    while ((m = params.exec(expr))) String(m[1] || m[2] || m[3] || '').split(',').forEach(p => {
      const name = p.replace(/=.*$/, '').replace(/[.\s]/g, ''); if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.push(name);
    });
    let braces = 0, prev = '', prevWord = '';
    for (let i = 0; i < expr.length;) {
      const c = expr[i];
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i++;
        while (i < expr.length && expr[i] !== q) { if (expr[i] === '\\') i++; i++; }
        i++; prev = '"'; prevWord = ''; continue;
      }
      if (c === '/' && expr[i + 1] === '/') break;
      if (/[A-Za-z_$]/.test(c)) {
        let j = i + 1; while (j < expr.length && /[\w$]/.test(expr[j])) j++;
        const id = expr.slice(i, j), rest = expr.slice(j);
        if (prev === '.') { /* property access */ }
        else if (/^\s*=>/.test(rest)) declared.push(id);
        else if (prevWord === 'let' || prevWord === 'var' || prevWord === 'const') declared.push(id);
        else if (prevWord === 'function') declared.push(id);
        else if (KEYWORDS.has(id)) { /* keyword or literal */ }
        else if (braces > 0 && (prev === '{' || prev === ',') && /^\s*:/.test(rest)) { /* object key */ }
        else used.push(id);
        prev = 'a'; prevWord = id; i = j; continue;
      }
      if (/\d/.test(c)) {
        let j = i + 1; while (j < expr.length && /[\w.]/.test(expr[j])) j++;
        i = j; prev = '0'; prevWord = ''; continue;
      }
      if (c === '{') braces++; else if (c === '}') braces--;
      if (!/\s/.test(c)) { prev = c; prevWord = ''; }
      i++;
    }
    return { used, declared };
  }
  // Split off a trailing odds marker: "salt ^2", "blue ^[c == 'blue']".
  function splitOdds(text) {
    const m = /^(.*?)\s*\^\s*(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?|\[[\s\S]*\])\s*$/.exec(text);
    return m ? { body: m[1], odds: m[2] } : { body: text, odds: null };
  }
  function collectImports(text) {
    const out = [], re = /\{\s*import\s*:\s*([^}\s]+?)\s*\}/g; let m;
    while ((m = re.exec(String(text || '')))) out.push(m[1]);
    return out;
  }

  // ------------------------------------------------------------ DSL structure
  const FUNC_RE = /^(async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*=>\s*(.*)$/;
  const ASSIGN_RE = /^([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*)$/;
  const NAME_RE = /^\$?[A-Za-z_][\w$]*$/;

  function parseDsl(text) {
    const raw = lines(text);
    const result = { lines: raw.length, nodes: [], lists: [], issues: [], tabLines: 0, spaceLines: 0, mixedLines: [], functions: [], comments: [] };
    const stack = [];
    let code = null;   // active function body
    let pending = [];  // comment lines seen inside a body, not yet attributed
    const noteComment = c => {
      result.comments.push({ line: c.line, text: c.text });
      result.nodes.push({ line: c.line, width: c.w, text: c.text, kind: 'comment', name: '', value: null, parent: null, children: [], codeLines: [], top: false });
    };
    raw.forEach((line, idx) => {
      if (!line.trim()) return;
      let w = 0, tabs = 0, spaces = 0, i = 0;
      for (; i < line.length; i++) {
        if (line[i] === '\t') { w += 2; tabs++; } else if (line[i] === ' ') { w += 1; spaces++; } else break;
      }
      if (tabs && spaces) result.mixedLines.push(idx + 1);
      if (tabs) result.tabLines++; else if (spaces) result.spaceLines++;
      const rawBody = line.slice(i).replace(/\s+$/, '');
      const body = rawBody.startsWith('//') ? rawBody : stripComment(rawBody);
      // A comment line never changes structure, whatever its indentation.
      if (rawBody.startsWith('//')) {
        if (code) { pending.push({ line: idx + 1, text: rawBody, w }); return; }   // belongs to the body only if more code follows
        noteComment({ line: idx + 1, text: rawBody, w }); return;
      }
      if (code && w > code.width) {
        pending.forEach(c => code.node.codeLines.push(c.line)); pending = [];
        code.node.codeLines.push(idx + 1); return;
      }
      pending.forEach(noteComment); pending = [];
      code = null;
      while (stack.length && stack[stack.length - 1].width >= w) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : null;
      const node = { line: idx + 1, width: w, text: body, kind: 'item', name: '', value: null, parent, children: [], codeLines: [], top: !parent && w === 0 };
      let m;
      if ((m = FUNC_RE.exec(body))) {
        node.kind = 'function'; node.name = m[2]; node.async = !!m[1]; node.params = m[3].trim(); node.value = m[4];
        if (!m[4].trim()) code = { width: w, node };
        result.functions.push(node);
      } else if ((m = ASSIGN_RE.exec(body)) && (node.top || (parent && parent.kind !== 'function'))) {
        node.kind = 'assign'; node.name = m[1]; node.value = m[2];
        if (node.name.startsWith('$')) node.kind = 'special';
      } else if (/^\$[A-Za-z_]\w*$/.test(body)) { node.kind = 'special'; node.name = body; }
      else if (node.top) {
        if (NAME_RE.test(body)) { node.kind = 'list'; node.name = body; }
        else node.kind = 'stray';
      }
      if (node.kind === 'special' && !node.name) node.name = body;
      if (parent) parent.children.push(node);
      result.nodes.push(node);
      stack.push(node);
      if (node.top && node.kind !== 'stray' && node.kind !== 'comment') result.lists.push(node);
    });
    pending.forEach(noteComment);
    return result;
  }
  function itemChildren(node) { return node.children.filter(c => c.kind === 'item'); }
  function propChildren(node) { return node.children.filter(c => c.kind === 'assign' || c.kind === 'function' || c.kind === 'special'); }
  function childNamed(node, name) {
    for (const c of node.children) {
      if (c.name === name) return c;
      if (c.kind === 'item' && splitOdds(c.text).body.trim() === name) return c;
    }
    return null;
  }

  // ------------------------------------------------- output-space estimation
  function estimateSpace(parsed, extraKnown) {
    const lists = new Map();
    parsed.lists.forEach(n => { if (!lists.has(n.name)) lists.set(n.name, n); });
    const memo = new Map(), active = new Set();
    const flags = { approx: false, cycle: false };
    const cap = n => (isFinite(n) ? Math.min(n, 1e300) : 1e300);
    function textEst(text, locals) {
      let total = 1;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\\') { i++; continue; }
        if (c === '[') {
          const e = matchClose(text, i, '[', ']'); if (e === -1) continue;
          total = cap(total * Math.max(1, refEst(text.slice(i + 1, e), locals))); i = e;
        } else if (c === '{') {
          const e = matchClose(text, i, '{', '}'); if (e === -1) continue;
          total = cap(total * Math.max(1, curlyEst(text.slice(i + 1, e), locals))); i = e;
        }
      }
      return total;
    }
    function curlyEst(content, locals) {
      if (/^\s*import\s*:/.test(content)) { flags.approx = true; return 1; }
      let m;
      if ((m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(content))) return Math.max(1, Math.abs(+m[2] - +m[1]) + 1);
      if ((m = /^\s*([a-z])\s*-\s*([a-z])\s*$/i.exec(content))) return Math.abs(m[2].charCodeAt(0) - m[1].charCodeAt(0)) + 1;
      if (/^\s*[aAsS]\s*$/.test(content)) return 1;
      return splitTop(content, '|').reduce((sum, opt) => cap(sum + textEst(splitOdds(opt).body, locals)), 0) || 1;
    }
    // A block's choices multiply: every assignment selects once, and the last statement is displayed.
    function refEst(content, locals) {
      let total = 1;
      splitTop(content, ',').forEach(st => {
        const am = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]*)$/.exec(st);
        total = cap(total * Math.max(1, exprEst(am ? am[2].trim() : st.trim(), locals, !!am)));
        if (am) locals.add(am[1]);
      });
      return total;
    }
    function exprEst(last, locals, assign) {
      if (/^(["'`][\s\S]*["'`]|-?\d[\d.]*|)$/.test(last)) return 1;
      const head = /^([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*(?:\([^()]*\))?)*)$/.exec(last);
      if (!head) { flags.approx = true; return 1; }
      if (locals.has(head[1]) && !assign) return 1;
      let node = lists.get(head[1]);
      if (!node) { if (!KEYWORDS.has(head[1]) && head[1] !== 'this' && !JS_GLOBALS.has(head[1])) flags.approx = true; return 1; }
      let power = 1;
      const segs = head[2] ? head[2].split('.').map(x => x.trim()).filter(Boolean) : [];
      for (const seg of segs) {
        const name = seg.replace(/\(.*$/, '');
        if (SELECTORS.has(name)) {
          const n = /\((\d+)(?:\s*,\s*(\d+))?\)/.exec(seg);
          if ((name === 'selectMany' || name === 'selectUnique') && n) power = Math.max(power, +(n[2] || n[1]));
          continue;
        }
        const child = childNamed(node, name);
        if (!child) { flags.approx = true; return 1; }
        node = child;
      }
      const e = nodeEst(node);
      return power > 1 ? cap(Math.pow(Math.max(1, e), power)) : e;
    }
    function nodeEst(node) {
      if (memo.has(node)) return memo.get(node);
      if (active.has(node)) { flags.cycle = true; return 1; }
      active.add(node);
      let value;
      const locals = new Set();
      const out = node.children.find(c => c.name === '$output');
      if (node.kind === 'assign' && node.value != null && node.value !== '') value = textEst(node.value, locals);
      else if (out && out.value) value = textEst(out.value, locals);
      else {
        const items = itemChildren(node);
        if (!items.length) value = node.value ? textEst(node.value, locals) : 1;
        else value = items.reduce((sum, it) => cap(sum + (itemChildren(it).length ? nodeEst(it) : textEst(splitOdds(it.text).body, new Set()))), 0) || 1;
      }
      active.delete(node); memo.set(node, value); return value;
    }
    const out = lists.get('output') || parsed.nodes.find(n => n.top && n.name === '$output');
    if (!out) return null;
    const count = nodeEst(out);
    return { count, approx: flags.approx, cycle: flags.cycle, text: formatCount(count) };
  }
  function formatCount(n) {
    if (!isFinite(n) || n >= 1e300) return '> 10^300';
    if (n < 1e6) return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const e = Math.floor(Math.log10(n));
    return (n / Math.pow(10, e)).toFixed(1).replace(/\.0$/, '') + ' × 10^' + e;
  }

  // ------------------------------------------------------------- HTML panel
  function htmlRegions(html) {
    html = String(html || '');
    const scripts = [], styles = [];
    let masked = html;
    const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi; let m;
    while ((m = re.exec(html))) {
      const attrs = m[2] || '', bodyStart = m.index + m[0].indexOf('>') + 1, code = m[3];
      const typeM = /\btype\s*=\s*["']?([^\s"'>]+)/i.exec(attrs), srcM = /\bsrc\s*=\s*["']?([^\s"'>]+)/i.exec(attrs);
      const rec = { start: bodyStart, end: bodyStart + code.length, code, line: lineOf(html, bodyStart), type: typeM ? typeM[1].toLowerCase() : '', src: srcM ? srcM[1] : '' };
      (m[1].toLowerCase() === 'script' ? scripts : styles).push(rec);
      masked = masked.slice(0, bodyStart) + code.replace(/[^\n]/g, ' ') + masked.slice(bodyStart + code.length);
    }
    return { scripts, styles, masked };
  }
  const JS_TYPES = /^(|text\/javascript|application\/javascript|module)$/;
  function isJsScript(s) { return JS_TYPES.test(s.type); }

  function htmlTraps(code) {
    const rules = [
      { re: /\\u\{/g, msg: 'A unicode brace-escape is read as a template: use a surrogate pair or String.fromCodePoint().' },
      { re: /\{import:/g, msg: 'An import pattern in panel code is parsed as a plugin import: escape the braces or build the string at runtime.' },
      { re: /&#(?:x0*7b|123|x0*5b|91);/gi, msg: 'A brace or bracket HTML entity still triggers the template parser: construct the character at runtime.' }
    ];
    const out = [];
    rules.forEach(rule => { rule.re.lastIndex = 0; let m; while ((m = rule.re.exec(code))) { out.push({ index: m.index, message: rule.msg }); if (m.index === rule.re.lastIndex) rule.re.lastIndex++; } });
    return out;
  }

  function analyzeHtml(html, ctx) {
    html = String(html || '');
    ctx = ctx || {};
    const reg = htmlRegions(html);
    const info = {
      ids: [], duplicateIds: [], scripts: reg.scripts.map(s => ({ line: s.line, type: s.type || 'script', src: s.src, bytes: s.code.length })),
      urls: [], hosts: [], externalScripts: [], stylesheets: [], rootRefs: {}, rootAssigned: [], functions: [], assigned: [],
      storage: { localStorage: [], sessionStorage: [], kv: [], indexedDB: [], cookies: false }, squareRefs: [], findings: [], capabilities: []
    };
    const idCount = {}, idLine = {};
    const idRe = /<[A-Za-z][^>]*?\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g; let m;
    while ((m = idRe.exec(reg.masked))) {
      const id = m[1] != null ? m[1] : m[2] != null ? m[2] : m[3];
      if (!id || /[\[\]{}]/.test(id)) continue;
      idCount[id] = (idCount[id] || 0) + 1; if (!idLine[id]) idLine[id] = lineOf(html, m.index);
    }
    info.ids = Object.keys(idCount);
    info.duplicateIds = info.ids.filter(id => idCount[id] > 1).map(id => ({ id, count: idCount[id], line: idLine[id] }));
    info.idLines = idLine;

    // scripts: declared functions/variables, root usage, storage
    const JS = reg.scripts.filter(isJsScript);
    JS.forEach(s => {
      const c = s.code; let k;
      const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|(?:^|[\s;{}])(?:var|let|const)\s+([A-Za-z_$][\w$]*)|(?:^|[\s;{}])window\.([A-Za-z_$][\w$]*)\s*=|^\s*([A-Za-z_$][\w$]*)\s*=(?!=)/gm;
      while ((k = fnRe.exec(c))) { const n = k[1] || k[2] || k[3] || k[4]; if (n) info.assigned.push(n); if (k[1]) info.functions.push(k[1]); }
      const rootRe = /\broot\s*\.\s*([A-Za-z_$][\w$]*)(\s*=(?!=))?/g;
      while ((k = rootRe.exec(c))) { info.rootRefs[k[1]] = (info.rootRefs[k[1]] || 0) + 1; if (k[2]) info.rootAssigned.push(k[1]); }
      const rb = /\broot\s*\[\s*["']([^"']+)["']\s*\]/g;
      while ((k = rb.exec(c))) info.rootRefs[k[1]] = (info.rootRefs[k[1]] || 0) + 1;
      const ls = /\blocalStorage\s*\.\s*(?:setItem|getItem|removeItem)\s*\(\s*["'`]([^"'`]+)["'`]/g;
      while ((k = ls.exec(c))) info.storage.localStorage.push(k[1]);
      const ls2 = /\blocalStorage\s*\.\s*([A-Za-z_$][\w$]*)\b(?!\s*\()/g;
      while ((k = ls2.exec(c))) if (!/^(setItem|getItem|removeItem|clear|key|length)$/.test(k[1])) info.storage.localStorage.push(k[1]);
      const ss = /\bsessionStorage\s*\.\s*(?:setItem|getItem|removeItem)\s*\(\s*["'`]([^"'`]+)["'`]/g;
      while ((k = ss.exec(c))) info.storage.sessionStorage.push(k[1]);
      const kv = /\bkv\s*\.\s*([A-Za-z_$][\w$]*)\s*\./g;
      while ((k = kv.exec(c))) info.storage.kv.push(k[1]);
      const idb = /\b(?:indexedDB\s*\.\s*open|new\s+Dexie)\s*\(\s*["'`]([^"'`]+)["'`]/g;
      while ((k = idb.exec(c))) info.storage.indexedDB.push(k[1]);
      if (/\bdocument\s*\.\s*cookie\b/.test(c)) info.storage.cookies = true;
    });
    ['localStorage', 'sessionStorage', 'kv', 'indexedDB'].forEach(key => { info.storage[key] = uniq(info.storage[key]); });
    info.assigned = uniq(info.assigned); info.functions = uniq(info.functions); info.rootAssigned = uniq(info.rootAssigned);

    // names assigned by inline event handlers: oninput="name = this.value"
    const attrRe = /\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    const handlerCalls = [];
    while ((m = attrRe.exec(reg.masked))) {
      const val = m[1] != null ? m[1] : m[2], line = lineOf(html, m.index);
      splitTop(val, ';').forEach(part => splitTop(part, ',').forEach(stmt => {
        const a = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(stmt); if (a) info.assigned.push(a[1]);
      }));
      const callRe = /(?:^|[;,(\s])([A-Za-z_$][\w$]*)\s*\(/g; let c;
      while ((c = callRe.exec(val))) handlerCalls.push({ name: c[1], line });
    }
    info.assigned = uniq(info.assigned);

    // URLs anywhere in the panel
    const urlRe = /https?:\/\/[^\s"'`<>)\]\\]+/gi, urls = {};
    while ((m = urlRe.exec(html))) {
      let u = m[0].replace(/[.,;:!?]+$/, '');
      if (/^https?:\/\/(www\.w3\.org|schemas?\.|schema\.org|purl\.org|xmlns\.com|ns\.adobe\.com)\b/i.test(u)) continue;
      if (!urls[u]) urls[u] = { url: u, host: (/^https?:\/\/([^/:?#]+)/i.exec(u) || [])[1] || '', line: lineOf(html, m.index), count: 0, insecure: /^http:\/\//i.test(u) };
      urls[u].count++;
    }
    info.urls = Object.keys(urls).map(k => urls[k]);
    info.hosts = uniq(info.urls.map(u => u.host.toLowerCase())).sort();
    reg.scripts.forEach(s => { if (s.src) info.externalScripts.push({ src: s.src, line: s.line, module: s.type === 'module' }); });
    const linkRe = /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
    while ((m = linkRe.exec(reg.masked))) { const h = /\bhref\s*=\s*["']?([^\s"'>]+)/i.exec(m[0]); if (h) info.stylesheets.push({ href: h[1], line: lineOf(html, m.index) }); }

    // square blocks in markup (outside script/style)
    const sq = squareBlocks(reg.masked);
    sq.blocks.forEach(b => {
      if (b.end - b.start > 2000) return;
      const line = lineOf(html, b.start), simple = /^\s*([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*$/.exec(b.content);
      if (/</.test(b.content) && /["'`]/.test(b.content)) info.findings.push({ id: 'html-in-square', severity: 'warn', pane: 'html', line, message: 'HTML tag inside a [square block] in the HTML panel.', hint: 'The HTML is parsed before blocks run. Write the < as \\u003c or build the markup in the lists panel.' });
      else if (simple) info.squareRefs.push({ name: simple[1], text: b.content.trim(), line });
    });
    info.handlerCalls = handlerCalls;
    JS.forEach(s => htmlTraps(s.code).forEach(t => info.findings.push({ id: 'perchance-trap', severity: 'warn', pane: 'html', line: s.line + lineOf(s.code, t.index) - 1, message: t.message })));
    info.mixedContent = info.urls.filter(u => u.insecure && !/^(localhost|127\.0\.0\.1)$/i.test(u.host));
    info.mixedContent.forEach(u => info.findings.push({ id: 'insecure-url', severity: 'warn', pane: 'html', line: u.line, message: 'Insecure http:// address: ' + u.url, hint: 'Browsers block http:// resources on an https page. Use https:// or host the file elsewhere.' }));
    return info;
  }
  // A structural map of a big HTML panel, for when the whole panel will not fit anywhere.
  function htmlMap(html) {
    html = String(html || '');
    const a = analyzeHtml(html), out = [];
    out.push('HTML panel: ' + html.length + ' characters, ' + lines(html).length + ' lines, ' + a.scripts.length + ' script block(s)');
    if (a.externalScripts.length) out.push('External scripts: ' + a.externalScripts.map(s => s.src).slice(0, 25).join(', '));
    if (a.ids.length) out.push('Element ids (' + a.ids.length + '): ' + a.ids.slice(0, 80).join(', ') + (a.ids.length > 80 ? ', ...' : ''));
    if (a.functions.length) out.push('Functions: ' + a.functions.slice(0, 80).join(', ') + (a.functions.length > 80 ? ', ...' : ''));
    const roots = Object.keys(a.rootRefs).sort((x, y) => a.rootRefs[y] - a.rootRefs[x]);
    if (roots.length) out.push('root.* used: ' + roots.slice(0, 40).map(k => k + ' (' + a.rootRefs[k] + ')').join(', '));
    const st = a.storage, store = [];
    if (st.localStorage.length) store.push('localStorage ' + st.localStorage.join('/'));
    if (st.kv.length) store.push('kv ' + st.kv.join('/'));
    if (st.indexedDB.length) store.push('IndexedDB ' + st.indexedDB.join('/'));
    if (store.length) out.push('Storage: ' + store.join('; '));
    if (a.hosts.length) out.push('Hosts referenced: ' + a.hosts.slice(0, 30).join(', '));
    return out.join('\n');
  }

  // --------------------------------------------------------- dependency data
  function normalizeDeps(json, rootName) {
    const gens = json && typeof json === 'object' && json.generators && typeof json.generators === 'object' ? json.generators : null;
    if (!gens) throw new Error('Unexpected dependency response.');
    const nodes = {};
    Object.keys(gens).forEach(name => {
      const g = gens[name] || {};
      nodes[name] = { name, imports: uniq((Array.isArray(g.imports) ? g.imports : []).filter(x => typeof x === 'string' && x !== name)),
        code: typeof g.code === 'string' ? g.code : '', bytes: bytes(g.code), lastEditTime: +g.lastEditTime || 0 };
    });
    const unfound = Array.isArray(json.unfound) ? json.unfound.filter(x => typeof x === 'string') : [];
    return { root: rootName, nodes, unfound };
  }
  function dependencyTree(deps, rootName) {
    const seen = new Set();
    function build(name, trail) {
      const n = deps.nodes[name];
      const rec = { name, bytes: n ? n.bytes : 0, lastEditTime: n ? n.lastEditTime : 0, missing: !n, children: [] };
      if (trail.includes(name)) { rec.cycle = true; return rec; }
      if (seen.has(name)) { rec.repeated = true; return rec; }
      seen.add(name);
      if (n) rec.children = n.imports.map(c => build(c, trail.concat(name)));
      return rec;
    }
    return build(rootName, []);
  }
  function dependencyStats(deps, rootName) {
    const closure = new Set(); let depth = 0;
    (function walk(name, d) {
      if (closure.has(name)) return; closure.add(name); depth = Math.max(depth, d);
      const n = deps.nodes[name]; if (n) n.imports.forEach(c => walk(c, d + 1));
    })(rootName, 0);
    closure.delete(rootName);
    const names = Array.from(closure);
    const heavy = names.filter(n => deps.nodes[n] && deps.nodes[n].bytes > 100000).map(n => ({ name: n, bytes: deps.nodes[n].bytes }));
    return { count: names.length, names, bytes: names.reduce((s, n) => s + (deps.nodes[n] ? deps.nodes[n].bytes : 0), 0), depth, heavy };
  }
  // Snapshot of just what is needed to notice later changes.
  function depSignature(deps) {
    const out = {};
    Object.keys(deps.nodes).forEach(n => { out[n] = { t: deps.nodes[n].lastEditTime, h: hash(deps.nodes[n].code) }; });
    return out;
  }
  function depDrift(prev, cur) {
    const changed = [], added = [], removed = [];
    Object.keys(cur).forEach(n => { if (!prev[n]) added.push(n); else if (prev[n].h !== cur[n].h || prev[n].t !== cur[n].t) changed.push(n); });
    Object.keys(prev).forEach(n => { if (!cur[n]) removed.push(n); });
    return { changed, added, removed, any: !!(changed.length || added.length || removed.length) };
  }

  // ------------------------------------------------------------- the analyzer
  function analyze(input) {
    input = input || {};
    const dsl = String(input.dsl || ''), html = input.html == null ? null : String(input.html);
    const parsed = parseDsl(dsl);
    const findings = [], unresolved = [];
    const add = (id, severity, pane, line, message, hint) => findings.push({ id, severity, pane, line: line || 0, message, hint: hint || '' });
    const hv = html == null ? null : analyzeHtml(html, input);
    if (hv) hv.findings.forEach(f => findings.push(f));

    // lists, names, imports
    const topLists = new Map(), seenTop = new Map();
    parsed.lists.forEach(n => {
      if (seenTop.has(n.name) && !n.name.startsWith('$')) add('duplicate-list', 'warn', 'dsl', n.line, 'List "' + n.name + '" is defined twice (first on line ' + seenTop.get(n.name) + ').', 'Later definitions may override or conflict with the first.');
      else { seenTop.set(n.name, n.line); topLists.set(n.name, n); }
    });
    const aliases = {}, importNames = [];
    parsed.nodes.forEach(n => {
      if (n.kind === 'assign') { const m = /^\{\s*import\s*:\s*([^}\s]+?)\s*\}$/.exec((n.value || '').trim()); if (m && n.top) aliases[n.name] = m[1]; }
    });
    collectImports(dsl).forEach(x => importNames.push(x));
    const htmlImports = hv ? collectImports(html) : [];
    const allImports = uniq(importNames.concat(htmlImports));

    // known names for reference checks
    const fnNames = parsed.functions.map(f => f.name);
    const known = new Set([...topLists.keys(), ...Object.keys(aliases), ...fnNames, ...KEYWORDS, ...JS_GLOBALS, ...PERCH_GLOBALS]);
    const locals = new Set();
    const used = new Set();   // names read anywhere, for the unused-list check
    function noteAssignments(content) {
      splitTop(content, ',').forEach(st => { const a = /^\s*([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\*=|\/=)/.exec(st); if (a) locals.add(a[1]); });
    }
    const blockNodes = parsed.nodes.filter(n => (n.kind === 'item' || n.kind === 'assign' || (n.kind === 'special' && n.name === '$output')) && !inMeta(n));
    function inMeta(n) { for (let p = n.parent; p; p = p.parent) if (p.name === '$meta' || p.name === '$preprocess' || p.name === '$postprocess') return true; return false; }
    function nodeText(n) { return n.kind === 'item' ? n.text : (n.value || ''); }
    blockNodes.forEach(n => { squareBlocks(nodeText(n)).blocks.forEach(b => noteAssignments(b.content)); });
    if (hv) hv.assigned.forEach(x => known.add(x));
    if (hv) hv.ids.forEach(x => known.add(x));
    if (hv) hv.functions.forEach(x => known.add(x));

    // dynamic-ness of each list, for the re-randomization check
    function isDynamicList(node) { const items = itemChildren(node); return items.length > 0 && items.every(it => !it.children.length) && items.some(it => /(^|[^\\])[\[{]/.test(it.text)); }

    blockNodes.forEach(n => {
      const text = nodeText(n), sq = squareBlocks(text);
      sq.unclosed.forEach(() => add('unclosed-block', 'warn', 'dsl', n.line, 'A "[" is never closed: ' + shorten(text, 60), 'Escape a literal bracket as \\[ .'));
      sq.blocks.forEach((b, bi) => {
        const stmts = splitTop(b.content, ',');
        stmts.forEach((st, si) => {
          const id = identifiers(st);
          id.used.forEach(name => used.add(name));
          id.declared.forEach(name => locals.add(name));
          const dyn = /\[([^\[\]]+)\]/g; let dm;
          while ((dm = dyn.exec(st))) identifiers(dm[1]).used.forEach(name => used.add(name));
        });
        if (stmts.length > 1) {
          stmts.slice(0, -1).forEach(st => {
            const bare = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(st);
            if (bare && topLists.has(bare[1])) {
              const target = topLists.get(bare[1]);
              if (!(target.kind === 'assign' && /^\s*\[[\s\S]*\]\s*$/.test(target.value || '')) && itemChildren(target).length)
                add('silent-noop', 'warn', 'dsl', n.line, '"' + bare[1] + '" is mentioned before the last statement of a block, which does nothing.', 'Use ' + bare[1] + '.evaluateItem to run it, or make it the final statement.');
            }
          });
          if (stmts.some(st => /^\s*if\s*\(/.test(st)) && /\belse\b/.test(b.content))
            add('if-else-shared-block', 'warn', 'dsl', n.line, 'An if/else shares a [square block] with other statements.', 'Put if/else in its own block: [x = y.selectOne, ""][if (x) {"a"} else {"b"}].');
        }
        stmts.forEach((st, si) => {
          const am = /^\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.selectOne\s*$/.exec(st);
          if (!am || !topLists.has(am[2])) return;
          const target = topLists.get(am[2]);
          if (target.kind === 'assign' || !isDynamicList(target)) return;
          const after = text.slice(b.end + 1);
          const reuse = new RegExp('\\[\\s*' + am[1].replace(/\$/g, '\\$') + '(?:\\s*\\.\\s*(?:pluralForm|singularForm|titleCase|upperCase|lowerCase|sentenceCase|pastTense|presentTense|futureTense))*\\s*\\]');
          if (reuse.test(after))
            add('re-randomize', 'warn', 'dsl', n.line, '"' + am[1] + '" stores an unevaluated item of "' + am[2] + '" that is reused later, so each use re-randomizes.', 'Use ' + am[2] + '.evaluateItem when you store a selection for reuse.');
        });
        // unresolved names
        stmts.forEach(st => {
          const id = identifiers(st);
          id.used.forEach(name => { if (!known.has(name) && !locals.has(name)) unresolved.push({ name, line: n.line }); });
        });
      });
    });
    function reportUnresolved() {
      const seen = new Set();
      unresolved.forEach(u => {
        if (known.has(u.name) || locals.has(u.name)) return;
        const key = u.name + ':' + u.line; if (seen.has(key)) return; seen.add(key);
        add('unresolved-ref', hv ? 'warn' : 'info', 'dsl', u.line, '"' + u.name + '" is not a list, import, function or variable defined in this generator.',
          hv ? 'Check the spelling, or define it.' : 'Load the HTML panel too: it may define this name.');
      });
    }
    // function bodies: only note which names are read
    parsed.functions.forEach(f => {
      const body = f.codeLines.length ? f.codeLines.map(l => lines(dsl)[l - 1]).join('\n') : (f.value || '');
      identifiers(body).used.forEach(x => used.add(x));
    });
    // top-level special blocks and meta
    parsed.nodes.forEach(n => {
      if (n.kind === 'stray') add('stray-line', 'warn', 'dsl', n.line, 'This line at column 0 is not a list name, "name = value", a function or a comment: ' + shorten(n.text, 60), 'Indent it under a list, or give it a list name.');
    });
    // lists
    const lists = parsed.lists.filter(n => n.kind === 'list' || n.kind === 'assign' || n.kind === 'special').map(n => ({
      name: n.name, line: n.line, kind: n.kind, items: itemChildren(n).length, props: propChildren(n).length,
      children: n.children.length, imported: n.kind === 'assign' && /\{\s*import\s*:/.test(n.value || ''), alias: aliases[n.name] || ''
    }));
    parsed.lists.forEach(n => {
      if (n.kind === 'list' && !n.children.length) add('empty-list', 'warn', 'dsl', n.line, 'List "' + n.name + '" has no items.');
      if (n.kind === 'list') {
        const items = itemChildren(n), seen = new Map();
        if (items.length >= 3) {
          items.forEach(it => { const key = splitOdds(it.text).body.trim().toLowerCase(); if (!key) return; if (seen.has(key)) seen.get(key).push(it.line); else seen.set(key, [it.line]); });
          const dup = Array.from(seen.entries()).filter(e => e[1].length > 1);
          if (dup.length) add('duplicate-items', 'info', 'dsl', dup[0][1][1], 'List "' + n.name + '" repeats ' + dup.length + ' item(s): ' + dup.slice(0, 3).map(e => '"' + shorten(e[0], 24) + '"').join(', ') + (dup.length > 3 ? ', ...' : ''), 'Repeats raise that item\'s odds. Use ^2 if that is intended.');
        }
      }
    });
    parsed.nodes.forEach(n => {
      if (n.kind !== 'item' || inMeta(n)) return;
      const o = /\^\s*(\S+)\s*$/.exec(n.text);
      if (o && !/^(\d+(\.\d+)?(\/\d+(\.\d+)?)?|\[.*\])$/.test(o[1]) && /\s\^/.test(n.text) && !/[\[{]/.test(o[1]))
        add('bad-odds', 'info', 'dsl', n.line, 'Odds "^' + o[1] + '" is not a number or [expression].', 'Odds look like ^2, ^1/10 or ^[x == 1].');
    });
    if (parsed.mixedLines.length) add('mixed-indent', 'warn', 'dsl', parsed.mixedLines[0], parsed.mixedLines.length + ' line(s) mix tabs and spaces in their indentation.', 'Mixed indentation confuses the parser. Pick one (two spaces is the safest).');
    else if (parsed.tabLines && parsed.spaceLines) add('mixed-indent', 'info', 'dsl', 0, parsed.tabLines + ' lines are tab-indented and ' + parsed.spaceLines + ' are space-indented.', 'Consistency avoids wrap and nesting surprises.');
    if (!parsed.nodes.some(n => n.top && n.name === '$meta') && parsed.lists.length > 0) add('no-meta', 'info', 'dsl', 0, 'No $meta block (title, description, tags).', 'Add one so the generator has a proper gallery listing.');
    if (!topLists.has('output') && !parsed.nodes.some(n => n.top && n.name === '$output') && parsed.lists.length > 0)
      add('no-output', 'info', 'dsl', 0, 'There is no "output" list or top-level $output.', 'Importing generators receive a random list name instead of text.');

    // HTML cross-checks
    if (hv) {
      hv.squareRefs.forEach(r => {
        if (!known.has(r.name) && !locals.has(r.name)) add('html-unresolved-ref', 'warn', 'html', r.line, '[' + r.text + '] in the HTML panel refers to "' + r.name + '", which is not defined.', 'Check the spelling against your list names.');
        used.add(r.name);
      });
      hv.ids.forEach(id => { if (topLists.has(id)) add('id-collision', 'warn', 'html', hv.idLines[id], 'Element id "' + id + '" has the same name as a list.', 'Element ids become globals and collide with list names. Rename one.'); });
      hv.duplicateIds.forEach(d => add('duplicate-id', 'warn', 'html', d.line, 'Element id "' + d.id + '" is used ' + d.count + ' times.'));
      const noRootCheck = new Set([...topLists.keys(), ...Object.keys(aliases), ...hv.rootAssigned, ...fnNames, 'update', 'light', 'dark']);
      Object.keys(hv.rootRefs).forEach(k => { if (!noRootCheck.has(k) && !locals.has(k)) add('root-unknown', 'info', 'html', 0, 'root.' + k + ' is read but no list, import or assignment of that name was found.', 'It may come from an imported plugin. If it is a typo, the value will be undefined.'); });
      const declared = new Set([...hv.functions, ...hv.assigned, ...fnNames, ...topLists.keys(), ...Object.keys(aliases), ...hv.ids]);
      const externalCode = hv.externalScripts.some(s => !s.module) || allImports.length > 0;
      hv.handlerCalls.forEach(c => { if (!HTML_BUILTINS.has(c.name) && !declared.has(c.name) && !JS_GLOBALS.has(c.name) && !locals.has(c.name)) add('missing-function', externalCode ? 'info' : 'warn', 'html', c.line, 'An inline handler calls ' + c.name + '(), which is not defined in this generator.', externalCode ? 'It may come from an external script or an import.' : 'Check the function name.'); });
      Object.keys(aliases).forEach(a => {
        if (used.has(a) || new RegExp('\\b' + a.replace(/\$/g, '\\$') + '\\b').test(html)) return;
        add('unused-import', 'info', 'dsl', topLists.get(a) ? topLists.get(a).line : 0, 'Import "' + a + '" (' + aliases[a] + ') is never used.', 'Plugins that must register themselves can be intentional.');
      });
    }
    reportUnresolved();
    // unused lists
    const exemptNames = new Set(['output', 'title', 'description']);
    parsed.lists.forEach(n => {
      if (n.kind !== 'list' || exemptNames.has(n.name) || n.name.startsWith('$') || used.has(n.name)) return;
      if (hv && new RegExp('\\b' + n.name.replace(/\$/g, '\\$') + '\\b').test(html)) return;
      add('unused-list', 'info', 'dsl', n.line, 'List "' + n.name + '" is not referenced in this generator.', 'It may still be used by generators that import this one.');
    });

    const order = { error: 0, warn: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.pane === b.pane ? 0 : a.pane === 'dsl' ? -1 : 1) || a.line - b.line);

    // capabilities and storage
    const deps = input.deps || null;
    const closureNames = deps ? dependencyStats(deps, input.name || deps.root).names : [];
    const everyImport = uniq(allImports.concat(closureNames));
    const capabilities = uniq(everyImport.filter(n => KNOWN_PLUGINS[n]).map(n => KNOWN_PLUGINS[n].label));
    const network = everyImport.some(n => KNOWN_PLUGINS[n] && KNOWN_PLUGINS[n].network);
    const items = lists.reduce((s, l) => s + l.items, 0);
    return {
      version: VERSION, name: input.name || '',
      stats: { dslBytes: bytes(dsl), dslLines: parsed.lines, htmlBytes: html == null ? 0 : bytes(html), htmlLines: html == null ? 0 : lines(html).length,
        lists: lists.length, items, functions: parsed.functions.length, imports: allImports.length, scripts: hv ? hv.scripts.length : 0,
        comments: parsed.comments.length, todos: parsed.comments.filter(c => /\b(TODO|FIXME|HACK|XXX)\b/i.test(c.text)).length },
      lists, aliases, imports: allImports, capabilities, network,
      outputSpace: estimateSpace(parsed),
      findings, counts: { error: findings.filter(f => f.severity === 'error').length, warn: findings.filter(f => f.severity === 'warn').length, info: findings.filter(f => f.severity === 'info').length },
      html: hv ? { ids: hv.ids, scripts: hv.scripts, urls: hv.urls, hosts: hv.hosts, externalScripts: hv.externalScripts, stylesheets: hv.stylesheets,
        storage: hv.storage, rootRefs: hv.rootRefs, functions: hv.functions } : null,
      todos: parsed.comments.filter(c => /\b(TODO|FIXME|HACK|XXX)\b/i.test(c.text)),
      functions: parsed.functions.map(f => ({ name: f.name, line: f.line, async: !!f.async, lines: f.codeLines.length || 1 }))
    };
  }
  function shorten(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // ------------------------------------------------------------- remote data
  function parseHtmlResponse(text) {
    text = String(text == null ? '' : text);
    if (/^\s*<!doctype html[\s\S]{0,400}(just a moment|cf-chl|challenge-platform)/i.test(text) || /<title>\s*Just a moment/i.test(text)) throw new Error('Perchance asked for a browser check. Open perchance.org once, then try again.');
    return text;
  }
  function parseListsResponse(text) {
    text = String(text == null ? '' : text);
    if (/<title>\s*Just a moment/i.test(text)) throw new Error('Perchance asked for a browser check. Open perchance.org once, then try again.');
    return text;
  }

  // -------------------------------------------------------------- sampling
  function sampleStats(samples, space) {
    samples = (samples || []).map(s => String(s == null ? '' : s).trim()).filter(Boolean);
    const n = samples.length;
    if (!n) return { n: 0 };
    const counts = new Map(); samples.forEach(s => counts.set(s, (counts.get(s) || 0) + 1));
    const lens = samples.map(s => s.length).sort((a, b) => a - b);
    const words = new Map();
    samples.forEach(s => (s.toLowerCase().match(/[a-zÀ-ɏ']{3,}/g) || []).forEach(w => words.set(w, (words.get(w) || 0) + 1)));
    const unique = counts.size, dupes = n - unique;
    const out = {
      n, unique, duplicates: dupes, duplicateRate: dupes / n,
      minLen: lens[0], maxLen: lens[n - 1], avgLen: Math.round(lens.reduce((a, b) => a + b, 0) / n), medianLen: lens[Math.floor(n / 2)],
      topRepeated: Array.from(counts.entries()).filter(e => e[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => ({ text: shorten(e[0], 80), count: e[1] })),
      topWords: Array.from(words.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(e => ({ word: e[0], count: e[1] })),
      lengthBuckets: bucketLengths(lens)
    };
    if (space && space.count > 0 && isFinite(space.count)) {
      out.expectedDuplicates = Math.min(n, (n * (n - 1)) / (2 * space.count));
      out.lowVariety = dupes >= 2 && dupes > out.expectedDuplicates * 3;
    } else out.lowVariety = n >= 20 && out.duplicateRate > 0.3;
    return out;
  }
  function bucketLengths(sorted) {
    if (!sorted.length) return [];
    const lo = sorted[0], hi = sorted[sorted.length - 1], steps = Math.min(8, Math.max(1, hi - lo + 1));
    const size = Math.max(1, Math.ceil((hi - lo + 1) / steps)), buckets = [];
    for (let i = 0; i < steps; i++) buckets.push({ from: lo + i * size, to: lo + (i + 1) * size - 1, count: 0 });
    sorted.forEach(v => { const b = buckets[Math.min(steps - 1, Math.floor((v - lo) / size))]; b.count++; });
    return buckets.filter(b => b.count || buckets.length <= 4);
  }

  // ------------------------------------------------------------------ export
  // Safe as one path segment: no separators, and never starting with a dot (so never "." or "..").
  function fileSafe(name) { return String(name || 'generator').replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'generator'; }
  function stamp(t) { return new Date(t || Date.now()).toISOString().replace(/[:.]/g, '-'); }
  function manifest(project, analysis) {
    return {
      format: 'weld-project', version: VERSION, name: project.name, source: project.source || '', fetchedAt: project.fetchedAt || 0,
      lastEditTime: project.lastEditTime || 0, files: ['dsl.txt', 'html.html'], imports: project.deps ? Object.keys(project.deps.nodes).filter(n => n !== project.name) : [],
      stats: analysis ? analysis.stats : null, findings: analysis ? analysis.counts : null
    };
  }
  function toMarkdown(project, analysis) {
    const a = analysis, out = [];
    out.push('# ' + (project.name || 'Generator'));
    out.push('');
    out.push('Exported by Weld Companion on ' + new Date().toISOString().slice(0, 10) + (project.source ? ' from ' + project.source : '') + '.');
    out.push('');
    if (a) {
      out.push('## Overview', '');
      out.push('- Lists: ' + a.stats.lists + ', items: ' + a.stats.items + ', functions: ' + a.stats.functions + ', imports: ' + a.stats.imports);
      out.push('- DSL: ' + a.stats.dslLines + ' lines (' + a.stats.dslBytes + ' bytes); HTML: ' + a.stats.htmlLines + ' lines (' + a.stats.htmlBytes + ' bytes)');
      if (a.outputSpace) out.push('- Estimated distinct outputs: ' + a.outputSpace.text + (a.outputSpace.approx ? ' (rough)' : ''));
      if (a.capabilities.length) out.push('- Uses: ' + a.capabilities.join(', '));
      out.push('');
      if (a.findings.length) {
        out.push('## Findings', '');
        a.findings.slice(0, 100).forEach(f => out.push('- **' + f.severity + '** (' + f.pane + (f.line ? ' line ' + f.line : '') + '): ' + f.message));
        out.push('');
      }
      if (a.imports.length) { out.push('## Imports', ''); a.imports.forEach(i => out.push('- ' + i)); out.push(''); }
      if (a.html && a.html.hosts.length) { out.push('## External hosts', ''); a.html.hosts.forEach(h => out.push('- ' + h)); out.push(''); }
    }
    out.push('## Lists panel', '', '```perchance', String(project.dsl || '').replace(/\r\n?/g, '\n').trimEnd(), '```', '');
    if (project.html != null) out.push('## HTML panel', '', '```html', String(project.html).replace(/\r\n?/g, '\n').trimEnd(), '```', '');
    return out.join('\n');
  }
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(data) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // Minimal ZIP writer (stored, UTF-8 names). files: [{ name, data: string | Uint8Array }]
  function zip(files, when) {
    const enc = new TextEncoder(), d = new Date(when || Date.now());
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = []; let offset = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(String(f.name).replace(/^\/+/, '')), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const local = Uint8Array.from([].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)));
      parts.push(local, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += local.length + name.length + data.length;
    });
    const dir = [];
    central.forEach(c => dir.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset))), c.name));
    const dirSize = dir.reduce((s, p) => s + p.length, 0);
    const end = Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(dirSize), u32(offset), u16(0)));
    const all = parts.concat(dir, [end]), out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0; all.forEach(p => { out.set(p, pos); pos += p.length; });
    return out;
  }
  function bundleFiles(project, analysis) {
    const slug = fileSafe(project.name), files = [];
    files.push({ name: slug + '/dsl.txt', data: String(project.dsl || '') });
    if (project.html != null) files.push({ name: slug + '/html.html', data: String(project.html) });
    files.push({ name: slug + '/README.md', data: toMarkdown(Object.assign({}, project, { html: null }), analysis) });
    files.push({ name: slug + '/manifest.json', data: JSON.stringify(manifest(project, analysis), null, 2) });
    if (analysis) files.push({ name: slug + '/analysis.json', data: JSON.stringify(analysis, null, 2) });
    if (project.deps) Object.keys(project.deps.nodes).forEach(n => { if (n !== project.name && project.deps.nodes[n].code) files.push({ name: slug + '/imports/' + fileSafe(n) + '.txt', data: project.deps.nodes[n].code }); });
    return files;
  }

  // ----------------------------------------------------------- AI context pack
  // A prompt-ready description of the generator that respects a character budget.
  function aiPack(project, analysis, options) {
    options = options || {};
    const budget = Math.max(2000, options.budget || 60000), parts = [], dropped = [];
    const a = analysis || analyze({ dsl: project.dsl, html: project.html, name: project.name, deps: project.deps });
    const head = ['GENERATOR: ' + (project.name || '(unnamed)') + (project.source ? ' [' + project.source + ']' : ''),
      'Lists: ' + a.stats.lists + ', items: ' + a.stats.items + ', functions: ' + a.stats.functions + ', imports: ' + (a.imports.join(', ') || 'none') +
      (a.outputSpace ? ', estimated distinct outputs: ' + a.outputSpace.text : '') + (a.capabilities.length ? ', uses: ' + a.capabilities.join(', ') : '')];
    if (options.findings !== false && a.findings.length) {
      head.push('', 'AUTOMATIC FINDINGS (heuristic, verify before acting):');
      a.findings.filter(f => f.severity !== 'info').slice(0, 30).forEach(f => head.push('- [' + f.severity + '] ' + f.pane + (f.line ? ':' + f.line : '') + ' ' + f.message));
    }
    if (options.outline !== false && a.lists.length) head.push('', 'LIST OUTLINE: ' + a.lists.slice(0, 120).map(l => l.name + '(' + (l.items || (l.imported ? 'import' : '1')) + ')').join(', '));
    if (project.deps) { const st = dependencyStats(project.deps, project.name); if (st.count) head.push('', 'IMPORT TREE: ' + st.names.slice(0, 40).map(n => n + ' ' + Math.round(project.deps.nodes[n] ? project.deps.nodes[n].bytes / 1024 : 0) + 'KB').join(', ')); }
    let text = head.join('\n'), left = budget - text.length;
    function addSection(label, lang, body, share) {
      const room = Math.max(0, Math.min(left - 200, Math.floor(share)));
      if (room < 200) { dropped.push(label + ' (no room)'); return; }
      let b = String(body || '').replace(/\r\n?/g, '\n');
      if (b.length > room) { b = b.slice(0, room); const cut = b.lastIndexOf('\n'); if (cut > room * 0.6) b = b.slice(0, cut); dropped.push(label + ' truncated'); b += '\n… [truncated: ' + (String(body).length - b.length) + ' more characters]'; }
      const block = '\n\n' + label + ':\n```' + lang + '\n' + b + '\n```';
      text += block; left -= block.length;
    }
    const wantDsl = options.dsl !== false, wantHtml = options.html !== false && project.html != null;
    if (wantDsl) {
      // The lists panel is the part that matters most. It gets everything the HTML does not need:
      // a huge HTML panel is reduced to a short structural map, so reserve only that much for it.
      const dslLen = String(project.dsl || '').length, htmlLen = wantHtml ? String(project.html).length : 0;
      let share = left;
      if (wantHtml && dslLen + htmlLen > left - 600) share = Math.max(left - (htmlMap(project.html).length + 600), left * 0.4);
      addSection('LISTS PANEL (Perchance DSL)', 'perchance', project.dsl, share);
    }
    if (wantHtml) {
      if (String(project.html).length > left - 400) { text += '\n\nHTML PANEL STRUCTURE (the full panel is too large to include):\n' + htmlMap(project.html); left = budget - text.length; dropped.push('HTML panel summarized'); }
      else addSection('HTML PANEL', 'html', project.html, left);
    }
    return { text, length: text.length, budget, dropped, approxTokens: Math.round(text.length / 4) };
  }

  return {
    VERSION, parseDsl, analyze, analyzeHtml, htmlMap, htmlTraps, estimateSpace, formatCount, collectImports, splitOdds, identifiers,
    squareBlocks, curlyBlocks, splitTop, normalizeDeps, dependencyTree, dependencyStats, depSignature, depDrift,
    parseHtmlResponse, parseListsResponse, sampleStats, toMarkdown, manifest, bundleFiles, zip, crc32, aiPack, hash, bytes, fileSafe, stamp,
    lineOf, lines, KNOWN_PLUGINS
  };
});
