/** Isolated regression of the EXPLICIT replacement command. No real Nginx touched. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,readlink,rm,readdir,chmod,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const root=await mkdtemp(join(tmpdir(),'rs-domain-replace-test-'));
const nginx=join(root,'etc/nginx');
const enabled=join(nginx,'sites-enabled');
const available=join(nginx,'sites-available');
const confd=join(nginx,'conf.d');
const backup=join(root,'backups');
const state=join(root,'state');
const oldSite=join(root,'old-website');
const bins=join(root,'bin');
const wrapper=join(root,'replace-domain.sh');
const fakeVps=join(root,'fake-vps.sh');
const source=join(available,'game.conf');
const active=join(enabled,'game.conf');
const neighbor=join(confd,'neighbor.conf');
const managed=join(confd,'rust-signal.conf');
const log=join(root,'installer.log');
const DOMAIN='game.example.com';
async function mock(name,body){
 const p=join(bins,name);
 await writeFile(p,'#!/bin/sh\n'+body,{mode:0o755});
 await chmod(p,0o755);
}
function call(domain=DOMAIN,extra={}){
 return spawnSync('sh',[wrapper,domain],{encoding:'utf8',timeout:10000,env:{
  ...process.env,PATH:bins+':'+process.env.PATH,MOCK_NGINX:nginx,
  MOCK_VPS:fakeVps,MOCK_STATE:state,MOCK_INSTALL_LOG:log,
  MOCK_RENDERER:join(process.cwd(),'deploy/render-replacement.py'),
  MOCK_TEMPLATE:join(process.cwd(),'deploy/nginx-site.conf.template'),...extra
 }});
}
const oldBody=(rootDir=oldSite)=>'server { listen 80; server_name '+DOMAIN+'; root '+rootDir+'; }\n';
async function reset(text=oldBody()){
 await rm(managed,{force:true});
 await rm(state,{recursive:true,force:true});
 await rm(active,{force:true});
 await writeFile(source,text);
 await symlink(source,active);
}
try{
 for(const p of [nginx,enabled,available,confd,backup,state,oldSite,bins]) await mkdir(p,{recursive:true});
 await writeFile(join(oldSite,'index.html'),'IMPORTANT ORIGINAL WEBSITE - NEVER DELETE');
 await writeFile(join(nginx,'nginx.conf'),'events { worker_connections 100; }\nhttp { include /dummy/*.conf; }\n');
 const mainBefore=await readFile(join(nginx,'nginx.conf'),'utf8');
 await writeFile(neighbor,'server { listen 80; server_name neighbor.example.com; root /srv/neighbor; }\n');
 const neighborBefore=await readFile(neighbor,'utf8');
 let script=await readFile('deploy/replace-domain.sh','utf8');
 for(const [a,b] of [
  ['NGINX=/etc/nginx','NGINX='+nginx],
  ['STATE=/var/lib/rust-signal','STATE='+state],
  ['BACKUP=/var/backups/rust-signal/replaced-','BACKUP='+backup+'/replaced-'],
  ['mkdir -p /var/backups/rust-signal','mkdir -p '+backup],
  ['chmod 700 /var/backups/rust-signal','chmod 700 '+backup],
 ]) {
  assert(script.includes(a),'Expected installer substitution: '+a);
  script=script.replace(a,b);
 }
 await writeFile(wrapper,script);
 await writeFile(fakeVps,[
  '#!/bin/sh',
  '[ "$1" = install ] || exit 4',
  'mkdir -p "$MOCK_NGINX/conf.d" "$MOCK_STATE"',
  "printf 'TLS=%s KEY=%s OPTIONS=%s DH=%s\\n' \"$RUST_SIGNAL_TLS_CERT\" \"$RUST_SIGNAL_TLS_KEY\" \"$RUST_SIGNAL_TLS_OPTIONS\" \"$RUST_SIGNAL_TLS_DHPARAM\" > \"$MOCK_INSTALL_LOG\"",
  '[ -s "$RUST_SIGNAL_REPLACEMENT_CONFIG" ] || exit 19',
  'cp "$RUST_SIGNAL_REPLACEMENT_CONFIG" "$MOCK_NGINX/conf.d/rust-signal.conf"',
  '[ "$FAIL_INSTALL" = 1 ] && exit 17',
  'printf "%s\\n" "$2" > "$MOCK_STATE/domain"',
  'echo MOCK_OK',
  'exit 0',
 ].join('\n')+'\n');
 await mock('id','[ "$1" = -u ] && echo 0 || exit 1\n');
 await mock('systemctl','case "$1" in is-active) exit 0;; reload) echo reload >> "$MOCK_NGINX/reloads.log"; exit 0;; *) exit 1;; esac\n');
 await mock('curl','for x do prev="$last"; last="$x"; done\n[ "$prev" = -o ] || exit 8\ncase "$last" in */vps.sh) cp "$MOCK_VPS" "$last";; */render-replacement.py) cp "$MOCK_RENDERER" "$last";; */nginx-site.conf.template) cp "$MOCK_TEMPLATE" "$last";; *) exit 9;; esac\n');
 await mock('nginx',[
  'if [ "$1" = -t ]; then exit 0; fi',
  'if [ "$1" = -T ]; then',
  '  for f in "$MOCK_NGINX/nginx.conf" "$MOCK_NGINX"/sites-enabled/* "$MOCK_NGINX"/conf.d/*.conf "$MOCK_NGINX"/custom/*; do',
  '    [ -f "$f" ] || continue',
  '    printf "# configuration file %s:\\n" "$f"',
  '    cat "$f"',
  '  done',
  '  exit 0',
  'fi',
  'exit 1',
 ].join('\n')+'\n');
 await reset();
 // Must refuse to take an unrelated domain or shared file.
 const notOwner=call('wrong.example.com');
 assert.notEqual(notOwner.status,0);
 assert(await readlink(active));
 await reset('server { listen 80; server_name '+DOMAIN+' other.example.com; root /srv/shared; }\n');
 const shared=call();
 assert.notEqual(shared.status,0,'Cannot disable a mixed-domain file');
 assert(await readlink(active),'Mixed domain vhost must remain active');
 await reset();
 await writeFile(join(confd,'wildcard.conf'),'server { listen 80; server_name *.example.com; root /srv/wild; }\n');
 const wildcard=call();
 assert.notEqual(wildcard.status,0,'Wildcard overlap must fail closed');
 await rm(join(confd,'wildcard.conf'));
 await reset();
 const first=call();
 assert.equal(first.status,0,'Dedicated HTTP domain should be replaced: '+first.stdout+first.stderr);
 assert.equal((await readFile(managed,'utf8')).includes(DOMAIN),true);
 await assert.rejects(readlink(active),'Old Nginx enabled link must be disabled');
 assert.equal(await readFile(join(oldSite,'index.html'),'utf8'),'IMPORTANT ORIGINAL WEBSITE - NEVER DELETE');
 assert.equal(await readFile(neighbor,'utf8'),neighborBefore);
 assert.equal(await readFile(join(nginx,'nginx.conf'),'utf8'),mainBefore);
 let backups=await readdir(backup);
 assert(backups.length>0);
 assert.equal(await readFile(join(backup,backups.at(-1),'original.conf'),'utf8'),oldBody());
 assert.equal((await stat(join(backup,backups.at(-1))).mode&0o077),0);
 // A second run must refuse because this host is now managed.
 assert.notEqual(call().status,0);
 // Simulate deployment failure: old link restored, unrelated sites intact.
 await reset();
 const failed=call(DOMAIN,{FAIL_INSTALL:'1'});
 assert.notEqual(failed.status,0,'Failed installer cannot be reported as success');
 assert.equal(await readlink(active),source,'Old site symlink must be restored on failure');
 await assert.rejects(readFile(managed),'Failed managed vhost must be removed');
 assert.equal(await readFile(neighbor,'utf8'),neighborBefore);
 assert.equal(await readFile(join(oldSite,'index.html'),'utf8'),'IMPORTANT ORIGINAL WEBSITE - NEVER DELETE');
 // Existing HTTPS certificate must be forwarded to the normal installer.
 await reset();
 const cert=join(root,'fullchain.pem'),key=join(root,'privkey.pem');
 await writeFile(cert,'TEST CERT'),await writeFile(key,'TEST KEY');
 const tlsBody='server { listen 80; server_name '+DOMAIN+'; return 301 https://'+DOMAIN+'; }\n'+
   'server {\n listen 443 ssl;\n server_name '+DOMAIN+';\n ssl_certificate '+cert+';\n ssl_certificate_key '+key+';\n root '+oldSite+';\n}\n';
 await writeFile(source,tlsBody);
 const https=call();
 assert.equal(https.status,0,'HTTPS domain replacement should succeed: '+https.stdout+https.stderr);
 const captured=await readFile(managed,'utf8');
 assert(captured.includes('ssl_certificate '+cert+';'),'TLS certificate not preserved');
 assert(captured.includes('ssl_certificate_key '+key+';'),'TLS private key path not preserved');
 assert.equal(await readFile(join(oldSite,'index.html'),'utf8'),'IMPORTANT ORIGINAL WEBSITE - NEVER DELETE');

 // Separate HTTP and HTTPS files for one domain must migrate together.
 await reset();
 const separatedTls=join(confd,'game-https.conf');
 const separatedHttps='server {\n listen 443 ssl;\n server_name '+DOMAIN+';\n ssl_certificate '+cert+';\n ssl_certificate_key '+key+';\n root '+oldSite+';\n}\n';
 await writeFile(separatedTls,separatedHttps);
 const split=call();
 assert.equal(split.status,0,'Split HTTP and HTTPS should migrate: '+split.stdout+split.stderr);
 await assert.rejects(readlink(active),'HTTP vhost must be disabled');
 await assert.rejects(readFile(separatedTls),'HTTPS vhost must be disabled');
 assert((await readFile(managed,'utf8')).includes('ssl_certificate '+cert+';'));
 const splitBackups=(await readdir(backup)).sort();
 const splitBackup=join(backup,splitBackups.at(-1));
 const savedPaths=(await readFile(join(splitBackup,'original-paths.txt'),'utf8')).trim().split('\n');
 assert.deepEqual(savedPaths.sort(),[active,separatedTls].sort());
 const savedConfigs=[
   await readFile(join(splitBackup,'original.conf'),'utf8'),
   await readFile(join(splitBackup,'original-2.conf'),'utf8')
 ];
 assert.deepEqual(savedConfigs.sort(),[oldBody(),separatedHttps].sort());
 assert.equal(await readFile(join(oldSite,'index.html'),'utf8'),'IMPORTANT ORIGINAL WEBSITE - NEVER DELETE');
 assert.equal(await readFile(neighbor,'utf8'),neighborBefore);
 // A failed multi-file install must restore *both* original vhosts.
 await reset();
 await writeFile(separatedTls,separatedHttps);
 const splitFailed=call(DOMAIN,{FAIL_INSTALL:'1'});
 assert.notEqual(splitFailed.status,0,'Failed replacement must fail');
 assert.equal(await readlink(active),source);
 assert.equal(await readFile(separatedTls,'utf8'),separatedHttps);
 await assert.rejects(readFile(managed));
 assert.equal(await readFile(neighbor,'utf8'),neighborBefore);
 // If the second file contains another domain, refuse without side effects.
 await reset();
 const mixedSplit='server { listen 443 ssl; server_name '+DOMAIN+' second.example.com; root /srv/shared; }\n';
 await writeFile(separatedTls,mixedSplit);
 const deniedSplit=call();
 assert.notEqual(deniedSplit.status,0,'Shared second vhost must be rejected');
 assert.equal(await readlink(active),source);
 assert.equal(await readFile(separatedTls,'utf8'),mixedSplit);
 await rm(separatedTls);
 // Regression: a reverse proxy uses nonstandard ports and loopback-only TLS.
 // Do not turn 127.0.0.1:24443 into public 443 or drop the HTTP proxy port.
 const httpConfig='server {\n    listen 80;\n    listen [::]:80;\n    listen 127.0.0.1:18080;\n    server_name '+DOMAIN+';\n    root '+oldSite+';\n    location / { proxy_pass http://127.0.0.1:18888; }\n}\n';
 const httpsConfig='server {\n    listen 127.0.0.1:24443 ssl http2;\n    server_name '+DOMAIN+';\n    ssl_certificate '+cert+';\n    ssl_certificate_key '+key+';\n    root '+oldSite+';\n}\n';
 await reset(httpConfig);
 await writeFile(separatedTls,httpsConfig);
 const custom=call();
 assert.equal(custom.status,0,'Nonstandard Nginx listener migration failed: '+custom.stdout+custom.stderr);
 const vhosts=await readFile(managed,'utf8');
 for(const listener of ['listen 80;', 'listen [::]:80;',
  'listen 127.0.0.1:18080;', 'listen 127.0.0.1:24443 ssl http2;']) {
  assert(vhosts.includes(listener),'Original listener changed or missing: '+listener);
 }
 assert(!vhosts.includes('listen 443 ssl;'),'Must not introduce public HTTPS socket');
 assert(!vhosts.includes('listen [::]:443 ssl;'),'Must not introduce public IPv6 HTTPS socket');
 assert(!vhosts.includes('18888'),'Old web application upstream must not be used');
 assert(vhosts.includes('ssl_certificate '+cert+';'));
 assert(vhosts.includes('ssl_certificate_key '+key+';'));
 assert.equal(await readFile(join(oldSite,'index.html'),'utf8'),'IMPORTANT ORIGINAL WEBSITE - NEVER DELETE');
 assert.equal(await readFile(neighbor,'utf8'),neighborBefore);
 // Failure after disabling both original socket configurations restores both.
 await reset(httpConfig);
 await writeFile(separatedTls,httpsConfig);
 const customFailed=call(DOMAIN,{FAIL_INSTALL:'1'});
 assert.notEqual(customFailed.status,0,'Failed custom-port migration must return failure');
 assert.equal(await readlink(active),source);
 assert.equal(await readFile(separatedTls,'utf8'),httpsConfig);
 await assert.rejects(readFile(managed));
 // No hardcoded Nginx virtual-host filenames or directories: nginx -T is
 // authoritative, including a dedicated vhost in a custom included folder.
 await reset();
 const customFolder=join(nginx,'custom');
 await mkdir(customFolder,{recursive:true});
 const unconventional=join(customFolder,'arbitrary-name.nginx');
 const unconventionalBody='server { listen 127.0.0.1:45671; server_name '+DOMAIN+'; root '+oldSite+'; }\n';
 await writeFile(unconventional,unconventionalBody);
 const nested=call();
 assert.equal(nested.status,0,'Nonstandard loaded vhost path must be supported: '+nested.stdout+nested.stderr);
 assert((await readFile(managed,'utf8')).includes('listen 127.0.0.1:45671;'));
 await assert.rejects(readFile(unconventional));
 assert.equal(await readFile(neighbor,'utf8'),neighborBefore);
 assert.equal(await readFile(join(oldSite,'index.html'),'utf8'),'IMPORTANT ORIGINAL WEBSITE - NEVER DELETE');
 console.log('PASS: custom Nginx include directory and arbitrary vhost filename');
 console.log('PASS: custom HTTP 18080 + loopback SSL 24443 sockets and arbitrary cert paths preserved');
 console.log('PASS: split HTTP/HTTPS vhosts, complete backups and rollback, mixed-domain refusal');
 console.log('PASS: explicit domain replacement, domain isolation, wildcard refusal, backup, symlink preservation, rollback, existing HTTPS credential reuse');
}finally{await rm(root,{recursive:true,force:true})}
