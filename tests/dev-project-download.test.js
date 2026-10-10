// Reuse the existing Dev UI's host/DOM/IndexedDB fixtures, without its unrelated tests.
const fs = require('node:fs');
const fixture = fs.readFileSync(require.resolve('./dev-ui.test.js'), 'utf8').split('(async () => {')[0];
const tests = `
(async () => {
  let calls = [], fail = false, cancel = null;
  host.backup = { crypto: {}, collect: async (name, paths, snapshot) => {
    calls.push({ name, paths, snapshot }); return {};
  } };
  window.WeldLocalBackup = { save: async o => {
    if (cancel) cancel();
    if (!o.active()) throw new Error('paused');
    if (fail) throw new Error('disk changed');
    return { files: 4, written: 2, bytes: 12, unavailable: [] };
  } };
  render(); await sleep(30); render(); click('Choose folder…');
  await until(() => dev.state.F.revision !== null && dev.state.F.perm === 'granted');
  render();
  assert.ok(findBtn('Download all files and assets (this generator)'));
  confirmAnswer = false; await dev.downloadProject(); assert.equal(calls.length, 0);
  assert.deepEqual(store.get('folderSync').projectBackups, {});
  confirmAnswer = true; await dev.downloadProject();
  assert.equal(calls[0].name, 'zoo');
  assert.equal(calls[0].paths.dsl, 'zoo/zoo-top-panel.txt');
  assert.deepEqual(store.get('folderSync').projectBackups, { zoo: true });
  assert.equal(store.get('folderSync').autoMirror, false, 'does not enable every generator');
  calls.length = 0; dev.state.F.projectCheck = 0; await dev.tick(true);
  assert.equal(calls.length, 1, 'selected generator updates automatically');
  await dev.tick(true); assert.equal(calls.length, 1, 'asset scan is throttled');
  slug = 'castle'; dev.state.F.projectCheck = 0; await dev.tick(true);
  assert.equal(calls.length, 1, 'unselected generator is never downloaded');
  slug = 'zoo'; documentStub.hidden = true; await dev.tick(true);
  assert.equal(calls.length, 1, 'background editor does not update');
  documentStub.hidden = false; fail = true; dev.state.F.projectCheck = 0; await dev.tick(true);
  assert.match(dev.state.F.projectError, /disk changed/); assert.equal(dev.state.F.projectBusy, false);
  fail = false; render(); click('Pause project and asset updates (this generator)');
  assert.deepEqual(store.get('folderSync').projectBackups, {});
  calls.length = 0; await dev.tick(true); assert.equal(calls.length, 0);
  cancel = () => { render(); click('Pause automatic writes in all tabs'); };
  await dev.downloadProject(); assert.match(dev.state.F.projectError, /paused/);
  assert.deepEqual(store.get('folderSync').projectBackups, {}, 'pause prevents a manual in-flight download enabling updates');
  cancel = null; await dev.downloadProject();
  root = new FakeDir('new location'); render(); click('Change master folder…');
  await until(() => dev.state.F.name === 'new location' && !dev.state.F.cfg.projectBackups.zoo);
  assert.deepEqual(store.get('folderSync').projectBackups, {}, 'changing location resets project opt-ins');
  console.log('Dev project downloads: explicit selection, current generator, visibility, throttle, pause, errors and location changes passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
new Function('require', 'process', fixture + tests)(require, process);
