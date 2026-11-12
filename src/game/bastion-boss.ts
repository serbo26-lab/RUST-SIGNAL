import Phaser from 'phaser';
import { diff, GROUND_Y, WORLD_W, rand, shake, addScaledScore, scorePopup } from './core';
import { SFX } from './audio';
import {
  BossShieldNodes,
  launchBossInterruptTarget,
  triggerArenaElevationSweep,
} from './boss-mechanics';

/**
 * «Цитадель-9» — Episode 5 Polar Armored Walker Boss.
 * Two combat phases + Crimson Overdrive:
 *  - Coolant shield nodes protect the hull until shot down
 *  - Launches interceptable cryo-warheads that can be shot down onto the walker
 *  - Telegraphed frost-beam elevation sweeps across lower & catwalk tiers
 */
export class CitadelBoss extends Phaser.Physics.Arcade.Sprite {
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

  constructor(scene: Phaser.Scene, x = WORLD_W - 290) {
    const usesPack = scene.textures.exists('ep5_boss_citadel');
    const initTex = usesPack ? 'ep5_boss_citadel' : '__rect';
    super(scene, x, usesPack ? GROUND_Y - 94 : GROUND_Y - 88, initTex, usesPack && scene.textures.get('ep5_boss_citadel').has('f0') ? 'f0' : undefined);
    this.usesPackArt = usesPack;
    this.anchorX = x;
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false).setImmovable(true);
    if (usesPack) {
      body.setSize(172, 218).setOffset(29, 34);
      this.setDepth(67);
    } else {
      this.setDisplaySize(164, 184).setTint(0x7bc8f2).setDepth(67);
      body.setSize(164, 184);
    }

    this.hpMax = Math.round(86 * diff().hpMul);
    this.hp = this.hpMax;
    this.nextAttack = scene.time.now + 1350;

    if (scene.add?.circle) {
      this.coreGlow = scene.add.circle(x - 16, this.y - 8, 72, 0x62e5ff, 0.14)
        .setDepth(66).setBlendMode(Phaser.BlendModes.ADD);
      const bypassed = ((scene as any).heatersDisabled ?? 0) >= 2;
      this.shieldRing = scene.add.circle(x - 8, this.y - 6, 118, 0x76e9ff, 0.06)
        .setStrokeStyle(2.5, 0x76f2ff, 0.75).setDepth(68)
        .setBlendMode(Phaser.BlendModes.ADD).setVisible(!bypassed);
      this.weakTag = scene.add.text(x - 14, this.y - 126, 'ПЕРЕГРЕВ ЦИТАДЕЛИ x2.2!', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#ffb090', stroke: '#141a24', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(95).setVisible(false);

      this.once('destroy', () => {
        this.coreGlow?.destroy();
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
    scene.traversal.addJumpPad(Math.max(minL + 26, this.anchorX - 380), GROUND_Y + 35, -865);
    scene.traversal.addOneWayDeck(Math.max(minL + 84, this.anchorX - 348), GROUND_Y - 124, 224, 'ГАЛЕРЕЯ ОГНЯ');

    this.nodes = new BossShieldNodes(scene, this, () => {
      if (!this.alive) return;
      this.exposedUntil = Math.max(this.exposedUntil, scene.time.now + 4500);
      this.nextAttack = Math.max(this.nextAttack, scene.time.now + 950);
      scene.fx?.bigBoom?.(this.x - 10, this.y - 20, 0.72);
      scorePopup(scene, this.x - 16, this.y - 126, 'ЩИТЫ СБИТЫ! x2.2', '#8ef4ff');
      this.takeDamage(8);
    });
    this.spawnCoolantNodes(4);
  }

  private spawnCoolantNodes(nodeHp = 4) {
    this.nodes?.spawnWave([
      {
        offsetX: -120, offsetY: -62,
        orbitRadius: 34, orbitSpeed: 1.15, orbitPhase: 0,
        hp: nodeHp, color: 0x18425e, trimColor: 0x76efff,
        label: 'СБЕЙ КРИО-КОНТУРЫ!',
      },
      {
        offsetX: -120, offsetY: 26,
        orbitRadius: 34, orbitSpeed: 1.15, orbitPhase: Math.PI,
        hp: nodeHp, color: 0x18425e, trimColor: 0x76efff,
        label: 'СБЕЙ КРИО-КОНТУРЫ!',
      },
    ]);
  }

  bulletDamageScale(): number {
    return (this.nodes?.activeCount ?? 0) > 0 ? 0.55 : 1;
  }

  takeDamage(amount: number) {
    if (!this.alive) return;
    const S = this.scene as any;
    const bypassed = (S.heatersDisabled ?? 0) >= 2;
    this.shieldRing?.setVisible(!bypassed);
    const now = this.scene.time?.now ?? 0;
    const crit = (now < this.exposedUntil || this.overdrive) ? 2.2 : 1;
    const mul = bypassed ? 1 : 0.72;
    this.hp = Math.max(0, this.hp - amount * mul * crit);

    if (this.usesPackArt) {
      this.setTint(now < this.exposedUntil ? 0xffcaa8 : 0xdff8ff);
      this.scene.time?.delayedCall?.(55, () => {
        if (this.alive) this.clearTint();
      });
    } else {
      this.setTint(0xffffff);
      this.scene.time?.delayedCall?.(55, () => {
        if (this.alive) this.setTint(this.overdrive ? 0xff6e62 : 0x7bc8f2);
      });
    }

    if (this.hp <= this.hpMax * 0.55 && this.phase === 1) {
      this.phase = 2;
      SFX.play('boss_roar', 0.9);
      shake(this.scene, 8, 280);
      S.hud?.banner?.('ЦИТАДЕЛЬ-9 — ВТОРАЯ ФАЗА: КРИО-БУРАН!');
      if (this.usesPackArt && this.scene.textures.get('ep5_boss_citadel').has('f1')) {
        this.setFrame('f1');
      }
      this.spawnCoolantNodes(5);
    }

    if (this.hp <= this.hpMax * 0.28 && !this.overdrive) {
      this.overdrive = true;
      this.exposedUntil = Math.max(this.exposedUntil, now + 5200);
      this.coreGlow?.setFillStyle(0xff5248, 0.24);
      if (this.usesPackArt && this.scene.textures.get('ep5_boss_citadel').has('f2')) {
        this.setFrame('f2');
      }
      S.hud?.toast?.('РЕАКТОР ЦИТАДЕЛИ КИПИТ — ДОБИВАЙ!', 2500);
    }

    if (this.hp <= 0) this.die();
  }

  updateBoss(time: number, px: number, py: number) {
    if (!this.alive) return;
    this.nodes?.update(time);
    const sway = Math.sin(time / 720) * 26;
    this.x = Phaser.Math.Clamp(this.anchorX + sway, this.anchorX - 42, this.anchorX + 24);
    (this.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();

    const exposed = time < this.exposedUntil;
    this.weakTag?.setVisible(exposed).setPosition(this.x - 14, this.y - 126);
    this.coreGlow?.setPosition(this.x - 16, this.y - 8)
      .setScale(1 + 0.14 * Math.sin(time * 0.008));
    this.shieldRing?.setPosition(this.x - 8, this.y - 6)
      .setScale(1 + 0.04 * Math.sin(time * 0.01));

    if (this.phase === 2 && !this.overdrive && this.nodes?.canRespawn(time)) {
      this.spawnCoolantNodes(4);
    }

    if (time < this.nextAttack) return;
    const rate = diff().rateMul * (this.phase === 2 ? 0.78 : 1) * (this.overdrive ? 0.85 : 1);
    this.nextAttack = time + rand(1250, 1750) * rate;
    this.attacks++;

    const S = this.scene as any;
    const pattern = this.attacks % 3;
    if (pattern === 1) {
      // Salvo + Interceptable cryo-warhead!
      if (this.usesPackArt && this.scene.textures.get('ep5_boss_citadel').has('f1')) {
        this.setFrame('f1');
        this.scene.time.delayedCall(380, () => {
          if (this.alive && !this.overdrive && this.scene.textures.get('ep5_boss_citadel').has('f0')) {
            this.setFrame('f0');
          }
        });
      }
      for (let i = 0; i < (this.phase === 2 ? 4 : 3); i++) {
        this.scene.time.delayedCall(i * 150, () => {
          if (!this.alive || !this.scene.sys.isActive()) return;
          S.weapons?.enemyAimedShot?.(this.x - 74, this.y - 26 + i * 10, px, py - 8, 355);
          S.fx?.enemyMuzzle?.(this.x - 74, this.y - 26, -1);
        });
      }
      if (this.attacks % 6 === 1 || this.phase === 2) {
        const dropX = Phaser.Math.Clamp(px, WORLD_W - 860, this.x - 110);
        launchBossInterruptTarget(this.scene, {
          startX: this.x - 58,
          startY: this.y - 72,
          targetX: dropX,
          targetY: GROUND_Y + 8,
          durationMs: 2150,
          hp: 3,
          texKey: 'bullet_e',
          tint: 0x7ef5ff,
          label: 'СБЕЙ РАКЕТУ!',
          onIntercepted: (ix, iy) => {
            if (!this.alive) return;
            S.fx?.bigBoom?.(ix, iy, 0.85);
            shake(this.scene, 7, 240);
            this.exposedUntil = Math.max(this.exposedUntil, (this.scene.time?.now ?? 0) + 3300);
            scorePopup(this.scene, ix, iy - 16, 'ПЕРЕХВАТ! ПЕРЕГРЕВ x2.2!', '#92f8ff');
            this.takeDamage(6);
          },
          onImpact: (ix, iy) => {
            if (!this.alive || !S?.sys?.isActive?.() || S.finished) return;
            S.fx?.boom?.(ix, iy, 1.35);
            SFX.play('boom_big', 0.8);
            const p = S.player;
            if (p?.active && !p.dead && Math.hypot(p.x - ix, p.y - iy) < 88) {
              if (p.inTank) S.tankSys?.damageTank?.(2);
              else S.hurtPlayer?.();
            }
          },
        });
      }
    } else if (pattern === 2) {
      // Elevation sweep beam! Forces jumping or changing decks.
      const upperTier = this.phase === 2 && this.attacks % 2 === 0;
      triggerArenaElevationSweep(this.scene, {
        xStart: this.x - 70,
        xEnd: Math.max(WORLD_W - 910, this.anchorX - 440),
        yCenter: upperTier ? GROUND_Y - 134 : GROUND_Y - 12,
        halfHeight: 28,
        warnMs: 920,
        sweepMs: 760,
        color: upperTier ? 0xff705c : 0x5ee5ff,
        label: upperTier ? '▲ ОБСТРЕЛ ГАЛЕРЕИ! ВНИЗ (S+SPACE)!' : '▼ КРИО-ЛУЧ ВНИЗ! ПРЫГАЙ / НА МОСТИК!',
        isAliveFn: () => this.alive,
      });
    } else {
      // Twin spread cryo-mortar shots + light reinforcement in phase 2
      for (const dy of [-26, 8]) {
        S.weapons?.enemyAimedShot?.(this.x - 68, this.y + dy, px, py - 10, 385);
      }
      S.fx?.enemyMuzzle?.(this.x - 68, this.y - 10, -1);
      if (this.phase === 2 && (S.enemies?.countActive?.(true) ?? 9) < 3) {
        S.spawnEnemyAt?.('drone', Phaser.Math.Clamp(this.x - 220, WORLD_W - 880, this.x - 130));
      }
    }
  }

  private die() {
    if (!this.alive) return;
    this.alive = false;
    this.nodes?.clearNodes();
    SFX.play('boom_big', 1);
    shake(this.scene, 14, 700);
    const S = this.scene as any;
    const bx = this.x, by = this.y;
    const pts = addScaledScore(S, 4200);
    scorePopup(S, bx - 20, by - 90, `+${pts} ЦИТАДЕЛЬ УНИЧТОЖЕНА!`, '#ffd46b');

    for (let i = 0; i < 6; i++) {
      S.time.delayedCall(i * 150, () => {
        if (!S?.sys?.isActive?.()) return;
        S.fx?.bigBoom?.(bx + rand(-65, 65), by + rand(-70, 50), 1.3);
        SFX.play('boom_small', 0.85);
      });
    }
    this.setTint(0xff8050);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y + 18,
      duration: 980,
      ease: 'Quad.easeIn',
      onComplete: () => {
        S.finished = true;
        S.onVictory?.();
        this.destroy();
      },
    });
  }
}
