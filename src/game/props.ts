import Phaser from 'phaser';
import { SFX } from './audio';
import { GROUND_Y, WORLD_W, shake, scorePopup, addScaledScore, rand, diff } from './core';
import { findClearGroundX, isWithinCamera } from './world-rules';
import type { GameScene } from '../types';

/**
 * Effects manager: explosions, muzzle flashes, shell casings, smoke, weld
 * sparks — the "juice" layer that makes pixel fights feel alive.
 */
export class FxSystem {
  scene: Phaser.Scene;
  /** Small, short-lived particles are capped for low-end/mobile devices. */
  private activeParticles = 0;
  private readonly maxParticles = 110;

  constructor(scene: Phaser.Scene) { this.scene = scene; }

  private visible(x: number, y: number, margin = 110): boolean {
    if (!this.scene.sys.isActive()) return false;
    const cam = this.scene.cameras.main;
    return x >= cam.scrollX - margin && x <= cam.scrollX + cam.width + margin
      && y >= cam.scrollY - margin && y <= cam.scrollY + cam.height + margin;
  }

  private particle(x: number, y: number, color: number, vx: number, vy: number, duration = 360, size = 3) {
    if (this.activeParticles >= this.maxParticles || !this.visible(x, y)) return;
    this.activeParticles++;
    const p = this.scene.add.rectangle(x, y, size, size, color).setDepth(145);
    this.scene.tweens.add({
      targets: p, x: x + vx * duration / 1000, y: y + vy * duration / 1000 + 16,
      angle: rand(-300, 300), alpha: 0, duration, ease: 'Quad.easeOut',
      onComplete: () => { p.destroy(); this.activeParticles = Math.max(0, this.activeParticles - 1); },
    });
  }

  /** Directional sparks when bullets strike armor/metal. No giant explosion per hit. */
  impact(x: number, y: number, direction = 1, electric = false) {
    if (!this.visible(x, y)) return;
    const color = electric ? 0x66f9e7 : 0xffcc79;
    const flash = this.scene.add.ellipse(x, y, 9, 7, electric ? 0x66f9e7 : 0xffe7a2, 0.94).setDepth(160);
    this.scene.tweens.add({ targets: flash, scaleX: 0.1, alpha: 0, duration: 90, onComplete: () => flash.destroy() });
    for (let i = 0; i < (electric ? 7 : 4); i++) {
      this.particle(x + rand(-3, 3), y + rand(-3, 3), color,
        direction * rand(40, 150), rand(-120, 95), rand(180, 330), rand(2, 4));
    }
  }

  debris(x: number, y: number, count = 8, palette: number[] = [0xa36b47, 0x626c77, 0xe4ab5e]) {
    if (!this.visible(x, y)) return;
    for (let i = 0; i < count; i++) {
      this.particle(x + rand(-16, 16), y + rand(-7, 7),
        palette[i % palette.length], rand(-180, 180), rand(-230, -45), rand(250, 620), rand(3, 7));
    }
  }

  /** Brief visual silhouette of a falling enemy, separate from its destroyed physics body. */
  defeat(enemy: Phaser.Physics.Arcade.Sprite, mechanical = false) {
    if (!this.visible(enemy.x, enemy.y)) return;
    const image = this.scene.add.image(enemy.x, enemy.y, enemy.texture.key, enemy.frame.name)
      .setDisplaySize(enemy.displayWidth, enemy.displayHeight)
      .setFlipX(enemy.flipX).setTint(mechanical ? 0x8bffed : 0xffc68e)
      .setDepth(Math.max(30, enemy.depth - 1)).setAlpha(0.85);
    const shift = enemy.flipX ? 24 : -24;
    this.scene.tweens.add({
      targets: image, x: image.x + shift, y: image.y - rand(15, 33),
      angle: rand(-20, 20), alpha: 0, duration: 300, ease: 'Quad.easeOut',
      onComplete: () => image.destroy(),
    });
    this.debris(enemy.x, enemy.y, mechanical ? 8 : 5,
      mechanical ? [0x6bb6a9, 0x9fb7c2, 0xffc060] : [0x667c64, 0x9c764d, 0xd19d64]);
  }

  boom(x: number, y: number, scale = 1) {
    if (!this.visible(x, y)) return;
    const s = this.scene.add.sprite(x, y, 'explosion', 'f0').setDepth(200).setScale(scale);
    s.play('boom');
    s.once('animationcomplete', () => s.destroy());
    // Hot center: a very brief burst makes the new animation feel luminous.
    const hot = this.scene.add.ellipse(x, y, 30 * scale, 20 * scale, 0xffedb0, 0.75).setDepth(201);
    this.scene.tweens.add({ targets: hot, scaleX: 1.6, scaleY: 1.6, alpha: 0,
      duration: 110, onComplete: () => hot.destroy() });
  }

  bigBoom(x: number, y: number, scale = 1.4) {
    if (!this.visible(x, y, 180)) return;
    this.boom(x, y, scale);
    if (scale > 1.1) this.boom(x + rand(-25, 25), y + rand(-12, 8), scale * 0.65);
    this.debris(x, y, Math.min(14, Math.round(scale * 6)));
    // Expanding shockwave ring
    const ring = this.scene.add.circle(x, y, 12 * scale, 0xffd27a, 0)
      .setStrokeStyle(Math.max(1.5, 2.2 * scale), 0xffbe6b, 0.88).setDepth(199);
    this.scene.tweens.add({
      targets: ring, scaleX: 4.2, scaleY: 3.1, alpha: 0, duration: 240, ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    const flare = this.scene.add.ellipse(x, y, 54 * scale, 22 * scale, 0xfff1c4, 0.52)
      .setDepth(202).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flare, scaleX: 2.1, scaleY: 0.45, alpha: 0, duration: 150, ease: 'Quad.easeOut',
      onComplete: () => flare.destroy(),
    });
    // Smoke rolls in after the bright flash, instead of appearing all at once.
    for (let i = 0; i < 4; i++) {
      this.scene.time.delayedCall(i * 65, () => {
        if (this.scene.sys.isActive()) this.smoke(x + rand(-34, 34), y + rand(-28, 12), 0.7 + scale * 0.15);
      });
    }
    if (y > 410 && y < 540) {
      const scorch = this.scene.add.ellipse(x, GROUND_Y + 13, 46 * scale, 9 * scale, 0x101820, 0.52).setDepth(13);
      this.scene.tweens.add({ targets: scorch, alpha: 0, duration: 3400,
        onComplete: () => scorch.destroy() });
    }
  }

  sparkTrail(x: number, y: number, color = 0x5df2e6, size = 3) {
    if (this.activeParticles >= this.maxParticles || !this.visible(x, y)) return;
    this.particle(x + rand(-2, 2), y + rand(-2, 2), color, rand(-36, 36), rand(-44, 18), rand(120, 210), size);
  }

  smoke(x: number, y: number, scale = 1) {
    if (!this.visible(x, y)) return;
    const p = this.scene.add.sprite(x, y, 'smoke', 'f0').setDepth(120).setScale(scale).setAlpha(0.8);
    p.play('puff');
    this.scene.tweens.add({ targets: p, y: y - 18, duration: 350 });
    p.once('animationcomplete', () => p.destroy());
  }

  muzzle(x: number, y: number, dir: Phaser.Math.Vector2, power = 1, casing = true) {
    if (!this.visible(x, y)) return;
    const texture = this.scene.textures.exists('rem_muzzle') ? 'rem_muzzle' : 'explosion';
    const rot = Math.atan2(dir.y, dir.x);
    const halo = this.scene.add.ellipse(x, y, 22 * power, 14 * power, 0xffe29a, 0.48)
      .setDepth(159).setRotation(rot).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: halo, scaleX: 1.5, scaleY: 0.7, alpha: 0, duration: 85, onComplete: () => halo.destroy() });
    const flash = this.scene.add.image(x, y, texture, texture === 'explosion' ? 'f0' : undefined)
      .setDepth(160).setRotation(rot)
      .setScale(0.55 * power).setAlpha(0.96).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: flash, scaleX: 1.25 * power, scaleY: 0.85 * power, alpha: 0,
      duration: 95, onComplete: () => flash.destroy() });
    if (casing) this.particle(x - dir.x * 11, y - 4, 0xd6b76e, -dir.x * 85 + rand(-18, 18), -125, 390, 3);
  }

  enemyMuzzle(x: number, y: number, direction: number) {
    if (!this.visible(x, y)) return;
    const tex = this.scene.textures.exists('rem_muzzle2') ? 'rem_muzzle2' : 'explosion';
    const flash = this.scene.add.image(x, y, tex, tex === 'explosion' ? 'f0' : undefined)
      .setDepth(135).setFlipX(direction < 0).setScale(0.5).setTint(0xffaa55)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: flash, alpha: 0, scaleX: 0.95,
      duration: 85, onComplete: () => flash.destroy() });
  }

  jumpDust(x: number, y: number) {
    this.landDust(x, y, 0.5);
  }

  landDust(x: number, y: number, strength = 1) {
    if (!this.visible(x, y)) return;
    for (let i = 0; i < (strength > 0.8 ? 6 : 3); i++) {
      this.particle(x + rand(-12, 12), y, 0x9c9690,
        rand(-90, 90) * strength, rand(-90, -24), rand(200, 350), rand(2, 4));
    }
  }

  weld(x: number, y: number) {
    this.impact(x, y, Math.random() > 0.5 ? 1 : -1, true);
  }

  signalGlitch(x: number, y: number) {
    const gfx = this.scene.add.graphics().setDepth(210);
    gfx.fillStyle(0xff4fd8, 0.28); gfx.fillRect(x - 60, y - 120, 120, 240);
    gfx.fillStyle(0x4fe8ff, 0.22); gfx.fillRect(x - 40, y - 140, 80, 280);
    for (let i = 0; i < 9; i++) {
      gfx.fillStyle(i % 2 ? 0xff4fd8 : 0x4fe8ff, 0.22 + (i % 3) * 0.1);
      gfx.fillRect(x - rand(20, 100), y + rand(-120, 100), rand(22, 150), 2 + (i % 3));
    }
    this.scene.tweens.add({ targets: gfx, alpha: 0, duration: 600, onComplete: () => gfx.destroy() });
    shake(this.scene, 260, 0.009);
  }

  floatingText(x: number, y: number, text: string, color = '#ffffff') {
    scorePopup(this.scene, x, y, text, color);
  }
}

/**
 * Destructible props (concept feature #1): barrels chain-explode, crates
 * shatter, watchtowers collapse onto enemies below.
 */
export interface Prop extends Phaser.Physics.Arcade.Image {
  hp: number; propKind: 'barrel' | 'crate' | 'tower';
}

export class PropsSystem {
  scene: GameScene;
  group: Phaser.Physics.Arcade.Group;
  constructor(scene: any) {
    this.scene = scene;
    this.group = scene.physics.add.group();
  }

  private makeTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
    if (this.scene.textures.exists(key)) return;
    const t = this.scene.textures.createCanvas(key, w, h)!;
    draw(t.getContext()); t.refresh();
  }

  private ensureTextures() {
    this.makeTex('prop_barrel', 24, 32, (c) => {
      c.fillStyle = '#2b120e'; c.fillRect(1, 0, 22, 32);
      c.fillStyle = '#993424'; c.fillRect(2, 2, 20, 28);
      c.fillStyle = '#c84f32'; c.fillRect(4, 2, 5, 28);
      c.fillStyle = '#6c2016'; c.fillRect(15, 2, 7, 28);
      c.fillStyle = '#404854'; c.fillRect(1, 0, 22, 3); c.fillRect(1, 9, 22, 2); c.fillRect(1, 21, 22, 2); c.fillRect(1, 29, 22, 3);
      c.fillStyle = '#ffd24a'; c.fillRect(9, 12, 6, 7);
      c.fillStyle = '#993424'; c.fillRect(11, 13, 2, 3); c.fillRect(11, 17, 2, 1);
    });
    this.makeTex('prop_crate', 28, 26, (c) => {
      c.fillStyle = '#2b2013'; c.fillRect(0, 0, 28, 26);
      c.fillStyle = '#7e5c34'; c.fillRect(2, 2, 24, 22);
      c.fillStyle = '#9b7444'; c.fillRect(3, 3, 22, 4);
      c.fillStyle = '#5a4021';
      c.fillRect(2, 9, 24, 2); c.fillRect(2, 17, 24, 2);
      c.fillRect(2, 2, 3, 22); c.fillRect(23, 2, 3, 22);
      c.fillStyle = '#c29958'; c.fillRect(3, 3, 2, 2); c.fillRect(23, 3, 2, 2); c.fillRect(3, 21, 2, 2); c.fillRect(23, 21, 2, 2);
    });
    this.makeTex('prop_tower', 48, 120, (c) => {
      c.fillStyle = '#252b34'; c.fillRect(6, 20, 8, 100); c.fillRect(34, 20, 8, 100);
      c.fillStyle = '#596373'; c.fillRect(7, 20, 5, 100); c.fillRect(35, 20, 5, 100);
      for (let k = 0; k < 5; k++) { c.fillStyle = '#3d4554'; c.fillRect(6, 28 + k * 20, 36, 4); }
      c.fillStyle = '#2e3540'; c.fillRect(0, 0, 48, 26);
      c.fillStyle = '#677182'; c.fillRect(2, 2, 44, 21);
      c.fillStyle = '#8b96a8'; c.fillRect(2, 2, 44, 3);
      c.fillStyle = '#181c22'; c.fillRect(14, 8, 20, 8);
      c.fillStyle = '#ff6d4f'; c.fillRect(16, 10, 4, 3);
      c.fillStyle = '#95a1b4'; c.fillRect(34, 7, 16, 4);
    });
  }

  private solidGroups: Array<Phaser.GameObjects.Group | Phaser.Physics.Arcade.StaticGroup> = [];

  bindSolids(solids: Phaser.GameObjects.Group | Phaser.Physics.Arcade.StaticGroup) {
    if (!solids || this.solidGroups.includes(solids)) return;
    this.solidGroups.push(solids);
    this.scene.physics.add.collider(this.group, solids);
  }

  barrel(x: number, surfaceY = GROUND_Y + 35) { this.spawn('barrel', 'prop_barrel', x, 3, surfaceY); }
  crate(x: number, surfaceY = GROUND_Y + 35) { this.spawn('crate', 'prop_crate', x, 2, surfaceY); }
  tower(x: number, surfaceY = GROUND_Y + 35) { this.spawn('tower', 'prop_tower', x, 10, surfaceY); }

  private spawn(kind: Prop['propKind'], tex: string, x: number, hp: number, surfaceY = GROUND_Y + 35) {
    this.ensureTextures();
    const hw = kind === 'tower' ? 30 : 18;
    const objH = kind === 'tower' ? 124 : 46;
    const clearX = findClearGroundX(this.scene, x, hw, surfaceY, {
      objectHeight: objH,
      avoidPads: true,
      includeProps: true,
      includeMachines: true,
      includeTurrets: true,
    });
    const texFrame = this.scene.textures.get(tex)?.get();
    const estH = texFrame?.height || 32;
    const p = this.group.create(clearX, surfaceY - estH / 2, tex) as Prop;
    p.propKind = kind;
    p.hp = hp;
    p.setDepth(40);
    const body = p.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    const h = p.displayHeight || p.height || estH;
    body.reset(clearX, surfaceY - h / 2);
    (p as any).takeDamage = (dmg: number) => this.hit(p, dmg);
    return p;
  }

  hit(p: Prop, dmg: number) {
    if (!p.active) return;
    p.hp -= dmg;
    (this.scene as any).fx?.impact?.(p.x + rand(-9, 9), p.y + rand(-8, 8), Math.random() < 0.5 ? 1 : -1);
    p.setTintFill(0xffd39b);
    this.scene.time.delayedCall(50, () => { if (p.active) p.clearTint(); });
    if (p.hp <= 0) this.destroyProp(p);
  }

  destroyProp(p: Prop) {
    const fx = (this.scene as any).fx;
    const S = this.scene;
    if (p.propKind === 'barrel') {
      // Save coordinates and detach physics first: chain blasts are reentrant.
      const x = p.x, y = p.y;
      p.destroy();
      fx?.debris?.(x, y, 12, [0xc86c45, 0x4d5c65, 0xe5b66c]);
      const pts = addScaledScore(S, 150); scorePopup(S, x, y - 20, `+${pts}`);
      // One authoritative explosion (FX + damage + shockwave), not three.
      S.weapons?.explode?.(x, y, 110, 6, true);
      // push nearby enemies
      (S.enemies?.children.entries as unknown as Array<{ x: number; body?: any }> || []).forEach((e) => {
        if (Math.abs(e.x - x) < 120) e.body?.setVelocity(rand(-120, 120), -260);
      });
    } else if (p.propKind === 'crate') {
      SFX.play('metal', 0.7);
      fx?.boom?.(p.x, p.y, 0.7);
      fx?.debris?.(p.x, p.y, 10, [0x956840, 0x654c35, 0xd4b07b]);
      addScaledScore(S, 50);
    } else if (p.propKind === 'tower') {
      // collapses: rotates down on top of the floor deck, crushes enemies under it
      SFX.play('boom_big', 0.8); SFX.play('metal', 1);
      if (p.body) {
        const tb = p.body as Phaser.Physics.Arcade.Body;
        tb.setAllowGravity(false);
        tb.enable = false;
      }
      fx?.bigBoom?.(p.x, p.y + p.height / 2 - 20, 1.5);
      fx?.debris?.(p.x, p.y + 30, 16, [0xb1a06b, 0x616e75, 0xd1a248]);
      S.tweens.add({ targets: p, angle: 82, y: Math.min(GROUND_Y + 23, p.y + 42), duration: 700, ease: 'Bounce.easeOut' });
      (S.enemies?.children.entries as unknown as Array<{ x: number; active: boolean; takeDamage?: (d: number) => void }> || []).forEach((e) => {
        if (Math.abs(e.x - p.x) < 70 && e.active) e.takeDamage?.(99);
      });
      const towerPts = addScaledScore(S, 300); scorePopup(S, p.x, p.y - 40, `+${towerPts} ОБВАЛ!`);
      S.time.delayedCall(900, () => { if (p.active) p.destroy(); });
      return;
    }
    p.destroy();
  }

  damageInRadius(x: number, y: number, r: number, dmg: number) {
    this.group.getChildren().slice().forEach((o) => {
      const p = o as Prop;
      if (!p.active) return;
      if (Math.hypot(p.x - x, p.y - y) < r) {
        if (p.propKind === 'barrel') this.destroyProp(p); // barrels always pop
        else this.hit(p, dmg);
      }
    });
  }
}

export interface TurretOptions {
  hp?: number;
  surfaceY?: number;
  linkedDisabled?: () => boolean;
}

/** Destructible automated turret nest: stands flush above ground/platforms,
 *  never overlaps solid walls, shows HP, and fires only inside the viewport. */
export class Turret extends Phaser.Physics.Arcade.Sprite {
  hp: number;
  hpMax: number;
  private barBg?: Phaser.GameObjects.Rectangle;
  private barFill?: Phaser.GameObjects.Rectangle;
  private fireEvt?: Phaser.Time.TimerEvent;
  private usesRemasterTex: boolean;
  private linkedDisabled?: () => boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, tex: string, hp: number, linkedDisabled?: () => boolean) {
    super(scene, x, y, tex, tex === 'prop_turret' ? 'f0' : undefined);
    this.usesRemasterTex = tex === 'prop_turret';
    this.hp = hp;
    this.hpMax = hp;
    this.linkedDisabled = linkedDisabled;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setName('turret');
    this.setDepth(42);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false).setImmovable(true);
    body.setSize(42, 34).setOffset(Math.max(4, (this.width - 42) / 2), Math.max(4, this.height - 34));

    this.barBg = scene.add.rectangle(x, y - 30, 38, 5, 0x10141c, 0.85).setDepth(75);
    this.barFill = scene.add.rectangle(x - 18, y - 30, 36, 3, 0xff7054, 0.95).setOrigin(0, 0.5).setDepth(76);

    const interval = Math.max(900, Math.round(1450 * diff().rateMul));
    this.fireEvt = scene.time.addEvent({
      delay: interval,
      loop: true,
      callback: () => this.tryFire(),
    });
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.fireEvt?.remove();
      this.barBg?.destroy();
      this.barFill?.destroy();
    });
  }

  private tryFire() {
    const S = this.scene as any;
    if (!this.active || !S?.sys?.isActive?.() || S.finished) return;
    if (this.linkedDisabled?.()) return;
    const player = S.player;
    if (!player || player.dead) return;
    // Never fire from outside the visible camera frame.
    if (!isWithinCamera(this.scene, this.x, 30)) return;
    if (Math.abs(player.x - this.x) > 640) return;

    const dir = player.x < this.x ? -1 : 1;
    // prop_turret faces LEFT in its base frame; fallback enemy_turret faces RIGHT.
    this.setFlipX(this.usesRemasterTex ? dir > 0 : dir < 0);
    if (this.usesRemasterTex && this.scene.textures.get('prop_turret').has('f1')) {
      this.setFrame('f1');
      this.scene.time.delayedCall(140, () => { if (this.active) this.setFrame('f0'); });
    }
    const muzX = this.x + dir * 24;
    const muzY = this.y - 5;
    S.fx?.enemyMuzzle?.(muzX, muzY, dir);
    S.weapons?.enemyAimedShot?.(muzX, muzY, player.x, player.y - 8, 330);
  }

  takeDamage(dmg: number) {
    if (!this.active) return;
    this.hp -= dmg;
    const S = this.scene as any;
    S.fx?.impact?.(this.x + rand(-8, 8), this.y - 6, Math.random() < 0.5 ? 1 : -1, true);
    this.setTintFill(0xffe19c);
    this.scene.time.delayedCall(55, () => { if (this.active) this.clearTint(); });
    const frac = Phaser.Math.Clamp(this.hp / Math.max(1, this.hpMax), 0, 1);
    if (this.barFill?.active) {
      this.barFill.setDisplaySize(Math.max(1, 36 * frac), 3);
      this.barFill.setFillStyle(frac > 0.5 ? 0x8ae068 : frac > 0.28 ? 0xffbf4d : 0xff4949);
    }
    if (this.hp <= 0) {
      const tx = this.x;
      const ty = this.y;
      this.destroy();
      SFX.play('boom_big', 0.75);
      S?.fx?.bigBoom?.(tx, ty - 6, 1.15);
      S?.fx?.debris?.(tx, ty - 4, 12, [0x707d8e, 0xd87a4a, 0xffd268]);
      if (S) {
        const pts = addScaledScore(S, 250);
        scorePopup(S, tx, ty - 28, `+${pts} ТУРЕЛЬ!`);
      }
    }
  }
}

export function spawnTurret(scene: Phaser.Scene, preferredX: number, opts: TurretOptions = {}): Turret {
  const surfaceY = opts.surfaceY ?? GROUND_Y + 35;
  const clearX = findClearGroundX(scene, preferredX, 34, surfaceY, {
    objectHeight: 54,
    avoidPads: true,
    includeMachines: true,
    includeProps: true,
    includeTurrets: true,
  });
  const usesRemaster = scene.textures.exists('prop_turret');
  const tex = usesRemaster ? 'prop_turret' : 'enemy_turret';
  const y = surfaceY - (usesRemaster ? 24 : 15);
  const hp = Math.max(4, Math.round((opts.hp ?? 6) * diff().hpMul));
  const turret = new Turret(scene, clearX, y, tex, hp, opts.linkedDisabled);
  const grp = (scene as any).machineGrp as Phaser.Physics.Arcade.Group | undefined;
  grp?.add?.(turret);
  // Phaser's Group.add() reapplies group defaults (allowGravity: true), which would drop turrets through the floor.
  (turret.body as Phaser.Physics.Arcade.Body)?.setAllowGravity(false).setImmovable(true);
  return turret;
}

/* =====================================================================
   ENEMY MACHINES — some can be DISABLED and CAPTURED (feature #2)
   Currently drivable capture target: enemy APC ("Кувалда" RS-7 is a
   friendly tank found later). Machines also get repaired by drones.
===================================================================== */
export class Machine extends Phaser.Physics.Arcade.Sprite {
  hp = 14; hpMax = 14; disabled = false; captured = false;
  lastShot = 0; id = Math.random();
  private shadow?: Phaser.GameObjects.Ellipse;
  private hpBg?: Phaser.GameObjects.Rectangle;
  private hpFill?: Phaser.GameObjects.Rectangle;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy_apc');
    scene.add.existing(this);
  }
  initMachine(scene: Phaser.Scene, x: number) {
    this.setTexture('enemy_apc', scene.textures.get('enemy_apc').has('f0') ? 'f0' : undefined);
    if (scene.anims.exists('veh_apc_roll')) this.play('veh_apc_roll');
    const dm = diff();
    this.hp = Math.max(4, Math.round(this.hp * dm.hpMul));
    this.hpMax = this.hp;
    const safeX = findClearGroundX(scene, x, 58, GROUND_Y + 35, {
      objectHeight: 56,
      padding: 14,
      avoidPads: true,
      includeMachines: true,
      includeProps: true,
      includeTurrets: true,
      exclude: this,
    });
    this.setPosition(safeX, GROUND_Y + 35 - this.height / 2 - 2);
    scene.physics.add.existing(this);
    this.setDepth(42);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false).setImmovable(true);
    if (this.width >= 110) body.setSize(102, 46, false).setOffset(8, 16);
    else body.setSize(90, 40, false).setOffset(6, 10);
    body.position.set(this.x - this.displayOriginX + body.offset.x, this.y - this.displayOriginY + body.offset.y);
    body.prev.copy(body.position);
    body.updateCenter();
    this.shadow = scene.add.ellipse(safeX, GROUND_Y + 33, this.width * 0.88, 12, 0x05080d, 0.5).setDepth(39);
    this.hpBg = scene.add.rectangle(safeX, this.y - this.height / 2 - 8, 56, 5, 0x0e131b, 0.85)
      .setStrokeStyle(1, 0x3b4859, 0.9).setDepth(95).setVisible(false);
    this.hpFill = scene.add.rectangle(safeX - 27, this.y - this.height / 2 - 8, 54, 3, 0xff7043)
      .setOrigin(0, 0.5).setDepth(96).setVisible(false);
    this.once('destroy', () => {
      this.shadow?.destroy(); this.hpBg?.destroy(); this.hpFill?.destroy();
    });
    return this;
  }
  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);
    if (this.shadow?.active) this.shadow.setPosition(this.x, GROUND_Y + 33);
    if (this.hpBg?.active && this.hpFill?.active) {
      const show = !this.disabled && this.hp < this.hpMax;
      this.hpBg.setVisible(show).setPosition(this.x, this.y - this.height / 2 - 8);
      const frac = Math.max(0, Math.min(1, this.hp / Math.max(1, this.hpMax)));
      this.hpFill.setVisible(show).setPosition(this.x - 27, this.y - this.height / 2 - 8)
        .setDisplaySize(Math.max(1, Math.round(54 * frac)), 3);
    }
  }
  takeDamage(d: number) {
    if (this.disabled || !this.active) return;
    this.hp -= d;
    (this.scene as any).fx?.impact?.(this.x + rand(-35, 35), this.y + rand(-12, 12), 1, true);
    this.setTintFill(0xbffff2);
    this.scene.time.delayedCall(50, () => { if (this.active && !this.disabled) this.clearTint(); });
    if (this.hp <= this.hpMax * 0.35 && !this.disabled) this.disable();
  }
  disable() {
    this.disabled = true;
    SFX.play('boom_big', 0.8); SFX.play('metal');
    this.anims?.stop?.();
    this.setTint(0x687280);
    this.hpBg?.setVisible(false);
    this.hpFill?.setVisible(false);
    (this.scene as any).fx?.bigBoom?.(this.x, this.y, 1.2);
    (this.scene as any).fx?.debris?.(this.x, this.y, 14, [0x8f8a70, 0x647c79, 0xe5b66c]);
    (this.scene as any).hud?.toast?.('Броневик подбит — забирай по [E]!');
    // driver bails out (comedy: runs away on foot)
    (this.scene as any).spawnEnemyAt?.('rifle', this.x, GROUND_Y - 30);
  }
  heal(d: number) {
    if (!this.disabled) { this.hp = Math.min(this.hpMax, this.hp + d); return; }
    this.hp += d;
    if (this.hp > this.hpMax * 0.5) {
      this.disabled = false; this.clearTint();
      if (this.scene.anims.exists('veh_apc_roll')) this.play('veh_apc_roll');
      (this.scene as any).hud?.toast?.('Ремонтный дрон починил машину!');
    }
  }
}

export function makeMachineTextures(scene: Phaser.Scene) {
  if (scene.textures.exists('enemy_apc')) return;
  const t = scene.textures.createCanvas('enemy_apc', 102, 56)!;
  const c = t.getContext();
  // wheels
  c.fillStyle = '#1c1f26';
  for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(20 + k * 30, 44, 10, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#3a4250';
  for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(20 + k * 30, 44, 4, 0, Math.PI * 2); c.fill(); }
  // hull
  c.fillStyle = '#6e5a3a'; c.fillRect(4, 16, 94, 22);
  c.fillStyle = '#57462c'; c.fillRect(4, 16, 94, 5);
  c.fillStyle = '#7d4a26'; c.fillRect(84, 20, 14, 14); // rust patch
  // turret + gun
  c.fillStyle = '#7a6844'; c.fillRect(30, 4, 34, 14);
  c.fillStyle = '#3a4250'; c.fillRect(60, 8, 40, 5);
  c.fillStyle = '#22262e'; c.fillRect(38, 8, 8, 6); // hatch
  // antenna with signal mote
  c.fillStyle = '#8a94a6'; c.fillRect(24, 0, 2, 12);
  c.fillStyle = '#ff4fd8'; c.fillRect(22, 0, 6, 4);
  t.refresh();
}
