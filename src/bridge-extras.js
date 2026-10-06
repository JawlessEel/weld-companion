/* Skybridge extra capabilities (download, clipboard, notify, tokens): pure validation and sizing.
   The anchor does the side effects; nothing here touches the page, network or storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeldBridgeExtras = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const LIMITS = Object.freeze({ downloadChars: 5 * 1024 * 1024, clipboardChars: 1024 * 1024, notifyChars: 200, tokenInputChars: 2 * 1024 * 1024, filename: 120 });
  const MIMES = Object.freeze({ txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', html: 'text/html', htm: 'text/html', xml: 'text/xml', css: 'text/css', js: 'text/javascript', pjs: 'text/plain', log: 'text/plain' });
  const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|jar|app|dmg|sh|pkg|apk|lnk|reg|dll)$/i;
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  // Strip paths, control characters and trailing dots; keep it short. Always returns a usable name.
  function sanitizeFilename(name) {
    let n = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]+/g, '-').replace(/[<>:"|?*]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
    if (n.length > LIMITS.filename) { const dot = n.lastIndexOf('.'), ext = dot > 0 ? n.slice(dot).slice(0, 12) : ''; n = n.slice(0, LIMITS.filename - ext.length) + ext; }
    return n || 'download.txt';
  }
  // { filename, text, mime? } -> { ok, filename, mime, text } | { ok:false, reason }
  function checkDownload(p) {
    if (!isObj(p)) return { ok: false, reason: 'bad-request' };
    if (typeof p.text !== 'string') return { ok: false, reason: 'text-required' };
    if (p.text.length > LIMITS.downloadChars) return { ok: false, reason: 'too-large' };
    const filename = sanitizeFilename(p.filename);
    if (BLOCKED_EXT.test(filename)) return { ok: false, reason: 'blocked-type' };
    const ext = (filename.match(/\.([a-z0-9]+)$/i) || [])[1];
    const byExt = ext ? MIMES[ext.toLowerCase()] : null;
    if (ext && !byExt) return { ok: false, reason: 'unsupported-type' };
    let mime = byExt || 'text/plain';
    if (typeof p.mime === 'string' && p.mime) {
      const want = p.mime.split(';')[0].trim().toLowerCase();
      if (Object.keys(MIMES).every(k => MIMES[k] !== want)) return { ok: false, reason: 'unsupported-type' };
      mime = want;
    }
    return { ok: true, filename: ext ? filename : filename + '.txt', mime, text: p.text };
  }
  function checkClipboard(p) {
    if (!isObj(p) || typeof p.text !== 'string' || !p.text) return { ok: false, reason: 'text-required' };
    if (p.text.length > LIMITS.clipboardChars) return { ok: false, reason: 'too-large' };
    return { ok: true, text: p.text };
  }
  // One short line for the host page toast.
  function checkNotify(p) {
    if (!isObj(p) || typeof p.text !== 'string') return { ok: false, reason: 'text-required' };
    const text = p.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.notifyChars);
    if (!text) return { ok: false, reason: 'text-required' };
    const ms = Math.max(1500, Math.min(8000, Number(p.ms) || 3000));
    return { ok: true, text, ms };
  }
  // Fixed-window limiter per key, so a looping generator cannot flood the page with toasts or downloads.
  function rateLimiter(max, windowMs) {
    const hits = new Map();
    return { allow(key, now) {
      now = now == null ? Date.now() : now;
      const list = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (list.length >= max) { hits.set(key, list); return false; }
      list.push(now); hits.set(key, list); return true;
    } };
  }
  // Rough, local estimate (characters / 3, deliberately conservative). No model or network involved.
  function estimateTokens(p) {
    const text = isObj(p) ? p.text : p;
    if (typeof text !== 'string') return { ok: false, reason: 'text-required' };
    if (text.length > LIMITS.tokenInputChars) return { ok: false, reason: 'too-large' };
    const words = (text.trim().match(/\S+/g) || []).length;
    return { ok: true, value: { tokens: Math.ceil(text.length / 3), chars: text.length, words, method: 'estimate-chars-div-3' } };
  }
  return { LIMITS, MIMES, sanitizeFilename, checkDownload, checkClipboard, checkNotify, rateLimiter, estimateTokens };
});
