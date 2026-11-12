/** Isolated install/update security test; does not modify a real Nginx/systemd. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'rs-score-install-'));
const app = join(root, 'opt/rust-signal/leaderboard');
const data = join(root, 'var/lib/rust-signal/leaderboard');
const unit = join(root, 'etc/systemd/system/rust-signal-leaderboard.service');
const snippet = join(root, 'etc/nginx/snippets/rust-signal-api.conf');
const source = join(root, 'install-leaderboard.sh');
const bin = join(root, 'bin');
async function mock(name, body) {
  const p = join(bin, name);
  await writeFile(p, '#!/bin/sh\n' + body, {mode:0o755});
  await chmod(p, 0o755);
}
function invoke() {
  return spawnSync('sh', [source, 'server/leaderboard.mjs', join(bin, 'node'), 'game.example.com'], {
    encoding:'utf8',
    env: {...process.env, PATH:bin+':'+process.env.PATH, MOCK_ROOT:root},
  });
}
try {
  await mkdir(bin,{recursive:true});
  await mock('id', '[ "$1" = rustsignal ] && test -f "$MOCK_ROOT/registered"\n');
  await mock('useradd', 'touch "$MOCK_ROOT/registered"\n');
  await mock('getent', "printf 'rustsignal:x:991:991::%s:/usr/sbin/nologin\\n' \"$MOCK_ROOT/var/lib/rust-signal/leaderboard\"\n");
  await mock('chown', 'exit 0\n');
  await mock('systemctl', 'echo "$*" >> "$MOCK_ROOT/systemctl.log"\nexit 0\n');
  await mock('node', 'exit 0\n');
  let script = await readFile('deploy/install-leaderboard.sh', 'utf8');
  for (const [a,b] of [
    ["APP_DIR='/opt/rust-signal/leaderboard'", "APP_DIR='"+app+"'"],
    ["DATA_DIR='/var/lib/rust-signal/leaderboard'", "DATA_DIR='"+data+"'"],
    ["SYSTEMD_UNIT='/etc/systemd/system/rust-signal-leaderboard.service'", "SYSTEMD_UNIT='"+unit+"'"],
    ["NGINX_SNIPPET='/etc/nginx/snippets/rust-signal-api.conf'", "NGINX_SNIPPET='"+snippet+"'"],
  ]) {
    assert(script.includes(a),'Unexpected installer path: '+a);
    script=script.replace(a,b);
  }
  await mkdir(join(root, 'etc/systemd/system'),{recursive:true});
  await writeFile(source,script);
  const first = invoke();
  assert.equal(first.status,0,'Clean service install failed:\n'+first.stdout+first.stderr);
  const firstUnit = await readFile(unit,'utf8');
  const firstSnippet = await readFile(snippet,'utf8');
  assert.match(firstUnit,/ProtectSystem=strict/);
  assert.match(firstUnit,/UMask=0077/);
  assert.match(firstUnit,/User=rustsignal/);
  assert.match(firstUnit,/PrivateDevices=true/);
  assert.match(firstSnippet,/proxy_pass http:\/\/127\.0\.0\.1:32741/);
  assert.doesNotMatch(firstSnippet,/proxy_pass http:\/\/0\.0\.0\.0/);
  assert.equal((await stat(data)).mode & 0o077,0,'DB directory is readable to other users');
  await writeFile(join(data,'scores.sqlite'),'USER DATA MUST PERSIST');
  const update = invoke();
  assert.equal(update.status,0,'Repeated install/update failed:\n'+update.stdout+update.stderr);
  assert.equal(await readFile(join(data,'scores.sqlite'),'utf8'),'USER DATA MUST PERSIST');
  assert.equal(await readFile(unit,'utf8'),firstUnit,'Idempotent update changed unrelated service fields');
  assert.equal(await readFile(snippet,'utf8'),firstSnippet,'Idempotent update changed snippet');
  await writeFile(snippet,'# unrelated company owns this Nginx snippet\n');
  const collision = invoke();
  assert.notEqual(collision.status,0,'Installer overwrote pre-existing snippet from unrelated app');
  assert.equal(await readFile(snippet,'utf8'),'# unrelated company owns this Nginx snippet\n');
  assert.equal(await readFile(join(data,'scores.sqlite'),'utf8'),'USER DATA MUST PERSIST');
  await writeFile(snippet,firstSnippet);
  await writeFile(unit,'[Unit]\nDescription=Unrelated application\n');
  const unitCollision = invoke();
  assert.notEqual(unitCollision.status,0,'Installer overwrote an unrelated systemd unit');
  assert.equal(await readFile(unit,'utf8'),'[Unit]\nDescription=Unrelated application\n');
  console.log('PASS: isolated clean API install, repeat install, data preservation, service isolation, safe Nginx snippet and conflict refusal');
} finally {
  await rm(root,{recursive:true,force:true});
}
