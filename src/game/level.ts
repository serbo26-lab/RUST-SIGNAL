import Phaser from 'phaser';
import { beginOnlineRun } from './online-leaderboard';
import {
  VIEW_W, VIEW_H, WORLD_W, GROUND_Y, GRAVITY, run, addScaledScore, finalizeEpisodeVictory, scorePopup, shake, rand, diff, recordBest, unlockEpisode2,
} from '../game/core';
import { makePlayerTextures, makeEnemyTextures, makeFxTextures, makeTankTextures } from '../game/sprites';
import { addRemasterHarbor } from './remaster';
import { buildHarborBackground, addBeacons } from '../game/background';
import { Player } from './player';
import { WeaponsSystem } from './weapons';
import { FxSystem, PropsSystem, Machine, makeMachineTextures, spawnTurret } from './props';
import { PickupManager } from './pickups';
import { markSolidPlatform, markGround, safeEnemySpawnX, findClearGroundX, findSafeRespawnPoint, makeBallisticCover, lockBossArena, confineHeroToArena } from './world-rules';
import { Enemy, EnemyKind, damageEnemy, killEnemy, spawnSurrenderGag } from './enemies';
import { Boss, TankSystem } from './boss';
import { RadioSystem } from './radio';
import { HarborDirector } from './harbor-events';
import { StageTraversal } from './traversal';
import { Hud, ensureWarnTexture } from '../ui/hud';
import { SFX, MUSIC } from './audio';
import { touch, tapEdge } from '../ui/touch';

/**
 * EPISODE 1 — «Гавань мёртвых кораблей». Scripted beats (MVP mini-plot):
 *  landing → first squad → friendly-fire revelation → weapon crates →
 *  APC capture set-piece → "Rusty Signal" transformation event → tank find →
 *  boss arena (crane, 2 phases) → ending reveal that the source is below.
 */

interface Beat { x: number; done?: boolean; fn: (s: LevelScene) => void; }

export class LevelScene extends Phaser.Scene {
  player!: Player;
  weapons!: WeaponsSystem;
  fx!: FxSystem;
  props!: PropsSystem;
  enemies!: Phaser.Physics.Arcade.Group;
  machines: Machine[] = [];
  machineGrp!: Phaser.Physics.Arcade.Group;
  private tankGrp!: Phaser.Physics.Arcade.Group;
  crates!: Phaser.Physics.Arcade.Group;
  tankSys!: TankSystem;
  radio!: RadioSystem;
  hud!: Hud;
  director!: HarborDirector;
  traversal!: StageTraversal;
  pickupSys!: PickupManager;
  boss: Boss | null = null;
  bossEntered = false;
  paused = false;
  finished = false;
  private beats: Beat[] = [];
  private t0 = 0;
  private activeMs = 0;
  private kE!: Phaser.Input.Keyboard.Key;
  private kP!: Phaser.Input.Keyboard.Key;

  constructor() { super('Level'); }

  preload() { /* all textures procedural in create() */ }

  create() {
    // Защита от «чёрного экрана»: любая ошибка при старте уровня пишется в
    // глобальный флаг — меню покажет её текстом вместо гасшего экрана.
    try {
      this.createLevel();
    } catch (e: any) {
      console.error('[RUST SIGNAL] Level create failed:', e);
      (window as any).__RS_FATAL__ = String(e?.stack ?? e?.message ?? e).slice(0, 500);
      throw e;
    }
  }

  private createLevel() {
    // Phaser reuses a Scene instance across retries: reset encounter state.
    this.bossEntered = false;
    this.boss = null;
    this.finished = false;
    this.paused = false;
    this.activeMs = 0;
    run.episode = 1;
    beginOnlineRun({ episode: 1, difficulty: run.difficulty, character: run.character });
    this.registry.set('episode', 1);
    this.registry.set('gameover', false);
    this.registry.set('scoreBreakdown', null);
    window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: true }));
    this.events.once('shutdown', () => window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: false })));
    // ---------- world & camera ----------
    this.physics.world.gravity.y = GRAVITY;
    this.physics.world.setBounds(0, -400, WORLD_W, 1000);
    this.cameras.main.setBounds(0, -60, WORLD_W, VIEW_H + 60);
    const followTarget = this.add.zone(80, GROUND_Y - 60, 1, 1);
    this._follow = followTarget;
    this.cameras.main.startFollow(followTarget, true, 0.14, 0.14);
    this.cameras.main.setDeadzone(300, 60);
    this.cameras.main.fadeIn(500, 10, 12, 18);

    // ---------- textures ----------
    makePlayerTextures(this);
    makeEnemyTextures(this);
    makeFxTextures(this);
    makeTankTextures(this);
    makeMachineTextures(this);
    Boss.makeTexture(this);
    ensureWarnTexture(this);

    // ---------- background ----------
    buildHarborBackground(this);
    addBeacons(this);
    addRemasterHarbor(this, WORLD_W, GROUND_Y);

    // ---------- systems ----------
    this.fx = new FxSystem(this);
    this.weapons = new WeaponsSystem(this);
    this.props = new PropsSystem(this);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.machineGrp = this.physics.add.group();
    // Scene objects survive restart. Never reuse a group whose Phaser
    // children collection was destroyed by the previous scene shutdown.
    this.tankGrp = this.physics.add.group();
    this.crates = this.physics.add.group({ allowGravity: false, immovable: true });
    this.tankSys = new TankSystem(this);
    this.radio = new RadioSystem(this);
    this.hud = new Hud(this);

    // ---------- player ----------
    this.player = new Player(this, 90, GROUND_Y - 40, run.character);

    // ---------- static collision ----------
    // NB: Phaser 3.90 arcade factory has no `staticRectangle`; use invisible
    // static images sized via displaySize (compatible with all 3.x builds).
    const makeStaticRect = (x: number, y: number, w: number, h: number) => {
      const r = this.physics.add.staticImage(x, y, '__rect');
      r.setVisible(false);
      r.setDisplaySize(w, h);
      r.refreshBody(); // Phaser static bodies need bounds recalculated AFTER resizing
      return r;
    };
    const ground = this.physics.add.staticGroup();
    const gt = makeStaticRect(WORLD_W / 2, GROUND_Y + 65, WORLD_W, 60);
    ground.add(gt);
    markGround(this);
    // walkable container stacks (platforms)
    const plats = this.physics.add.staticGroup();
    const addPlat = (x: number, y: number, w: number, h: number) => {
      const r = makeStaticRect(x, y, w, h);
      plats.add(r);
      markSolidPlatform(this, x, y, w, h);
      // visual container on top (stack two crisp tiers for double-height grounded stacks)
      if (this.textures.exists('rem_container')) {
        if (h > 56) {
          this.add.image(x, y - h * 0.25, 'rem_container').setDisplaySize(w, h * 0.5).setDepth(30);
          this.add.image(x, y + h * 0.25, 'rem_container').setDisplaySize(w, h * 0.5).setDepth(30);
        } else {
          this.add.image(x, y, 'rem_container').setDisplaySize(w, h).setDepth(30);
        }
      } else {
        const colors = [0x8a4a3a, 0x3a6a7a, 0x6a6a3a];
        this.add.rectangle(x, y, w, h, colors[Math.floor(rand(0, 3))])
          .setStrokeStyle(2, 0x22262e).setDepth(30);
      }
    };
    addPlat(760, GROUND_Y + 14, 110, 42);
    // High signal route now has a reachable grounded stack on BOTH sides (and solid center piers so you can't get trapped underneath).
    addPlat(1400, GROUND_Y + 4, 96, 62);
    addPlat(1500, GROUND_Y + 4, 110, 62);
    addPlat(1500, GROUND_Y - 51, 110, 48);
    addPlat(1600, GROUND_Y + 4, 96, 62);
    addPlat(2450, GROUND_Y + 14, 110, 42);
    addPlat(4200, GROUND_Y + 4, 96, 62);
    addPlat(4300, GROUND_Y + 4, 110, 62);
    addPlat(4300, GROUND_Y - 51, 110, 48);
    addPlat(4400, GROUND_Y + 4, 96, 62);
    // Optional high road: two reachable grounded stacks to the second hidden radio cache.
    addPlat(2570, GROUND_Y + 4, 110, 62);
    addPlat(2680, GROUND_Y + 4, 124, 62);
    addPlat(2680, GROUND_Y - 51, 110, 48);
    addPlat(2790, GROUND_Y + 4, 96, 62);

    // Non-colliding atmospheric props; nudged clear of solid covers & crane pads.
    if (this.textures.exists('rem_sandbags')) {
      for (const px of [370, 1000, 2190, 3180, 4050, 5230]) {
        const cx = findClearGroundX(this, px, 28, GROUND_Y + 35, { objectHeight: 36 });
        this.add.image(cx, GROUND_Y + 14, 'rem_sandbags').setDepth(26).setScale(0.88);
      }
      for (const px of [300, 2120, 3850, 4920]) {
        const cx = findClearGroundX(this, px, 24, GROUND_Y + 35, { objectHeight: 34 });
        this.add.image(cx, GROUND_Y + 15, 'rem_box').setDepth(25).setScale(0.9);
      }
      for (const px of [720, 1830, 3540, 5410]) {
        const cx = findClearGroundX(this, px, 18, GROUND_Y + 35, { objectHeight: 80 });
        this.add.image(cx, GROUND_Y - 18, 'rem_lamp').setDepth(24).setScale(0.82);
        this.add.triangle(cx, GROUND_Y + 26, 0, -96, -54, 16, 54, 16, 0xffd284, 0.1)
          .setOrigin(0.5, 0.5).setDepth(23).setBlendMode(Phaser.BlendModes.ADD);
      }
    }

    this.pickupSys = new PickupManager(this);

    // Hidden intel is collected by actual physics overlap, never by a story trigger.
    this.director = new HarborDirector(this);
    this.director.installCaches();

    // Multi-tier Harbor gantry cranes ("стрелы крана"), hoists, jump pads, ziplines & hanging cargo
    this.traversal = new StageTraversal(this, 'harbor');
    // Pier Crane #1: clearly visible early crane boom with pneumatic jump pad, cargo trap & zip exit
    this.traversal.addCraneStructure({ towerX: 640, boomX: 450, boomW: 410, boomY: GROUND_Y - 128, midDeckY: GROUND_Y - 30, label: 'СТРЕЛА КРАНА #1' });
    this.traversal.addJumpPad(480, GROUND_Y + 35, -875);
    this.traversal.addBonusCache(525, GROUND_Y - 128, 'mg');
    this.traversal.addHangingCargo(825, GROUND_Y - 128, 60);
    this.traversal.addZipLine(860, GROUND_Y - 128, 1130, GROUND_Y - 102);
    this.traversal.addOneWayDeck(1090, GROUND_Y - 30, 150, 'МОСТИК');

    // Container Unloader Crane #2: vertical cargo hoist + overhead crane trolley into upper signal route
    this.traversal.addCraneStructure({ towerX: 2150, boomX: 1940, boomW: 480, boomY: GROUND_Y - 134, midDeckY: GROUND_Y - 30, label: 'СТРЕЛА КРАНА #2' });
    this.traversal.addMovingLift(1865, GROUND_Y - 10, 1865, GROUND_Y - 132, 92, 3200);
    this.traversal.addBonusCache(2030, GROUND_Y - 134, 'intel');
    this.traversal.addHangingCargo(2310, GROUND_Y - 134, 62);
    this.traversal.addMovingLift(2472, 358, 2545, 358, 76, 2600, 0.25);

    // Shipyard Heavy Crane #3: jump pad launch + downhill boom zip onto container deck + pre-boss catwalk
    this.traversal.addCraneStructure({ towerX: 3760, boomX: 3530, boomW: 450, boomY: GROUND_Y - 128, midDeckY: GROUND_Y - 30, label: 'СТРЕЛА КРАНА #3' });
    this.traversal.addJumpPad(3565, GROUND_Y + 35, -870);
    this.traversal.addBonusCache(3635, GROUND_Y - 128, 'laser');
    this.traversal.addHangingCargo(3865, GROUND_Y - 128, 60);
    this.traversal.addZipLine(3980, GROUND_Y - 128, 4215, GROUND_Y - 108);
    this.traversal.addOneWayDeck(4560, GROUND_Y - 30, 210, 'НАДСТРОЙКА');

    this.traversal.bindActor(this.player);
    this.traversal.bindActor(this.enemies as any);
    this.traversal.bindWeapons(this.weapons);
    this.traversal.bindSolids(ground);
    this.traversal.bindSolids(plats);
    this.props.bindSolids(ground);
    this.props.bindSolids(plats);

    // ---------- collisions ----------
    this.physics.add.collider(this.player, ground);
    this.physics.add.collider(this.player, plats);
    this.physics.add.collider(this.enemies, ground);
    this.physics.add.collider(this.enemies, plats);
    this.physics.add.collider(this.weapons.grenades, ground, (g) => {
      const gg = g as Phaser.Physics.Arcade.Image;
      if ((gg as any).bounced !== true) { (gg as any).bounced = true; this.fx.smoke(gg.x, gg.y); }
    });
    this.physics.add.collider(this.weapons.grenades, plats);
    // Real cover: shots hit solid walls instead of travelling through scenery.
    makeBallisticCover(this, plats, this.weapons.playerBullets, this.weapons.enemyBullets);
    this.physics.add.collider(this.tankDummyGroup(), ground);
    this.physics.add.collider(this.tankDummyGroup(), plats);

    // player bullets vs enemies/machines/props/boss
    this.physics.add.overlap(this.weapons.playerBullets, this.enemies, (pb, e) => this.hitEnemy(pb as any, e as Enemy));
    this.physics.add.overlap(this.weapons.playerBullets, this.props.group, (pb, p) => {
      const b = pb as Phaser.Physics.Arcade.Image;
      if ((b as any).isRocket) {
        this.weapons.explode(b.x, b.y, 90, 5);
        b.destroy();
        return;
      }
      (p as any).takeDamage?.((b as any).dmg ?? 1);
      this.fx.impact(b.x, b.y, (b.body as Phaser.Physics.Arcade.Body).velocity.x >= 0 ? 1 : -1);
      if (!(b as any).pierce) { this.fx.boom(b.x, b.y, 0.4); b.destroy(); }
    });
    this.physics.add.overlap(this.weapons.playerBullets, this.machineGrp, (pb, m) => {
      const b = pb as Phaser.Physics.Arcade.Image;
      (m as Machine).takeDamage?.((b as any).dmg ?? 1);
      this.fx.impact(b.x, b.y, (b.body as Phaser.Physics.Arcade.Body).velocity.x >= 0 ? 1 : -1, true);
      if ((b as any).isRocket) { this.weapons.explode(b.x, b.y, 90, 5); b.destroy(); }
      else if (!(b as any).pierce) { this.fx.boom(b.x, b.y, 0.4); b.destroy(); }
    });

    // enemy bullets vs player & tank & props
    this.physics.add.overlap(this.weapons.enemyBullets, this.player, (first, second) => {
      // Phaser's group-vs-sprite collider passes the SPRITE first in some paths.
      // Never assume first === bullet: that used to destroy the hero on impact.
      const bullet = (first === this.player ? second : first) as Phaser.Physics.Arcade.Image;
      if (!bullet?.active || !this.player.active) return;
      bullet.destroy(); // one collision per bullet
      if (this.player.inTank) {
        const dmg = Math.max(1, Math.round(((bullet as any).dmg ?? 1) * diff().dmgMul));
        this.tankSys.damageTank(dmg); return;
      }
      // РЕКРУТ: пуля «царапает» — даёт i-frames, но жизнь не отнимает
      if (diff().dmgMul < 1) { this.player.invulnUntil = this.time.now + 600; return; }
      this.hurtPlayer();
    });
    this.physics.add.overlap(this.weapons.enemyBullets, this.tankDummyGroup(), (first, second) => {
      if (!this.tankSys.active) return;
      const bullet = (this.weapons.enemyBullets.contains(first as Phaser.GameObjects.GameObject) ? first : second) as Phaser.Physics.Arcade.Image;
      if (!bullet?.active) return;
      bullet.destroy();
      this.tankSys.damageTank(1);
    });
    this.physics.add.overlap(this.weapons.enemyBullets, this.props.group, (b, p) => {
      const bullet = b as Phaser.Physics.Arcade.Image;
      if (!bullet.active) return;
      (p as any).takeDamage?.(2);
      bullet.destroy();
    });
    // enemy touch damage
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => {
      const en = e as Enemy;
      if (en.kind === 'spider' || en.kind === 'drone') this.hurtPlayer();
    });
    // ---------- scripted level beats ----------
    this.beats = [
      { x: 60, fn: (s) => { s.radio.say('intro'); s.time.delayedCall(2600, () => s.radio.say('landing')); } },
      { x: 330, fn: (s) => { s.spawnWave(420, ['rifle', 'rifle']); s.spawnEnemyAt('rifle', 710, 290); s.props.barrel(520); s.props.crate(565); } },
      { x: 620, fn: (s) => { s.spawnWave(980, ['rifle', 'gren']); s.spawnEnemyAt('spider', 900, 120); s.time.delayedCall(750, () => { if (!s.finished) s.traversal.spawnDropIn('rifle', 840); }); } },
      { x: 900, fn: (s) => { s.giveCrate(960, 'mg'); s.props.barrel(1040); s.props.barrel(1075); } },
      { x: 1150, fn: (s) => {
        s.radio.say('friendly_fire');
        s.spawnWave(1480, ['rifle', 'officer']);
        s.time.delayedCall(680, () => { if (!s.finished) s.spawnEnemyAt('gren', 1500, GROUND_Y - 120); });
        s.time.delayedCall(1220, () => { if (!s.finished) s.spawnEnemyAt('heavy', 1675, GROUND_Y - 30); });
      } },
      { x: 1500, fn: (s) => { s.props.tower(1720); s.spawnWave(1790, ['rifle', 'rifle']); spawnSurrenderGag(s, 1910); } },
      { x: 1700, fn: (s) => { s.director.startCargoAmbush(); s.spawnEnemyAt('rifle', 2220, 290); } },
      { x: 1950, fn: (s) => { s.giveCrate(2050, 'shotgun'); s.spawnEnemyAt('drone', 2300, GROUND_Y - 120); s.spawnMachine(2240); s.time.delayedCall(900, () => { if (!s.finished) s.traversal.spawnDropIn('rifle', 2330); }); } },
      { x: 2300, fn: (s) => { s.signalEvent_aptTransform(2960); } },
      { x: 2700, fn: (s) => { s.giveCrate(2835, 'laser'); s.spawnWave(2950, ['rifle', 'gren', 'rifle'], 440); s.time.delayedCall(950, () => { if (!s.finished) s.traversal.spawnDropIn('gren', 3030); }); } },
      { x: 3050, fn: (s) => { s.spawnEnemyAt('heavy', 3250, GROUND_Y - 30); s.time.delayedCall(520, () => { if (!s.finished) s.spawnWave(3360, ['rifle', 'officer']); }); s.props.barrel(3200); } },
      { x: 3160, fn: (s) => s.director.startSignalSurge() },
      { x: 3400, fn: (s) => { s.tankSys.spawnAt(3360); s.radio.say('tank_found'); } },
      { x: 3700, fn: (s) => { s.spawnWave(3980, ['rifle', 'rifle', 'gren'], 440); s.spawnEnemyAt('gren', 3810, 290); s.spawnEnemyAt('spider', 4100, 120); } },
      { x: 4200, fn: (s) => {
        s.giveCrate(4115, 'life');
        s.props.tower(4485);
        s.spawnWave(4540, ['rifle', 'heavy']);
        s.time.delayedCall(820, () => { if (!s.finished) s.spawnEnemyAt('rifle', 4640, GROUND_Y - 105); });
        s.time.delayedCall(1350, () => { if (!s.finished) s.traversal.spawnDropIn('rifle', 4560); });
      } },
      { x: 4600, fn: (s) => { s.spawnEnemyAt('drone', 4700, GROUND_Y - 130); s.spawnMachine(4720); } },
      { x: 4950, fn: (s) => { s.enterBossArena(); } },
    ];

    MUSIC.play('level');
    window.addEventListener('rs:touch-pause', this.onPauseEvt);
    this.events.once('shutdown', () => window.removeEventListener('rs:touch-pause', this.onPauseEvt));
    this.kE = this.input.keyboard!.addKey('E');
    this.kP = this.input.keyboard!.addKey('P');
    this.input.keyboard!.on('keydown-ESC', this.togglePause, this);
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-ESC', this.togglePause, this));
    this.events.on('rs:boss-defeated', () => this.onBossDefeated());
    this.t0 = this.time.now;
  }

  private tankDummyGroup() {
    // The tank group is created once per Level run, then shared by colliders.
    return this.tankGrp;
  }

  // ===================== spawning helpers =====================

  spawnEnemyAt(kind: EnemyKind, x: number, y: number): Enemy {
    x = safeEnemySpawnX(this, x, kind === 'spider' ? GROUND_Y : y);
    const e = new Enemy(this, x, y, kind === 'spider' ? 'e_spider' : 'e_rifle');
    this.enemies.add(e);
    (e as Enemy).init(kind, x, y);
    return e;
  }

  spawnWave(startX: number, kinds: EnemyKind[], staggerMs = 0) {
    kinds.forEach((k, i) => {
      if (staggerMs > 0 && i >= 2) {
        this.time.delayedCall((i - 1) * staggerMs, () => {
          if (!this.finished && this.enemies.countActive(true) < 7) {
            this.spawnEnemyAt(k, startX + i * 98, GROUND_Y - 30);
          }
        });
      } else {
        this.spawnEnemyAt(k, startX + i * 105, GROUND_Y - 30);
      }
    });
  }

  giveCrate(x: number, kind: 'mg' | 'shotgun' | 'laser' | 'life') {
    this.pickupSys.add(x, GROUND_Y + 35, kind);
  }

  spawnMachine(x: number): Machine {
    const m = new Machine(this, x, GROUND_Y - 40);
    m.initMachine(this, x);
    this.machineGrp.add(m);
    (m.body as Phaser.Physics.Arcade.Body)?.setAllowGravity(false).setImmovable(true);
    this.machines.push(m);
    spawnTurret(this, x + 150, { linkedDisabled: () => !m.active || m.disabled });
    return m;
  }

  nearestDamaged(x: number): Machine | null {
    let best: Machine | null = null, bd = 1e9;
    for (const m of this.machines) {
      if (!m.active || m.hp >= m.hpMax || m.captured) continue;
      const d = Math.abs(m.x - x);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  requestReinforcement(x: number) {
    // Hard upper limit prevents officer chains from overwhelming mobile devices.
    if (this.finished || this.enemies.countActive(true) >= 13) return;
    this.radio.say('reinforce');
    this.spawnWave(x, ['rifle', 'rifle']);
  }

  // ===================== special events =====================

  /** «Ржавый сигнал»: an APC sprouts mechanical legs right in front of you. */
  signalEvent_aptTransform(x: number) {
    const S = this;
    S.hud.banner('СОБЫТИЕ «РЖАВОГО СИГНАЛА»');
    SFX.play('signal');
    S.radio.say('signal_event_1');
    const m = S.spawnMachine(x);
    S.fx.signalGlitch(m.x, GROUND_Y - 40);
    S.time.delayedCall(1200, () => {
      // grow legs: scale + leg rectangles tween
      const legs = S.add.graphics().setDepth(41);
      S.tweens.addCounter({
        from: 0, to: 1, duration: 900,
        onUpdate: (tw) => {
          const v = tw.getValue() ?? 0;
          legs.clear();
          legs.fillStyle(0x3a4250, 1);
          for (let k = 0; k < 3; k++) {
            const lx = m.x - 40 + k * 34;
            const mb = m.y + m.displayHeight / 2; // bottom edge (typed-safe)
            legs.fillRect(lx, mb - 24, 8, 26 * v);
            legs.fillRect(lx - 6, mb - 24 + 26 * v, 20, 6);
          }
        },
      });
      m.setScale(1.15);
      S.time.delayedCall(4000, () => legs.destroy());
    });
    return m;
  }

  // ===================== combat callbacks =====================

  private hitEnemy(b: Phaser.Physics.Arcade.Image, e: Enemy) {
    if (!e.active || !b.active) return;
    const dmg = (b as any).dmg ?? 1;
    if ((b as any).isRocket) {
      this.weapons.explode(b.x, b.y, 90, 5);
      b.destroy();
      return;
    }
    damageEnemy(this, e, dmg);
    if (!(b as any).pierce) b.destroy(); // damageEnemy already emits a directional hit spark
  }

  hurtPlayer() {
    // A delayed projectile must not defeat the hero after the boss is destroyed.
    if (this.finished) return;
    if (this.player.inTank) { this.tankSys.damageTank(1); return; }
    if (this.player.hurt(this.time.now)) {
      this.player.killFx();
      this.onPlayerDown();
    }
  }

  onPlayerDown() {
    run.lives--;
    this.radio.say('death');
    if (run.lives <= 0) {
      this.time.delayedCall(900, () => this.gameOver());
    } else {
      this.time.delayedCall(1400, () => {
        if (this.finished || !this.sys.isActive()) return;
        const safe = findSafeRespawnPoint(this, Math.max(60, this.player.x - 120));
        this.player.respawn(safe.x, this.time.now, safe.y);
      });
    }
  }

  private pickCrate(c: Phaser.Physics.Arcade.Image) {
    if (!c.active) return;
    const kind = c.getData('kind');
    c.destroy();
    SFX.play('pickup');
    this.fx.boom(c.x, c.y, 0.8);
    if (kind === 'life') {
      run.lives = Math.min(5, run.lives + 1);
      this.hud.toast('+1 ЖИЗНЬ');
      addScaledScore(this, 200);
    } else {
      this.player.giveWeapon(kind);
      const pts = addScaledScore(this, 300);
      scorePopup(this, c.x, c.y - 16, `+${pts}`);
    }
  }

  // ===================== boss =====================

  enterBossArena() {
    // The scripted x-trigger and a direct scene call can fire in the same
    // frame. Never spawn a second boss or replace a defeated boss reference.
    if (this.bossEntered || this.finished) return;
    this.bossEntered = true;
    const S = this;
    S.hud.banner('ГАВАНЬ ЗАКРЫТА. ИДЁТ «МАЯК-6»');
    MUSIC.play('boss');
    S.radio.say('boss_intro');
    // gate closes
    const gate = S.textures.exists('rem_gate')
      ? S.add.image(WORLD_W - 40, GROUND_Y - 140, 'rem_gate').setDisplaySize(28, 300).setDepth(37)
      : S.add.rectangle(WORLD_W - 40, GROUND_Y - 140, 24, 300, 0x22262e).setDepth(37);
    S.tweens.add({ targets: gate, y: GROUND_Y - 140, scaleY: { from: 0.05, to: 1 }, duration: 800 });
    const gateBody = S.physics.add.staticImage(WORLD_W - 40, GROUND_Y - 140, '__rect');
    gateBody.setVisible(false);
    gateBody.setDisplaySize(24, 300);
    gateBody.refreshBody();
    S.physics.add.collider(S.player, gateBody);
    // lock camera zone
    // The old bound (WORLD_W-1000) snapped the camera past the hero at x=4950.
    S.boss = new Boss(S, Math.min(WORLD_W - 340, S.player.x + 430), GROUND_Y + 35);
    lockBossArena(S, S.player, S.boss);
    S.hud.showBoss(true);
    // boss body overlaps bullets:
    S.physics.add.overlap(S.weapons.playerBullets, S.boss, (first, second) => {
      const b = (first === S.boss ? second : first) as Phaser.Physics.Arcade.Image;
      if (!S.boss?.alive || !b?.active) return;
      // phase 2: only cab hits count double (weak point)
      let dmg = (b as any).dmg ?? 1;
      if (S.boss.phase === 2 && b.y < S.boss.y - 160 && b.x < S.boss.x) dmg *= 3;
      S.boss.takeDamage(dmg);
      S.fx.impact(b.x, b.y, b.x < S.boss.x ? -1 : 1, S.boss.phase === 2);
      if ((b as any).isRocket) { S.weapons.explode(b.x, b.y, 90, 5); b.destroy(); }
      else if (!(b as any).pierce) b.destroy();
    });
    // trickle of reinforcements during fight
    S.time.addEvent({
      delay: 6500, loop: true, callback: () => {
        if (!S.boss?.alive || S.finished) return;
        S.spawnEnemyAt('rifle', S.player.x + rand(-260, -160), GROUND_Y - 30);
      },
    });
  }

  private onBossDefeated() {
    unlockEpisode2();
    MUSIC.stop();
    this.hud.showBoss(false);
    this.radio.say('boss_dead');
    this.finished = true;
    const elapsedSec = Math.max(1, Math.round((this.activeMs || (this.time.now - this.t0)) / 1000));
    const br = finalizeEpisodeVictory(this, 1, elapsedSec);
    const totalBonus = br.clearBonus + br.livesBonus + br.timeBonus;
    this.hud.toast(`БОНУС ГЛАВЫ: +${totalBonus} (×${br.multiplier})`, 3200);
    this.time.delayedCall(5200, () => {
      recordBest();
      this.registry.set('finalScore', run.score);
      this.cameras.main.fadeOut(900, 10, 12, 18);
      const goRes = () => { if (!this.finished) return; this.scene.start('Results'); };
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, goRes);
      this.time.delayedCall(1200, goRes); // страховка от «зависшего» перехода
    });
  }

  private gameOver() {
    if (this.finished) return;
    MUSIC.stop();
    recordBest();
    this.registry.set('scoreBreakdown', null);
    this.registry.set('finalScore', run.score);
    this.registry.set('gameover', true);
    this.scene.start('Results');
  }

  // ===================== update loop =====================

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.kP)) this.togglePause();
    if (this.paused) return;
    if (!this.finished) this.activeMs += delta;

    this.player.update(time);
    this.traversal.update(time, delta, [this.player, ...(this.enemies.getChildren() as Enemy[])]);
    const grp = this.tankDummyGroup();
    if (this.tankSys.tank && !grp.contains(this.tankSys.tank)) grp.add(this.tankSys.tank);

    const interact = Phaser.Input.Keyboard.JustDown(this.kE) || tapEdge('justBoard');
    const usedPickup = !this.player.inTank && this.pickupSys.update(this.player, interact);
    if (this.player.inTank) {
      const K = this.input.keyboard!;
      const kd = (kc: string) => K.addKey(kc).isDown;
      const pointer = this.input.activePointer;
      const mouseFire = !!pointer?.leftButtonDown();
      const pointerWorld = mouseFire ? this.cameras.main.getWorldPoint(pointer.x, pointer.y) : null;
      this.tankSys.update(time, this.player, {
        left: kd('A') || kd('LEFT') || touch.left,
        right: kd('D') || kd('RIGHT') || touch.right,
        up: kd('W') || kd('UP') || touch.up,
        down: kd('S') || kd('DOWN') || touch.down,
        fire: kd('J') || touch.fire || mouseFire,
        jump: kd('SPACE') || touch.jump,
        pointerWorldX: pointerWorld?.x,
        pointerWorldY: pointerWorld?.y,
      });
      if (interact) this.tankSys.eject(this.player);
    } else {
      if (this.tankSys.tank) {
        this.tankSys.update(time, this.player, { left: false, right: false, up: false, fire: false, jump: false });
      }
      if (interact && !usedPickup) {
        this.tankSys.board(this.player);
      }
    }

    // enemies AI (only near camera)
    const camL = this.cameras.main.scrollX - 60;
    this.enemies.children.each((o) => {
      const e = o as Enemy;
      if (e.active && e.x > camL && e.x < camL + VIEW_W + 120) e.behavior(time, this.player);
      return true;
    });
    // machines idle behavior: disabled ones stay; active shoot handled by nests
    this.weapons.update(time);
    this.weapons.cleanupOffscreen(this.cameras.main.scrollX);

    // trigger beats
    for (const b of this.beats) {
      if (!b.done && this.player.x >= b.x) { b.done = true; b.fn(this); }
    }

    // camera lead target
    this.followTargetSync();

    // boss update
    if (this.boss?.alive) {
      confineHeroToArena(this, this.player);
      this.boss.update(time, this.player.x, this.player.y);
    }

    this.hud.update(time, this.player, this.tankSys);
    void delta; void time;
  }

  private _follow?: Phaser.GameObjects.Zone;
  private followTargetSync() {
    if (!this._follow) return;
    const cb = this.cameras.main.getBounds(); // world bounds of the camera
    const tx = Phaser.Math.Clamp(this.player.x + 130, cb.x + 480, cb.x + Math.max(cb.width - 480, 480));
    this._follow.setPosition(tx, this.player.y - 40);
  }

  private onPauseEvt = () => this.togglePause();

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) { this.physics.pause(); this.hud.toast('ПАУЗА', 999999); }
    else { this.physics.resume(); this.hud.toast('ПОЕХАЛИ!', 900); }
  }
}
