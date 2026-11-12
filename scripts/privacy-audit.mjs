import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Public-repository guard: test names and documentation must never contain
// real infrastructure names, private keys or arbitrary public IPv4 addresses.
const textExtensions = /\.(?:md|html|js|mjs|ts|json|sh|py|yml|yaml|svg|css|txt|template)$/i;
const skip = new Set(['node_modules','.git','dist','coverage']);
const issues = [];
const suspicious = [
  { name: 'dynamic-DNS / non-example private host', re: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:dpdns\.org|online|qzz\.io)\b|https?:\/\/[a-z0-9.-]+\.top\b/gi },
  { name: 'server-specific SNI/bot routing', re: /\b(?:bot[_-]sui|sui_443_backend|mtproxyl[_-]selfmask)\b/gi },
  { name: 'certificate manager private path', re: /\/root\/cert-[A-Za-z0-9_-]+\//g },
  { name: 'embedded private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'access token', re: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g },
];
async function walk(dir='.') {
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(skip.has(entry.name))continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory()){await walk(path);continue;}
    if(!entry.isFile()||!textExtensions.test(path)||path.endsWith('package-lock.json')||path.endsWith('scripts/privacy-audit.mjs'))continue;
    const content=await readFile(path,'utf8');
    for(const pattern of suspicious){
      pattern.re.lastIndex=0;
      if(pattern.re.test(content))issues.push(path+': '+pattern.name);
    }
    for(const email of content.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)){
      if(!/^example\.(com|net|org)$/i.test(email[1]))issues.push(path+': unapproved email domain');
    }
    for(const ip of content.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)){
      const v=ip[0];
      if(/^(?:127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(v))continue;
      issues.push(path+': unexpected IPv4 literal');
    }
  }
}
await walk();
if(issues.length){
  console.error('Privacy audit failed:\n'+[...new Set(issues)].join('\n'));
  process.exitCode=1;
}else console.log('Privacy audit: no hostnames, credentials, or server-specific network addresses detected.');
