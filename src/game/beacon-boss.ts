import Phaser from 'phaser';
import { diff, GROUND_Y, WORLD_W, rand, shake, addScaledScore, scorePopup } from './core';
import { SFX } from './audio';
import {
  BossShieldNodes,
  launchBossInterruptTarget,
  triggerArenaElevationSweep,
} from './boss-mechanics';

/**
 * «Пра-передатчик «Альфа-13»» — Final Campaign Boss (Episode 6).
 * Multi-tier finale battle beneath Beacon-13:
 *  - 3 Orbiting Resonance Amplifier Pylons protect the Eye
 *  - Launches interceptable Resonance Orbs that overload Alpha-13 on destruction
 *  - Dual-tier cross-elevation harmonic sweeps across ground & mezzanine
 */
export class SourceBoss extends Phaser.Physics.Arcade.Sprite {
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
  private eyeGlow: Phaser.GameObjects.Arc | null = null;
  private weakTag: Phaser.GameObjects.Text | null = null;
  private nodes: BossShieldNodes | null = null;

  constructor(scene: Phaser.Scene, x = WORLD_W - 290) {
    const usesPack = scene.textures.exists('ep6_boss_source');
    const initTex = usesPack ? 'ep6_boss_source' : '__rect';
    super(scene, x, usesPack ? GROUND_Y - 108 : GROUND_Y - 96, initTex, usesPack && scene.textures.get('ep6_boss_source').has('f0') ? 'f0' : undefined);
    this.usesPackArt = usesPack;
    this.anchorX = x;
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false).setImmovable(true);
    if (usesPack) {
      body.setSize(172, 244).setOffset(29, 32);
      this.setDepth(67);
    } else {
      this.setDisplaySize(166, 206).setTint(0x62f5eb).setDepth(67);
      body.setSize(166, 206);
    }

    this.hpMax = Math.round(98 * diff().hpMul);
    this.hp = this.hpMax;
    this.nextAttack = scene.time.now + 1350;

    if (scene.add?.circle) {
      this.eyeGlow = scene.add.circle(x, this.y - 16, 78, 0x5ef5eb, 0.16)
        .setDepth(66).setBlendMode(Phaser.BlendModes.ADD);
      const weakened = ((scene as any).anchorsDisabled ?? 0) >= 2;
      this.shieldRing = scene.add.circle(x, this.y - 10, 122, 0x52e8ff, 0.06)
        .setStrokeStyle(3, 0x5ef5eb, 0.78).setDepth(68)
        .setBlendMode(Phaser.BlendModes.ADD).setVisible(!weakened);
      this.weakTag = scene.add.text(x, this.y - 138, 'РАЗГЕРМЕТИЗАЦИЯ ЯДРА x2.3!', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#ff9ee6', stroke: '#100c1e', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(95).setVisible(false);

      this.once('destroy', () => {
        this.eyeGlow?.destroy();
        this.shieldRing?.destroy();
        this.weakTag?.destroy();
        this.nodes?.clearNodes();
      });
    }
    this.initArena(scene);
  }

  private initArena(scene: any) {
    if (!scene?.traversal?.addOneWayDeck) return;
    const minL = Math.max(WORLD_W - 920, this.anchorX - 420);
    scene.traversal.addJumpPad(Math.max(minL + 26, this.anchorX - 385), GROUND_Y + 35, -875);
    scene.traversal.addOneWayDeck(Math.max(minL + 84, this.anchorX - 350), GROUND_Y - 128, 228, 'НЕФ «АЛЬФЫ»');

    this.nodes = new BossShieldNodes(scene, this, () => {
      if (!this.alive) return;
      this.exposedUntil = Math.max(this.exposedUntil, scene.time.now + 4800);
      this.nextAttack = Math.max(this.nextAttack, scene.time.now + 950);
      scene.fx?.signalGlitch?.(this.x, this.y - 12);
      scene.fx?.bigBoom?.(this.x - 8, this.y - 18, 0.9);
      scorePopup(scene, this.x - 10, this.y - 134, 'РЕЗОНАТОРЫ СБИТЫ! x2.3', '#96fff6');
      this.takeDamage(10);
    });
    this.spawnPylons(4);
  }

  private spawnPylons(pylonHp = 4) {
    const label = 'СБЕЙ РЕЗОНАТОРНЫЕ ПИЛОНЫ!';
    this.nodes?.spawnWave([
      { offsetX: -32, offsetY: -18, orbitRadius: 102, orbitSpeed: 1.5, orbitPhase: 0, hp: pylonHp, color: 0x10384e, trimColor: 0x5ef5eb, label },
      { offsetX: -32, offsetY: -18, orbitRadius: 102, orbitSpeed: 1.5, orbitPhase: (Math.PI * 2) / 3, hp: pylonHp, color: 0x261646, trimColor: 0xff5ce8, label },
      { offsetX: -32, offsetY: -18, orbitRadius: 102, orbitSpeed: 1.5, orbitPhase: (Math.PI * 4) / 3, hp: pylonHp, color: 0x10384e, trimColor: 0x5ef5eb, label },
    ]);
  }

  bulletDamageScale(): number {
    return (this.nodes?.activeCount ?? 0) > 0 ? 0.5 : 1;
  }

  takeDamage(amount: number) {
    if (!this.alive) return;
    const S = this.scene as any;
    const weakened = (S.anchorsDisabled ?? 0) >= 2;
    this.shieldRing?.setVisible(!weakened);
    const now = this.scene.time?.now ?? 0;
    const crit = (now < this.exposedUntil || this.overdrive) ? 2.3 : 1;
    const mul = weakened ? 1 : 0.7;
    this.hp = Math.max(0, this.hp - amount * mul * crit);

    if (this.usesPackArt) {
      this.setTint(now < this.exposedUntil ? 0xffb8f0 : 0xdffeff);
      this.scene.time?.delayedCall?.(55, () => {
        if (this.alive) this.clearTint();
      });
    } else {
      this.setTint(0xffffff);
      this.scene.time?.delayedCall?.(55, () => {
        if (this.alive) this.setTint(this.overdrive ? 0xff5ce8 : 0x62f5eb);
      });
    }

    if (this.hp <= this.hpMax * 0.56 && this.phase === 1) {
      this.phase = 2;
      SFX.play('boss_roar', 0.95);
      shake(this.scene, 9, 300);
      S.hud?.banner?.('АЛЬФА-13 — РЕЗОНАНС ВТОРОЙ ЧАСТОТЫ!');
      if (this.usesPackArt && this.scene.textures.get('ep6_boss_source').has('f1')) {
        this.setFrame('f1');
      }
      this.spawnPylons(5);
    }

    if (this.hp <= this.hpMax * 0.28 && !this.overdrive) {
      this.overdrive = true;
      this.exposedUntil = Math.max(this.exposedUntil, now + 6000);
      this.eyeGlow?.setFillStyle(0xff42b8, 0.28);
      if (this.usesPackArt && this.scene.textures.get('ep6_boss_source').has('f2')) {
        this.setFrame('f2');
      }
      S.hud?.toast?.('КУПОЛ СОРВАН — БЕЙ В САМОЕ ЯДРО!', 2700);
    }

    if (this.hp <= 0) this.die();
  }

  updateBoss(time: number, px: number, py: number) {
    if (!this.alive) return;
    this.nodes?.update(time);
    this.y = (this.usesPackArt ? GROUND_Y - 108 : GROUND_Y - 96) + Math.sin(time / 620) * 14;
    (this.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();

    const exposed = time < this.exposedUntil;
    this.weakTag?.setVisible(exposed).setPosition(this.x, this.y - 138);
    this.eyeGlow?.setPosition(this.x, this.y - 16)
      .setScale(1 + 0.16 * Math.sin(time * 0.009));
    this.shieldRing?.setPosition(this.x, this.y - 10)
      .setScale(1 + 0.05 * Math.sin(time * 0.011));

    if (this.phase === 2 && !this.overdrive && this.nodes?.canRespawn(time)) {
      this.spawnPylons(4);
    }

    if (time < this.nextAttack) return;
    const rate = diff().rateMul * (this.phase === 2 ? 0.76 : 1) * (this.overdrive ? 0.84 : 1);
    this.nextAttack = time + rand(1200, 1700) * rate;
    this.attacks++;

    const S = this.scene as any;
    const pattern = this.attacks % 3;
    if (pattern === 1) {
      // Spiral Eye Pulse + Interceptable Resonance Sphere!
      if (this.usesPackArt && this.scene.textures.get('ep6_boss_source').has('f1') && !this.overdrive) {
        this.setFrame('f1');
        this.scene.time.delayedCall(420, () => {
          if (this.alive && !this.overdrive && this.scene.textures.get('ep6_boss_source').has('f0')) {
            this.setFrame('f0');
          }
        });
      }
      for (let i = 0; i < (this.phase === 2 ? 4 : 3); i++) {
        this.scene.time.delayedCall(i * 140, () => {
          if (!this.alive || !this.scene.sys.isActive()) return;
          S.weapons?.enemyAimedShot?.(this.x - 56, this.y - 34 + i * 16, px, py - 8, 375);
          S.fx?.enemyMuzzle?.(this.x - 56, this.y - 24, -1);
        });
      }
      if (this.attacks % 6 === 1 || this.phase === 2) {
        const dropX = Phaser.Math.Clamp(px, WORLD_W - 860, this.x - 115);
        launchBossInterruptTarget(this.scene, {
          startX: this.x - 36,
          startY: this.y - 68,
          targetX: dropX,
          targetY: GROUND_Y + 6,
          durationMs: 2200,
          hp: 4,
          texKey: 'bullet_e',
          tint: 0xff5ce8,
          label: 'СБЕЙ СФЕРУ РЕЗОНАНСА!',
          onIntercepted: (ix, iy) => {
            if (!this.alive) return;
            S.fx?.signalGlitch?.(ix, iy);
            S.fx?.bigBoom?.(ix, iy, 0.95);
            shake(this.scene, 8, 260);
            this.exposedUntil = Math.max(this.exposedUntil, (this.scene.time?.now ?? 0) + 3600);
            scorePopup(this.scene, ix, iy - 16, 'ОБРАТНЫЙ ИМПУЛЬС x2.3!', '#ff9cf0');
            this.takeDamage(8);
          },
          onImpact: (ix, iy) => {
            if (!this.alive || !S?.sys?.isActive?.() || S.finished) return;
            S.fx?.boom?.(ix, iy, 1.45);
            SFX.play('boom_big', 0.85);
            const p = S.player;
            if (p?.active && !p.dead && Math.hypot(p.x - ix, p.y - iy) < 92) {
              S.hurtPlayer?.();
            }
          },
        });
      }
    } else if (pattern === 2) {
      // Elevation Harmonic Sweeps (alternates low/high, cross-tier in phase 2!)
      const upperTier = this.phase === 2 && this.attacks % 2 === 0;
      triggerArenaElevationSweep(this.scene, {
        xStart: this.x - 62,
        xEnd: Math.max(WORLD_W - 910, this.anchorX - 440),
        yCenter: upperTier ? GROUND_Y - 134 : GROUND_Y - 12,
        halfHeight: 28,
        warnMs: 920,
        sweepMs: 740,
        color: upperTier ? 0xff4fd8 : 0x5ef5eb,
        label: upperTier ? '▲ ВОЛНА НА ГАЛЕРЕЮ! ПРЫГАЙ ВНИЗ!' : '▼ ГАРМОНИКА ПО ПОЛУ! НА МОСТИК!',
        isAliveFn: () => this.alive,
      });
    } else {
      // Harmonic barrage + capped Sentinel/Drone reinforcement
      for (const dy of [-44, -10, 22]) {
        S.weapons?.enemyAimedShot?.(this.x - 60, this.y + dy, px, py - 8, 395);
      }
      S.fx?.enemyMuzzle?.(this.x - 60, this.y - 10, -1);
      if (this.phase === 2 && (S.enemies?.countActive?.(true) ?? 9) < 3) {
        S.spawnEnemyAt?.(this.overdrive ? 'sentinel' : 'drone',
          Phaser.Math.Clamp(this.x - 240, WORLD_W - 880, this.x - 130));
      }
    }
  }

  private die() {
    if (!this.alive) return;
    this.alive = false;
    this.nodes?.clearNodes();
    SFX.play('boom_big', 1);
    shake(this.scene, 16, 850);
    const S = this.scene as any;
    const bx = this.x, by = this.y;
    const pts = addScaledScore(S, 5500);
    scorePopup(S, bx - 10, by - 100, `+${pts} АЛЬФА-13 ОТКЛЮЧЕНА!`, '#8ef6ff');

    for (let i = 0; i < 8; i++) {
      S.time.delayedCall(i * 150, () => {
        if (!S?.sys?.isActive?.()) return;
        S.fx?.signalGlitch?.(bx + rand(-55, 55), by + rand(-80, 60));
        S.fx?.bigBoom?.(bx + rand(-65, 65), by + rand(-80, 60), 1.35);
        SFX.play('boom_small', 0.9);
      });
    }
    this.setTint(0xff9cf2);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scaleX: 1.06,
      scaleY: 0.92,
      duration: 1200,
      ease: 'Quad.easeIn',
      onComplete: () => {
        S.finished = true;
        S.onVictory?.();
        this.destroy();
      },
    });
  }
}
