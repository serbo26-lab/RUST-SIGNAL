import Phaser from 'phaser';
import { diff, GROUND_Y, WORLD_W, rand, shake, addScaledScore, scorePopup } from './core';
import { SFX } from './audio';
import { BossShieldNodes, triggerArenaElevationSweep } from './boss-mechanics';

/** REACTOR ZERO: multi-stage final boss featuring orbiting shield pylons,
 * dual-elevation EMP sweeps, vertical laser strikes, and core overload bursts. */
export class FacilityCore extends Phaser.Physics.Arcade.Sprite {
  hpMax: number;
  hp: number;
  phase: 1 | 2 = 1;
  overdrive = false;
  exposedUntil = 0;
  alive = true;
  attacks = 0;
  private nextAttack: number;
  private readonly usesPackArt: boolean;
  private readonly anchorX: number;
  private shieldRing: Phaser.GameObjects.Arc | null = null;
  private coreGlow: Phaser.GameObjects.Arc | null = null;
  private weakTag: Phaser.GameObjects.Text | null = null;
  private nodes: BossShieldNodes | null = null;

  constructor(scene: Phaser.Scene, x = WORLD_W - 300) {
    const usesPack = scene.textures.exists('ep4_boss_core');
    super(scene, x, usesPack ? GROUND_Y - 105 : GROUND_Y - 89, 'fz_core1');
    this.usesPackArt = usesPack;
    this.anchorX = x;
    scene.add.existing(this); scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false).setImmovable(true);
    if (usesPack) {
      body.setSize(176, 238).setOffset(27, 32);
      this.setDepth(67);
    } else {
      body.setSize(228, 162).setOffset(34, 48);
      this.setDepth(67).setScale(0.94);
    }
    this.hpMax = Math.round(72 * diff().hpMul);
    this.hp = this.hpMax;
    this.nextAttack = scene.time.now + 1450;
    if (scene.add?.circle) {
      this.coreGlow = scene.add.circle(x - 10, this.y - 10, 76, 0x4bf5ec, 0.16)
        .setDepth(66).setBlendMode(Phaser.BlendModes.ADD);
      const bypass = ((scene as any).terminalsHacked ?? 0) >= 2;
      this.shieldRing = scene.add.circle(x - 6, this.y - 6, 114, 0x52dce8, 0.05)
        .setStrokeStyle(2.5, 0x62f5ff, 0.72).setDepth(68).setBlendMode(Phaser.BlendModes.ADD).setVisible(!bypass);
      this.weakTag = scene.add.text(x - 10, this.y - 125, 'ПЕРЕГРУЗКА ЯДРА x2.2!', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#ff9ec2', stroke: '#160d1c', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(95).setVisible(false);
      this.once('destroy', () => {
        this.coreGlow?.destroy(); this.shieldRing?.destroy();
        this.weakTag?.destroy(); this.nodes?.clearNodes();
      });
    }
    this.initArena(scene);
  }

  private initArena(scene: any) {
    if (!scene?.traversal?.addOneWayDeck) return;
    const minL = Math.max(WORLD_W - 920, this.anchorX - 420);
    scene.traversal.addJumpPad(Math.max(minL + 26, this.anchorX - 385), GROUND_Y + 35, -865);
    scene.traversal.addOneWayDeck(Math.max(minL + 80, this.anchorX - 355), GROUND_Y - 122, 225, 'ГАЛЕРЕЯ РЕАКТОРА');

    this.nodes = new BossShieldNodes(scene, this, () => {
      if (!this.alive) return;
      this.exposedUntil = Math.max(this.exposedUntil, scene.time.now + 4500);
      this.nextAttack = Math.max(this.nextAttack, scene.time.now + 950);
      sGlitch(scene, this.x, this.y);
      scorePopup(scene, this.x - 15, this.y - 125, 'ПИЛОНЫ СБИТЫ! x2.2', '#8ef4ff');
      this.takeDamage(9);
    });
    this.spawnPylons(4);
  }

  private spawnPylons(pylonHp = 4) {
    this.nodes?.spawnWave([
      { offsetX: -36, offsetY: -12, orbitRadius: 96, orbitSpeed: 1.45, orbitPhase: 0, hp: pylonHp, color: 0x1b4560, trimColor: 0x4fe8ff, label: 'СБЕЙ ОРБИТ. ПИЛОНЫ!' },
      { offsetX: -36, offsetY: -12, orbitRadius: 96, orbitSpeed: 1.45, orbitPhase: Math.PI, hp: pylonHp, color: 0x1b4560, trimColor: 0x4fe8ff, label: 'СБЕЙ ОРБИТ. ПИЛОНЫ!' },
    ]);
  }

  bulletDamageScale(): number {
    return (this.nodes?.activeCount ?? 0) > 0 ? 0.5 : 1;
  }

  takeDamage(amount: number) {
    if (!this.alive) return;
    const S = this.scene as any;
    // No soft-lock: even without terminals, damage is reduced but never zero.
    const bypass = (S.terminalsHacked ?? 0) >= 2;
    this.shieldRing?.setVisible(!bypass);
    const now = this.scene.time?.now ?? 0;
    const crit = (now < this.exposedUntil || this.overdrive) ? 2.2 : 1;
    this.hp = Math.max(0, this.hp - amount * (bypass ? 1 : .3) * crit);
    S.fx?.impact?.(this.x + rand(-100, 70), this.y + rand(-50, 40), 1, true);
    this.setTintFill(crit > 1 ? 0xffa8d2 : 0xd4f9fc);
    this.scene.time.delayedCall(70, () => { if (this.active) this.clearTint(); });
    if (this.hp <= 0) { this.defeat(); return; }
    if (this.phase === 1 && this.hp <= this.hpMax * .48) {
      this.phase = 2;
      this.setTexture('fz_core2');
      this.coreGlow?.setFillStyle(0xff528e, 0.25);
      this.nextAttack = this.scene.time.now + 1800;
      S.hud?.banner?.('ПРОТОКОЛ НУЛЬ: ВТОРАЯ ФАЗА');
      sGlitch(S, this.x, this.y);
      S.fx?.debris?.(this.x, this.y, 18, [0x6efde5, 0xf86b9f, 0x8ea6b0]);
      shake(this.scene, 320, .015);
      SFX.play('signal');
      this.spawnPylons(5);
    }
    if (this.phase === 2 && !this.overdrive && this.hp <= this.hpMax * 0.25) {
      this.overdrive = true;
      this.exposedUntil = now + 99999;
      S.hud?.banner?.('РЕАКТОР «НУЛЬ»: ПОТЕРЯ КОНТРОЛЯ!');
      S.hud?.toast?.('Броня реактора сорвана — жми в самое ядро!', 3000);
      SFX.play('boss_roar', 0.95);
    }
  }

  updateBoss(time: number, playerX: number, playerY: number) {
    this.nodes?.update(time);
    const S = this.scene as any;
    const exposed = time < this.exposedUntil || this.overdrive;
    if (this.weakTag?.active) {
      this.weakTag.setVisible(exposed && this.alive).setPosition(this.x - 10, this.y - 125);
    }
    if (this.phase === 2 && this.nodes?.canRespawn(time) && !this.overdrive) {
      this.spawnPylons(5);
    }
    if (this.coreGlow?.active) {
      this.coreGlow.setPosition(this.x - 10, this.y - 10)
        .setScale((exposed ? 1.15 : 0.92) + 0.14 * Math.sin(time * (this.phase === 2 ? 0.011 : 0.005)));
    }
    if (this.shieldRing?.active && this.shieldRing.visible) {
      const bypass = (S.terminalsHacked ?? 0) >= 2;
      if (bypass) this.shieldRing.setVisible(false);
      else this.shieldRing.setScale(0.96 + 0.04 * Math.sin(time * 0.007));
    }
    if (!this.alive || time < this.nextAttack) return;
    if (!S.sys.isActive() || S.finished) return;

    this.attacks++;
    const rate = this.overdrive ? 0.76 : 1;
    this.nextAttack = time + (this.phase === 1 ? 1820 : 1280) * diff().rateMul * rate;
    const mod = this.attacks % 4;
    if (mod === 0) {
      const minL = Math.max(WORLD_W - 920, this.anchorX - 500);
      triggerArenaElevationSweep(S, {
        xStart: this.x - 110,
        xEnd: minL,
        yCenter: GROUND_Y + 6,
        halfHeight: 28,
        warnMs: 900,
        sweepMs: 680,
        color: 0x4fe8ff,
        label: '⚡ НИЖНИЙ ЭМИ — НА ГАЛЕРЕЮ!',
        isAliveFn: () => this.alive,
      });
    } else if (mod === 1 && this.phase === 2) {
      const minL = Math.max(WORLD_W - 920, this.anchorX - 500);
      triggerArenaElevationSweep(S, {
        xStart: this.x - 110,
        xEnd: minL,
        yCenter: GROUND_Y - 140,
        halfHeight: 34,
        warnMs: 900,
        sweepMs: 700,
        color: 0xff4f94,
        label: '⚠ ВЕРХНИЙ СКАНЕР — ВНИЗ (S+SPACE)!',
        isAliveFn: () => this.alive,
      });
    } else if (mod === 2) {
      S.warnLaser(Phaser.Math.Clamp(playerX, WORLD_W - 950, WORLD_W - 100),
        this.phase === 2 ? 760 : 1020);
      if (this.overdrive) {
        S.warnLaser(Phaser.Math.Clamp(playerX + 120, WORLD_W - 920, WORLD_W - 110), 920);
      }
    } else {
      const count = this.phase === 1 ? 3 : 5;
      const sx = this.x - 118, sy = this.y - 39;
      S.fx?.enemyMuzzle?.(sx, sy, -1);
      for (let i = 0; i < count; i++) this.scene.time.delayedCall(i * 155, () => {
        if (!this.alive || !S.sys.isActive()) return;
        S.weapons.enemyAimedShot(sx, sy, S.player.x, S.player.y + (i % 2 ? -16 : 0),
          this.phase === 1 ? 355 : 470);
      });
    }
    void playerY;
  }

  private defeat() {
    if (!this.alive) return;
    this.alive = false;
    const S = this.scene as any;
    S.finished = true;
    this.nodes?.clearNodes();
    this.weakTag?.setVisible(false);
    this.coreGlow?.setVisible(false);
    this.shieldRing?.setVisible(false);
    this.setTexture('fz_core3');
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    S.hud?.showBoss?.(false);
    const bossPts = addScaledScore(S, 3000);
    scorePopup(S, this.x - 35, this.y - 125, `+${bossPts}`, '#ffd24a');
    SFX.play('boom_big'); shake(this.scene, 480, .023);
    for (let i = 0; i < 9; i++) this.scene.time.delayedCall(i * 130, () => {
      if (!this.scene.sys.isActive()) return;
      S.fx?.bigBoom?.(this.x + rand(-100, 95), this.y + rand(-72, 60), 1.3);
      S.fx?.debris?.(this.x, this.y, 7, [0x4cf3e5, 0xd57099, 0xb9a69d]);
    });
    this.scene.time.delayedCall(1950, () => {
      if (this.scene.sys.isActive()) this.scene.events.emit('rs:facility-boss-dead');
    });
  }
}

function sGlitch(S: any, x: number, y: number) {
  S?.fx?.signalGlitch?.(x, y);
}
