/**
 * Chromium smoke test for the production-built VPS website.
 * Installs: npm install --no-save --package-lock=false playwright
 *          npx playwright install chromium
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const port = 5188;
const url = `http://127.0.0.1:${port}/play/?renderer=canvas`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  detached: true, // CI-only ephemeral HTTP server for compiled dist/
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', b => { logs += b.toString(); });
server.stderr.on('data', b => { logs += b.toString(); });

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Vite exited: ' + logs);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* wait for startup */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Vite did not start: ' + logs);
}

let browser;
const errors = [];
try {
  await waitServer();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, { timeout: 25000 });
  await page.waitForTimeout(850);
  const startState = await page.evaluate(() => ({
    chars: ['p_ignis_idle', 'p_volt_idle'].every(k => window.__RS_GAME__.textures.exists(k)),
    animations: ['p_ignis_idle', 'p_ignis_run', 'p_ignis_roll'].every(k => window.__RS_GAME__.anims.exists(k)),
    menu: window.__RS_GAME__.scene.isActive('Menu'),
    remasterCount: window.__RS_GAME__.registry.get('remasterTextures'),
    remasteredHero: window.__RS_GAME__.textures.get('p_ignis_idle').get('f0')?.width === 48,
    scenicHarbor: window.__RS_GAME__.textures.exists('rs_harbor'),
    canvas: !!document.querySelector('#app canvas'),
    art: ['menu_harbor','portrait_ignis','portrait_volt'].every(k => window.__RS_GAME__.textures.exists(k)),
  }));
  assert(startState.chars && startState.animations && startState.menu && startState.canvas && startState.art && startState.remasterCount >= 35 && startState.remasteredHero && startState.scenicHarbor,
    'Menu textures/animations/canvas missing: ' + JSON.stringify(startState));
  // Locked missions must be visible without becoming playable.
  await page.keyboard.press('2');
  const chapterMenu = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Menu');
    return {
      selected: s.selectedEpisode,
      chapters: s.children.list.filter(o => o.type === 'Text' && /^0[1-6]\s/.test(o.text ?? '')).length,
      heading: s.children.list.find(o => o.type === 'Text' && (o.text ?? '').startsWith('МИССИЯ:'))?.text,
    };
  });
  assert(chapterMenu.selected === 1 && chapterMenu.chapters === 6 && chapterMenu.heading?.includes('ГАВАНЬ'),
    'Mission selector/locking broken: ' + JSON.stringify(chapterMenu));
  console.log('MENU_PREVIEW_START' + (await page.screenshot({ type: 'jpeg', quality: 39 })).toString('base64') + 'MENU_PREVIEW_END');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Level'), null, { timeout: 15000 });
  // A restarted Level needs a fresh Arcade Group; the old one is destroyed
  // during shutdown and cannot safely participate in collision checks.
  await page.evaluate(() => {
    const level = window.__RS_GAME__.scene.getScene('Level');
    window.__RS_TEST_TANK_GROUP__ = level.tankDummyGroup();
    level.scene.restart();
  });
  await page.waitForFunction(() => {
    const s = window.__RS_GAME__?.scene?.getScene('Level');
    return s?.scene?.isActive() && s.tankDummyGroup() !== window.__RS_TEST_TANK_GROUP__
      && s.tankDummyGroup()?.children && s.player?.active;
  }, null, { timeout: 15000 });
  assert.equal(errors.length, 0, 'Restarted level retained an invalid collider group: ' + errors.join('\\n'));
  // Regression of reported playability bugs: collision geometry is visibly
  // marked, enemies are not born inside the hero, and arrow/W aiming works.
  const foundations = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Level');
    const p = s.player;
    const sample = s.spawnEnemyAt('rifle', p.x, 450);
    const cam = s.cameras.main;
    const found = {
      visiblePlatforms: s.children.list.filter(o => o.depth === 41).length,
      groundMark: s.children.list.some(o => o.depth === 38 && o.type === 'TileSprite'),
      safeSpawnDistance: Math.abs(sample.x - p.x),
      bornOnScreen: sample.x >= cam.scrollX + 35 && sample.x <= cam.scrollX + cam.width - 35,
      bodyFootInset: sample.frame.realHeight - (sample.body.offset.y + sample.body.height),
    };
    sample.destroy();
    return found;
  });
  assert(foundations.visiblePlatforms >= 5 && foundations.groundMark
    && foundations.safeSpawnDistance >= 185 && foundations.bornOnScreen
    && foundations.bodyFootInset >= 0 && foundations.bodyFootInset <= 5,
    'Stage collision/spawn regression: ' + JSON.stringify(foundations));
  await page.keyboard.down('w');
  await page.waitForFunction(() => {
    const p=window.__RS_GAME__.scene.getScene('Level').player;
    return p.getAimDirection().y < -.96;
  }, null, { timeout: 15000, polling: 100 });
  let aim = await page.evaluate(() => {
    const p=window.__RS_GAME__.scene.getScene('Level').player;
    return p.getAimDirection().y;
  });
  assert(aim < -.96, 'W / UP must aim vertically: ' + aim);
  await page.keyboard.down('d');
  await page.waitForFunction(() => {
    const p=window.__RS_GAME__.scene.getScene('Level').player;
    const aim=p.getAimDirection();
    return aim.x > .4 && aim.y < -.4;
  }, null, { timeout: 15000, polling: 100 });
  const diagonal = await page.evaluate(() => {
    const p=window.__RS_GAME__.scene.getScene('Level').player;
    return {x:p.getAimDirection().x,y:p.getAimDirection().y};
  });
  assert(diagonal.x > .4 && diagonal.y < -.4,
    'W+D must fire diagonally: ' + JSON.stringify(diagonal));
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  // Software-rendered CI can skip many Phaser frames: wait for the player
  // update to clear its previous diagonal-aim state before pressing ArrowUp.
  await page.waitForFunction(() => {
    const p = window.__RS_GAME__.scene.getScene('Level').player;
    return !p.aimDiagUp;
  }, null, { timeout: 10000 });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => {
    const p = window.__RS_GAME__.scene.getScene('Level').player;
    return p.getAimDirection().y < -.96;
  }, null, { timeout: 10000 });
  aim = await page.evaluate(() =>
    window.__RS_GAME__.scene.getScene('Level').player.getAimDirection().y);
  await page.keyboard.up('ArrowUp');
  assert(aim < -.96, 'ArrowUp must aim vertically: ' + aim);
  const offscreenFire = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Level');
    const existing = s.weapons.enemyBullets.getChildren().filter(x => x.active).length;
    s.weapons.enemyShoot(s.cameras.main.scrollX - 100, 420, 1);
    s.weapons.enemyAimedShot(s.cameras.main.scrollX + s.cameras.main.width + 100, 420,
      s.player.x, s.player.y);
    return {
      before: existing,
      after: s.weapons.enemyBullets.getChildren().filter(x => x.active).length,
    };
  });
  assert.equal(offscreenFire.after, offscreenFire.before,
    'Off-screen soldiers may fire into the arena: ' + JSON.stringify(offscreenFire));
  const contactAndSteps = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Level');
    const p = s.player;
    const groundTop = 505;
    const ledges = s.children.list.filter(o => o.type === 'Rectangle' && o.depth === 41)
      .map(o => ({ x: o.x, top: o.y - 3 }));
    const high = ledges.filter(o => groundTop - o.top > 85);
    const inaccessible = high.filter(t => {
      const step = (side) => ledges.some(p => Math.sign(p.x - t.x) === side
        && Math.abs(p.x - t.x) <= 153
        && groundTop - p.top <= 84
        && p.top - t.top > 18
        && p.top - t.top < 84);
      return !step(-1) || !step(1);
    });
    // Three soldiers spawned far beyond the camera must fan out in the
    // visible zone, never form one overlapping tower at the screen edge.
    const before = new Set(s.enemies.getChildren());
    s.spawnWave(p.x + 1800, ['rifle', 'gren', 'rifle']);
    const wave = s.enemies.getChildren().filter(o => !before.has(o));
    const separated = wave.every((e,i) => wave.every((other,j) =>
      i === j || Math.abs(e.x-other.x) >= 66));
    wave.forEach(e => e.destroy());
    p.setFlipX(false);
    const e = s.spawnEnemyAt('spider', p.x + 260, 120);
    e.body.setAllowGravity(true);
    e.state = 'idle';
    e.body.reset(p.x + 30, p.y);
    e.setPosition(p.x + 30, p.y);
    const startHp = e.hp;
    p.lastFire = -100000;
    p.tryFire(s.time.now + 500);
    const damage = startHp - e.hp;
    e.behavior(s.time.now + 1000, p);
    const retreat = e.body.velocity.x * (e.x - p.x) > 50;
    const hurtTop = e.body.top, hurtBottom = e.body.bottom;
    const combatProbe = { enemyY:e.y, heroY:p.y, enemyX:e.x, heroX:p.x,
      active:e.active, state:e.state, direction:e.body.velocity.x };
    e.destroy();
    return { ledges:ledges.length, high:high.length, inaccessible,
      separated, wave:wave.length, damage, retreat, hurtTop, hurtBottom, combatProbe };
  });
  assert(contactAndSteps.high >= 3 && contactAndSteps.inaccessible.length === 0
    && contactAndSteps.wave === 3 && contactAndSteps.separated
    && contactAndSteps.damage > 0 && contactAndSteps.retreat,
    'Harbor ladders/spider hitbox/contact combat still broken: '+JSON.stringify(contactAndSteps));
  console.log('PASS: three two-sided platform routes, spread-out spawns and hittable retreating spiders');

  // Keep the hero alive while independently testing traversal, spawning and art.
  // Combat damage is covered by game logic tests; a random bullet should not
  // derail a graphical smoke test before we take screenshots.
  await page.evaluate(() => { window.__RS_GAME__.scene.getScene('Level').player.invulnUntil = Number.POSITIVE_INFINITY; });
  // Software Chromium can advance Phaser frames far slower than wall clock.
  // Wait for actual game-world progress instead of guessing elapsed seconds.
  await page.keyboard.press('w'); // no effect inside level; safety in case of stale input
  await page.keyboard.down('d');
  try {
    await page.waitForFunction(
      () => window.__RS_GAME__?.scene?.getScene('Level')?.player?.x > 370,
      null, { timeout: 30000, polling: 250 }
    );
  } finally {
    await page.keyboard.up('d');
  }
  await page.keyboard.down('j');
  await page.waitForTimeout(600);
  await page.keyboard.up('j');
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Level');
    return {
      x: s.player?.x,
      y: s.player?.y,
      spriteTexture: s.player?.texture?.key,
      heroFrameWidth: s.player?.frame?.width,
      remasteredBackground: s.textures.exists('rs_harbor') && s.children.list.some(o => o.type === 'TileSprite' && o.depth === -8),
      dead: s.player?.dead,
      blockedDown: s.player?.body?.blocked?.down,
      velocityY: s.player?.body?.velocity?.y,
      velocityX: s.player?.body?.velocity?.x,
      keyRightDown: s.player?.kRight?.isDown,
      enemies: s.enemies?.getLength(),
      triggeredBeats: s.beats?.filter(b => b.done).length,
      camera: s.cameras?.main?.scrollX,
      bullets: s.weapons?.playerBullets?.getLength(),
      fatal: window.__RS_FATAL__ || null,
    };
  });
  console.log('DESKTOP SMOKE STATE:', state);
  assert(state.x > 330 && Number.isFinite(state.x), 'Character did not move: ' + JSON.stringify(state));
  assert(state.enemies > 0 || state.triggeredBeats > 0, 'First enemy encounter did not trigger: ' + JSON.stringify(state));
  assert(state.remasteredBackground && state.heroFrameWidth === 48 && state.spriteTexture?.startsWith('p_ignis_'), 'Remaster is not being drawn in the actual level: ' + JSON.stringify(state));
  assert(!state.fatal, 'Level crashed: ' + state.fatal);
  // Regression: chain explosion must not recursively destroy itself forever.
  await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Level');
    const x = s.player.x + 70;
    s.props.barrel(x);
    const b = s.props.group.getChildren().find(p => p.propKind === 'barrel' && Math.abs(p.x - x) < 2);
    b?.takeDamage(999);
  });
  await page.waitForTimeout(400);
  // Real Phaser smoke for the combat-polish layer: test textured muzzle flash,
  // directional armor sparks, bounded debris, and explosion lifecycle.
  const polish = await page.evaluate(() => {
    const level = window.__RS_GAME__.scene.getScene('Level');
    const fx = level.fx;
    const x = level.player.x + 30, y = level.player.y - 12;
    const before = level.children.list.length;
    fx.muzzle(x, y, { x: 1, y: 0 }, 1.25);
    fx.enemyMuzzle(x + 15, y, -1);
    fx.impact(x, y, 1, true);
    fx.debris(x, y, 12);
    fx.bigBoom(x, y, 1.2);
    return {
      spawned: level.children.list.length - before,
      authoredMuzzle: level.textures.exists('rem_muzzle'),
      authoredEnemyMuzzle: level.textures.exists('rem_muzzle2'),
      particleCap: fx.maxParticles,
    };
  });
  assert(polish.spawned >= 5 && polish.authoredMuzzle && polish.authoredEnemyMuzzle
    && polish.particleCap <= 140, 'Combat polish did not render: ' + JSON.stringify(polish));
  await page.waitForTimeout(800);
  assert.equal(errors.length, 0, 'Browser errors: ' + errors.join('\n'));
  await mkdir('test-results', { recursive: true });
  // Screenshot a living hero: the hero may legitimately have died in the shootout.
  await page.evaluate(() => {
    const scene = window.__RS_GAME__.scene.getScene('Level');
    scene.enemies.clear(true, true);
    scene.weapons.enemyBullets.clear(true, true);
    scene.player.respawn(scene.player.x, scene.time.now);
    // Put the hero on the ground, rather than in the mid-air respawn location
    // behind the subtitle bar. Regression screenshots must show the sprite.
    scene.player.setPosition(scene.player.x, 487);
    scene.player.body.reset(scene.player.x, 487);
    scene.player.invulnUntil = 0;
    scene.radio.strip?.setVisible(false);
    scene.spawnEnemyAt('rifle', scene.player.x + 210, 460);
  });
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/harbor.png' });
  // A small image sample in logs allows verification even when Actions artifact quota is full.
  console.log('GAME_PREVIEW_START' + (await page.screenshot({ type: 'jpeg', quality: 43 })).toString('base64') + 'GAME_PREVIEW_END');
  console.log('PASS: actual Chromium menu, sprites, animations, level, combat, movement and barrel explosion', state);
  // Touch overlay must not obscure menu; it must appear in Level.
  const mobile = await browser.newPage({ viewport: { width: 960, height: 540 }, hasTouch: true, isMobile: true });
  mobile.on('pageerror', error => errors.push(error.stack || String(error)));
  await mobile.goto(url);
  await mobile.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, { timeout: 25000 });
  assert.equal(await mobile.locator('#rs-touch').evaluate(el => getComputedStyle(el).display), 'none');
  await mobile.waitForTimeout(850);
  await mobile.locator('canvas').tap({ position: { x: 480, y: 472 } });
  await mobile.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Level'), null, { timeout: 15000 });
  assert.equal(await mobile.locator('#rs-touch').evaluate(el => getComputedStyle(el).display), 'block');
  await mobile.screenshot({ path: 'test-results/mobile.png' });
  assert.equal(errors.length, 0, errors.join('\n'));
  await mobile.close();
  console.log('PASS: mobile menu touch-to-start and Level controls');

  // Episode-1 gameplay extensions: test an actual physics pickup, remaining
  // intel rewards, warned enemy attack windups and both scripted setpieces.
  await page.goto(url);
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, { timeout: 25000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Level'), null, { timeout: 15000 });
  const cacheSetup = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Level');
    const items = s.director?.intel?.getChildren() || [];
    s.player.invulnUntil = Infinity;
    const cache = items[0];
    if (cache) {
      s.player.body.reset(cache.x, cache.y);
      s.player.setPosition(cache.x, cache.y);
    }
    return {
      count: items.length, ids: items.map(x => x.getData('intelId')),
      height: cache?.y, hero: s.player?.x,
    };
  });
  assert.equal(cacheSetup.count, 3, 'All three secret signals must exist: ' + JSON.stringify(cacheSetup));
  await page.waitForFunction(() => window.__RS_GAME__.registry.get('intel') >= 1, null, { timeout: 16000 });
  const encounters = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Level');
    const before = s.registry.get('intel');
    const remaining = s.director.intel.getChildren().filter(x => x.active);
    remaining.forEach(x => s.director.collectIntel(x));
    const after = s.registry.get('intel');
    const duplicate = s.director.collectIntel(remaining[0]);

    // This test teleports the hero to an intel item. Set the camera to
    // the matching game position before checking camera-safe spawn/AI.
    s.cameras.main.setScroll(s.player.x - 380, s.cameras.main.scrollY);
    const rifle = s.spawnEnemyAt('rifle', s.player.x + 150, 440);
    rifle.eatTimer = 0; rifle.state = 'advance'; rifle.stateUntil = -1;
    rifle.behavior(s.time.now, s.player);
    const rifleWindup = rifle.state === 'aim' && !!rifle.intentCue?.active;

    const gren = s.spawnEnemyAt('gren', s.player.x + 210, 440);
    gren.stateUntil = -1;
    gren.behavior(s.time.now, s.player);
    const grenadeWindup = gren.state === 'deploy' && !!gren.intentCue?.active;
    s.enemies.clear(true, true);
    s.weapons.enemyBullets.clear(true, true);

    s.player.invulnUntil = Infinity;
    s.time.timeScale = 12;
    s.director.startCargoAmbush();
    s.director.startCargoAmbush(); // repeat must not spawn an extra hazard
    s.director.startSignalSurge();
    return {
      before, after, unique: s.director.collectedIds.size,
      duplicate, rifleWindup, grenadeWindup,
      cargoStarted: s.director.cargoStarted,
      signalStarted: s.director.signalStarted,
    };
  });
  assert.equal(encounters.before, 1, 'Intel must be collected through real physics overlap');
  assert(encounters.after === 3 && encounters.unique === 3 && encounters.duplicate === false,
    'Intel rewards/deduplication broken: ' + JSON.stringify(encounters));
  assert(encounters.rifleWindup && encounters.grenadeWindup
    && encounters.cargoStarted && encounters.signalStarted,
    'Tactical AI and scripted encounters broken: ' + JSON.stringify(encounters));
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.getScene('Level')?.director?.cargoImpacts === 3,
    null, { timeout: 30000 });
  assert.equal(errors.length, 0, 'Encounter browser errors: ' + errors.join('\\n'));
  console.log('PASS: physics intel collectibles, all three secrets, tactical windups and three cargo impacts');

  // Fresh level: earlier combat may have scheduled a pending legitimate game-over.
  await page.goto(url);
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, { timeout: 25000 });
  await page.keyboard.press('w'); // select rookie difficulty for this boss-only test
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Level'), null, { timeout: 15000 });
  // End-to-end boss mechanics and return to the results scene: no console errors.
  const boss = await page.evaluate(() => {
    const level = window.__RS_GAME__.scene.getScene('Level');
    level.weapons.enemyBullets.clear(true, true);
    level.enemies.clear(true, true);
    level.player.respawn(5200, level.time.now);
    level.enterBossArena();
    const firstBoss = level.boss;
    level.enterBossArena(); // duplicated encounter triggers are ignored
    const bossSingleton = level.boss === firstBoss && level.bossEntered;
    const bounds = level.cameras.main.getBounds();
    const arenaVisible = bounds.x <= level.player.x && level.boss.x >= bounds.x
      && level.boss.x <= bounds.x + level.cameras.main.width;
    if (!arenaVisible) return { exists: false, arenaVisible, boundsX: bounds.x,
      playerX: level.player.x, bossX: level.boss?.x, bossSingleton };
    // Reproduce the original bug: moving the player right must never drag
    // the crane offscreen or shift the fixed battle camera.
    const anchorX = level.boss.x, scrollX = level.cameras.main.scrollX;
    level.boss.update(level.time.now + 2000, anchorX - 35, level.player.y);
    const fixedArena = level.boss.x === anchorX && level.cameras.main.scrollX === scrollX
      && level.cameras.main.getBounds().width === 960
      && level.boss.x + level.boss.displayWidth / 2 < scrollX + 960
      && level.player.x > scrollX + 30;
    if (!fixedArena) return { exists:false, fixedArena, anchorX, bossX:level.boss.x, scrollX };
    // Slow software-rendered CI machines can take >50s of wall time to
    // advance 7.3s of Phaser time. Accelerate only the isolated ending test.
    level.time.timeScale = 45; // deterministic scripted finale on slow CI renderers
    if (!level.boss || !level.boss.alive) return { exists: false };
    const firstPhase = level.boss.phase;
    level.boss.takeDamage(level.boss.hpMax * 0.6);
    const phase2 = level.boss.phase;
    const phase2Art = level.boss.texture.key === 'boss_phase2';
    level.boss.takeDamage(level.boss.hpMax);
    return { exists: true, firstPhase, phase2, phase2Art, defeated: !level.boss.alive, deadArt: level.boss.texture.key === 'boss_dead', bossSingleton };
  });
  assert(boss.exists && boss.firstPhase === 1 && boss.phase2 === 2 && boss.defeated && boss.phase2Art && boss.deadArt && boss.bossSingleton,
    'Boss mechanics broken: ' + JSON.stringify(boss));
  // Headless software Chromium can render only a few frames per second.
  // Advance the *scene's Phaser clock* through the cinematic events rather
  // than waiting >70s of wall time for a fixed 8.5-second story transition.
  // The same game callbacks, scene events, fades and result logic still run.
  const clockState = await page.evaluate(() => {
    const level = window.__RS_GAME__.scene.getScene('Level');
    if (!level.scene.isActive()) return {active:false};
    level.time.timeScale = 1;
    // Each Clock.update first inserts events scheduled by the previous call;
    // use several bounded ticks to flush nested die -> unlock -> fade events.
    for (let i = 0; i < 8; i++) {
      if (!level.scene.isActive()) break;
      // Phaser inserts delayedCall events into its active queue in preUpdate,
      // not update. Without this, the loop doesn't progress scripted endings.
      level.time.preUpdate(level.time.now + 1800, 1800);
      level.time.update(level.time.now + 1800, 1800);
    }
    return {
      active: level.scene.isActive(), finished: level.finished,
      unlocked: localStorage.getItem('rs_episode2_unlocked'),
      timerPending: level.time._pendingInsertion?.length,
      timerActive: level.time._active?.length,
      current: window.__RS_GAME__.scene.getScenes(true).map(s => s.scene.key),
    };
  });
  console.log('HARBOR_CLOCK', clockState);
  // Software Chromium occasionally stalls the camera fade even after the
  // *real* boss-death callbacks have unlocked the next chapter. Verify the
  // legitimate win first, then skip only the cinematic wait in this test.
  const skipCinematic = await page.evaluate(() => {
    const level = window.__RS_GAME__.scene.getScene('Level');
    if (!level.scene.isActive()) return { skipped:false, alreadyResults:true };
    const legitimate = !!level.boss && !level.boss.alive && level.finished
      && window.localStorage.getItem('rs_episode2_unlocked') === '1'
      && level.registry.get('gameover') === false;
    if (!legitimate) return { skipped:false, legitimate:false };
    // The real win/unlock callbacks have already completed. End the
    // cinematic deterministically through the global SceneManager: Phaser's
    // scene-plugin transition can remain queued on CPU-starved headless CI.
    // Simulate late scoring during the victory cinematic; the leaderboard
    // and results must use the immutable boss-defeat breakdown.
    const stable = level.registry.get('scoreBreakdown');
    if (stable) level.registry.set('finalScore', stable.totalScore + 940);
    window.__RS_GAME__.scene.stop('Level');
    window.__RS_GAME__.scene.start('Results');
    return { skipped:true, legitimate:true };
  });
  assert(skipCinematic.legitimate !== false, 'Harbor win never unlocked: ' + JSON.stringify(skipCinematic));
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Results'), null, { timeout: 16000 });
  const rankingSnapshot = await page.evaluate(() => {
    const game = window.__RS_GAME__, b = game.registry.get('scoreBreakdown');
    const results = game.scene.getScene('Results');
    const scoreText = results.children.list.find(o => o.type === 'Text'
      && typeof o.text === 'string' && o.text.startsWith('ИТОГО ОЧКОВ:'))?.text;
    return { expected: b?.totalScore, scoreText };
  });
  assert(rankingSnapshot.expected != null
    && rankingSnapshot.scoreText === 'ИТОГО ОЧКОВ: ' + rankingSnapshot.expected,
    'Result screen used mutable cinematic score: ' + JSON.stringify(rankingSnapshot));
  const didWin = await page.evaluate(() => !window.__RS_GAME__.registry.get('gameover'));
  assert(didWin, 'Boss defeated but the result was a game over');
  assert.equal(errors.length, 0, 'Boss/result browser errors: ' + errors.join('\n'));
  console.log('PASS: boss two phases, death FX, level completion and victory screen');

  // Episode 1 victory must unlock episode 2 and allow seamless continuation.
  const unlocked = await page.evaluate(() => ({
    unlocked: !!window.__RS_GAME__.scene.getScene('Results').registry.get('gameover') === false
      && window.localStorage.getItem('rs_episode2_unlocked') === '1',
    episode: window.__RS_GAME__.registry.get('episode'),
  }));
  assert(unlocked.unlocked && unlocked.episode === 1, 'Train progression did not unlock: ' + JSON.stringify(unlocked));
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Train'), null, { timeout: 20000 });

  const stage = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Train');
    return {
      hero: !!s.player?.active,
      wagonArt: s.textures.exists('tr_wagon'),
      rooftop: s.children.list.some(o => o.type === 'TileSprite' && o.depth === 2),
      night: s.textures.exists('tr_night'),
      episode: s.registry.get('episode'),
      lives: s.player?.dead === false,
    };
  });
  assert(stage.hero && stage.wagonArt && stage.rooftop && stage.night && stage.episode === 2 && stage.lives,
    'Episode 2 artwork or scene did not load: ' + JSON.stringify(stage));

  await page.keyboard.down('d');
  try {
    await page.waitForFunction(
      () => window.__RS_GAME__?.scene?.getScene('Train')?.player?.x > 350,
      null, { timeout: 30000, polling: 250 },
    );
  } finally {
    await page.keyboard.up('d');
  }
  await page.screenshot({ path: 'test-results/armored-train.png' });
  console.log('TRAIN_PREVIEW_START' + (await page.screenshot({ type: 'jpeg', quality: 46 })).toString('base64') + 'TRAIN_PREVIEW_END');

  const trainAction = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Train');
    s.player.invulnUntil = Number.POSITIVE_INFINITY;
    s.player.setPosition(3620, 430);
    const breakerWorked = s.activateBreaker();
    const breakerRepeat = s.activateBreaker();
    s.helicopterRaid();
    s.bridgeVolley();
    s.tunnelBlackout();
    s.weapons.enemyBullets.clear(true, true);
    s.enemies.clear(true, true);
    s.enterEngineArena();
    const boss = s.boss;
    if (!boss) return { boss: false };
    const fixedCamera = s.cameras.main.getBounds().width === 960
      && boss.x - boss.displayWidth / 2 > s.cameras.main.scrollX + 25
      && boss.x + boss.displayWidth / 2 < s.cameras.main.scrollX + 960 - 25;
    s.time.timeScale = 12;
    const phase1 = boss.phase;
    boss.takeDamage(boss.hpMax * 0.58);
    const phase2 = boss.phase;
    const art2 = boss.texture.key;
    boss.takeDamage(boss.hpMax);
    return {
      boss: true, fixedCamera, breakerWorked, breakerRepeat,
      helicopterEvents: s.helicopterEvents,
      bridgeEvents: s.bridgeEvents,
      phase1, phase2, art2,
      defeated: !boss.alive, art3: boss.texture.key,
    };
  });
  assert(trainAction.boss && trainAction.fixedCamera && trainAction.breakerWorked && !trainAction.breakerRepeat
    && trainAction.helicopterEvents === 1 && trainAction.bridgeEvents === 1
    && trainAction.phase1 === 1 && trainAction.phase2 === 2
    && trainAction.art2 === 'tr_engine2' && trainAction.art3 === 'tr_engine3'
    && trainAction.defeated, 'Train interactions/boss broken: ' + JSON.stringify(trainAction));
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Results')
    && window.__RS_GAME__.registry.get('episode') === 2, null, { timeout: 40000 });
  assert.equal(await page.evaluate(() => window.__RS_GAME__.registry.get('gameover')), false);
  assert.equal(errors.length, 0, 'Episode 2 browser errors: ' + errors.join('\\n'));

  // Seamless Episode 2 -> 3 continuation and real jungle battle mechanics.
  const stage2Unlocked = await page.evaluate(() =>
    window.localStorage.getItem('rs_episode3_unlocked') === '1');
  assert(stage2Unlocked, 'Episode 2 did not unlock Green Zone after locomotive victory');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Jungle'), null, { timeout: 22000 });
  const jungle = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Jungle');
    // Movement/art verification must not be invalidated by random enemy fire.
    s.player.invulnUntil = Infinity;
    return {
      hero: !!s.player?.active && !s.player.dead, episode: s.registry.get('episode'),
      background: s.textures.exists('jg_sky'),
      foreground: s.children.list.some(o => o.type === 'TileSprite' && o.depth === -85),
      nests: s.growthPods.getChildren().length, bossArt: s.textures.exists('jg_heart2'),
    };
  });
  assert(jungle.hero && jungle.episode === 3 && jungle.background && jungle.foreground
    && jungle.nests === 3 && jungle.bossArt, 'Green Zone scene/art incomplete: ' + JSON.stringify(jungle));
  await page.keyboard.down('d');
  try {
    await page.waitForFunction(() => window.__RS_GAME__.scene.getScene('Jungle')?.player?.x > 360,
      null, { timeout: 23000 });
  } finally { await page.keyboard.up('d'); }
  await page.screenshot({ path: 'test-results/green-zone.png' });
  console.log('JUNGLE_PREVIEW_START' + (await page.screenshot({ type: 'jpeg', quality: 48 })).toString('base64') + 'JUNGLE_PREVIEW_END');

  const greenAction = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Jungle');
    s.player.invulnUntil = Infinity;
    s.weapons.enemyBullets.clear(true, true);
    s.enemies.clear(true, true);
    const nodes = s.growthPods.getChildren().slice();
    // The melee-purge option can destroy one cocoon, but cannot duplicate rewards.
    s.player.body.reset(nodes[0].x, nodes[0].y);
    s.player.setPosition(nodes[0].x, nodes[0].y);
    let usedPurge = s.activatePurge();
    for (let i = 0; i < 3; i++) s.activatePurge();
    const alreadyDead = s.damagePod(nodes[0], 10);
    for (const pod of nodes.slice(1)) s.damagePod(pod, 9);
    s.sporeStorm(); s.warnSpore(3510, 950, 76); s.rootAmbush();
    const sporeWarning = s.children.list.some(o => o.text === '▼ СПОРЫ!');
    s.weapons.enemyBullets.clear(true, true); s.enemies.clear(true, true);
    s.player.body.reset(5450, 420); s.player.setPosition(5450, 420);
    s.enterHeartArena();
    const boss = s.boss;
    if (!boss) return { exists: false };
    const fixedCamera = s.cameras.main.getBounds().width === 960
      && boss.x - boss.displayWidth / 2 > s.cameras.main.scrollX + 25
      && boss.x + boss.displayWidth / 2 < s.cameras.main.scrollX + 960 - 25;
    const reachable = s.children.list.filter(o => o.depth === 41)
      .every(o => 505 - (o.y - 3) <= 85);
    s.time.timeScale = 12;
    const first = boss.phase;
    boss.takeDamage(boss.hpMax * 0.58);
    const second = boss.phase, secondTexture = boss.texture.key;
    boss.takeDamage(boss.hpMax);
    return {
      exists: true, fixedCamera, reachable, usedPurge, alreadyDead,
      purified: s.podsDestroyed, sporeWaves: s.sporeWaves, sporeWarning, ambushes: s.ambushes,
      first, second, secondTexture, dead: !boss.alive,
      deadTexture: boss.texture.key,
    };
  });
  assert(greenAction.exists && greenAction.fixedCamera && greenAction.reachable && greenAction.usedPurge && !greenAction.alreadyDead
    && greenAction.purified === 3 && greenAction.sporeWaves > 0 && greenAction.sporeWarning
    && greenAction.ambushes === 1 && greenAction.first === 1
    && greenAction.second === 2 && greenAction.secondTexture === 'jg_heart2'
    && greenAction.dead && greenAction.deadTexture === 'jg_heart3',
    'Green Zone mechanics failed: ' + JSON.stringify(greenAction));
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Results')
    && window.__RS_GAME__.registry.get('episode') === 3, null, { timeout: 42000 });
  assert.equal(await page.evaluate(() => window.__RS_GAME__.registry.get('gameover')), false);
  assert.equal(errors.length, 0, 'Episode 3 browser errors: ' + errors.join('\\n'));
  console.log('PASS: train -> Green Zone, nest purge, spore storms, root ambush, two-phase alien heart and ending');

  // Episode 4: prove the campaign continuation and the locked-door
  // security objective are actually enforced in the Phaser physics scene.
  assert.equal(await page.evaluate(() => localStorage.getItem('rs_episode4_unlocked')), '1',
    'Green Zone victory did not unlock fourth chapter');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Facility'),
    null, {timeout: 23000});
  const facilityStart=await page.evaluate(()=>{
    const s=window.__RS_GAME__.scene.getScene('Facility');
    s.player.invulnUntil=Infinity;
    return {
      episode:s.registry.get('episode'), hero:!!s.player?.active&&!s.player?.dead,
      artwork:s.textures.exists('fz_wall')&&s.textures.exists('fz_core2'),
      terminals:s.terminals.getChildren().length,
      locked:s.gateBody.enable,
      lasers:s.textures.exists('fz_beam'),
    };
  });
  assert(facilityStart.episode===4 && facilityStart.hero && facilityStart.artwork
    && facilityStart.terminals===3 && facilityStart.locked && facilityStart.lasers,
    'Facility did not initialize with security door: '+JSON.stringify(facilityStart));
  await page.keyboard.down('d');
  try {
    await page.waitForFunction(()=>window.__RS_GAME__.scene.getScene('Facility')?.player?.x>345,
      null,{timeout:24000});
  } finally {await page.keyboard.up('d');}
  await page.screenshot({path:'test-results/facility-zero.png'});
  console.log('FACILITY_PREVIEW_START'+
    (await page.screenshot({type:'jpeg',quality:46})).toString('base64')+
    'FACILITY_PREVIEW_END');

  const security=await page.evaluate(()=>{
    const s=window.__RS_GAME__.scene.getScene('Facility');
    s.player.invulnUntil=Infinity;
    s.weapons.enemyBullets.clear(true,true);s.enemies.clear(true,true);
    const items=s.terminals.getChildren().slice();
    const initialLocked=s.gateBody.enable;
    // Interaction is proximity based; pressing E from the opposite side fails.
    s.player.body.reset(360,430);s.player.setPosition(360,430);
    const remote=s.hackNearbyTerminal();
    // Activate first terminal using the same routine as the player's E key.
    s.player.body.reset(items[0].x,items[0].y);
    s.player.setPosition(items[0].x,items[0].y);
    const first=s.hackNearbyTerminal(),duplicate=s.hackTerminal(items[0]);
    const afterOneLocked=s.gateBody.enable;
    s.player.body.reset(items[1].x,items[1].y);
    s.player.setPosition(items[1].x,items[1].y);
    const second=s.hackNearbyTerminal();
    const opened=!s.gateBody.enable;
    s.securityLockdown();
    s.warnLaser(3650,900);
    const warning=s.children.list.some(o=>o.text==='▼ ЛАЗЕР');
    s.weapons.enemyBullets.clear(true,true);s.enemies.clear(true,true);
    s.player.body.reset(5450,430);s.player.setPosition(5450,430);
    s.enterCoreArena();
    const boss=s.boss;
    if(!boss)return {boss:false};
    const fixedCamera=s.cameras.main.getBounds().width===960
      && boss.x-boss.displayWidth/2>s.cameras.main.scrollX+25
      && boss.x+boss.displayWidth/2<s.cameras.main.scrollX+960-25;
    const reachable=s.children.list.filter(o=>o.depth===41)
      .every(o=>505-(o.y-3)<=85);
    s.time.timeScale=12;
    const p1=boss.phase;
    boss.takeDamage(boss.hpMax*.59);
    const p2=boss.phase,t2=boss.texture.key;
    boss.takeDamage(boss.hpMax);
    return {
      boss:true,fixedCamera,reachable,initialLocked,remote,first,duplicate,afterOneLocked,second,
      opened,used:s.terminalsHacked,securityWaves:s.securityWaves,
      laserWarnings:s.laserWarnings,warning,
      p1,p2,t2,dead:!boss.alive,t3:boss.texture.key,
    };
  });
  assert(security.boss&&security.fixedCamera&&security.reachable&&security.initialLocked&&!security.remote&&security.first
    &&!security.duplicate&&security.afterOneLocked&&security.second&&security.opened
    &&security.used===2&&security.securityWaves===1
    &&security.laserWarnings>0&&security.warning
    &&security.p1===1&&security.p2===2&&security.t2==='fz_core2'
    &&security.dead&&security.t3==='fz_core3',
    'Facility security and reactor mechanics broken: '+JSON.stringify(security));
  await page.waitForFunction(()=>window.__RS_GAME__?.scene?.isActive('Results')
    &&window.__RS_GAME__.registry.get('episode')===4,null,{timeout:43000});
  assert.equal(await page.evaluate(()=>!!window.__RS_GAME__.registry.get('gameover')),false);
  assert.equal(errors.length,0,'Facility browser errors: '+errors.join('\\n'));
  console.log('PASS: chapter 3 -> 4, terminals, sealed/open door, laser cues, lockdown, phased reactor and victory');

  await page.goto(url);
  await page.waitForFunction(()=>window.__RS_GAME__?.scene?.isActive('Menu'),null,{timeout:25000});
  await page.waitForTimeout(750);
  await page.keyboard.press('4');
  await page.waitForFunction(()=>window.__RS_GAME__?.scene?.getScene('Menu')?.selectedEpisode===4);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__RS_GAME__?.scene?.isActive('Facility'),null,{timeout:16000});
  const facilityReplay=await page.evaluate(()=>{
    const s=window.__RS_GAME__.scene.getScene('Facility');
    return {terminals:s.terminalsHacked,locked:s.gateBody.enable,
      scene:s.scene.key,body:!!s.player?.body};
  });
  assert(facilityReplay.terminals===0&&facilityReplay.locked&&facilityReplay.body&&facilityReplay.scene==='Facility',
    'Replaying facility did not reset security: '+JSON.stringify(facilityReplay));
  assert.equal(errors.length,0,'Chapter 4 replay errors: '+errors.join('\\n'));
  console.log('PASS: independent unlocked chapter 4 replay with reset security state');

  await page.goto(url);
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.getScene('Menu')?.selectedEpisode === 3);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Jungle'), null, { timeout: 15000 });
  const replay = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Jungle');
    const stalker = s.spawnEnemyAt('spider', 730, 400);
    return { pods: s.registry.get('podsDestroyed'), art: stalker.texture.key };
  });
  assert(replay.pods === 0 && replay.art === 'jg_stalker',
    'Jungle replay leaked objective state or mutant artwork: ' + JSON.stringify(replay));
  assert.equal(errors.length, 0, 'Unlocked Green Zone menu replay failed: ' + errors.join('\\n'));
  console.log('PASS: episode 3 replay from saved progress');
  await page.goto(url);
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.getScene('Menu')?.selectedEpisode === 2);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Train'), null, { timeout: 15000 });
  assert.equal(errors.length, 0, 'Unlocked episode-2 replay failed: ' + errors.join('\\n'));

  // Verify Episodes 5 (Bastion) & 6 (Beacon) unlock flow, Sentinels, thermal heaters,
  // Citadel-9 & Alpha-13 two-phase + overdrive battles, and Grand Finale Results.
  await page.evaluate(() => localStorage.setItem('rs_episode5_unlocked', '1'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Menu'), null, { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('5');
  const ep5Menu = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Menu');
    return {
      selected: s.selectedEpisode,
      heading: s.children.list.find(o => o.type === 'Text' && (o.text ?? '').startsWith('МИССИЯ:'))?.text ?? '',
    };
  });
  assert(ep5Menu.selected === 5 && ep5Menu.heading.includes('БАСТИОН'),
    'Episode 5 selection failed: ' + JSON.stringify(ep5Menu));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Bastion'), null, { timeout: 25000 });
  // Ensure restarted Bastion refreshes tankGrp cleanly rather than holding a destroyed group reference
  await page.evaluate(() => {
    const b = window.__RS_GAME__.scene.getScene('Bastion');
    window.__RS_PREV_BASTION_PLAYER__ = b.player;
    b.scene.restart();
  });
  await page.waitForFunction(() => {
    const g = window.__RS_GAME__;
    const b = g?.scene?.getScene('Bastion');
    return g?.scene?.isActive('Bastion') && b?.player && b.player !== window.__RS_PREV_BASTION_PLAYER__;
  }, null, { timeout: 25000 });
  await page.evaluate(() => { delete window.__RS_PREV_BASTION_PLAYER__; });
  await page.waitForTimeout(150);
  assert.equal(errors.length, 0, 'Restarted Bastion threw errors: ' + errors.join('\n'));
  await page.waitForFunction(() => {
    const s = window.__RS_GAME__.scene.getScene('Bastion');
    return !!s?.player && !!s?.heaters;
  }, null, { timeout: 10000 });

  const bastionPre = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Bastion');
    s.player.invulnUntil = Infinity;
    s.spawnEnemyAt('sentinel', s.player.x + 170);
    const sentinel = s.enemies.getChildren().find((e) => e.kind === 'sentinel');
    return {
      tankActive: !!s.tankSys?.tank?.active && Math.abs(s.tankSys.tank.x - 1920) < 5,
      sentinelKey: sentinel?.texture?.key ?? null,
      heaterCount: s.heaters.getChildren().length,
    };
  });
  assert.equal(bastionPre.tankActive, true, 'Episode 5 RS-7 tank missing');
  assert.equal(bastionPre.sentinelKey, 'e_sentinel', 'Episode 5 Sentinel sprite missing: ' + bastionPre.sentinelKey);
  assert.equal(bastionPre.heaterCount, 3, 'Episode 5 thermal heater relays missing');

  for (let i = 0; i < 2; i++) {
    await page.evaluate((idx) => {
      const s = window.__RS_GAME__.scene.getScene('Bastion');
      const r = s.heaters.getChildren()[idx];
      s.weapons.enemyBullets.clear(true, true);
      s.enemies.clear(true, true);
      s.player.setPosition(r.x, r.y);
      s.player.body.reset(r.x, r.y);
    }, i);
    await page.keyboard.down('e');
    try {
      await page.waitForFunction((targetCount) => {
        const s = window.__RS_GAME__?.scene?.getScene('Bastion');
        return (s?.heatersDisabled ?? 0) >= targetCount;
      }, i + 1, { timeout: 6000, polling: 50 });
    } finally {
      await page.keyboard.up('e');
    }
  }
  await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Bastion');
    s.weapons.enemyBullets.clear(true, true);
    s.enemies.clear(true, true);
    const safeY = s.heaters.getChildren()[1].y;
    s.player.setPosition(5050, safeY);
    s.player.body.reset(5050, safeY);
  });
  await page.waitForFunction(() => {
    const s = window.__RS_GAME__.scene.getScene('Bastion');
    return s?.bossEntered === true && !!s?.boss && s.cameras.main.getBounds().width < 2000;
  }, null, { timeout: 10000 });

  const citadelCheck = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Bastion');
    s.time.timeScale = 12;
    const initialNodes = s.boss.nodes?.activeCount ?? 0;
    const texKey = s.boss.texture?.key ?? '';
    s.boss.takeDamage(s.boss.hpMax * 0.49);
    const phase2 = s.boss.phase;
    const framePhase2 = s.boss.frame?.name ?? '';
    s.boss.takeDamage(s.boss.hpMax * 0.3);
    const overdrive = s.boss.overdrive;
    const frameOverdrive = s.boss.frame?.name ?? '';
    s.boss.takeDamage(99999);
    return {
      heatersDisabled: s.heatersDisabled,
      initialNodes,
      texKey,
      phase2,
      framePhase2,
      overdrive,
      frameOverdrive,
    };
  });
  assert.equal(citadelCheck.heatersDisabled, 2, 'Thermal heater sabotage count mismatch');
  assert.equal(citadelCheck.initialNodes, 2, 'Citadel coolant node count mismatch');
  assert.equal(citadelCheck.texKey, 'ep5_boss_citadel', 'Citadel texture key mismatch');
  assert.equal(citadelCheck.phase2, 2, 'Citadel failed to enter Phase 2');
  assert.equal(citadelCheck.overdrive, true, 'Citadel failed to enter Overdrive');
  assert(citadelCheck.framePhase2 === 'f1' && citadelCheck.frameOverdrive === 'f2',
    'Citadel frames mismatch: ' + JSON.stringify(citadelCheck));

  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Results'), null, { timeout: 40000 });
  const ep5Results = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Results');
    return {
      ep6Unlocked: localStorage.getItem('rs_episode6_unlocked'),
      episode: s.registry.get('scoreBreakdown')?.episode,
    };
  });
  assert.equal(ep5Results.ep6Unlocked, '1', 'Episode 6 did not unlock on Bastion victory');
  assert.equal(ep5Results.episode, 5, 'Episode 5 breakdown mismatch');

  // Press [C] on Results to advance directly into Episode 6 (Beacon)
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Beacon'), null, { timeout: 25000 });
  await page.waitForFunction(() => {
    const s = window.__RS_GAME__.scene.getScene('Beacon');
    return !!s?.player && !!s?.anchors;
  }, null, { timeout: 10000 });

  for (let i = 0; i < 2; i++) {
    await page.evaluate((idx) => {
      const s = window.__RS_GAME__.scene.getScene('Beacon');
      const a = s.anchors.getChildren()[idx];
      s.player.invulnUntil = Infinity;
      s.weapons.enemyBullets.clear(true, true);
      s.enemies.clear(true, true);
      s.player.setPosition(a.x, a.y);
      s.player.body.reset(a.x, a.y);
    }, i);
    await page.keyboard.down('e');
    try {
      await page.waitForFunction((targetCount) => {
        const s = window.__RS_GAME__?.scene?.getScene('Beacon');
        return (s?.anchorsDisabled ?? 0) >= targetCount;
      }, i + 1, { timeout: 6000, polling: 50 });
    } finally {
      await page.keyboard.up('e');
    }
  }
  await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Beacon');
    s.weapons.enemyBullets.clear(true, true);
    s.enemies.clear(true, true);
    const safeY = s.anchors.getChildren()[1].y;
    s.player.setPosition(5050, safeY);
    s.player.body.reset(5050, safeY);
  });
  await page.waitForFunction(() => {
    const s = window.__RS_GAME__.scene.getScene('Beacon');
    return s?.bossEntered === true && !!s?.boss && s.cameras.main.getBounds().width < 2000;
  }, null, { timeout: 10000 });

  const sourceCheck = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Beacon');
    s.time.timeScale = 12;
    const initialPylons = s.boss.nodes?.activeCount ?? 0;
    const texKey = s.boss.texture?.key ?? '';
    s.boss.takeDamage(s.boss.hpMax * 0.48);
    const phase2 = s.boss.phase;
    const framePhase2 = s.boss.frame?.name ?? '';
    s.boss.takeDamage(s.boss.hpMax * 0.3);
    const overdrive = s.boss.overdrive;
    const frameOverdrive = s.boss.frame?.name ?? '';
    s.boss.takeDamage(99999);
    return {
      anchorsDisabled: s.anchorsDisabled,
      initialPylons,
      texKey,
      phase2,
      framePhase2,
      overdrive,
      frameOverdrive,
    };
  });
  assert.equal(sourceCheck.anchorsDisabled, 2, 'Signal anchor sabotage count mismatch');
  assert.equal(sourceCheck.initialPylons, 3, 'Alpha-13 resonator pylon count mismatch');
  assert.equal(sourceCheck.texKey, 'ep6_boss_source', 'Alpha-13 texture key mismatch');
  assert.equal(sourceCheck.phase2, 2, 'Alpha-13 failed to enter Phase 2');
  assert.equal(sourceCheck.overdrive, true, 'Alpha-13 failed to enter Overdrive');
  assert(sourceCheck.framePhase2 === 'f1' && sourceCheck.frameOverdrive === 'f2',
    'Alpha-13 frames mismatch: ' + JSON.stringify(sourceCheck));

  await page.waitForFunction(() => window.__RS_GAME__?.scene?.isActive('Results'), null, { timeout: 40000 });
  const finaleResults = await page.evaluate(() => {
    const s = window.__RS_GAME__.scene.getScene('Results');
    const texts = s.children.list.filter((o) => o.type === 'Text').map((o) => o.text ?? '');
    return {
      episode: s.registry.get('scoreBreakdown')?.episode,
      campaignComplete: s.registry.get('campaignComplete'),
      hasFinaleBanner: texts.some((t) => t.includes('КАМПАНИЯ ЗАВЕРШЕНА')),
    };
  });
  assert.equal(finaleResults.episode, 6, 'Episode 6 finale breakdown mismatch');
  assert.equal(finaleResults.campaignComplete, true, 'Campaign complete registry flag missing');
  assert.equal(finaleResults.hasFinaleBanner, true, 'Grand Finale Results banner missing');
  assert.equal(errors.length, 0, 'Episodes 5-6 / finale errors: ' + errors.join('\\n'));
  console.log('PASS: Episode 1 -> Episode 2, Ep 5 (Bastion/Citadel-9), Ep 6 (Beacon/Alpha-13) and Grand Finale verified');
} finally {
  if (browser) await browser.close();
  // npm spawns Vite: kill its process GROUP so the child cannot hold open
  // stdout/stderr pipes and hang CI after the test has already finished.
  try {
    if (process.platform !== 'win32' && server.pid) process.kill(-server.pid, 'SIGTERM');
    else server.kill('SIGTERM');
  } catch { /* server already closed */ }
}
