/* Backups tab: manage, examine, extract and maintain generator backup copies held in companion storage.
   Read-only except the exact-key Delete action. Record contents are never logged or sent anywhere. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const C = window.WeldBackupCore, H = window.weldProjectHost;
  if (!C || !H) return;
  const E = H.el;
  const S = { rows: null, inv: null, error: '', selected: null, inspected: null, pendingDelete: null, secrets: null, msg: '', stamp: 0 };
  let host = null, unsub = null;
  const note = t => E('div', { class: 'wc-section-note', text: t });
  const small = { fontSize: '12px', opacity: '.75' };
  const btn = (label, fn, extra) => E('button', Object.assign({ type: 'button', class: 'wc-btn wc-mini', text: label, onclick: fn }, extra || {}));
  const V = () => H.vault || null;

  function say(t, isErr) { S.msg = t; S.msgErr = !!isErr; }

  // One pass over the stored keys. Values are parsed only to read their size, date and staleness, then dropped.
  function load() {
    const v = V();
    S.rows = null; S.inv = null; S.error = ''; S.stamp = Date.now();
    if (!v) { S.error = 'Storage access is unavailable in this build. Update the complete Weld userscript.'; return; }
    let listed;
    try { listed = v.list(); } catch (e) { listed = { ok: false, reason: String((e && e.message) || e) }; }
    if (!listed || listed.ok !== true) { S.error = 'Could not list stored backups: ' + ((listed && listed.reason) || 'unknown error') + '.'; return; }
    const rows = [];
    (listed.items || []).forEach(it => {
      if (!C.inScope(it.key)) return;
      let r;
      try { r = v.read(it.gmKey); } catch (e) { r = { ok: false, reason: 'read-failed' }; }
      const row = { key: it.key, gmKey: it.gmKey, caller: it.caller, size: 0, stale: false, parseError: false, at: null };
      if (!r || r.ok !== true) row.parseError = true;
      else {
        row.size = r.size || 0;
        if (r.parseError) row.parseError = true;
        else if (r.value === null || r.value === undefined) row.stale = true;
        else if (r.value && typeof r.value === 'object' && typeof r.value.at === 'number') row.at = r.value.at;
      }
      rows.push(row);
    });
    S.rows = rows; S.inv = C.buildInventory(rows);
    if (S.selected && !rows.some(r => r.gmKey === S.selected)) { S.selected = null; S.inspected = null; }
    S.pendingDelete = null;
  }
  function full(gmKey) {   // fresh read of a single record for inspect / export
    const row = (S.rows || []).find(r => r.gmKey === gmKey); if (!row) return null;
    let r; try { r = V().read(gmKey); } catch (e) { r = { ok: false, reason: 'read-failed' }; }
    if (!r || r.ok !== true) return Object.assign({}, row, { unreadable: true });
    return Object.assign({}, row, { size: r.size || 0, value: r.value === undefined ? null : r.value, parseError: !!r.parseError, stale: !r.parseError && (r.value === null || r.value === undefined) });
  }
  function indexFor(gen) {
    const row = (S.rows || []).find(r => C.parseKey(r.key).kind === 'chat-index' && C.parseKey(r.key).gen === gen);
    const rec = row && full(row.gmKey); return rec && !rec.parseError && !rec.stale ? rec.value : undefined;
  }
  function inspectRow(gmKey) {
    const rec = full(gmKey); S.selected = gmKey; S.pendingDelete = null; S.secrets = null;
    if (!rec) { S.inspected = null; return; }
    const keys = (S.rows || []).map(r => r.key), gen = C.parseKey(rec.key).gen;
    S.inspected = rec.unreadable ? { rec, report: { meta: [['Key', rec.key]], anomalies: ['The value could not be read.'], chat: null } }
      : { rec, report: C.inspect(rec, { keys, index: gen ? indexFor(gen) : undefined }) };
  }

  const stamp = () => Date.now();
  function saveFile(file) {
    try { H.vault.download(file.filename, file.text); say('Saved ' + file.filename + '.'); } catch (e) { say('Download failed.', true); }
  }
  function exportRows(label, rows) {
    const recs = rows.map(r => full(r.gmKey)).filter(Boolean);
    if (!recs.length) { say('Nothing to export.', true); return; }
    saveFile(C.exportBundle(label, recs, stamp()));
  }
  function runDelete(gmKey) {
    const row = (S.rows || []).find(r => r.gmKey === gmKey);
    if (!row) { say('That key no longer exists.', true); return; }
    let res; try { res = V().remove(gmKey); } catch (e) { res = { ok: false, reason: 'error' }; }
    say(res && res.ok ? 'Deleted ' + row.key + '. Only that key was removed.' : 'Delete failed: ' + ((res && res.reason) || 'unknown') + '.', !(res && res.ok));
    S.selected = null; S.inspected = null; load();
  }
  function scanSecrets() {
    const hits = [];
    (S.rows || []).forEach(r => {
      if (C.parseKey(r.key).kind !== 'chat-copy' || r.stale || r.parseError) return;
      const rec = full(r.gmKey); if (!rec || rec.parseError || !rec.value) return;
      const found = C.secretScan(rec.value.data);
      if (found.length) hits.push({ key: r.key, paths: found.map(f => f.path) });
    });
    S.secrets = hits; say(hits.length ? 'Found secret-shaped values in ' + hits.length + ' chat cop' + (hits.length === 1 ? 'y' : 'ies') + '. Values are not shown.' : 'No plaintext secret-shaped config values found.');
  }

  function rowLine(r, canDelete, rerender) {
    const p = C.parseKey(r.key), label = p.sub || r.key;
    const sel = S.selected === r.gmKey;
    const bits = [label, C.fmtBytes(r.size)];
    if (r.at) bits.push(C.fmtDate(r.at));
    if (r.stale) bits.push('STALE (null value)');
    if (r.parseError) bits.push('unreadable');
    const line = E('div', { 'data-key': r.key, style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', padding: '4px 0', fontWeight: sel ? '600' : '' } }, [
      E('span', { text: bits.join(' · '), style: { flex: '1', minWidth: '160px', fontSize: '12px', wordBreak: 'break-all' } }),
      btn('Inspect', () => { inspectRow(r.gmKey); rerender(); }, { 'aria-label': 'Inspect ' + r.key }),
      btn('Download', () => { const rec = full(r.gmKey); if (rec) saveFile(C.exportRecord(rec, stamp())); rerender(); }, { 'aria-label': 'Download ' + r.key })
    ]);
    if (canDelete) line.appendChild(btn('Delete', () => { S.pendingDelete = r.gmKey; rerender(); }, { 'aria-label': 'Delete ' + r.key }));
    return line;
  }
  function confirmBar(rerender) {
    const row = (S.rows || []).find(r => r.gmKey === S.pendingDelete); if (!row) return null;
    const p = C.parseKey(row.key);
    return E('div', { role: 'alertdialog', 'aria-label': 'Confirm delete', style: { border: '1px solid #c0392b', borderRadius: '8px', padding: '10px', margin: '8px 0' } }, [
      E('div', { text: 'Delete ' + (p.gen ? 'generator "' + p.gen + '"' : 'record') + ' key ' + row.key + '? This removes only that one key and cannot be undone.' }),
      E('div', { style: Object.assign({ marginTop: '4px' }, small), text: 'If this is a chat copy, its generator\'s chat index is not edited. Index cleanup is the generator\'s job.' }),
      E('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        btn('Confirm delete', () => runDelete(row.gmKey)),
        btn('Cancel', () => { S.pendingDelete = null; rerender(); })
      ])
    ]);
  }
  function inspector(rerender) {
    const i = S.inspected; if (!i) return note('Select Inspect on a record to see its details.');
    const wrap = E('div', { 'aria-label': 'Record inspector', style: { borderTop: '1px solid var(--wc-line,#555)', marginTop: '12px', paddingTop: '10px' } });
    wrap.appendChild(E('div', { text: 'Inspector', style: { fontWeight: '600', marginBottom: '6px' } }));
    i.report.meta.forEach(m => wrap.appendChild(E('div', { style: { display: 'flex', gap: '8px', fontSize: '12px' } }, [E('span', { text: m[0], style: { minWidth: '110px', opacity: '.7' } }), E('span', { text: m[1], style: { wordBreak: 'break-all' } })])));
    const chat = i.report.chat;
    if (chat) {
      if (chat.threads.length) { wrap.appendChild(E('div', { text: 'Threads', style: { fontWeight: '600', marginTop: '8px' } })); chat.threads.slice(0, 50).forEach(t => wrap.appendChild(E('div', { style: { fontSize: '12px' }, text: t.title + ' — ' + t.messages + ' message' + (t.messages === 1 ? '' : 's') }))); }
      if (chat.characters.length) wrap.appendChild(E('div', { style: { fontSize: '12px', marginTop: '6px' }, text: 'Characters: ' + chat.characters.join(', ') }));
      if (chat.configKeys.length) wrap.appendChild(E('div', { style: { fontSize: '12px', marginTop: '6px' }, text: 'Config keys (names only): ' + chat.configKeys.join(', ') }));
    }
    if (i.report.anomalies.length) {
      wrap.appendChild(E('div', { text: 'Warnings (read-only, nothing is changed)', style: { fontWeight: '600', marginTop: '10px', color: '#e0a030' } }));
      i.report.anomalies.forEach(a => wrap.appendChild(E('div', { 'data-anomaly': '1', style: { fontSize: '12px' }, text: '⚠ ' + a })));
    } else wrap.appendChild(E('div', { style: { fontSize: '12px', marginTop: '8px' }, text: 'No anomalies found.' }));
    return wrap;
  }

  function render(parent) {
    host = parent; S.msg = '';
    load();
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    const v = V();
    if (v && typeof v.onChange === 'function') unsub = v.onChange(() => { if (host && host.isConnected !== false && !S.pendingDelete) { load(); draw(); } });
    draw();
  }
  function draw() {
    const parent = host; if (!parent) return;
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    const rerender = () => draw();
    const wrap = E('div', { id: 'wc-backup-body' });
    wrap.appendChild(E('div', { text: 'Backup Manager', style: { fontWeight: '600', fontSize: '15px' } }));
    wrap.appendChild(note('Look after the generator backup copies kept in this companion. You can inspect and download them, and delete a single key. This tab never edits, moves or repairs a record; generators own their own data.'));
    const top = E('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' } });
    top.appendChild(btn('Refresh', () => { load(); draw(); }));
    top.appendChild(btn('Export all', () => exportRows('all-generators', S.rows || []), { disabled: !(S.rows && S.rows.length) }));
    top.appendChild(btn('Scan for plaintext secrets', () => { scanSecrets(); draw(); }, { disabled: !(S.rows && S.rows.length) }));
    wrap.appendChild(top);
    if (S.msg) wrap.appendChild(E('div', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', margin: '4px 0', color: S.msgErr ? '#ff9e92' : '' }, text: S.msg }));
    if (S.error) { wrap.appendChild(E('div', { role: 'alert', style: { color: '#ff9e92', margin: '8px 0' }, text: S.error })); parent.appendChild(wrap); return; }
    const inv = S.inv, info = (V() && V().info && V().info()) || {};
    wrap.appendChild(E('div', { 'data-summary': '1', style: Object.assign({ margin: '4px 0 10px' }, small), text:
      (info.backend || 'Userscript storage') + ' · ' + inv.count + ' backup key' + (inv.count === 1 ? '' : 's') + ' · ' + C.fmtBytes(inv.bytes) + ' used by backups' +
      (info.quota ? ' · browser storage ' + C.fmtBytes(info.usage || 0) + ' of ' + C.fmtBytes(info.quota) : '') }));
    if (!inv.count) wrap.appendChild(note('No generator backups are stored yet. They appear here after a generator saves a copy through Skybridge storage.'));
    const bar = confirmBar(rerender); if (bar) wrap.appendChild(bar);
    inv.generators.forEach(g => {
      const d = E('details', { 'data-gen': g.gen, style: { margin: '6px 0' } });
      if (S.selected && g.keys.some(k => k.gmKey === S.selected) || g.keys.some(k => k.gmKey === S.pendingDelete)) d.open = true;
      d.appendChild(E('summary', { text: g.gen + ' — ' + (g.snapshot ? 'source copy ' + (g.snapshot.stale ? '(stale)' : (g.snapshot.at ? C.fmtDate(g.snapshot.at) : 'present')) : 'no source copy') + ', ' + g.chats + ' chat cop' + (g.chats === 1 ? 'y' : 'ies') + ', ' + C.fmtBytes(g.bytes) +
        (g.newest ? ', newest ' + C.fmtDate(g.newest).slice(0, 10) : '') + (g.oldest && g.oldest !== g.newest ? ', oldest ' + C.fmtDate(g.oldest).slice(0, 10) : '') + (g.stale ? ', ' + g.stale + ' stale' : '') }));
      d.appendChild(E('div', { style: { padding: '2px 0 4px 12px' } }, [btn('Export folder', () => exportRows(g.gen, g.keys), { 'aria-label': 'Export folder ' + g.gen })]));
      g.keys.forEach(r => d.appendChild(E('div', { style: { paddingLeft: '12px' } }, [rowLine(r, true, rerender)])));
      wrap.appendChild(d);
    });
    function plain(title, rows, canDelete, why) {
      if (!rows.length) return;
      const d = E('details', { 'data-section': title, style: { margin: '6px 0' } });
      d.appendChild(E('summary', { text: title + ' (' + rows.length + ')' }));
      d.appendChild(E('div', { style: Object.assign({ padding: '2px 0 4px 12px' }, small), text: why }));
      rows.forEach(r => d.appendChild(E('div', { style: { paddingLeft: '12px' } }, [rowLine(r, canDelete, rerender)])));
      wrap.appendChild(d);
    }
    plain('Legacy (dadchat:vault)', inv.legacy, false, 'Read-only. Generators own the migration of these keys; this tab never migrates, renames or cleans them.');
    plain('Operational keys', inv.operational, false, 'Small link and self-test records. Display only.');
    plain('Other vault-prefix keys', inv.other, true, 'Keys under weld:genvault: whose folder name is not a valid generator name.');
    if (S.secrets) {
      wrap.appendChild(E('div', { text: 'Secret scan', style: { fontWeight: '600', marginTop: '10px' } }));
      if (!S.secrets.length) wrap.appendChild(note('No plaintext secret-shaped values found.'));
      S.secrets.forEach(h => wrap.appendChild(E('div', { 'data-secret': '1', style: { fontSize: '12px' }, text: '⚠ ' + h.key + ': ' + h.paths.join(', ') + ' (value hidden)' })));
    }
    wrap.appendChild(inspector(rerender));
    parent.appendChild(wrap);
  }
  window.weldBackup = { render };
})();
