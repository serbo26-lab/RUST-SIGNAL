import Phaser from 'phaser';
import { beginOnlineRun } from './online-leaderboard';
import {
  VIEW_W, VIEW_H, WORLD_W, GROUND_Y, GRAVITY, run, diff,
  addScaledScore, finalizeEpisodeVictory, recordBest, unlockEpisode3, rand, shake,
} from './core';
import { makePlayerTextures, makeEnemyTextures, makeFxTextures, makeTankTextures } from './sprites';
import { makeMachineTextures, Machine, PropsSystem, FxSystem } from './props';
import { PickupManager } from './pickups';
import { TrainBackdrop, makeTrainArt } from './train-art';
import { TrainBoss } from './train-boss';
import { StageTraversal } from './traversal';
import { Player } from './player';
import { WeaponsSystem } from './weapons';
import { markSolidPlatform, markGround, safeEnemySpawnX, findClearGroundX, findSafeRespawnPoint, makeBallisticCover, lockBossArena, confineHeroToArena, isWithinCamera } from './world-rules';
import { Enemy, type EnemyKind, damageEnemy } from './enemies';
import { TankSystem } from './boss';
import { Hud, ensureWarnTexture } from '../ui/hud';
import { SFX, MUSIC } from './audio';
import { touch, tapEdge } from '../ui/touch';

interface TrainBeat { x: number; fired: boolean; action: () => void }

/**
 * EPISODE 2 — ARMORED TRAIN NO. 7.
 * New level, new chase / visual palette / stage events / original train boss.
 * Shares controls, equipment, remastered actors and scoring with episode one.
 */
export class TrainScene extends Phaser.Scene {
  player!: Player;
  weapons!: WeaponsSystem;
  fx!: FxSystem;
  props!: PropsSystem;
  hud!: Hud;
  enemies!: Phaser.Physics.Arcade.Group;
  machines: Machine[] = [];
  machineGrp!: Phaser.Physics.Arcade.Group;
  tankSys!: TankSystem;
  boss: TrainBoss | null = null;
  finished = false;
  paused = false;
  private backdrop!: TrainBackdrop;
  private follow!: Phaser.GameObjects.Zone;
  traversal!: StageTraversal;
  pickupSys!: PickupManager;
  private beats: TrainBeat[] = [];
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private breaker!: Phaser.GameObjects.Image;
  breakerActivated = false;
  bridgeEvents = 0;
  helicopterEvents = 0;
  bossEntered = false;
  private airstrikeUntil = 0;
  private activeMs = 0;

  constructor() { super('Train'); }

  create() {
    try { this.createStage(); }
    catch (error: any) {
      (window as any).__RS_FATAL__ = String(error?.stack ?? error).slice(0, 800);
      console.error('[RUST SIGNAL] TrainScene create failed:', error);
      throw error;
    }
  }

  private createStage() {
    run.episode = 2;
    beginOnlineRun({ episode: 2, difficulty: run.difficulty, character: run.character });
    this.registry.set('episode', 2);
    this.registry.set('gameover', false);
    this.registry.set('scoreBreakdown', null);
    this.finished = false;
    this.activeMs = 0;
    window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: true }));
    this.events.once('shutdown', () =>
      window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: false })));

    this.physics.world.gravity.y = GRAVITY;
    this.physics.world.setBounds(0, -350, WORLD_W, 1400);
    this.cameras.main.setBounds(0, -60, WORLD_W, VIEW_H + 200);
    this.cameras.main.fadeIn(620, 10, 12, 24);
    this.follow = this.add.zone(95, GROUND_Y - 50, 1, 1);
    this.cameras.main.startFollow(this.follow, true, .15, .1);
    this.cameras.main.setDeadzone(260, 95);

    makePlayerTextures(this); makeEnemyTextures(this); makeFxTextures(this);
    makeTankTextures(this); makeMachineTextures(this); ensureWarnTexture(this);
    makeTrainArt(this);
    this.backdrop = new TrainBackdrop(this);

    this.fx = new FxSystem(this);
    this.weapons = new WeaponsSystem(this);
    this.props = new PropsSystem(this);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.machineGrp = this.physics.add.group();
    this.tankSys = new TankSystem(this);
    this.hud = new Hud(this);
    this.player = new Player(this, 85, GROUND_Y - 55, run.character);
    this.player.invulnUntil = this.time.now + 1600;

    // The train is divided into roof sections. Jump the two visible inter-car
    // gaps or take the higher luggage-container paths to bypass them.
    const ground = this.physics.add.staticGroup();
    const addSolid = (x: number, y: number, w: number, h: number, group = ground) => {
      const p = this.physics.add.staticImage(x, y, '__rect').setVisible(false);
      p.setDisplaySize(w, h); p.refreshBody(); group.add(p);
      return p;
    };
    for (const [left, right] of [[0, 1345], [1430, 2780], [2865, WORLD_W]] as const) {
      addSolid((left + right) / 2, GROUND_Y + 65, right - left, 60);
    }
    markGround(this, [[0, 1345], [1430, 2780], [2865, WORLD_W]]);
    for (const x of [1345, 2780]) {
      this.add.rectangle(x + 42, GROUND_Y + 49, 85, 39, 0x09111b).setDepth(12);
      this.add.rectangle(x + 1, GROUND_Y + 36, 8, 8, 0xffb459).setDepth(14);
      this.add.rectangle(x + 82, GROUND_Y + 36, 8, 8, 0xffb459).setDepth(14);
    }
    const raised = this.physics.add.staticGroup();
    for (const [x, y, width] of [
      [900, GROUND_Y - 4, 120], [1250, GROUND_Y - 31, 110],
      [1900, GROUND_Y - 5, 126], [2530, GROUND_Y - 9, 116],
      [2685, GROUND_Y - 31, 110], [3530, GROUND_Y - 5, 128],
      [4260, GROUND_Y - 12, 130],
    ] as const) {
      if (y < GROUND_Y - 30) {
        // Two-tier crate stack seated flush on the train deck (no floating 33px head-snag gap).
        const topY = y + 3;
        const deckY = GROUND_Y + 35;
        const stackH = deckY - topY;
        const midY = topY + stackH / 2;
        addSolid(x, midY, width, stackH, raised);
        this.add.image(x, deckY - 22, 'tr_cover').setDisplaySize(width, 44).setDepth(15);
        this.add.image(x, topY + 21, 'tr_cover').setDisplaySize(width, 44).setDepth(16);
        markSolidPlatform(this, x, midY, width, stackH);
      } else {
        addSolid(x, y + 25, width, 44, raised);
        this.add.image(x, y + 24, 'tr_cover').setDisplaySize(width, 44).setDepth(16);
        markSolidPlatform(this, x, y + 25, width, 44);
      }
    }
    this.physics.add.collider(this.player, ground);
    this.physics.add.collider(this.player, raised);
    this.physics.add.collider(this.enemies, ground);
    this.physics.add.collider(this.enemies, raised);
    this.physics.add.collider(this.weapons.grenades, ground);
    // Real cover: shots hit solid walls instead of travelling through scenery.
    makeBallisticCover(this, raised, this.weapons.playerBullets, this.weapons.enemyBullets);
    this.physics.add.collider(this.weapons.grenades, raised);

    this.pickupSys = new PickupManager(this);

    // Multi-tier Train overhead radar catwalks, steam vents, pantograph lifts & contact ziplines
    this.traversal = new StageTraversal(this, 'train');
    this.traversal.addJumpPad(590, GROUND_Y + 35, -850);
    this.traversal.addOneWayDeck(560, GROUND_Y - 115, 360, 'РАДАРНЫЙ МОСТИК');
    this.traversal.addBonusCache(720, GROUND_Y - 115, 'mg');
    this.traversal.addOneWayDeck(1080, GROUND_Y - 92, 190);
    this.traversal.addZipLine(1250, GROUND_Y - 92, 1535, GROUND_Y - 76);

    this.traversal.addOneWayDeck(1740, GROUND_Y - 62, 230, 'ПАНТОГРАФ');
    this.traversal.addOneWayDeck(2010, GROUND_Y - 122, 300, 'ВЕРХНЯЯ СВЯЗЬ');
    this.traversal.addHangingCargo(2170, GROUND_Y - 122, 58);
    this.traversal.addBonusCache(2120, GROUND_Y - 122, 'intel');
    this.traversal.addMovingLift(2362, GROUND_Y - 112, 2610, GROUND_Y - 112, 92, 3200);

    this.traversal.addJumpPad(3160, GROUND_Y + 35, -855);
    this.traversal.addOneWayDeck(3120, GROUND_Y - 118, 360, 'СИГНАЛЬНАЯ АРКА');
    this.traversal.addBonusCache(3300, GROUND_Y - 118, 'laser');
    this.traversal.addZipLine(3480, GROUND_Y - 118, 3790, GROUND_Y - 68);
    this.traversal.addJumpPad(4380, GROUND_Y + 35, -845);
    this.traversal.addOneWayDeck(4420, GROUND_Y - 102, 290, 'ПОСТ ОХРАНЫ');
    this.traversal.addHangingCargo(4560, GROUND_Y - 102, 56);

    this.traversal.bindActor(this.player);
    this.traversal.bindActor(this.enemies as any);
    this.traversal.bindWeapons(this.weapons);
    this.traversal.bindSolids(ground);
    this.traversal.bindSolids(raised);
    this.props.bindSolids(ground);
    this.props.bindSolids(raised);

    this.physics.add.overlap(this.weapons.playerBullets, this.enemies, (a, b) => {
      const bullet = (this.weapons.playerBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const enemy = (bullet === a ? b : a) as Enemy;
      if (!bullet.active || !enemy.active) return;
      if ((bullet as any).isRocket) {
        const x = bullet.x, y = bullet.y;
        bullet.destroy(); this.weapons.explode(x, y, 94, 5, false); return;
      }
      damageEnemy(this, enemy, (bullet as any).dmg ?? 1);
      if (!(bullet as any).pierce) bullet.destroy();
    });
    this.physics.add.overlap(this.weapons.playerBullets, this.props.group, (a, b) => {
      const bullet = (this.weapons.playerBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const prop = bullet === a ? b : a;
      if (!bullet.active || !(prop as any).active) return;
      (prop as any).takeDamage?.((bullet as any).dmg ?? 1);
      if (!(bullet as any).pierce) bullet.destroy();
    });
    this.physics.add.overlap(this.weapons.enemyBullets, this.player, (a, b) => {
      const bullet = (a === this.player ? b : a) as Phaser.Physics.Arcade.Image;
      if (!bullet.active) return;
      bullet.destroy();
      if (!this.finished && diff().dmgMul >= 1) this.hurtPlayer();
      else if (!this.finished) this.player.invulnUntil = Math.max(this.player.invulnUntil, this.time.now + 400);
    });
    this.physics.add.overlap(this.player, this.enemies, (_a, b) => {
      const e = b as Enemy;
      if ((e.kind === 'spider' || e.kind === 'drone') && !this.finished) this.hurtPlayer();
    });
    this.physics.add.overlap(this.weapons.enemyBullets, this.props.group, (a, b) => {
      const bullet = (this.weapons.enemyBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const prop = bullet === a ? b : a;
      if (bullet.active) { (prop as any).takeDamage?.(1); bullet.destroy(); }
    });

    this.decorateStage();
    this.addPickups();
    this.initBreaker();
    this.initBeats();
    this.pauseKey = this.input.keyboard!.addKey('P');
    this.interactKey = this.input.keyboard!.addKey('E');
    this.input.keyboard!.on('keydown-ESC', this.togglePause, this);
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-ESC', this.togglePause, this));
    window.addEventListener('rs:touch-pause', this.onTouchPause);
    this.events.once('shutdown', () => window.removeEventListener('rs:touch-pause', this.onTouchPause));
    this.events.on('rs:train-boss-dead', this.onVictory, this);
    MUSIC.play('level');
    this.hud.banner('ЭПИЗОД 2: БРОНЕПОЕЗД №7');
    this.hud.toast('Перепрыгивай разрывы между вагонами. Ищи щиток турелей!', 3700);
  }

  private decorateStage() {
    for (let i = 0; i < 12; i++) {
      const rawX = 380 + i * 440;
      if (rawX > WORLD_W - 1050 || (rawX > 1250 && rawX < 1480) || (rawX > 2680 && rawX < 2930)) continue;
      const x = findClearGroundX(this, rawX, 44, GROUND_Y + 35, { objectHeight: 42 });
      this.add.image(x, GROUND_Y + 7, 'tr_cover')
        .setDisplaySize(80, 37).setDepth(14).setTint(i % 2 ? 0x869fa2 : 0xb3b9a7);
      if (i % 3 === 0) this.add.text(x, GROUND_Y - 35, '▦ 07', {
        fontFamily: 'monospace', fontSize: '12px', color: '#efbd87',
      }).setOrigin(.5).setDepth(15);
    }
    // Pursuit telegraph signs that make the two jumps legible.
    for (const x of [1270, 2695]) {
      const sign = this.add.text(x, GROUND_Y - 76, '⚠ РАЗРЫВ ВАГОНОВ', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffd090',
        stroke: '#171923', strokeThickness: 4,
      }).setDepth(85);
      this.tweens.add({ targets: sign, alpha: 0.45, duration: 650, repeat: -1, yoyo: true });
    }
  }

  private addPickups() {
    const locations: Array<[number, 'mg' | 'shotgun' | 'laser' | 'life']> = [
      [710, 'mg'], [1900, 'shotgun'], [3330, 'laser'], [4870, 'life'],
    ];
    for (const [x, kind] of locations) {
      this.pickupSys.add(x, GROUND_Y + 35, kind);
    }
  }

  spawnEnemyAt(kind: EnemyKind, x: number, y = GROUND_Y - 30) {
    x = safeEnemySpawnX(this, x, kind === 'spider' ? GROUND_Y : y);
    const enemy = new Enemy(this, x, y, kind === 'spider' ? 'e_spider' : 'e_rifle');
    this.enemies.add(enemy); enemy.init(kind, x, y);
    return enemy;
  }

  spawnWave(x: number, kinds: EnemyKind[]) {
    for (let i = 0; i < kinds.length; i++) {
      if (this.enemies.countActive(true) >= 13) return;
      if (i < 2) {
        this.spawnEnemyAt(kinds[i], x + 105 * i);
      } else {
        this.time.delayedCall((i - 1) * 440, () => {
          if (!this.finished && this.enemies.countActive(true) < 7) {
            this.spawnEnemyAt(kinds[i], x + 100 * i);
          }
        });
      }
    }
  }

  nearestDamaged(_x: number): Machine | null { return null; }

  requestReinforcement(x: number) {
    if (this.finished || this.enemies.countActive(true) > 10) return;
    this.spawnWave(Phaser.Math.Clamp(x, 25, WORLD_W - 950), ['rifle', 'gren']);
  }

  private initBreaker() {
    const x = 3620;
    const hasProp = this.textures.exists('prop_breaker');
    this.breaker = hasProp
      ? this.add.image(x, GROUND_Y + 35 - 32, 'prop_breaker', 'f0').setDepth(26)
      : this.add.image(x, GROUND_Y - 12, 'tr_cover').setDisplaySize(50, 64).setDepth(24).setTint(0xb45a66);
    this.breaker.setData('active', true);
    const aura = this.add.circle(x, GROUND_Y - 2, 22, 0xff5a6a, 0.2)
      .setDepth(25).setBlendMode(Phaser.BlendModes.ADD);
    this.breaker.setData('aura', aura);
    this.tweens.add({ targets: aura, alpha: 0.45, scale: 1.25, yoyo: true, repeat: -1, duration: 520 });
    this.add.text(x, GROUND_Y - 76, '[E] ОТКЛЮЧИТЬ ПИТАНИЕ', {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#ffcf89',
      stroke: '#10151d', strokeThickness: 3,
    }).setOrigin(.5).setDepth(70);
  }

  /** One-use circuit breaker disables roof turrets for the rest of the stage.
   * A deliberate reason to go on foot instead of holding down fire. */
  activateBreaker() {
    if (this.breakerActivated || this.player.dead || this.finished) return false;
    if (Math.abs(this.player.x - this.breaker.x) > 78
      || Math.abs(this.player.y - this.breaker.y) > 100) return false;
    this.breakerActivated = true;
    if (this.textures.exists('prop_breaker') && this.textures.get('prop_breaker').has('f1')) {
      this.breaker.setFrame('f1');
    } else {
      this.breaker.setTint(0x63dfc5);
    }
    const aura = this.breaker.getData('aura') as Phaser.GameObjects.Arc | undefined;
    if (aura?.active) aura.setFillStyle(0x52f2c8, 0.16);
    this.breaker.setData('active', false);
    this.fx.signalGlitch(this.breaker.x, this.breaker.y);
    this.hud.banner('ЗАЩИТА ПОЕЗДА СНЯТА');
    addScaledScore(this, 750);
    this.hud.toast('Турели замолкли. Путь к локомотиву свободен!', 3000);
    return true;
  }

  private initBeats() {
    const once = (x: number, action: () => void) => this.beats.push({ x, action, fired: false });
    once(90, () => this.hud.toast('Боцман: состав уже в тревоге, эти ребята нас ждали!', 3000));
    once(320, () => { this.spawnWave(500, ['rifle', 'rifle']); this.spawnEnemyAt('rifle', 780, GROUND_Y - 165); });
    once(860, () => { this.spawnWave(1110, ['gren', 'rifle']); this.spawnEnemyAt('rifle', 1150, GROUND_Y - 145); this.props.barrel(1190); });
    once(1520, () => { this.hud.banner('БОЙ НА КРЫШАХ'); this.spawnWave(1690, ['rifle', 'heavy']); this.spawnEnemyAt('gren', 2140, GROUND_Y - 170); });
    once(1860, () => { this.helicopterRaid(); this.traversal.spawnDropIn('rifle', 2180, '▼ ДЕСАНТ С ВЕРТОЛЁТА'); });
    once(2240, () => { this.spawnWave(2470, ['rifle', 'gren']); this.props.crate(2600); });
    once(3030, () => { this.hud.toast('Впереди щиток питания турелей!', 3000); this.spawnWave(3260, ['heavy', 'rifle']); this.spawnEnemyAt('rifle', 3320, GROUND_Y - 165); });
    once(3300, () => this.bridgeVolley());
    once(3650, () => { this.spawnWave(3860, ['rifle', 'officer']); this.hud.toast('Выруби щиток клавишей [E], чтобы заткнуть пушки.'); });
    once(4140, () => { this.spawnEnemyAt('drone', 4370); this.spawnWave(4470, ['rifle', 'gren']); this.spawnEnemyAt('rifle', 4560, GROUND_Y - 150); this.traversal.spawnDropIn('gren', 4620); });
    once(4590, () => this.tunnelBlackout());
    once(4890, () => this.spawnWave(5130, ['heavy', 'rifle']));
    once(5180, () => this.enterEngineArena());
  }

  private helicopterRaid() {
    this.helicopterEvents++;
    this.hud.banner('ВЕРТОЛЁТ НА ХВОСТЕ!');
    const x = this.player.x + 340;
    const hasHeli = this.textures.exists('veh_heli');
    const heli = hasHeli
      ? this.add.sprite(x, 128, 'veh_heli', 'f0').setDepth(105)
      : this.add.sprite(x, 135, 'e_drone').setScale(2.35).setDepth(105);
    if (hasHeli && this.anims.exists('veh_heli_spin')) heli.play('veh_heli_spin');
    const beam = this.add.triangle(x, 148, 0, 0, -135, 340, 45, 340, 0xffe49e, 0.14)
      .setOrigin(0, 0).setDepth(103).setBlendMode(Phaser.BlendModes.ADD);
    heli.once('destroy', () => { if (beam.active) beam.destroy(); });
    this.tweens.add({
      targets: [heli, beam], x: `-=${920}`, y: '+=38',
      duration: 5600, ease: 'Sine.easeInOut',
      onComplete: () => { if (heli.active) heli.destroy(); },
    });
    for (let i = 0; i < 7; i++) this.time.delayedCall(650 + i * 620, () => {
      if (!heli.active || this.finished || !this.sys.isActive()) return;
      if (!isWithinCamera(this, heli.x - 34, 24)) return;
      this.fx.enemyMuzzle(heli.x - 36, heli.y + 18, -1);
      this.fx.smoke(heli.x + 44, heli.y - 10, 0.55);
      this.weapons.enemyAimedShot(heli.x - 34, heli.y + 16, this.player.x, this.player.y, 325);
    });
  }

  private bridgeVolley() {
    this.bridgeEvents++;
    this.hud.banner('ПУШКИ МОСТА! УХОДИ С ЛИНИИ ОГНЯ');
    for (let i = 0; i < 4; i++) this.time.delayedCall(i * 950, () => {
      if (!this.sys.isActive() || this.finished || this.breakerActivated) return;
      const x = Phaser.Math.Clamp(this.player.x + (i % 2 ? -55 : 70), 3200, 4040);
      const warn = this.add.rectangle(x, GROUND_Y + 31, 90, 8, 0xffbe69).setDepth(120);
      this.tweens.add({ targets: warn, alpha: 0.12, duration: 130, yoyo: true, repeat: 3 });
      this.time.delayedCall(780, () => {
        warn.destroy();
        if (!this.sys.isActive() || this.finished || this.breakerActivated) return;
        this.weapons.explode(x, GROUND_Y, 75, 2, true);
      });
    });
  }

  private tunnelBlackout() {
    this.hud.banner('ТОННЕЛЬ: СВЯЗЬ ПРОПАЛА');
    const dim = this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x071221, 0.75)
      .setScrollFactor(0).setOrigin(0).setDepth(150);
    const lamp = this.add.circle(VIEW_W / 2, 270, 112, 0xffd5a1, 0.14)
      .setScrollFactor(0).setDepth(152);
    this.tweens.add({ targets: [dim, lamp], alpha: 0, delay: 2200, duration: 900,
      onComplete: () => { dim.destroy(); lamp.destroy(); } });
    this.hud.toast('Вышли из темноты. Дальше только локомотив.', 2600);
  }

  enterEngineArena() {
    if (this.bossEntered) return;
    this.bossEntered = true;
    this.hud.banner('БРОНЕПОЕЗД №7: ЛОКОМОТИВ');
    MUSIC.play('boss');
    this.boss = new TrainBoss(this, Math.min(WORLD_W - 340, this.player.x + 430));
    lockBossArena(this, this.player, this.boss);
    this.hud.showBoss(true);
    this.physics.add.overlap(this.weapons.playerBullets, this.boss, (a, b) => {
      const bullet = (a === this.boss ? b : a) as Phaser.Physics.Arcade.Image;
      if (!bullet.active || !this.boss?.alive) return;
      const dmg = (bullet as any).dmg ?? 1;
      const x = bullet.x, y = bullet.y;
      if ((bullet as any).isRocket) {
        bullet.destroy();
        // Shared explosion applies its area damage exactly once.
        this.weapons.explode(x, y, 96, 5, false); return;
      }
      this.boss.takeDamage(this.boss.phase === 2 && y < this.boss.y - 8 ? dmg * 2 : dmg);
      if (!(bullet as any).pierce) bullet.destroy();
    });
    this.time.addEvent({ delay: 7800, loop: true, callback: () => {
      if (!this.boss?.alive || this.finished || this.enemies.countActive(true) >= 9) return;
      this.spawnEnemyAt('rifle', Phaser.Math.Clamp(this.player.x - 210, WORLD_W - 960, WORLD_W - 300));
    } });
  }

  hurtPlayer() {
    if (this.finished || this.player.dead) return;
    if (this.player.hurt(this.time.now)) {
      this.player.killFx();
      this.onPlayerDown();
    }
  }

  onPlayerDown() {
    run.lives--;
    if (run.lives <= 0) this.time.delayedCall(1200, () => this.gameOver());
    else this.time.delayedCall(1400, () => {
      if (this.finished || !this.sys.isActive()) return;
      let desiredX = Math.max(65, this.player.x - 160);
      if (desiredX >= 1330 && desiredX <= 1470) desiredX = 1150;
      if (desiredX >= 2750 && desiredX <= 2900) desiredX = 2590;
      const safe = findSafeRespawnPoint(this, desiredX, { minX: 65 });
      this.player.respawn(safe.x, this.time.now, safe.y);
      this.player.invulnUntil = this.time.now + 2700;
    });
  }

  private gameOver() {
    if (this.finished) return;
    MUSIC.stop();
    this.registry.set('episode', 2);
    this.registry.set('gameover', true);
    this.registry.set('scoreBreakdown', null);
    this.registry.set('finalScore', run.score);
    recordBest();
    this.scene.start('Results');
  }

  private onVictory() {
    if (!this.finished || !this.boss || this.boss.alive) return;
    unlockEpisode3();
    MUSIC.stop();
    const br = finalizeEpisodeVictory(this, 2, Math.max(1, Math.round(this.activeMs / 1000)));
    this.hud.banner('ЭПИЗОД 2 ПРОЙДЕН!');
    this.hud.toast(`БОНУС ГЛАВЫ: +${br.clearBonus + br.livesBonus + br.timeBonus} (×${br.multiplier})`, 2600);
    this.time.delayedCall(2800, () => {
      if (!this.sys.isActive()) return;
      this.scene.start('Results');
    });
  }

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) this.togglePause();
    if (this.paused) return;
    if (!this.finished) this.activeMs += delta;
    this.player.update(time);
    this.traversal.update(time, delta, [this.player, ...(this.enemies.getChildren() as Enemy[])]);
    if (!this.player.dead && this.player.y > 625) {
      this.player.dead = true;
      this.player.killFx();
      this.onPlayerDown();
    }
    const interact = Phaser.Input.Keyboard.JustDown(this.interactKey) || tapEdge('justBoard');
    const usedBreaker = interact ? this.activateBreaker() : false;
    this.pickupSys.update(this.player, interact && !usedBreaker);
    const left = this.cameras.main.scrollX;
    this.enemies.children.each(obj => {
      const e = obj as Enemy;
      if (e.active && e.x > left - 100 && e.x < left + VIEW_W + 120) e.behavior(time, this.player);
      return true;
    });
    this.weapons.update(time);
    this.weapons.cleanupOffscreen(left);
    if (!this.finished && !this.player.dead) {
      for (const beat of this.beats) if (!beat.fired && this.player.x >= beat.x) {
        beat.fired = true; beat.action();
      }
    }
    const bounds = this.cameras.main.getBounds();
    const x = Phaser.Math.Clamp(this.player.x + 130, bounds.x + 430, bounds.right - 480);
    this.follow.setPosition(x, this.player.y - 45);
    this.backdrop.update(left, delta);
    if (this.boss?.alive) {
      confineHeroToArena(this, this.player);
      this.boss.updateBoss(time, this.player.x, this.player.y);
    }
    this.hud.update(time, this.player, this.tankSys);
  }

  private onTouchPause = () => this.togglePause();

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.physics.pause();
      this.hud.toast('ПАУЗА', 999999);
    } else {
      this.physics.resume();
      this.hud.toast('ПОЕХАЛИ!', 900);
    }
  }
}
