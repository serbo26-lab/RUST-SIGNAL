/** Regression: static selfmask deployment must never edit the proxy/nginx or ACME. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'rust-signal-selfmask-test-'));
const webroot = join(root, 'site');
const bin = join(root, 'bin');
const state = join(root, 'state');
const backup = join(root, 'backups');
const runtime = join(root, 'runtime');
const fakeNginxConfig = join(root, 'nginx.conf');
const otherSite = join(root, 'other-application');
const scriptFile = join(root, 'selfmask-webroot.sh');
const domain = 'test.example.net';
async function mock(name, body) {
  const path = join(bin, name);
  await writeFile(path, '#!/bin/sh\n' + body + '\n');
  await chmod(path, 0o755);
}
function run(mode, extra = {}) {
  return spawnSync('sh', [scriptFile, mode, domain, webroot], {
    encoding: 'utf8', timeout: 30000,
    env: {
      ...process.env, PATH: bin + ':' + process.env.PATH,
      MOCK_SITE_ROOT: webroot, MOCK_DIST_VERSION: 'v1', ...extra,
    },
  });
}
async function content(file) { return await readFile(file, 'utf8'); }
try {
  for (const dir of [webroot, bin, otherSite]) await mkdir(dir, { recursive: true });
  await mkdir(join(webroot, '.well-known', 'acme-challenge'), {recursive:true});
  await writeFile(join(webroot, '.well-known/acme-challenge/PROOF'), 'ACME-NEVER-TOUCH');
  await writeFile(join(webroot, 'index.html'), '<html>Original decoy page</html>');
  await writeFile(join(otherSite, 'index.html'), 'UNRELATED-WEBSITE');
  await writeFile(fakeNginxConfig, 'server { listen 80; server_name other.example.net; }\n');
  const nginxBefore = await content(fakeNginxConfig);
  let src = await readFile('deploy/selfmask-webroot.sh', 'utf8');
  for (const [find, replace] of [
    ['STATE_PARENT=/var/lib/rust-signal-selfmask', 'STATE_PARENT=' + state],
    ['BACKUP_BASE=/var/backups/rust-signal-selfmask', 'BACKUP_BASE=' + backup],
    ['RUNTIME=/opt/rust-signal-selfmask', 'RUNTIME=' + runtime],
  ]) {
    assert(src.includes(find), 'Installer fixture changed: ' + find);
    src = src.replace(find, replace);
  }
  await writeFile(scriptFile, src);
  await mock('id', '[ "$1" = -u ] && { echo 0; exit 0; }\n[ "$1" = rustsignalbuild ] && exit 0\nexit 1');
  await mock('getent', '[ "$1" = passwd ] && [ "$2" = rustsignalbuild ] && { echo rustsignalbuild:x:999:999::/nonexistent:/usr/sbin/nologin; exit 0; }\nexit 1');
  await mock('chown', 'exit 0');
  await mock('runuser', '[ "$1" = -u ] && [ "$3" = -- ] || exit 12\nshift 3\nexec env MOCK_UNPRIV=1 "$@"');
  await mock('node', '[ "$1" = -e ] && exit 0\n[ "$1" = -v ] && { echo v24.22.3; exit 0; }\nexit 0');
  await mock('git', [
    'case "$1" in',
    ' clone) for x; do last="$x"; done; mkdir -p "$last";; ',
    ' -C) [ "$MOCK_UNPRIV" = 1 ] || { echo "fatal: detected dubious ownership" >&2; exit 128; }; echo 123abc987def;;',
    ' *) exit 21;;',
    'esac',
  ].join('\n'));
  await mock('npm', [
    '[ "$1" = ci ] && exit 0',
    '[ "$1" = run ] && [ "$2" = build ] || exit 22',
    '[ "$FAIL_BUILD" = 1 ] && exit 66',
    'mkdir -p dist/assets dist/remaster dist/play',
    'printf "<html>Rust Signal %s</html>\\n" "$MOCK_DIST_VERSION" > dist/index.html',
    'printf "<html>Play</html>\\n" > dist/play/index.html',
    'printf "console.log(1);\\n" > dist/assets/game-123.js',
    'printf "placeholder" > dist/remaster/atlas.webp',
    'exit 0',
  ].join('\n'));
  // Force an I/O error after the original decoy has been snapshotted.
  await mock('cp', [
    'if [ "$FAIL_COPY_SITE" = 1 ]; then',
    '  case "$2" in */source/dist/*) for arg; do [ "$arg" = "$MOCK_SITE_ROOT/" ] && { echo forced-copy-error >&2; exit 71; }; done;; esac',
    'fi',
    'exec /bin/cp "$@"',
  ].join('\n'));
  // Initial installation must refuse unrelated static files without mutating them.
  await writeFile(join(webroot, 'other.txt'), 'PRIVATE-UNRELATED');
  assert.notEqual(run('install').status, 0, 'Unexpected original files must block install');
  assert.equal(await content(join(webroot, 'other.txt')), 'PRIVATE-UNRELATED');
  await rm(join(webroot, 'other.txt'));

  // Git rejects root inspection of a clone owned by the unprivileged builder.
  // Fake git now enforces this so the old regression cannot silently pass.
  const installed = run('install');
  assert.equal(installed.status, 0, 'Static install failed: ' + installed.stdout + installed.stderr);
  assert.equal(await content(join(webroot, 'index.html')), '<html>Rust Signal v1</html>\n');
  assert.equal(await content(join(webroot, '.well-known/acme-challenge/PROOF')), 'ACME-NEVER-TOUCH');
  assert.equal(await content(fakeNginxConfig), nginxBefore);
  assert.equal(await content(join(otherSite, 'index.html')), 'UNRELATED-WEBSITE');
  assert.equal(await content(join(state, domain, 'webroot')), webroot + '\n');
  assert((await readdir(join(backup, domain))).length > 0);

  const duplicate = run('install');
  assert.notEqual(duplicate.status, 0, 'Second install must require update');

  const activeLock=join(state, domain, '.deploy-lock');
  await mkdir(activeLock);
  const competing=run('update');
  assert.notEqual(competing.status,0,'Concurrent deployment must refuse');
  await readdir(activeLock); // lock must remain owned by the first deployment
  await rm(activeLock,{recursive:true});

  const failedBuild = run('update', {FAIL_BUILD:'1'});
  assert.notEqual(failedBuild.status, 0);
  assert.equal(await content(join(webroot, 'index.html')), '<html>Rust Signal v1</html>\n');
  const failedCopy = run('update', {FAIL_COPY_SITE:'1', MOCK_DIST_VERSION:'v2'});
  assert.notEqual(failedCopy.status, 0, 'Publishing failure must be rolled back');
  assert.equal(await content(join(webroot, 'index.html')), '<html>Rust Signal v1</html>\n');
  assert.equal(await content(join(webroot, 'assets/game-123.js')), 'console.log(1);\n');
  assert.equal(await content(join(webroot, '.well-known/acme-challenge/PROOF')), 'ACME-NEVER-TOUCH');
  assert.equal(await content(join(state,domain,'revision')), '123abc987def\n');

  await writeFile(join(webroot, 'third-party'), 'UNMANAGED');
  const foreign = run('update');
  assert.notEqual(foreign.status,0,'Untracked files must block update');
  assert.equal(await content(join(webroot,'third-party')),'UNMANAGED');
  await rm(join(webroot,'third-party'));
  const updated = run('update', {MOCK_DIST_VERSION:'v2'});
  assert.equal(updated.status,0,'Update failed: '+updated.stdout+updated.stderr);
  assert.equal(await content(join(webroot, 'index.html')), '<html>Rust Signal v2</html>\n');
  assert.equal(await content(join(webroot, '.well-known/acme-challenge/PROOF')), 'ACME-NEVER-TOUCH');
  assert.equal(await content(fakeNginxConfig), nginxBefore);
  assert.equal(await content(join(otherSite, 'index.html')), 'UNRELATED-WEBSITE');
  console.log('PASS: selfmask static install/update, ACME preservation, proxy isolation, backups, rollback, untracked-file refusal');
} finally {
  await rm(root, {recursive:true,force:true});
}
