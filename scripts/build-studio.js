// Embed maintainable Studio sources into the single installable userscript.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'weld-companion.user.js');
const start = '/* BEGIN GENERATED STUDIO */';
const end = '/* END GENERATED STUDIO */';
const normalize = s => s.replace(/\r\n/g, '\n');
const current = normalize(fs.readFileSync(file, 'utf8'));
const body = ['studio-core.js', 'studio-ui.js'].map(name => normalize(fs.readFileSync(path.join(root, 'src', name), 'utf8')).trimEnd()).join('\n\n');
const block = start + '\n' + body + '\n' + end + '\n';
const from = current.indexOf(start);
let output;
if (from === -1) output = current.trimEnd() + '\n\n' + block;
else {
  const to = current.indexOf(end, from);
  if (to === -1) throw new Error('Missing Studio end marker.');
  output = current.slice(0, from) + block + current.slice(to + end.length).replace(/^\n/, '');
}
if (process.argv.includes('--check')) {
  if (output !== current) { console.error('Studio bundle is stale. Run npm run build.'); process.exitCode = 1; }
  else console.log('Studio bundle matches source.');
} else fs.writeFileSync(file, output);
