import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const vps = readFileSync('deploy/vps.sh', 'utf8');
const api = readFileSync('deploy/install-leaderboard-freebsd.sh', 'utf8');
for (const file of ['deploy/vps.sh', 'deploy/install-leaderboard-freebsd.sh']) {
  const checked = spawnSync('sh', ['-n', file], { encoding: 'utf8' });
  assert.equal(checked.status, 0, file + ': ' + checked.stderr);
}
for (const text of [
  'OS=freebsd',
  "STATE_DIR='/var/db/rust-signal'",
  "NGINX_DIR='/usr/local/etc/nginx'",
  'install-leaderboard-freebsd.sh',
  'su -m rustsignalbuild',
  'pw useradd rustsignalbuild',
  'NPM_CONFIG_CACHE="$WORK/npm-cache"',
  'service rust_signal_leaderboard',
  'api_unit=/usr/local/etc/rc.d/rust_signal_leaderboard',
  'api_snippet=/usr/local/etc/nginx/snippets/rust-signal-api.conf',
  'include /usr/local/etc/nginx/snippets/rust-signal-api.conf;',
  'sysrc -x rust_signal_leaderboard_enable',
]) assert(vps.includes(text), 'FreeBSD VPS support missing: ' + text);
for (const text of [
  '# Rust Signal FreeBSD rc service (loopback only)',
  '# PROVIDE: rust_signal_leaderboard',
  'REQUIRE: NETWORKING LOGIN',
  'load_rc_config',
  'sysrc rust_signal_leaderboard_enable=YES',
  'service rust_signal_leaderboard start',
  'node:sqlite',
  'chmod 700 "$DATA_DIR"',
  'chown rustsignal:rustsignal "$DATA_DIR"',
  '127.0.0.1:32741',
  'RS_PUBLIC_HOST',
  'proxy_set_header X-Real-IP',
  "grep -Fq 'Rust Signal global leaderboard on '",
]) assert(api.includes(text), 'FreeBSD API security or lifecycle guard missing: ' + text);
assert(!api.includes('systemctl'), 'FreeBSD rc service must not require systemd');
assert(!vps.includes('Global leaderboard requires Linux/systemd'), 'FreeBSD API must not be disabled');
console.log('PASS: FreeBSD rc.d service, private SQLite, Nginx loopback proxy, rollback and shell syntax');
