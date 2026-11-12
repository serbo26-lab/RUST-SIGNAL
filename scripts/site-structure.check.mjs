import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url),pages=["/","/play/","/episodes/","/episodes/harbor/","/episodes/train/","/episodes/jungle/","/episodes/facility/","/episodes/bastion/","/episodes/beacon/","/characters/","/characters/volkova/","/characters/orlov/","/guide/","/guide/controls/","/guide/weapons/","/guide/progression/","/guide/traversal/","/guide/boss-tactics/","/world/","/faq/","/about/","/encyclopedia/","/encyclopedia/enemies/","/encyclopedia/enemies/rifle/","/encyclopedia/enemies/gren/","/encyclopedia/enemies/heavy/","/encyclopedia/enemies/spider/","/encyclopedia/enemies/officer/","/encyclopedia/enemies/drone/","/encyclopedia/enemies/sentinel/","/encyclopedia/bosses/","/encyclopedia/bosses/crane/","/encyclopedia/bosses/locomotive/","/encyclopedia/bosses/heart/","/encyclopedia/bosses/core/","/encyclopedia/bosses/citadel/","/encyclopedia/bosses/source/","/encyclopedia/weapons/","/encyclopedia/weapons/pistol/","/encyclopedia/weapons/mg/","/encyclopedia/weapons/shotgun/","/encyclopedia/weapons/laser/","/encyclopedia/locations/","/encyclopedia/locations/harbor/","/encyclopedia/locations/train/","/encyclopedia/locations/jungle/","/encyclopedia/locations/facility/","/encyclopedia/locations/bastion/","/encyclopedia/locations/beacon/","/encyclopedia/gallery/"];
const graph=new Map(),titles=new Set();
for(const page of pages){
const html=await readFile(new URL(page.slice(1)+'index.html',root),'utf8');
const title=html.match(/<title>([^<]+)<\/title>/)?.[1];
assert(title&&!titles.has(title),'Duplicate/missing title: '+page);titles.add(title);
assert(html.includes('lang="ru"')&&html.includes('name="description"'),'Missing metadata: '+page);
if(page!=='/play/'){
assert(html.includes('<h1>')&&html.includes('<main'),'Invalid page: '+page);
assert(html.replace(/<[^>]*>/g,' ').trim().length>350,'Thin content: '+page);
}else assert(html.includes('id="app"')&&html.includes('.js'),'Game not compiled');
const urls=[...html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)].map(x=>x[1]);
// All teaser cards must show editorial artwork, including mobile layouts.
for(const match of html.matchAll(/<a class="card"[^>]*>([\s\S]*?)<\/a>/g)){
  assert(match[1].includes('<img '), 'Card missing illustration: ' + page);
}
if(/^\/encyclopedia\/(?:enemies|bosses|weapons)\/[^/]+\/$/.test(page)){
  assert(html.includes('class="dossier-hero"'), 'Missing dossier illustration: ' + page);
}
graph.set(page,urls.filter(u=>pages.includes(u)));
for(const u of urls)await stat(new URL(u.slice(1)+(u.endsWith('/')?'index.html':''),root)).catch(()=>{throw Error('Broken link: '+page+' -> '+u)});
}
// Every episode card on the two main catalog pages must have genuine art.
for (const path of ['/', '/episodes/']) {
  const html = await readFile(new URL(path.slice(1) + 'index.html', root), 'utf8');
  for (const episode of ['harbor', 'train', 'jungle', 'facility', 'bastion', 'beacon']) {
    assert(html.includes('href="/episodes/' + episode + '/"><img src="/illustrations/location-' + episode + '.webp"'),
      'Episode card has no illustration: ' + path + ' ' + episode);
  }
}

// Documentation must reflect mechanics used in src/game/traversal.ts and the boss modules.
for(const [route,terms] of Object.entries({
  '/guide/controls/':['S + Space','P / Esc','ЛКМ'],
  '/guide/traversal/':['трос','подъёмник','Space','высот'],
  '/guide/boss-tactics/':['форсаж','пилон','биоузл','терминал'],
  '/characters/volkova/':['Лена «Искра» Волкова'],
  '/encyclopedia/bosses/heart/':['кокон','биоузл'],
  '/encyclopedia/bosses/core/':['терминал','пилон'],
})){
  const html=await readFile(new URL(route.slice(1)+'index.html',root),'utf8');
  for(const term of terms) assert(html.toLowerCase().includes(term.toLowerCase()),'Outdated documentation: '+route+' missing '+term);
}
const seen=new Set(['/']),q=['/'];while(q.length){for(const link of graph.get(q.shift())||[])if(!seen.has(link)){seen.add(link);q.push(link)}}
assert.deepEqual([...pages].sort(),[...seen].sort(),'Unreachable pages');

// Brand & scanner contract: website uses "Rust Signal" + real SVG emblem (never "RS" box),
// while the playable game page preserves "Ржавый сигнал".
for (const svgName of ['logo.svg', 'favicon.svg']) {
  const svg = await readFile(new URL(svgName, root), 'utf8');
  assert(svg.includes('<svg') && !svg.includes('>RS<'), 'Logo/favicon must not revert to text RS: ' + svgName);
}
for (const page of pages) {
  const html = await readFile(new URL(page.slice(1) + 'index.html', root), 'utf8');
  assert(!html.includes('<b>RS</b>'), 'Header must not contain RS placeholder: ' + page);
  assert(/<title>[^<]*Rust Signal[^<]*<\/title>/.test(html), 'Title must include Rust Signal: ' + page);
  assert(html.includes('name="application-name" content="Rust Signal"'), 'Missing application-name meta: ' + page);
  assert(html.includes('property="og:site_name" content="Rust Signal"'), 'Missing og:site_name meta: ' + page);
  assert(html.includes('"@type"') && html.includes('"name":"Rust Signal"'), 'Missing JSON-LD Rust Signal: ' + page);
  if (page === '/play/') {
    assert(html.includes('РЖАВЫЙ СИГНАЛ') || html.includes('Ржавый сигнал'), 'Game launcher must display Russian title');
  } else {
    assert(html.includes('src="/logo.svg"') && html.includes('RUST <br>SIGNAL'), 'Missing site logo/wordmark: ' + page);
    assert(html.includes('<b lang="en">RUST SIGNAL</b>'), 'Missing footer Rust Signal brand: ' + page);
  }
}

console.log('PASS: '+pages.length+' unique, linked, crawlable HTML pages');
