/**
 * Reusable interactive boss-fight systems shared across all 4 episodes:
 *  - BossShieldNodes: breakable ground/perched pylons or bio-nodes shielding the boss.
 *  - BossArenaSweep: telegraphed horizontal elevation hazards (floor / upper catwalk).
 *  - BossInterruptTarget: shootable bombs/carts launched by bosses; shooting them
 *    detonates back on the boss and triggers an overheat vulnerability window.
 */

import Phaser from 'phaser';
import { GROUND_Y, WORLD_W, addScaledScore, rand, scorePopup, shake } from './core';
import { SFX } from './audio';

export interface ArenaNodeSpec {
  offsetX: number;
  offsetY: number;
  orbitRadius?: number;
  orbitSpeed?: number;
  orbitPhase?: number;
  hp?: number;
  color: number;
  trimColor: number;
  label: string;
}

interface NodeEntry {
  sprite: Phaser.Physics.Arcade.Image;
  ring: Phaser.GameObjects.Arc;
  beam: Phaser.GameObjects.Line;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  hp: number;
  hpMax: number;
  spec: ArenaNodeSpec;
}

/** Breakable shield pylons / bio-nodes tied visually & mechanically to a boss. */
export class BossShieldNodes {
  scene: any;
  boss: any;
  group: Phaser.Physics.Arcade.Group;
  private entries: NodeEntry[] = [];
  private activeUntilRespawn = 0;
  private colliderBound = false;
  onAllDestroyed?: () => void;

  constructor(scene: any, boss: any, onAllDestroyed?: () => void) {
    this.scene = scene;
    this.boss = boss;
    this.onAllDestroyed = onAllDestroyed;
    this.group = scene.physics.add.group({ allowGravity: false, immovable: true });
    this.bindBullets();
  }

  get activeCount(): number {
    return this.entries.filter((e) => e.sprite.active && e.hp > 0).length;
  }

  private bindBullets() {
    if (this.colliderBound) return;
    const bullets = this.scene.weapons?.playerBullets;
    if (!bullets) return;
    this.colliderBound = true;
    this.scene.physics.add.overlap(bullets, this.group, (a: any, b: any) => {
      const bullet = (bullets.contains(a) ? a : b) as Phaser.Physics.Arcade.Image;
      const target = (bullet === a ? b : a) as Phaser.Physics.Arcade.Image;
      if (!bullet?.active || !target?.active) return;
      const entry = (target as any).__nodeEntry as NodeEntry | undefined;
      if (!entry) return;
      const dmg = (bullet as any).dmg ?? 1;
      if ((bullet as any).isRocket) {
        const bx = bullet.x, by = bullet.y;
        bullet.destroy();
        this.scene.weapons?.explode?.(bx, by, 84, 5, false);
      } else if (!(bullet as any).pierce) {
        bullet.destroy();
      }
      this.hitNode(entry, dmg);
    });
  }

  spawnWave(specs: ArenaNodeSpec[]) {
    this.clearNodes();
    this.bindBullets();
    const S = this.scene;
    for (const spec of specs) {
      const x = Phaser.Math.Clamp(this.boss.x + spec.offsetX, WORLD_W - 920, WORLD_W - 65);
      const y = Phaser.Math.Clamp(this.boss.y + spec.offsetY, 115, GROUND_Y + 20);
      const sprite = this.group.create(x, y, '__rect') as Phaser.Physics.Arcade.Image;
      sprite.setDisplaySize(26, 26).setVisible(false);
      (sprite.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setImmovable(true);

      const ring = S.add.circle(x, y, 13, spec.color, 0.85)
        .setStrokeStyle(2.5, spec.trimColor, 1).setDepth(70);
      const beam = S.add.line(0, 0, x, y, this.boss.x - 16, this.boss.y - 36, spec.trimColor, 0.42)
        .setLineWidth(2, 2).setOrigin(0, 0).setDepth(65).setBlendMode(Phaser.BlendModes.ADD);
      const hpMax = Math.max(3, Math.round(spec.hp ?? 4));
      const hpBarBg = S.add.rectangle(x, y - 20, 30, 4, 0x0d121a, 0.9).setDepth(95);
      const hpBarFill = S.add.rectangle(x - 14, y - 20, 28, 2, spec.trimColor)
        .setOrigin(0, 0.5).setDepth(96);

      const entry: NodeEntry = { sprite, ring, beam, hpBarBg, hpBarFill, hp: hpMax, hpMax, spec };
      (sprite as any).__nodeEntry = entry;
      this.entries.push(entry);
    }
    if (specs.length > 0 && S.hud?.toast) {
      scorePopup(S, this.boss.x - 110, this.boss.y - 120, specs[0].label, '#7ef2ff');
    }
  }

  private hitNode(entry: NodeEntry, dmg: number) {
    if (!entry.sprite.active || entry.hp <= 0) return;
    entry.hp -= dmg;
    const S = this.scene;
    SFX.play('metal', 0.85);
    S.fx?.impact?.(entry.sprite.x, entry.sprite.y, -1, true);
    entry.ring.setFillStyle(0xffffff, 1);
    S.time.delayedCall(55, () => {
      if (entry.ring.active) entry.ring.setFillStyle(entry.spec.color, 0.85);
    });
    const frac = Math.max(0, entry.hp / entry.hpMax);
    entry.hpBarFill.setDisplaySize(Math.max(1, Math.round(28 * frac)), 2);

    if (entry.hp <= 0) {
      const x = entry.sprite.x, y = entry.sprite.y;
      entry.sprite.destroy();
      entry.ring.destroy();
      entry.beam.destroy();
      entry.hpBarBg.destroy();
      entry.hpBarFill.destroy();
      SFX.play('boom_small', 0.9);
      S.fx?.bigBoom?.(x, y, 0.75);
      S.fx?.debris?.(x, y, 10, [entry.spec.color, entry.spec.trimColor, 0xffffff]);
      const pts = addScaledScore(S, 300);
      scorePopup(S, x, y - 22, `+${pts} УЗЕЛ СБИТ!`, '#7ef2ff');
      if (this.activeCount === 0) {
        this.activeUntilRespawn = (S.time?.now ?? 0) + 14500;
        this.onAllDestroyed?.();
      }
    }
  }

  update(time: number) {
    const aliveEntries: NodeEntry[] = [];
    for (const e of this.entries) {
      if (!e.sprite.active || e.hp <= 0) continue;
      aliveEntries.push(e);
      let nx = this.boss.x + e.spec.offsetX;
      let ny = this.boss.y + e.spec.offsetY;
      if (e.spec.orbitRadius && e.spec.orbitSpeed) {
        const ang = time * 0.001 * e.spec.orbitSpeed + (e.spec.orbitPhase ?? 0);
        nx = this.boss.x + e.spec.offsetX + Math.cos(ang) * e.spec.orbitRadius;
        ny = this.boss.y + e.spec.offsetY + Math.sin(ang) * (e.spec.orbitRadius * 0.7);
      }
      nx = Phaser.Math.Clamp(nx, WORLD_W - 920, WORLD_W - 55);
      ny = Phaser.Math.Clamp(ny, 95, GROUND_Y + 24);
      e.sprite.setPosition(nx, ny);
      (e.sprite.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();
      e.ring.setPosition(nx, ny).setScale(0.92 + 0.14 * Math.sin(time * 0.01));
      e.beam.setTo(nx, ny, this.boss.x - 16, this.boss.y - 36);
      e.hpBarBg.setPosition(nx, ny - 20);
      e.hpBarFill.setPosition(nx - 14, ny - 20);
    }
    this.entries = aliveEntries;
  }

  canRespawn(time: number): boolean {
    return this.activeCount === 0 && time >= this.activeUntilRespawn;
  }

  clearNodes() {
    for (const e of this.entries) {
      if (e.sprite.active) e.sprite.destroy();
      if (e.ring.active) e.ring.destroy();
      if (e.beam.active) e.beam.destroy();
      if (e.hpBarBg.active) e.hpBarBg.destroy();
      if (e.hpBarFill.active) e.hpBarFill.destroy();
    }
    this.entries = [];
  }
}

/** Telegraphed horizontal elevation wave across the boss arena (forces jumping,
 * using upper catwalks, or S+SPACE dropping down!). */
export function triggerArenaElevationSweep(
  scene: any,
  opts: {
    xStart: number;
    xEnd: number;
    yCenter: number;
    halfHeight?: number;
    warnMs?: number;
    sweepMs?: number;
    color: number;
    label: string;
    isAliveFn: () => boolean;
  },
) {
  if (!scene.sys?.isActive?.()) return;
  const xMin = Math.min(opts.xStart, opts.xEnd);
  const xMax = Math.max(opts.xStart, opts.xEnd);
  const span = xMax - xMin;
  const h = (opts.halfHeight ?? 28) * 2;
  const warnMs = opts.warnMs ?? 920;
  const sweepMs = opts.sweepMs ?? 720;

  const lane = scene.add.rectangle((xMin + xMax) / 2, opts.yCenter, span, h, opts.color, 0.14)
    .setStrokeStyle(1.5, opts.color, 0.72).setDepth(92);
  const msgX = Phaser.Math.Clamp(scene.player?.x ?? (xMin + xMax) / 2, xMin + 95, xMax - 95);
  const label = scene.add.text(msgX, opts.yCenter - h / 2 - 14, opts.label, {
    fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold',
    color: '#ffffff', stroke: '#11161f', strokeThickness: 3,
  }).setOrigin(0.5).setDepth(94);

  scene.tweens.add({ targets: [lane, label], alpha: 0.12, yoyo: true, repeat: 4, duration: 95 });
  SFX.play('alarm', 0.55);

  scene.time.delayedCall(warnMs, () => {
    if (lane.active) lane.destroy();
    if (label.active) label.destroy();
    if (!scene.sys?.isActive?.() || scene.finished || !opts.isAliveFn()) return;

    const beam = scene.add.rectangle(opts.xStart, opts.yCenter, 72, h * 0.82, opts.color, 0.92)
      .setDepth(95).setBlendMode(Phaser.BlendModes.ADD);
    const core = scene.add.rectangle(opts.xStart, opts.yCenter, 58, Math.max(8, h * 0.34), 0xffffff, 0.85)
      .setDepth(96).setBlendMode(Phaser.BlendModes.ADD);
    SFX.play('signal', 0.55);

    let hitPlayer = false;
    const hitCheck = scene.time.addEvent({
      delay: 32,
      loop: true,
      callback: () => {
        if (!beam.active || hitPlayer || !opts.isAliveFn() || scene.finished) return;
        const p = scene.player;
        if (!p?.active || p.dead || p.rolling) return;
        const py = p.y;
        const dyOk = Math.abs(py - opts.yCenter) <= (opts.halfHeight ?? 28) + 12;
        const dxOk = Math.abs(p.x - beam.x) <= 44;
        if (dxOk && dyOk) {
          hitPlayer = true;
          if (p.inTank) scene.tankSys?.damageTank?.(2);
          else if (p.hurt?.(scene.time.now)) { p.killFx?.(); scene.onPlayerDown?.(); }
        }
      },
    });

    scene.tweens.add({
      targets: [beam, core],
      x: opts.xEnd,
      duration: sweepMs,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        hitCheck.remove();
        if (beam.active) beam.destroy();
        if (core.active) core.destroy();
      },
    });
  });
}

/** Shootable bomb/cart hazard from a boss; destroying it early blasts the boss
 * back and opens a brief vulnerability window! */
export function launchBossInterruptTarget(
  scene: any,
  opts: {
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    durationMs: number;
    hp?: number;
    texKey: string;
    tint?: number;
    label: string;
    onIntercepted: (x: number, y: number) => void;
    onImpact: (x: number, y: number) => void;
  },
) {
  if (!scene.sys?.isActive?.()) return null;
  const sprite = scene.physics.add.image(opts.startX, opts.startY, opts.texKey)
    .setDepth(66).setScale(1.1);
  if (opts.tint) sprite.setTint(opts.tint);
  (sprite.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setImmovable(true);

  const ring = scene.add.circle(opts.startX, opts.startY, 20, 0xff9f38, 0)
    .setStrokeStyle(2, 0xffd24a, 0.92).setDepth(67);
  const tag = scene.add.text(opts.startX, opts.startY - 24, opts.label, {
    fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold',
    color: '#ffe27a', stroke: '#10141c', strokeThickness: 3,
  }).setOrigin(0.5).setDepth(68);

  let hp = opts.hp ?? 3;
  let resolved = false;

  const cleanup = () => {
    if (ring.active) ring.destroy();
    if (tag.active) tag.destroy();
    if (sprite.active) sprite.destroy();
  };

  const tween = scene.tweens.add({
    targets: sprite,
    x: opts.targetX,
    y: opts.targetY,
    duration: opts.durationMs,
    ease: 'Quad.easeIn',
    onUpdate: () => {
      if (resolved || !sprite.active) return;
      if (!scene.sys?.isActive?.() || (scene as any).finished) {
        resolved = true;
        tween.stop();
        cleanup();
        return;
      }
      ring.setPosition(sprite.x, sprite.y);
      tag.setPosition(sprite.x, sprite.y - 24);
      (sprite.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();
    },
    onComplete: () => {
      if (resolved) return;
      resolved = true;
      const ix = sprite.x, iy = sprite.y;
      cleanup();
      if (!scene.sys?.isActive?.() || (scene as any).finished) return;
      opts.onImpact(ix, iy);
    },
  });

  const bullets = scene.weapons?.playerBullets;
  if (bullets) {
    scene.physics.add.overlap(bullets, sprite, (a: any, b: any) => {
      const bullet = (bullets.contains(a) ? a : b) as Phaser.Physics.Arcade.Image;
      if (resolved || !bullet?.active || !sprite.active) return;
      hp -= (bullet as any).dmg ?? 1;
      SFX.play('metal', 0.75);
      scene.fx?.impact?.(sprite.x, sprite.y, -1, true);
      if (!(bullet as any).pierce) bullet.destroy();
      if (hp <= 0) {
        resolved = true;
        tween.stop();
        const ix = sprite.x, iy = sprite.y;
        cleanup();
        opts.onIntercepted(ix, iy);
      }
    });
  }

  void rand; void shake;
  return sprite;
}
