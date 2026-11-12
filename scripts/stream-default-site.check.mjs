import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const script = readFileSync('deploy/stream-default-site.sh', 'utf8');
for (const required of [
  'systemctl is-active --quiet nginx.service',
  '/usr/sbin/nginx -t',
  'nginx -T > "$TMP/nginx-dump"',
  '$2 == "$ssl_preread_server_name"',
  '127\\.0\\.0\\.1:$PORT',
  'default_server',
  'ssl_certificate $CERT;',
  'ssl_certificate_key $KEY;',
  'root $WEBROOT;',
  'include /etc/nginx/snippets/rust-signal-api.conf;',
  'sh "$TMP/static.sh" "$ACTION" "$DOMAIN" "$WEBROOT"',
  'sh "$TMP/source/deploy/install-leaderboard.sh"',
  '--resolve "$DOMAIN:443:127.0.0.1"',
  '--resolve "$DOMAIN:$PORT:127.0.0.1"',
  'tls_ready=0',
  'while [ "$attempt" -lt 24 ]',
  'https://$DOMAIN:$PORT/',
  "die 'New certificate not consistently selected after graceful reload; vhost rollback will restore Nginx.",
  'Do not use -k or weaken TLS.',
  'JavaScript asset has the wrong Content-Type.',
  'Stylesheet has wrong MIME type.',
  'Graphics have the wrong MIME type.',
  'Leaderboard API is not served through HTTPS.',
  'CREATED_VHOST=1',
  'rm -f -- "$VHOST"',
  'systemctl reload nginx.service',
]) assert(script.includes(required), 'Required non-invasive safeguard missing: ' + required);

// The installer has no reason to write an existing stream config or
// modify any existing virtual host. Its only new Nginx file is rust-signal-*.
assert(!script.includes('MAP_CHANGED='));
assert(!script.includes('MAP_BACKUP='));
assert(!script.includes('sed -i'));
assert(!script.includes('systemctl restart nginx'));
assert(!script.includes('nginx -s stop'));
assert(script.includes('VHOST="/etc/nginx/conf.d/rust-signal-shared-$DOMAIN.conf"'));
assert(script.includes("if [ \"$ACTION\" = resume ]; then"));
assert(script.includes("grep -Fq \"$DOMAIN\" \"$TMP/nginx-dump\""));
assert(script.includes('openssl x509 -in "$CERT" -noout -checkhost "$DOMAIN"'));

// Exercise the *actual* AWK default-SNI extraction from the shell script
// against a synthetic example stream map (no private infrastructure).
const markerStart = "backend=$(awk -v mapname=\"$MAP_NAME\" '\n";
const markerEnd = "' \"$TMP/nginx-dump\")";
const start = script.indexOf(markerStart);
const end = script.indexOf(markerEnd, start + markerStart.length);
assert(start >= 0 && end > start, 'Default-upstream AWK detection missing');
const awk = script.slice(start + markerStart.length, end);
const fixture = [
  "# configuration file /etc/nginx/stream.d/example-tls.conf:",
  "map $ssl_preread_server_name $site_routes {",
  "  vpn.example.net vpn_backend;",
  "  site.example.net other_https_backend;",
  "  default default_https_upstream;",
  "}",
  "upstream default_https_upstream { server 127.0.0.1:18443; }",
  "server { listen 443; proxy_pass $site_routes; ssl_preread on; }",
].join('\n') + '\n';
const result = spawnSync('awk', ['-v', 'mapname=site_routes', awk], { input:fixture, encoding:'utf8' });
assert.equal(result.status,0,'AWK parser failed: '+result.stderr);
assert.equal(result.stdout.trim(),'default_https_upstream',
  'The default SNI target was not identified');

const syntax=spawnSync('sh',['-n','deploy/stream-default-site.sh'],{encoding:'utf8'});
assert.equal(syntax.status,0,syntax.stderr);
console.log('PASS: default SNI backend identified, no edits to stream routes, rollback guards, HTTPS/JS/CSS/image/API checks');
