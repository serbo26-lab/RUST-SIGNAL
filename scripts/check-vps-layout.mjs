import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const removed = [
  'PLAY.bat', 'launchers/README-WINDOWS.md',
  'launchers/start-built.bat', 'launchers/start-dev.bat',
  'launchers/wait-and-open.ps1', 'launchers/make-portable-zip.ps1',
  'rust-signal-fixed.html', 'rust-signal-single-file.html',
  'DEPLOY_VPS.md', 'deploy/install-vps.sh',
];
for (const file of removed) {
  let exists = true;
  try { await access(file); } catch { exists = false; }
  assert.equal(exists, false, 'Obsolete launcher/document still tracked: ' + file);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert(!pkg.scripts.dev && !pkg.scripts.preview,
  'Localhost launch commands must be removed');
assert(pkg.scripts.build && pkg.scripts.test,
  'Deployment requires a reproducible build and tests');
const docs = await readFile('README.md', 'utf8');
assert(docs.includes('deploy/vps.sh') && !docs.includes('npm run dev')
  && !docs.includes('PLAY.bat') && !docs.includes('localhost'),
  'README must describe GitHub VPS install/update only');
const deploy = await readFile('deploy/vps.sh', 'utf8');
assert(deploy.includes('runuser -u rustsignalbuild') && deploy.includes('find dist -type l'),
  'VPS build must drop root privileges and reject symlink output');
assert(deploy.includes('git clone') && deploy.includes('npm ci')
  && deploy.includes('npm run build') && deploy.includes('nginx -t'),
  'VPS installer must fetch, compile and configure the website');
console.log('PASS: VPS deployment workflow and server-backed leaderboards verified');
