import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync as read } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the exact firewalld block from the real VPS installer using fake
// systemctl/firewall-cmd commands. No OS firewall is accessed by this test.
const deploy = readFileSync('deploy/vps.sh', 'utf8');
const start = deploy.indexOf('# CentOS Stream / RHEL-family images');
const end = deploy.indexOf('\nmkdir -p "$STATE_DIR"', start);
assert(start > 0 && end > start, 'Cannot locate the firewalld deployment block');
const block = deploy.slice(start, end);
assert(!block.includes('firewall-cmd --reload'), 'Do not reload and disturb existing firewall rules');
const root = mkdtempSync(join(tmpdir(), 'rust-signal-firewalld-'));
const bin = join(root, 'bin');
mkdirSync(bin);
const writeBin = (name, source) => writeFileSync(join(bin, name), '#!/bin/sh\n' + source, { mode: 0o755 });
writeBin('systemctl', `
[ "$1" = is-active ] && [ "$2" = --quiet ] && [ "$3" = firewalld ] &&
  [ "$MOCK_ACTIVE" = yes ]
`);
writeBin('firewall-cmd', `
printf '%s\\n' "$*" >> "$MOCK_TRACE"
case "$*" in
  '--query-service=http') test -f "$MOCK_RUNTIME" ;;
  '--permanent --query-service=http') test -f "$MOCK_PERM" ;;
  '--add-service=http') touch "$MOCK_RUNTIME" ;;
  '--permanent --add-service=http') touch "$MOCK_PERM" ;;
  *) echo 'Unexpected firewalld command' >&2; exit 42 ;;
esac
`);
const rt = join(root, 'runtime');
const perm = join(root, 'persistent');
const trace = join(root, 'trace');
function run(os, active) {
  rmSync(trace, { force: true });
  const shell = 'OS=' + os + '\nsay(){ :; }\nfail(){ echo "$*" >&2; exit 1; }\n' + block;
  const p = spawnSync('sh', ['-c', shell], {
    encoding: 'utf8', env: { ...process.env,
      PATH: bin + ':' + process.env.PATH,
      MOCK_ACTIVE: active ? 'yes' : 'no',
      MOCK_TRACE: trace, MOCK_RUNTIME: rt, MOCK_PERM: perm,
    },
  });
  assert.equal(p.status, 0, p.stderr || p.stdout);
  return existsSync(trace) ? read(trace, 'utf8').trim().split('\n') : [];
}
try {
  assert.deepEqual(run('dnf', true), [
    '--query-service=http', '--add-service=http',
    '--permanent --query-service=http', '--permanent --add-service=http',
  ]);
  assert(existsSync(rt) && existsSync(perm), 'HTTP must be allowed in both firewall zones');
  assert.deepEqual(run('dnf', true), [
    '--query-service=http', '--permanent --query-service=http',
  ], 'Update must not rewrite existing firewall rules');
  rmSync(rt); rmSync(perm);
  assert.deepEqual(run('apt', true), [], 'Do not touch non-RHEL firewalls');
  assert.deepEqual(run('dnf', false), [], 'Do not touch inactive firewalld');
  console.log('PASS: CentOS active/persistent firewalld HTTP opening, idempotence, OS isolation');
} finally {
  rmSync(root, { recursive: true, force: true });
}
