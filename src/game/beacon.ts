import Phaser from 'phaser';
import { beginOnlineRun } from './online-leaderboard';
import {
  VIEW_W, VIEW_H, WORLD_W, GROUND_Y, GRAVITY, run,
  addScaledScore, finalizeEpisodeVictory, recordBest, scorePopup,
} from './core';
import { makePlayerTextures, makeEnemyTextures, makeFxTextures, makeTankTextures } from './sprites';
import { makeMachineTextures, Machine, PropsSystem, FxSystem, spawnTurret } from './props';
import { PickupManager } from './pickups';
import { BeaconBackdrop, makeBeaconArt } from './beacon-art';
import { SourceBoss } from './beacon-boss';
import { StageTraversal } from './traversal';
import { Player } from './player';
import { WeaponsSystem } from './weapons';
import {
  markSolidPlatform, markGround, safeEnemySpawnX, findClearGroundX, findSafeRespawnPoint,
  makeBallisticCover, lockBossArena, confineHeroToArena,
} from './world-rules';
import { Enemy, type EnemyKind, damageEnemy } from './enemies';
import { TankSystem } from './boss';
import { Hud, ensureWarnTexture } from '../ui/hud';
import { RadioSystem } from './radio';
import { SFX, MUSIC } from './audio';
import { touch, tapEdge } from '../ui/touch';

interface BeaconBeat { x: number; fired: boolean; action: () => void }

/**
 * EPISODE 6 — ЯДРО «МАЯК-13» (Grand Finale).
 * Descent into the subterranean Signal Spire beneath Beacon-13 to cut all 3
 * harmonic resonance anchors and shut down Prime Transmitter «Alpha-13».
 */
export class BeaconScene extends Phaser.Scene {
  player!: Player;
  weapons!: WeaponsSystem;
  fx!: FxSystem;
  props!: PropsSystem;
  hud!: Hud;
  radio!: RadioSystem;
  enemies!: Phaser.Physics.Arcade.Group;
  machines: Machine[] = [];
  machineGrp!: Phaser.Physics.Arcade.Group;
  tankSys!: TankSystem;
  boss: SourceBoss | null = null;
  finished = false;
  paused = false;
  private backdrop!: BeaconBackdrop;
  private follow!: Phaser.GameObjects.Zone;
  traversal!: StageTraversal;
  pickupSys!: PickupManager;
  private beats: BeaconBeat[] = [];
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  bossEntered = false;
  anchorsDisabled = 0;
  private anchors!: Phaser.Physics.Arcade.Group;
  private activeMs = 0;

  constructor() { super('Beacon'); }

  create() {
    try { this.createStage(); }
    catch (error: any) {
      (window as any).__RS_FATAL__ = String(error?.stack ?? error).slice(0, 800);
      console.error('[RUST SIGNAL] BeaconScene create failed:', error);
      throw error;
    }
  }

  private createStage() {
    run.episode = 6;
    beginOnlineRun({ episode: 6, difficulty: run.difficulty, character: run.character });
    this.paused = false;
    this.anchorsDisabled = 0;
    this.activeMs = 0;
    this.beats = [];
    this.machines = [];
    this.bossEntered = false;
    this.boss = null;
    this.finished = false;
    this.registry.set('episode', 6);
    this.registry.set('anchorsDisabled', 0);
    this.registry.set('campaignComplete', false);
    this.registry.set('gameover', false);
    this.registry.set('scoreBreakdown', null);
    window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: true }));
    this.events.once('shutdown', () =>
      window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: false })));

    this.physics.world.gravity.y = GRAVITY;
    this.physics.world.setBounds(0, -350, WORLD_W, 1400);
    this.cameras.main.setBounds(0, -60, WORLD_W, VIEW_H + 200);
    this.cameras.main.fadeIn(650, 6, 10, 22);
    this.follow = this.add.zone(95, GROUND_Y - 50, 1, 1);
    this.cameras.main.startFollow(this.follow, true, 0.15, 0.1);
    this.cameras.main.setDeadzone(260, 95);

    makePlayerTextures(this);
    makeEnemyTextures(this);
    makeFxTextures(this);
    makeTankTextures(this);
    makeMachineTextures(this);
    ensureWarnTexture(this);
    makeBeaconArt(this);

    this.backdrop = new BeaconBackdrop(this);
    this.fx = new FxSystem(this);
    this.weapons = new WeaponsSystem(this);
    this.props = new PropsSystem(this);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.machineGrp = this.physics.add.group();
    this.tankSys = new TankSystem(this);
    this.hud = new Hud(this);
    this.radio = new RadioSystem(this);

    this.player = new Player(this, 85, GROUND_Y - 55, run.character);
    this.player.invulnUntil = this.time.now + 1600;

    const ground = this.physics.add.staticGroup();
    const solid = (x: number, y: number, w: number, h: number, group = ground) => {
      const o = this.physics.add.staticImage(x, y, '__rect').setVisible(false);
      o.setDisplaySize(w, h);
      o.refreshBody();
      group.add(o);
      return o;
    };
    solid(WORLD_W / 2, GROUND_Y + 65, WORLD_W, 60);
    markGround(this);

    const raised = this.physics.add.staticGroup();
    const platTex = this.textures.exists('ep6_platform') ? 'ep6_platform' : 'sp_platform';
    for (const [x, y, w] of [
      [660, GROUND_Y - 28, 145],
      [1120, GROUND_Y - 28, 142],
      [1690, GROUND_Y - 28, 148],
      [2290, GROUND_Y - 28, 144],
      [2920, GROUND_Y - 28, 148],
      [3500, GROUND_Y - 28, 145],
      [4100, GROUND_Y - 28, 146],
      [4640, GROUND_Y - 28, 142],
    ] as const) {
      solid(x, y + 12, w, 24, raised);
      this.add.image(x, y + 13, platTex).setDisplaySize(w, 26).setDepth(19);
      markSolidPlatform(this, x, y + 12, w, 24);
    }

    this.physics.add.collider(this.player, ground);
    this.physics.add.collider(this.player, raised);
    this.physics.add.collider(this.enemies, ground);
    this.physics.add.collider(this.enemies, raised);
    this.physics.add.collider(this.weapons.grenades, ground);
    this.physics.add.collider(this.weapons.grenades, raised);
    makeBallisticCover(this, raised, this.weapons.playerBullets, this.weapons.enemyBullets);

    this.pickupSys = new PickupManager(this);

    // Multi-tier Signal Spire vertical traversal chambers
    this.traversal = new StageTraversal(this, 'beacon');
    this.traversal.addJumpPad(554, GROUND_Y + 35, -885);
    this.traversal.addOneWayDeck(600, GROUND_Y - 134, 340, 'ЯРУС ЯКОРЯ');
    this.traversal.addBonusCache(740, GROUND_Y - 134, 'mg');
    this.traversal.addZipLine(935, GROUND_Y - 134, 1235, GROUND_Y - 100);

    this.traversal.addJumpPad(1315, GROUND_Y + 35, -875);
    this.traversal.addOneWayDeck(1305, GROUND_Y - 128, 300, 'КАМЕРА РЕЗОНАНСА');
    this.traversal.addBonusCache(1505, GROUND_Y - 128, 'intel');

    this.traversal.addMovingLift(2460, GROUND_Y - 14, 2460, GROUND_Y - 128, 92, 3000);
    this.traversal.addOneWayDeck(2525, GROUND_Y - 128, 380, 'МОСТИК «АЛЬФА»');
    this.traversal.addBonusCache(2640, GROUND_Y - 128, 'laser');
    this.traversal.addHangingCargo(2840, GROUND_Y - 128, 58);

    this.traversal.addJumpPad(3396, GROUND_Y + 35, -890);
    this.traversal.addOneWayDeck(3460, GROUND_Y - 136, 360, 'НЕФ ШПИЛЯ');
    this.traversal.addBonusCache(3640, GROUND_Y - 136, 'mg');
    this.traversal.addZipLine(3815, GROUND_Y - 136, 4065, GROUND_Y - 102);

    this.traversal.addJumpPad(4215, GROUND_Y + 35, -875);
    this.traversal.addOneWayDeck(4120, GROUND_Y - 128, 330, 'ПРЕДДВЕРИЕ ЯДРА');
    this.traversal.addBonusCache(4320, GROUND_Y - 128, 'life');

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
        bullet.destroy();
        this.weapons.explode(x, y, 94, 5, false);
        return;
      }
      damageEnemy(this, enemy, (bullet as any).dmg ?? 1);
      if (!(bullet as any).pierce) bullet.destroy();
    });

    this.physics.add.overlap(this.weapons.playerBullets, this.machineGrp, (a, b) => {
      const bullet = (this.weapons.playerBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const m = (bullet === a ? b : a) as Machine;
      if (!bullet.active || !m.active) return;
      if ((bullet as any).isRocket) {
        const x = bullet.x, y = bullet.y;
        bullet.destroy();
        this.weapons.explode(x, y, 95, 5, false);
        return;
      }
      m.takeDamage((bullet as any).dmg ?? 1);
      if (!(bullet as any).pierce) bullet.destroy();
    });

    this.physics.add.overlap(this.weapons.enemyBullets, this.player, (a, b) => {
      const bullet = (this.weapons.enemyBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      if (!bullet.active || this.finished) return;
      if (this.player.inTank) {
        bullet.destroy();
        this.tankSys.damageTank(1);
        return;
      }
      if (this.player.rolling || this.time.now < this.player.invulnUntil) return;
      bullet.destroy();
      this.hurtPlayer();
    });

    this.physics.add.overlap(this.player, this.enemies, (_p, eObj) => {
      const enemy = eObj as Enemy;
      if (!enemy.active || this.finished || this.player.inTank) return;
      if (this.player.rolling || this.time.now < this.player.invulnUntil) return;
      this.hurtPlayer();
    });

    // Weapons & Supplies across Spire hall
    this.pickupSys.add(760, GROUND_Y + 35, 'shotgun');
    this.pickupSys.add(1820, GROUND_Y + 35, 'mg');
    this.pickupSys.add(2710, GROUND_Y + 35, 'laser');
    this.pickupSys.add(3760, GROUND_Y + 35, 'shotgun');
    this.pickupSys.add(4520, GROUND_Y + 35, 'life');

    for (const bx of [890, 1590, 2140, 2980, 3690, 4340]) {
      this.props.barrel(bx, GROUND_Y + 35);
    }
    for (const tx of [1250, 2190, 3290, 4430]) {
      spawnTurret(this, tx, { surfaceY: GROUND_Y + 35, hp: 7 });
    }

    this.setupSignalAnchors();
    this.initBeats();

    this.pauseKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.input.keyboard!.on('keydown-ESC', this.togglePause, this);
    window.addEventListener('rs:touch-pause', this.onTouchPause);
    this.events.once('shutdown', () => {
      this.input.keyboard?.off('keydown-ESC', this.togglePause, this);
      window.removeEventListener('rs:touch-pause', this.onTouchPause);
    });

    MUSIC.play('level');
    this.time.delayedCall(600, () => {
      if (this.sys.isActive()) this.radio.say('ep6_intro');
    });
  }

  private setupSignalAnchors() {
    this.anchors = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const [ax, ay] of [
      [1370, GROUND_Y - 128],
      [2785, GROUND_Y + 35],
      [4175, GROUND_Y - 128],
    ] as const) {
      const clearX = ay > GROUND_Y
        ? findClearGroundX(this, ax, 24, GROUND_Y + 35, { objectHeight: 68, includeProps: true, includeMachines: true, includeTurrets: true, avoidPads: true })
        : ax;
      const node = this.anchors.create(clearX, ay - 34, 'sp_anchor_on') as Phaser.Physics.Arcade.Sprite;
      node.setDepth(24);
      (node.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setImmovable(true);
      (node as any).hacked = false;
      const prompt = this.add.text(clearX, ay - 78, '[E] ОТКЛ. УЗЕЛ «АЛЬФЫ»', {
        fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold',
        color: '#9cf6ff', backgroundColor: '#091220dd', padding: { x: 5, y: 2 },
      }).setOrigin(0.5).setDepth(75).setVisible(false);
      (node as any).promptText = prompt;
    }
  }

  private disableNearbyAnchor(): boolean {
    if (!this.anchors) return false;
    for (const obj of this.anchors.getChildren()) {
      const r = obj as Phaser.Physics.Arcade.Sprite;
      const prompt = (r as any).promptText as Phaser.GameObjects.Text | undefined;
      if (!r.active || (r as any).hacked) continue;
      if (Math.abs(this.player.x - r.x) < 60 && Math.abs(this.player.y - r.y) < 80) {
        (r as any).hacked = true;
        r.setTexture('sp_anchor_off');
        prompt?.setVisible(false);
        this.anchorsDisabled++;
        this.registry.set('anchorsDisabled', this.anchorsDisabled);
        SFX.play('pickup', 0.9);
        this.fx.signalGlitch?.(r.x, r.y);
        const pts = addScaledScore(this, 500);
        scorePopup(this, r.x, r.y - 34, `+${pts} УЗЕЛ ОТКЛЮЧЁН (${this.anchorsDisabled}/3)`, '#8ef6ff');
        if (this.anchorsDisabled === 1) this.radio.say('ep6_anchor');
        if (this.anchorsDisabled === 2) {
          this.hud.toast('ДВА УЗЛА СНЯТЫ — КУПОЛ «АЛЬФЫ-13» ДРОЖИТ!', 3100);
        }
        return true;
      }
    }
    return false;
  }

  private updateAnchorPrompts() {
    if (!this.anchors) return;
    for (const obj of this.anchors.getChildren()) {
      const r = obj as Phaser.Physics.Arcade.Sprite;
      const prompt = (r as any).promptText as Phaser.GameObjects.Text | undefined;
      if (!prompt?.active) continue;
      const near = r.active && !(r as any).hacked
        && Math.abs(this.player.x - r.x) < 64 && Math.abs(this.player.y - r.y) < 82;
      prompt.setVisible(near);
    }
  }

  spawnEnemyAt(kind: EnemyKind, x: number, y = GROUND_Y - 26) {
    if (!this.sys.isActive() || this.finished) return;
    const sx = safeEnemySpawnX(this, x, kind === 'spider' ? GROUND_Y : y);
    const key = kind === 'sentinel' ? (this.textures.exists('e_sentinel') ? 'e_sentinel' : 'e_heavy')
      : kind === 'spider' ? 'e_spider'
        : kind === 'drone' ? 'e_drone'
          : kind === 'heavy' ? 'e_heavy'
            : kind === 'gren' ? 'e_gren'
              : kind === 'officer' ? 'e_officer' : 'e_rifle';
    const enemy = new Enemy(this, sx, y, key);
    this.enemies.add(enemy);
    enemy.init(kind, sx, y);
  }

  private spawnWave(startX: number, kinds: EnemyKind[], staggerMs = 360) {
    kinds.forEach((kind, i) => {
      const fire = () => {
        if (!this.sys.isActive() || this.finished) return;
        this.spawnEnemyAt(kind, startX + i * 76);
      };
      if (staggerMs > 0 && i > 0) this.time.delayedCall(i * staggerMs, fire);
      else fire();
    });
  }

  requestReinforcement(x: number) {
    this.spawnEnemyAt('sentinel', x);
  }

  nearestDamaged(fromX: number): Machine | null {
    let best: Machine | null = null, bestD = 9999;
    for (const m of this.machines) {
      if (!m.active || m.hp >= m.hpMax) continue;
      const d = Math.abs(m.x - fromX);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  private initBeats() {
    const once = (x: number, action: () => void) => this.beats.push({ x, action, fired: false });
    once(110, () => this.hud.toast('Вейс: вырубай узлы питания [E] по пути, иначе до ядра не достать.', 3200));
    once(320, () => { this.spawnWave(560, ['sentinel', 'rifle']); });
    once(880, () => { this.hud.banner('НИЖНИЙ ЯРУС «МАЯКА-13»'); this.spawnWave(1090, ['gren', 'sentinel', 'spider']); });
    once(1620, () => { this.spawnWave(1870, ['sentinel', 'heavy', 'drone']); });
    once(2380, () => { this.spawnWave(2640, ['sentinel', 'spider', 'gren']); });
    once(3060, () => { this.hud.banner('ЗАЛ РЕЗОНАНСА'); this.spawnWave(3310, ['heavy', 'sentinel', 'drone']); });
    once(3780, () => { this.spawnWave(4040, ['officer', 'sentinel', 'gren']); this.traversal.spawnDropIn('sentinel', 3990, '▼ ОХРАНА ЯДРА'); });
    once(4460, () => { this.spawnWave(4660, ['sentinel', 'heavy']); });
    once(5020, () => this.enterSourceArena());
  }

  enterSourceArena() {
    if (this.bossEntered) return;
    this.bossEntered = true;
    this.hud.banner('ПРА-ПЕРЕДАТЧИК «АЛЬФА-13»');
    MUSIC.play('boss');
    this.radio.say('ep6_boss');
    this.boss = new SourceBoss(this, Math.min(WORLD_W - 285, this.player.x + 425));
    lockBossArena(this, this.player, this.boss);
    this.hud.showBoss(true);

    this.physics.add.overlap(this.weapons.playerBullets, this.boss, (a, b) => {
      const bullet = (a === this.boss ? b : a) as Phaser.Physics.Arcade.Image;
      if (!bullet.active || !this.boss?.alive) return;
      const dmg = (bullet as any).dmg ?? 1;
      const bx = bullet.x, by = bullet.y;
      if ((bullet as any).isRocket) {
        bullet.destroy();
        this.weapons.explode(bx, by, 95, 5, false);
        return;
      }
      this.boss.takeDamage(dmg * (this.boss.bulletDamageScale?.() ?? 1));
      if (!(bullet as any).pierce) bullet.destroy();
    });
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
      const safe = findSafeRespawnPoint(this, Math.max(65, this.player.x - 160), { minX: 65 });
      this.player.respawn(safe.x, this.time.now, safe.y);
      this.player.invulnUntil = this.time.now + 2700;
    });
  }

  private gameOver() {
    if (this.finished) return;
    MUSIC.stop();
    this.registry.set('gameover', true);
    this.registry.set('episode', 6);
    this.registry.set('campaignComplete', false);
    this.registry.set('scoreBreakdown', null);
    this.registry.set('finalScore', run.score);
    recordBest();
    this.scene.start('Results');
  }

  private onVictory() {
    if (!this.finished || !this.boss || this.boss.alive) return;
    MUSIC.stop();
    this.registry.set('campaignComplete', true);
    const br = finalizeEpisodeVictory(this, 6, Math.max(1, Math.round(this.activeMs / 1000)));
    this.radio.say('campaign_finale');
    this.hud.banner('МАЯК-13 ОБЕСТОЧЕН — ЭФИР ОЧИЩЕН!');
    this.hud.toast(`ФИНАЛЬНЫЙ БОНУС: +${br.clearBonus + br.livesBonus + br.timeBonus} (×${br.multiplier})`, 3000);
    this.time.delayedCall(3300, () => {
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
    if (!this.player.dead && this.player.y > 690) {
      this.player.dead = true;
      this.player.killFx();
      this.onPlayerDown();
    }

    const interact = Phaser.Input.Keyboard.JustDown(this.interactKey) || tapEdge('justBoard');
    const usedPickup = this.pickupSys.update(this.player, interact);
    if (interact && !usedPickup) this.disableNearbyAnchor();
    this.updateAnchorPrompts();

    const left = this.cameras.main.scrollX;
    this.enemies.children.each((obj) => {
      const e = obj as Enemy;
      if (e.active && e.x > left - 100 && e.x < left + VIEW_W + 120) e.behavior(time, this.player);
      return true;
    });

    this.weapons.update(time);
    this.weapons.cleanupOffscreen(left);
    if (!this.finished && !this.player.dead) {
      for (const beat of this.beats) {
        if (!beat.fired && this.player.x >= beat.x) {
          beat.fired = true;
          beat.action();
        }
      }
    }

    const bounds = this.cameras.main.getBounds();
    const cx = Phaser.Math.Clamp(this.player.x + 130, bounds.x + 430, bounds.right - 480);
    this.follow.setPosition(cx, this.player.y - 45);
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
