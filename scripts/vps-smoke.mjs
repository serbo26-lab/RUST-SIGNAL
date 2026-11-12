import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// End-to-end install/update/rollback test with all files isolated under
// a temporary directory and Git/npm/Nginx/service management mocked.
// No VPS packages or global Nginx configuration are touched.
const root = await mkdtemp(join(tmpdir(), 'rust-vps-smoke-'));
const bin = join(root, 'bin');
const conf = join(root, 'etc/nginx');
const web = join(root, 'www');
const state = join(root, 'state');
const runtimeParent = join(root, 'opt', 'rust-signal');
const runtime = join(runtimeParent, 'runtime');
const installer = join(root, 'vps.sh');
async function executable(name, source) {
  const path = join(bin, name);
  await writeFile(path, '#!/bin/sh\n' + source, { mode: 0o755 });
  await chmod(path, 0o755);
}
function run(args, env = {}) {
  return spawnSync('sh', ['-c', 'umask 077; exec sh "$@"', 'sh', installer, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: bin + ':' + process.env.PATH,
      MOCK_CONF_DIR: join(conf, 'conf.d'),
      MOCK_NGINX_MAIN: join(conf, 'nginx.conf'),
      RUST_SIGNAL_SKIP_ONLINE_API: '1',
      RUST_SIGNAL_SKIP_NONROOT_BUILD: '1',
      ...env,
    },
  });
}
try {
  await mkdir(bin, { recursive: true });
  await mkdir(join(conf, 'conf.d'), { recursive: true });
  await writeFile(join(conf, 'nginx.conf'), 'events { worker_connections 128; }\nhttp { include ' + join(conf, 'conf.d') + '/*.conf; }\n');
  const originalMainNginx = await readFile(join(conf, 'nginx.conf'),'utf8');
// A previous installation can leave the private build runtime inaccessible
// to rustsignalbuild: emulate real "umask 077" from replace-domain.sh.
await mkdir(runtime, {recursive:true,mode:0o700});
await chmod(runtimeParent, 0o700);
await chmod(runtime, 0o700);
assert.equal((await stat(runtimeParent)).mode & 0o777, 0o700);
assert.equal((await stat(runtime)).mode & 0o777, 0o700);
  // A live Nginx server may host a completely unrelated application.
  const neighbor = join(conf, 'conf.d/other-app.conf');
  const neighborContent = '# unrelated TLS/site, must remain unchanged\nserver { listen 80; server_name other.example.com *.example.net; root /srv/other-app; }\n';
  await writeFile(neighbor, neighborContent);
  let source = await readFile('deploy/vps.sh', 'utf8');
  const patch = [
    ["SITE_ROOT='/var/www/rust-signal'", "SITE_ROOT='" + web + "'"],
    ["RUNTIME_ROOT='/opt/rust-signal/runtime'", "RUNTIME_ROOT='" + runtime + "'"],
    ["STATE_DIR='/var/lib/rust-signal'", "STATE_DIR='" + state + "'"],
    ["NGINX_DIR='/etc/nginx'", "NGINX_DIR='" + conf + "'"],
  ];
  for (const [old, next] of patch) {
    assert(source.includes(old), 'Installer layout has changed: ' + old);
    source = source.replace(old, next);
  }
  await writeFile(installer, source);

  await executable('id', 'echo 0\n');
  await executable('git', `
if [ "$1" = clone ]; then
  for last; do :; done
  mkdir -p "$last/dist/assets" "$last/dist/remaster" "$last/deploy"
  echo ok > "$last/dist/index.html"
  echo ok > "$last/dist/assets/index.js"
  echo ok > "$last/dist/remaster/atlas.webp"
  printf 'server {\\n    listen 80;\\n    listen [::]:80;\\n    server_name __DOMAIN__;\\n    root __WEB_ROOT__;\\n}\\n' > "$last/deploy/nginx-site.conf.template"
elif [ "$1" = rev-parse ]; then
  echo abcd1234mock
else
  exit 2
fi
`);
  await executable('npm', `
if [ "$1" = -v ] || [ "$1" = --version ]; then echo 12.1.0; exit 0; fi
if [ "$1" = ci ] || { [ "$1" = run ] && [ "$2" = build ]; }; then exit 0; fi
exit 2
`);
  // The mock installer needs a compatible Node even when the host only has
  // the isolated runtime. Do not accidentally execute real npm in fake repo.
  await executable('node', `
if [ "$1" = -v ] || [ "$1" = --version ]; then echo v24.22.2; exit 0; fi
if [ "$1" = -e ]; then exit 0; fi
exit 2
`);
  await executable('nginx', `
if [ "$1" = -t ]; then [ "\${FAIL_NGINX:-0}" = 0 ]; exit $?; fi
if [ "$1" = -T ]; then
  printf '# configuration file %s:\\n' "$MOCK_NGINX_MAIN"
  cat "$MOCK_NGINX_MAIN"
  for f in "$MOCK_CONF_DIR"/*.conf; do
    [ -e "$f" ] || continue
    printf '# configuration file %s:\\n' "$f"
    cat "$f"
  done
  exit 0
fi
exit 2
`);
  await executable('systemctl', 'if [ "$1" = is-active ]; then exit 1; fi\nexit 0\n');

  const occupied = run(['install', 'other.example.com']);
  assert.notEqual(occupied.status, 0, 'Installer claimed another application domain');
  const wildcardOccupied = run(['install', 'game.example.net']);
  assert.notEqual(wildcardOccupied.status, 0,
    'Installer claimed a domain covered by another site wildcard');
  assert.equal(await readFile(neighbor,'utf8'), neighborContent, 'Occupied vhost mutated');
  const first = run(['install', 'game.example.com']);
  assert.equal(first.status, 0, 'Install failed: ' + first.stdout + first.stderr);
  assert.equal((await stat(runtimeParent)).mode & 0o777, 0o755,
    'Runtime parent must be traversable by the non-root build/service user');
  assert.equal((await stat(runtime)).mode & 0o777, 0o755,
    'Existing Node runtime directory must recover from restrictive permissions');
  assert.equal((await readFile(join(state, 'domain'), 'utf8')).trim(), 'game.example.com');
  assert.equal(await readFile(neighbor,'utf8'), neighborContent, 'Fresh install touched unrelated Nginx vhost');
  assert.equal(await readFile(join(conf,'nginx.conf'),'utf8'),originalMainNginx,'Fresh install rewrote main nginx.conf');
  const current = join(web, 'current');
  const original = await readlink(current);
  assert((await stat(join(current, 'index.html'))).size > 0);
  const vhost = join(conf, 'conf.d/rust-signal.conf');
  await writeFile(vhost, (await readFile(vhost, 'utf8')) + '\n# TLS extension must survive the update\n');
  const update = run(['update']);
  assert.equal(update.status, 0, 'Update failed: ' + update.stdout + update.stderr);
  const latest = await readlink(current);
  assert.notEqual(latest, original, 'Update did not change the release symlink');
  assert.equal(await readFile(neighbor,'utf8'), neighborContent, 'Update touched another Nginx vhost');
  assert.equal(await readFile(join(conf,'nginx.conf'),'utf8'),originalMainNginx,'Update rewrote main nginx.conf');
  assert((await readFile(vhost, 'utf8')).includes('TLS extension'),
    'Update overwrote existing Nginx/TLS configuration');
  const failure = run(['update'], { FAIL_NGINX: '1' });
  assert.notEqual(failure.status, 0, 'Forced Nginx error did not fail');
  assert.equal(await readlink(current), latest, 'Failed update did not restore old website');
  assert.equal(await readFile(neighbor,'utf8'), neighborContent, 'Failed update damaged unrelated vhost');
  assert.equal(await readFile(join(conf,'nginx.conf'),'utf8'),originalMainNginx,'Rollback changed main nginx.conf');
  assert.equal((await readdir(join(web, 'releases'))).length, 2,
    'Failed update left an unused release in webroot');
  // A fresh server must also work without providing a DNS name.
  await rm(web, { recursive: true, force: true });
  await rm(state, { recursive: true, force: true });
  await rm(vhost, { force: true });
  const ipInstall = run(['install']);
  assert.equal(ipInstall.status, 0, 'IP-only install failed: ' + ipInstall.stdout + ipInstall.stderr);
  assert.equal((await readFile(join(state, 'domain'), 'utf8')).trim(), '',
    'IP-only install must persist an empty domain');
  const ipVhost = await readFile(vhost, 'utf8');
  assert(ipVhost.includes('server_name ~^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$;'),
    'IP-only mode should match an IPv4 Host without claiming default_server');
  assert(ipInstall.stdout.includes('http://<YOUR_VPS_PUBLIC_IP>/'),
    'IP-only install should show how to open the game');
  const ipRelease = await readlink(current);
  const ipUpdate = run(['update']);
  assert.equal(ipUpdate.status, 0, 'IP-only update failed: ' + ipUpdate.stdout + ipUpdate.stderr);
  assert.notEqual(await readlink(current), ipRelease, 'IP-only update did not publish new release');
  assert.equal(await readFile(vhost, 'utf8'), ipVhost, 'IP-only update modified Nginx config');
  const rejectChange = run(['install', 'play.example.org']);
  assert.notEqual(rejectChange.status, 0, 'Reinstall silently changed IP-only mode to domain mode');
  // A dedicated replacement may reuse a certificate from the former site.
  // The first Nginx reload must already publish HTTPS, not downgrade to HTTP.
  await rm(web, {recursive:true,force:true});
  await rm(state, {recursive:true,force:true});
  await rm(vhost, {force:true});
  const cert = join(root, 'test-fullchain.pem');
  const key = join(root, 'test-privkey.pem');
  await writeFile(cert, 'dummy cert for mocked nginx');
  await writeFile(key, 'dummy key for mocked nginx');
  const tlsInstall = run(['install','secure.example.com'], {
    RUST_SIGNAL_TLS_CERT: cert, RUST_SIGNAL_TLS_KEY: key,
  });
  assert.equal(tlsInstall.status, 0, 'TLS first deployment failed: '+tlsInstall.stdout+tlsInstall.stderr);
  const tlsVhost = await readFile(vhost,'utf8');
  assert.match(tlsVhost,/listen 443 ssl;/);
  assert(tlsVhost.includes('ssl_certificate '+cert+';'));
  assert(tlsVhost.includes('ssl_certificate_key '+key+';'));
  assert(tlsVhost.includes('return 301 https:\/\/secure.example.com$request_uri;'));
  assert.equal(await readFile(neighbor,'utf8'),neighborContent);
  const tlsUpdate = run(['update']);
  assert.equal(tlsUpdate.status,0,'HTTPS update failed');
  assert.equal(await readFile(vhost,'utf8'),tlsVhost,'Update must not drop HTTPS');
  console.log('PASS: named and domainless install/update, TLS replacement, config preservation, rollback');
} finally {
  await rm(root, { recursive: true, force: true });
}
