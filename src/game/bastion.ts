import Phaser from 'phaser';
import { beginOnlineRun } from './online-leaderboard';
import {
  VIEW_W, VIEW_H, WORLD_W, GROUND_Y, GRAVITY, run, diff,
  addScaledScore, finalizeEpisodeVictory, recordBest, unlockEpisode6, scorePopup,
} from './core';
import { makePlayerTextures, makeEnemyTextures, makeFxTextures, makeTankTextures } from './sprites';
import { makeMachineTextures, Machine, PropsSystem, FxSystem, spawnTurret } from './props';
import { PickupManager } from './pickups';
import { BastionBackdrop, makeBastionArt } from './bastion-art';
import { CitadelBoss } from './bastion-boss';
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

interface BastionBeat { x: number; fired: boolean; action: () => void }

/**
 * EPISODE 5 — БАСТИОН «СЕВЕР».
 * Polar radar fortress shielding the coordinates to Beacon-13's primeval source.
 * Features RS-7 tank assault courtyard, thermal heater relays, Sentinels & Citadel-9 boss.
 */
export class BastionScene extends Phaser.Scene {
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
  boss: CitadelBoss | null = null;
  finished = false;
  paused = false;
  private backdrop!: BastionBackdrop;
  private follow!: Phaser.GameObjects.Zone;
  traversal!: StageTraversal;
  pickupSys!: PickupManager;
  private beats: BastionBeat[] = [];
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private tankGrp: Phaser.Physics.Arcade.Group | null = null;
  bossEntered = false;
  heatersDisabled = 0;
  private heaters!: Phaser.Physics.Arcade.Group;
  private activeMs = 0;

  constructor() { super('Bastion'); }

  create() {
    try { this.createStage(); }
    catch (error: any) {
      (window as any).__RS_FATAL__ = String(error?.stack ?? error).slice(0, 800);
      console.error('[RUST SIGNAL] BastionScene create failed:', error);
      throw error;
    }
  }

  private createStage() {
    run.episode = 5;
    beginOnlineRun({ episode: 5, difficulty: run.difficulty, character: run.character });
    this.paused = false;
    this.heatersDisabled = 0;
    this.activeMs = 0;
    this.beats = [];
    this.machines = [];
    this.bossEntered = false;
    this.boss = null;
    this.finished = false;
    this.registry.set('episode', 5);
    this.registry.set('heatersDisabled', 0);
    this.registry.set('gameover', false);
    this.registry.set('scoreBreakdown', null);
    window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: true }));
    this.events.once('shutdown', () =>
      window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: false })));

    this.physics.world.gravity.y = GRAVITY;
    this.physics.world.setBounds(0, -350, WORLD_W, 1400);
    this.cameras.main.setBounds(0, -60, WORLD_W, VIEW_H + 200);
    this.cameras.main.fadeIn(600, 8, 16, 28);
    this.follow = this.add.zone(95, GROUND_Y - 50, 1, 1);
    this.cameras.main.startFollow(this.follow, true, 0.15, 0.1);
    this.cameras.main.setDeadzone(260, 95);

    makePlayerTextures(this);
    makeEnemyTextures(this);
    makeFxTextures(this);
    makeTankTextures(this);
    makeMachineTextures(this);
    ensureWarnTexture(this);
    makeBastionArt(this);

    this.backdrop = new BastionBackdrop(this);
    this.fx = new FxSystem(this);
    this.weapons = new WeaponsSystem(this);
    this.props = new PropsSystem(this);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.machineGrp = this.physics.add.group();
    this.tankGrp = this.physics.add.group();
    this.tankSys = new TankSystem(this);
    this.hud = new Hud(this);
    this.radio = new RadioSystem(this);

    this.player = new Player(this, 85, GROUND_Y - 55, run.character);
    this.player.invulnUntil = this.time.now + 1600;

    // Arctic ground & hardened steel fortifications (ballistic cover)
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
    const platTex = this.textures.exists('ep5_platform') ? 'ep5_platform' : 'bz_platform';
    for (const [x, y, w] of [
      [620, GROUND_Y - 32, 145],
      [1080, GROUND_Y - 32, 140],
      [1620, GROUND_Y - 32, 150],
      [2340, GROUND_Y - 32, 142],
      [2940, GROUND_Y - 32, 146],
      [3520, GROUND_Y - 32, 148],
      [4120, GROUND_Y - 32, 142],
      [4620, GROUND_Y - 32, 144],
    ] as const) {
      solid(x, y + 8, w, 16, raised);
      this.add.image(x, y + 8, platTex).setDisplaySize(w, 16).setDepth(19);
      markSolidPlatform(this, x, y + 8, w, 16);
    }

    this.physics.add.collider(this.player, ground);
    this.physics.add.collider(this.player, raised);
    this.physics.add.collider(this.enemies, ground);
    this.physics.add.collider(this.enemies, raised);
    this.physics.add.collider(this.tankDummyGroup(), ground);
    this.physics.add.collider(this.tankDummyGroup(), raised);
    this.physics.add.collider(this.weapons.grenades, ground);
    this.physics.add.collider(this.weapons.grenades, raised);
    makeBallisticCover(this, raised, this.weapons.playerBullets, this.weapons.enemyBullets);

    this.pickupSys = new PickupManager(this);

    // Multi-tier Arctic Bastion traversal decks, jump pads, lifts & ziplines
    this.traversal = new StageTraversal(this, 'bastion');
    this.traversal.addJumpPad(516, GROUND_Y + 35, -885);
    this.traversal.addOneWayDeck(560, GROUND_Y - 134, 340, 'РАДАРНЫЙ ЯРУС');
    this.traversal.addBonusCache(720, GROUND_Y - 134, 'mg');
    this.traversal.addZipLine(895, GROUND_Y - 134, 1195, GROUND_Y - 98);

    this.traversal.addJumpPad(1285, GROUND_Y + 35, -865);
    this.traversal.addOneWayDeck(1300, GROUND_Y - 122, 300, 'ПОСТ ОБОГРЕВА');
    this.traversal.addBonusCache(1480, GROUND_Y - 122, 'intel');

    this.traversal.addMovingLift(2540, GROUND_Y - 14, 2540, GROUND_Y - 126, 92, 3100);
    this.traversal.addOneWayDeck(2605, GROUND_Y - 126, 360, 'ЭСТАКАДА «СЕВЕР»');
    this.traversal.addBonusCache(2745, GROUND_Y - 126, 'shotgun');
    this.traversal.addZipLine(2960, GROUND_Y - 126, 3260, GROUND_Y - 62);

    this.traversal.addJumpPad(3416, GROUND_Y + 35, -885);
    this.traversal.addOneWayDeck(3480, GROUND_Y - 134, 360, 'КРИО-ГАЛЕРЕЯ');
    this.traversal.addBonusCache(3680, GROUND_Y - 134, 'laser');

    this.traversal.addJumpPad(4018, GROUND_Y + 35, -870);
    this.traversal.addOneWayDeck(4080, GROUND_Y - 124, 320, 'ПОДСТУП ЦИТАДЕЛИ');
    this.traversal.addBonusCache(4240, GROUND_Y - 124, 'life');

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

    this.physics.add.overlap(this.weapons.enemyBullets, this.tankDummyGroup(), (a, b) => {
      if (!this.tankSys.active) return;
      const bullet = (this.weapons.enemyBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      if (bullet?.active) bullet.destroy();
      this.tankSys.damageTank(1);
    });

    this.physics.add.overlap(this.player, this.enemies, (_p, eObj) => {
      const enemy = eObj as Enemy;
      if (!enemy.active || this.finished || this.player.inTank) return;
      if (this.player.rolling || this.time.now < this.player.invulnUntil) return;
      this.hurtPlayer();
    });

    // RS-7 Hammer tank waiting in snowstorm courtyard
    this.tankSys.spawnAt(1920);

    // Pickups, Props, Destructible Turrets & Thermal Relays
    this.pickupSys.add(760, GROUND_Y + 35, 'shotgun');
    this.pickupSys.add(1750, GROUND_Y + 35, 'mg');
    this.pickupSys.add(2720, GROUND_Y + 35, 'shotgun');
    this.pickupSys.add(3860, GROUND_Y + 35, 'laser');
    this.pickupSys.add(4530, GROUND_Y + 35, 'life');

    for (const bx of [840, 1480, 2190, 2830, 3660, 4280]) {
      this.props.barrel(bx, GROUND_Y + 35);
    }
    for (const tx of [1220, 2240, 3360, 4440]) {
      spawnTurret(this, tx, { surfaceY: GROUND_Y + 35 });
    }

    this.setupThermalHeaters();
    this.initBeats();

    this.pauseKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.input.keyboard!.on('keydown-ESC', this.togglePause, this);
    window.addEventListener('rs:touch-pause', this.onTouchPause);
    this.events.once('shutdown', () => {
      this.input.keyboard?.off('keydown-ESC', this.togglePause, this);
      window.removeEventListener('rs:touch-pause', this.onTouchPause);
      this.tankGrp = null;
    });

    MUSIC.play('level');
    this.time.delayedCall(600, () => {
      if (this.sys.isActive()) this.radio.say('ep5_intro');
    });
  }

  private setupThermalHeaters() {
    this.heaters = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const [hx, hy] of [
      [1415, GROUND_Y - 122],
      [2870, GROUND_Y + 35],
      [4205, GROUND_Y - 124],
    ] as const) {
      const clearX = hy > GROUND_Y
        ? findClearGroundX(this, hx, 24, GROUND_Y + 35, { objectHeight: 64, includeProps: true, includeMachines: true, includeTurrets: true, avoidPads: true })
        : hx;
      const relay = this.heaters.create(clearX, hy - 31, 'bz_heater_on') as Phaser.Physics.Arcade.Sprite;
      relay.setDepth(24);
      (relay.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setImmovable(true);
      (relay as any).hacked = false;
      const prompt = this.add.text(clearX, hy - 74, '[E] ОТКЛ. ТЕРМОКОНТУР', {
        fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold',
        color: '#88f4ff', backgroundColor: '#0c1522dd', padding: { x: 5, y: 2 },
      }).setOrigin(0.5).setDepth(75).setVisible(false);
      (relay as any).promptText = prompt;
      (relay as any).baseFloorY = hy;
    }
  }

  private sabotageNearbyHeater(): boolean {
    if (!this.heaters) return false;
    for (const obj of this.heaters.getChildren()) {
      const r = obj as Phaser.Physics.Arcade.Sprite;
      const prompt = (r as any).promptText as Phaser.GameObjects.Text | undefined;
      if (!r.active || (r as any).hacked) continue;
      if (Math.abs(this.player.x - r.x) < 58 && Math.abs(this.player.y - r.y) < 76) {
        (r as any).hacked = true;
        r.setTexture('bz_heater_off');
        prompt?.setVisible(false);
        this.heatersDisabled++;
        this.registry.set('heatersDisabled', this.heatersDisabled);
        SFX.play('pickup', 0.9);
        this.fx.boom(r.x, r.y, 0.55);
        const pts = addScaledScore(this, 450);
        scorePopup(this, r.x, r.y - 34, `+${pts} ТЕРМОКОНТУР (${this.heatersDisabled}/3)`, '#8ef6ff');
        if (this.heatersDisabled === 2) {
          this.radio.say('ep5_heaters');
          this.hud.toast('ДВЕ ПЕЧКИ ВЫРУБЛЕНЫ — КРИО-ЩИТ ЦИТАДЕЛИ ПРОСЕЛ!', 3100);
        }
        return true;
      }
    }
    return false;
  }

  private updateHeaterPrompts() {
    if (!this.heaters) return;
    for (const obj of this.heaters.getChildren()) {
      const r = obj as Phaser.Physics.Arcade.Sprite;
      const prompt = (r as any).promptText as Phaser.GameObjects.Text | undefined;
      if (!prompt?.active) continue;
      const near = r.active && !(r as any).hacked
        && Math.abs(this.player.x - r.x) < 62 && Math.abs(this.player.y - r.y) < 78;
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

  private tankDummyGroup() {
    if (!this.tankGrp || !(this.tankGrp as any).children) this.tankGrp = this.physics.add.group();
    return this.tankGrp;
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
    once(110, () => this.hud.toast('Вейс: глуши термоконтуры [E] на вышках — собьём щиты шагохода.', 3200));
    once(320, () => { this.spawnWave(560, ['rifle', 'sentinel']); });
    once(860, () => { this.hud.banner('ПЕРИМЕТР БАСТИОНА «СЕВЕР»'); this.spawnWave(1060, ['gren', 'sentinel', 'drone']); });
    once(1560, () => { this.spawnWave(1810, ['sentinel', 'heavy', 'rifle']); });
    once(1950, () => this.hud.toast('РС-7 «Кувалда» на площадке [E] — пригодится у цитадели.', 2600));
    once(2480, () => { this.spawnWave(2740, ['sentinel', 'gren']); this.traversal.spawnDropIn('sentinel', 2860, '▼ ДЕСАНТ'); });
    once(3160, () => { this.hud.banner('КРИО-ШЛЮЗ ВТОРОГО УРОВНЯ'); this.spawnWave(3410, ['heavy', 'sentinel', 'drone']); });
    once(3850, () => { this.spawnWave(4110, ['officer', 'sentinel', 'gren']); });
    once(4460, () => { this.spawnWave(4650, ['sentinel', 'heavy']); });
    once(5020, () => this.enterCitadelArena());
  }

  enterCitadelArena() {
    if (this.bossEntered) return;
    this.bossEntered = true;
    this.hud.banner('ШАГОХОД «ЦИТАДЕЛЬ-9» — ОБОРОНА БАСТИОНА');
    MUSIC.play('boss');
    this.radio.say('ep5_boss');
    this.boss = new CitadelBoss(this, Math.min(WORLD_W - 285, this.player.x + 425));
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
    if (this.player.inTank) { this.tankSys.damageTank(1); return; }
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
    this.registry.set('episode', 5);
    this.registry.set('scoreBreakdown', null);
    this.registry.set('finalScore', run.score);
    recordBest();
    this.scene.start('Results');
  }

  private onVictory() {
    if (!this.finished || !this.boss || this.boss.alive) return;
    MUSIC.stop();
    unlockEpisode6();
    const br = finalizeEpisodeVictory(this, 5, Math.max(1, Math.round(this.activeMs / 1000)));
    this.radio.say('ep5_dead');
    this.hud.banner('ЭПИЗОД 5 ПРОЙДЕН!');
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
    if (!this.player.dead && this.player.y > 690) {
      this.player.dead = true;
      this.player.killFx();
      this.onPlayerDown();
    }

    const grp = this.tankDummyGroup();
    if (this.tankSys.tank && !grp.contains(this.tankSys.tank)) grp.add(this.tankSys.tank);

    const interact = Phaser.Input.Keyboard.JustDown(this.interactKey) || tapEdge('justBoard');
    const usedPickup = !this.player.inTank && this.pickupSys.update(this.player, interact);
    const usedHeater = !this.player.inTank && interact && !usedPickup ? this.sabotageNearbyHeater() : false;
    let tankUsed = false;
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
      if (interact) {
        this.tankSys.eject(this.player);
        tankUsed = true;
      }
    } else {
      if (this.tankSys.tank) {
        this.tankSys.update(time, this.player, { left: false, right: false, up: false, fire: false, jump: false });
      }
      if (interact && !usedPickup && !usedHeater) {
        tankUsed = this.tankSys.board(this.player);
      }
    }
    this.updateHeaterPrompts();
    void tankUsed;

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
