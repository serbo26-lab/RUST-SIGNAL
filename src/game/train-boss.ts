import Phaser from 'phaser';
import { GROUND_Y, WORLD_W, diff, shake, rand, addScaledScore, scorePopup } from './core';
import { SFX } from './audio';
import { launchBossInterruptTarget, triggerArenaElevationSweep } from './boss-mechanics';

/** Armored locomotive no. 7 — a multi-stage dynamic episode-2 boss with rail rams,
 * destructible fuel carts, steam sweeps, and furnace overdrive. */
export class TrainBoss extends Phaser.Physics.Arcade.Sprite {
  hpMax: number;
  hp: number;
  phase: 1 | 2 = 1;
  overdrive = false;
  exposedUntil = 0;
  alive = true;
  private nextAttack = 0;
  private attackCount = 0;
  private readonly usesPackArt: boolean;
  private readonly anchorX: number;
  private ramming = false;
  private headlight: Phaser.GameObjects.Triangle | null = null;
  private weakTag: Phaser.GameObjects.Text | null = null;
  private steamAt = 0;

  constructor(scene: Phaser.Scene, x = WORLD_W - 300) {
    const usesPack = scene.textures.exists('ep2_boss_loco');
    super(scene, x, usesPack ? GROUND_Y - 63 : GROUND_Y - 38, 'tr_engine1');
    this.usesPackArt = usesPack;
    this.anchorX = x;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false).setImmovable(true);
    if (usesPack) {
      body.setSize(250, 154).setOffset(30, 32);
      this.setDepth(65);
    } else {
      body.setSize(245, 136).setOffset(34, 70);
      this.setDepth(65).setScale(0.94);
    }
    this.hpMax = Math.max(20, Math.round(60 * diff().hpMul));
    this.hp = this.hpMax;
    this.nextAttack = scene.time.now + 1300;
    if (scene.add?.triangle) {
      this.headlight = scene.add.triangle(x - 135, this.y + 6, 0, 0, -290, -45, -290, 58, 0xff7b5a, 0.16)
        .setOrigin(0, 0).setDepth(64).setBlendMode(Phaser.BlendModes.ADD);
      this.weakTag = scene.add.text(x - 30, this.y - 105, 'ТОПКА ОТКРЫТА x2!', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#ffe57a', stroke: '#131820', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(95).setVisible(false);
      this.once('destroy', () => { this.headlight?.destroy(); this.weakTag?.destroy(); });
    }
    this.initArena(scene);
  }

  private initArena(scene: any) {
    if (!scene?.traversal?.addOneWayDeck) return;
    const minL = Math.max(WORLD_W - 920, this.anchorX - 420);
    scene.traversal.addJumpPad(Math.max(minL + 28, this.anchorX - 385), GROUND_Y + 35, -840);
    scene.traversal.addOneWayDeck(Math.max(minL + 75, this.anchorX - 355), GROUND_Y - 102, 195, 'МОСТИК СЦЕПКИ');
  }

  triggerOverheat(bonusDmg: number, durationMs = 3800) {
    if (!this.alive) return;
    const S = this.scene as any;
    this.exposedUntil = Math.max(this.exposedUntil, S.time.now + durationMs);
    this.nextAttack = Math.max(this.nextAttack, S.time.now + 750);
    S.fx?.signalGlitch?.(this.x - 40, this.y - 35);
    scorePopup(S, this.x - 50, this.y - 110, 'КОТЁЛ ПЕРЕГРЕТ x2!', '#ffe57a');
    this.takeDamage(bonusDmg);
  }

  takeDamage(amount: number) {
    if (!this.active || !this.alive) return;
    const now = this.scene.time?.now ?? 0;
    const crit = (now < this.exposedUntil || this.overdrive) ? 2 : 1;
    this.hp = Math.max(0, this.hp - amount * crit);
    const S = this.scene as any;
    S.fx?.impact?.(this.x + rand(-105, -20), this.y + rand(-40, 40), -1, true);
    this.setTintFill(crit > 1 ? 0xffe878 : 0xffffff);
    this.scene.time.delayedCall(65, () => { if (this.active) this.clearTint(); });
    if (this.hp <= 0) {
      this.defeat();
      return;
    }
    if (this.phase === 1 && this.hp <= this.hpMax * 0.47) {
      this.phase = 2;
      this.setTexture('tr_engine2');
      this.headlight?.setFillStyle(0x52f2e8, 0.24);
      this.nextAttack = this.scene.time.now + 1900;
      S.hud?.banner?.('БРОНЕПОЕЗД ТРАНСФОРМИРУЕТСЯ!');
      S.fx?.signalGlitch?.(this.x - 40, this.y - 40);
      S.fx?.debris?.(this.x - 70, this.y - 30, 21);
      SFX.play('signal');
      shake(this.scene, 340, 0.016);
      this.launchMineCart();
    }
    if (this.phase === 2 && !this.overdrive && this.hp <= this.hpMax * 0.25) {
      this.overdrive = true;
      this.exposedUntil = now + 99999;
      S.hud?.banner?.('ЛОКОМОТИВ: ФОРСАЖ КОТЛА!');
      S.hud?.toast?.('Реактор топки перегружен — добивай с мостика!', 3000);
      SFX.play('boss_roar', 0.9);
    }
  }

  updateBoss(time: number, playerX: number, playerY: number) {
    const S = this.scene as any;
    if (this.alive && S.sys?.isActive() && time - this.steamAt > 260) {
      this.steamAt = time;
      S.fx?.smoke?.(this.x + 12, this.y - 84, this.phase === 2 ? 0.95 : 0.7);
      if (this.phase === 2 && Math.random() < (this.overdrive ? 0.65 : 0.45)) {
        S.fx?.sparkTrail?.(this.x - 58 + rand(-25, 25), this.y - 10, this.overdrive ? 0xff9f40 : 0x52f2e8, 3);
      }
    }
    if (this.headlight?.active) {
      this.headlight.setPosition(this.x - 135, this.y + 6)
        .setAlpha(0.14 + 0.06 * Math.sin(time * 0.009));
    }
    const exposed = time < this.exposedUntil || this.overdrive;
    if (this.weakTag?.active) {
      this.weakTag.setVisible(exposed && this.alive).setPosition(this.x - 30, this.y - 105);
    }
    if (!this.alive || this.ramming || time < this.nextAttack) return;
    if (!S.sys.isActive() || S.finished) return;

    this.attackCount++;
    const rate = this.overdrive ? 0.75 : 1;
    this.nextAttack = time + (this.phase === 1 ? 1850 : 1400) * diff().rateMul * rate;
    const step = this.attackCount % 5;

    if (step === 0) {
      this.ramCharge();
    } else if (step === 1) {
      this.steamSweep();
    } else if (step === 2) {
      this.launchMineCart();
    } else if (step === 3 || (this.phase === 2 && step === 4 && Math.random() < 0.5)) {
      this.telegraphedShell(playerX);
    } else {
      const x = this.x - 122, y = this.y - 29;
      S.fx?.enemyMuzzle?.(x, y, -1);
      for (let i = 0; i < (this.phase === 2 ? 5 : 3); i++) {
        S.time.delayedCall(i * 155, () => {
          if (!this.alive || !S.sys.isActive() || S.finished) return;
          S.weapons.enemyAimedShot(
            this.x - 122, this.y - 32,
            S.player.x, S.player.y - (i % 2) * 14,
            this.phase === 2 ? 460 : 370,
          );
        });
      }
    }
    void playerY;
  }

  private ramCharge() {
    const S = this.scene as any;
    this.ramming = true;
    const minX = Math.max(WORLD_W - 640, this.anchorX - 245);
    const lane = this.scene.add.rectangle((minX + this.x) / 2, GROUND_Y + 8, this.anchorX - minX + 90, 62, 0xff5a48, 0.16)
      .setStrokeStyle(1.5, 0xff7055, 0.8).setDepth(92);
    const cue = this.scene.add.text(this.x - 150, GROUND_Y - 36, '◀◀ ТАРАН ПО РЕЛЬСАМ — ПРЫГАЙ!', {
      fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold',
      color: '#ffcf88', stroke: '#191015', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(95);
    this.scene.tweens.add({ targets: [lane, cue], alpha: 0.12, yoyo: true, repeat: 4, duration: 90 });
    SFX.play('boss_roar', 0.8);

    this.scene.time.delayedCall(820, () => {
      if (lane.active) lane.destroy();
      if (cue.active) cue.destroy();
      if (!this.alive || !S.sys?.isActive() || S.finished) { this.ramming = false; return; }

      let hitPlayer = false;
      this.scene.tweens.add({
        targets: this,
        x: minX,
        duration: 620,
        ease: 'Quad.easeIn',
        onUpdate: () => {
          if (!this.alive || hitPlayer || S.finished) return;
          (this.body as Phaser.Physics.Arcade.Body)?.updateFromGameObject?.();
          const p = S.player;
          if (p?.active && !p.dead && !p.rolling && Math.abs(p.x - this.x) < 128 && Math.abs(p.y - this.y) < 88) {
            hitPlayer = true;
            if (p.hurt?.(S.time.now)) { p.killFx?.(); S.onPlayerDown?.(); }
          }
        },
        onComplete: () => {
          SFX.play('boom_big', 0.7);
          shake(this.scene, 200, 0.01);
          S.fx?.debris?.(this.x - 110, GROUND_Y + 18, 10, [0x7e8d9c, 0xffaa55, 0x35404d]);
          this.scene.tweens.add({
            targets: this,
            x: this.anchorX,
            duration: 900,
            ease: 'Sine.easeOut',
            onUpdate: () => { (this.body as Phaser.Physics.Arcade.Body)?.updateFromGameObject?.(); },
            onComplete: () => { this.ramming = false; },
          });
        },
      });
    });
  }

  private steamSweep() {
    const S = this.scene as any;
    const minL = Math.max(WORLD_W - 920, this.anchorX - 500);
    triggerArenaElevationSweep(S, {
      xStart: this.x - 110,
      xEnd: minL,
      yCenter: GROUND_Y + 6,
      halfHeight: 28,
      warnMs: 880,
      sweepMs: 700,
      color: 0xbef5ff,
      label: '! СБРОС ПАРА — НА ВЕРХНИЙ МОСТИК!',
      isAliveFn: () => this.alive,
    });
  }

  private launchMineCart() {
    const S = this.scene as any;
    const targetX = Math.max(WORLD_W - 860, (S.player?.x ?? this.x - 360));
    launchBossInterruptTarget(S, {
      startX: this.x - 125,
      startY: GROUND_Y + 12,
      targetX,
      targetY: GROUND_Y + 12,
      durationMs: 2200,
      hp: 3,
      texKey: S.textures.exists('prop_barrel') ? 'prop_barrel' : 'crate_shotgun',
      tint: 0xff7043,
      label: 'СБЕЙ ТЕЛЕЖКУ!',
      onIntercepted: (ix, iy) => {
        S.weapons?.explode?.(ix, iy, 92, 4, false);
        addScaledScore(S, 300);
        this.triggerOverheat(8, 3800);
      },
      onImpact: (ix, iy) => {
        if (!this.alive || !S?.sys?.isActive?.() || S.finished) return;
        S.weapons?.explode?.(ix, iy, 96, 3, true);
        S.fx?.debris?.(ix, iy, 9);
      },
    });
  }

  telegraphedShell(playerX: number) {
    const S = this.scene as any;
    const x = Phaser.Math.Clamp(playerX + (this.attackCount % 2 ? 28 : -50), WORLD_W - 920, WORLD_W - 90);
    const marker = this.scene.add.rectangle(x, GROUND_Y + 31, 95, 10, 0xffb55a, 0.85)
      .setDepth(180);
    const warning = this.scene.add.text(x, GROUND_Y - 75, '▼ СНАРЯД', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffeaa2',
      stroke: '#20151b', strokeThickness: 4,
    }).setOrigin(.5).setDepth(180);
    this.scene.tweens.add({ targets: [marker, warning], alpha: 0.15, yoyo: true, repeat: 4, duration: 90 });
    SFX.play('alarm', 0.6);
    this.scene.time.delayedCall(950, () => {
      marker.destroy(); warning.destroy();
      if (!this.alive || !S.sys.isActive() || S.finished) return;
      S.weapons.explode(x, GROUND_Y + 2, this.phase === 2 ? 105 : 86, 3, true);
      S.fx?.debris?.(x, GROUND_Y + 2, 9);
    });
  }

  private defeat() {
    if (!this.alive) return;
    this.alive = false;
    const S = this.scene as any;
    S.finished = true;
    this.headlight?.setVisible(false);
    this.setTexture('tr_engine3');
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    S.hud?.showBoss?.(false);
    const bossPts = addScaledScore(S, 2000);
    scorePopup(S, this.x - 40, this.y - 120, `+${bossPts}`, '#ffd24a');
    SFX.play('boom_big');
    shake(this.scene, 450, 0.021);
    for (let i = 0; i < 9; i++) {
      this.scene.time.delayedCall(i * 125, () => {
        if (!this.scene.sys.isActive()) return;
        S.fx?.bigBoom?.(this.x + rand(-115, 90), this.y + rand(-75, 54), 1.3);
        S.fx?.debris?.(this.x, this.y, 9);
      });
    }
    this.scene.time.delayedCall(1950, () => {
      if (this.scene.sys.isActive()) this.scene.events.emit('rs:train-boss-dead');
    });
  }
}
