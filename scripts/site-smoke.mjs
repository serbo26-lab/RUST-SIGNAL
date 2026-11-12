/**
 * Regression test of the actual files that will be served by Nginx.
 * Both browser smoke scripts now load the compiled VPS site, not a development server.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4199/';
const dist = new URL('../dist/play/index.html', import.meta.url);
const html = await readFile(dist, 'utf8');
assert.match(html, /<html lang="ru">/);
assert.match(html, /<main id="app"/);
assert(!html.includes('/src/main.ts'), 'dist/play/index.html must point to compiled JavaScript, not TypeScript sources');
const asset = html.match(/<script[^>]*src="([^"]+\.js)"/)?.[1];
assert(asset, 'The production index is missing its bundled JavaScript');
await access(new URL('../dist/' + asset.replace(/^(?:\.\/|\/)/, ''), import.meta.url));

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
  '--port', '4199', '--strictPort'], {
  detached: true, // CI-only ephemeral HTTP server for compiled dist/
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
for (const stream of [server.stdout, server.stderr])
  stream?.on('data', chunk => { output += chunk.toString(); });

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Production server exited: ' + output);
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Production server did not start: ' + output);
}

let browser;
try {
  await waitServer();

  // These public files are resolved from /dist, not via a TypeScript development server.
  for (const file of [
    'index.html', 'remaster/atlas.webp', 'remaster/atlas.json',
    'remaster/harbor.webp', 'art/harbor-scene.svg',
    'characters/volkova.png', 'characters/orlov.png',
  ]) {
    const response = await fetch(new URL(file, origin));
    assert.equal(response.status, 200, 'Missing published asset: ' + file);
    assert(Number(response.headers.get('content-length')) > 0
      || (await response.arrayBuffer()).byteLength > 0, 'Empty published asset: ' + file);
  }

  browser = await chromium.launch({
    headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(String(e.stack || e)));
  page.on('response', response => {
    if (response.status() >= 400 && /\/(?:assets|remaster|art)\//.test(response.url()))
      errors.push('Missing production resource: ' + response.status() + ' ' + response.url());
  });
  await page.goto(origin + 'play/?renderer=canvas', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, {timeout: 25000});
  const desktop = await page.evaluate(() => ({
    menu: window.__RS_GAME__.scene.isActive('Menu'),
    canvas: document.querySelectorAll('#app canvas').length,
    loaderGone: !document.getElementById('site-loading'),
    images: window.__RS_GAME__.registry.get('remasterTextures') ?? 0,
    viewport: document.documentElement.clientWidth,
  }));
  assert(desktop.menu && desktop.canvas === 1 && desktop.loaderGone
    && desktop.images >= 35 && desktop.viewport > 900,
    'Published site failed to start on desktop: ' + JSON.stringify(desktop));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Level'), null, {timeout: 18000});
  assert.equal(errors.length, 0, 'Production browser errors: ' + errors.join('\n'));

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  mobile.on('pageerror', e => errors.push(String(e.stack || e)));
  await mobile.goto(origin + 'play/?renderer=canvas', {waitUntil: 'domcontentloaded'});
  await mobile.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, {timeout: 25000});
  const mobileState = await mobile.evaluate(() => {
    const canvas = document.querySelector('#app canvas');
    return {
      loading: !!document.getElementById('site-loading'),
      menu: window.__RS_GAME__.scene.isActive('Menu'),
      visible: !!canvas && canvas.getBoundingClientRect().width > 0,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  assert(mobileState.menu && mobileState.visible && !mobileState.loading
    && !mobileState.horizontalOverflow, 'Published mobile website broken: ' + JSON.stringify(mobileState));
  // The encyclopedia is visually usable on phones: every teaser has an image,
  // the original 1200px art does not stretch card columns, and assets decode.
  await mobile.goto(origin + 'encyclopedia/enemies/', {waitUntil: 'load'});
  const encyclopediaMobile = await mobile.evaluate(async () => {
    const images = [...document.querySelectorAll('a.card img')];
    for (const img of images) {
      img.loading = 'eager';
      await img.decode().catch(() => {});
    }
    return {
      cards: document.querySelectorAll('a.card').length,
      images: images.length,
      decoded: images.filter(img => img.naturalWidth > 0).length,
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  assert(encyclopediaMobile.cards === 7
    && encyclopediaMobile.images === 7
    && encyclopediaMobile.decoded === 7
    && encyclopediaMobile.width <= encyclopediaMobile.viewport + 1,
    'Encyclopedia mobile thumbnails broken: ' + JSON.stringify(encyclopediaMobile));

  assert.equal(errors.length, 0, 'Production site errors: ' + errors.join('\n'));
  console.log('PASS: production dist/play/index.html, assets, real desktop+mobile Chromium and game start');
} finally {
  try { await browser?.close(); } catch { /* browser already closed */ }
  if (server.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
  }
}
