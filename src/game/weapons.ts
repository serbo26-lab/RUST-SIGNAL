import Phaser from 'phaser';
import { WEAPONS, WeaponSpec, GROUND_Y, WORLD_W, VIEW_W, shake, rand, diff } from './core';
import { isWithinCamera } from './world-rules';
import type { GameScene } from '../types';
import { SFX } from './audio';

/**
 * Weapons system: player shots (4 weapon types), enemy bullets, grenades,
 * rockets and explosions. Pools keep it smooth on low-end machines.
 */
export class WeaponsSystem {
  scene: GameScene;
  playerBullets: Phaser.Physics.Arcade.Group;
  enemyBullets: Phaser.Physics.Arcade.Group;
  grenades: Phaser.Physics.Arcade.Group;

  constructor(scene: any) {
    this.scene = scene;
    this.playerBullets = scene.physics.add.group({ runChildUpdate: false });
    this.enemyBullets = scene.physics.add.group();
    this.grenades = scene.physics.add.group();
  }

  playerShoot(player: Phaser.Physics.Arcade.Sprite, spec: WeaponSpec, mx: number, my: number, dir: Phaser.Math.Vector2) {
    const S = this.scene;
    const shotName = spec.pierce ? 'shot_laser' : spec.count > 1 ? 'shot_shotgun' : spec.cooldown < 90 ? 'shot_mg' : 'shot_pistol';
    SFX.play(shotName as any, 0.8);
    const texKey = spec.pierce ? 'laser_b' : 'bullet';
    // Point-blank safety: Arcade bullets are created ~20 px ahead of the hero.
    // If a spider/soldier overlaps that muzzle, a new bullet spawns *behind*
    // its tiny physics body. Resolve the short 0-52px barrel segment first.
    const close = S.enemies?.getChildren?.()
      .filter((e: any) => e.active && e.hp > 0 && e.body?.enable)
      .map((e: any) => {
        const body = e.body as Phaser.Physics.Arcade.Body;
        const ex = (body.left + body.right) / 2 - player.x;
        const ey = (body.top + body.bottom) / 2 - (player.y - 2);
        const along = ex * dir.x + ey * dir.y;
        const offAxis = Math.abs(ex * dir.y - ey * dir.x);
        return { enemy: e, along, offAxis,
          tolerance: Math.max(body.width, body.height) / 2 + 13 };
      })
      .filter((c: any) => c.along > -12 && c.along < 52
        && c.offAxis <= c.tolerance)
      .sort((a: any, b: any) => a.along - b.along)[0];
    if (close) {
      // Shotgun pellets hit at contact range; respect the weapon's total
      // pellet damage while keeping normal cooldown/ammo accounting.
      const dmg = spec.dmg * (spec.count > 1 ? Math.min(spec.count, 4) : 1);
      close.enemy.takeDamage(dmg);
      S.fx?.impact?.(close.enemy.x, close.enemy.y, dir.x >= 0 ? 1 : -1,
        close.enemy.kind === 'spider' || close.enemy.kind === 'drone');
      return;
    }
    for (let i = 0; i < spec.count; i++) {
      const spread = spec.spread > 0 ? rand(-spec.spread / 2, spec.spread / 2) : 0;
      const a = Math.atan2(dir.y, dir.x) + spread;
      const b = this.playerBullets.create(mx, my, texKey) as Phaser.Physics.Arcade.Image;
      b.setDepth(55);
      (b.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
      const vx = Math.cos(a) * spec.speed, vy = Math.sin(a) * spec.speed;
      if (b.body) b.body.velocity.set(vx, vy); else b.setVelocity(vx, vy);
      b.setRotation(a);
      (b as any).dmg = spec.dmg;
      (b as any).pierce = spec.pierce;
      (b as any).isRocket = false;
      (b as any).isLaser = texKey === 'laser_b';
      const glow = S.add?.ellipse?.(mx, my, texKey === 'laser_b' ? 24 : 16, texKey === 'laser_b' ? 8 : 6,
        texKey === 'laser_b' ? 0x56f7f0 : 0xffcf70, texKey === 'laser_b' ? 0.55 : 0.4)
        ?.setDepth(54)?.setRotation(a)?.setBlendMode?.(Phaser.BlendModes.ADD);
      if (glow) {
        (b as any).__glow = glow;
        b.once('destroy', () => { if (glow.active) glow.destroy(); });
      } else {
        b.once('pointerdown', () => {});
      }
      // despawn offscreen
      S.time.delayedCall(1600, () => { if (b.active) b.destroy(); });
    }
    if ((player as any).charId === 'volt') void 0; // heavier recoil flavour handled by fx
  }

  /** rocket variant used by tank cannon */
  rocket(x: number, y: number, dirX: number, dirY = 0) {
    const S = this.scene;
    SFX.play('rocket');
    const aimLen = Math.hypot(dirX, dirY) || 1;
    const dx = dirX / aimLen;
    const dy = dirY / aimLen;
    S.fx?.muzzle?.(x, y, new Phaser.Math.Vector2(dx, dy), 1.35, false);

    // Point-blank safety: detonate immediately if an enemy stands right in front of the tank barrel.
    const pointBlank = S.enemies?.getChildren?.()
      .filter((e: any) => e.active && e.hp > 0 && e.body?.enable)
      .find((e: any) => {
        const body = e.body as Phaser.Physics.Arcade.Body;
        const ex = (body.left + body.right) / 2 - (x - dx * 20);
        const ey = (body.top + body.bottom) / 2 - y;
        const along = ex * dx + ey * dy;
        const offAxis = Math.abs(ex * dy - ey * dx);
        return along > -16 && along < 64 && offAxis <= Math.max(body.width, body.height) / 2 + 18;
      });
    if (pointBlank) {
      const target = pointBlank as Phaser.Physics.Arcade.Sprite;
      this.explode(target.x, target.y, 92, 5, false);
      return;
    }

    const b = this.playerBullets.create(x, y, 'rocket') as Phaser.Physics.Arcade.Image;
    b.setDepth(55).setFlipX(dx < 0);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setSize(26, 20);
    const rad = Math.atan2(dy, dx);
    const vx = Math.cos(rad) * 720, vy = Math.sin(rad) * 720;
    body.velocity.set(vx, vy);
    b.setRotation(rad);
    (b as any).dmg = 6;
    (b as any).isRocket = true;
    (b as any).pierce = false;
    const glow = S.add?.ellipse?.(x, y, 26, 12, 0xff9a44, 0.52)
      ?.setDepth(54)?.setRotation(rad)?.setBlendMode?.(Phaser.BlendModes.ADD);
    if (glow) {
      (b as any).__glow = glow;
      b.once('destroy', () => { if (glow.active) glow.destroy(); });
    }
    S.time.delayedCall(2400, () => { if (b.active) { this.explode(b.x, b.y, 90, 5); b.destroy(); } });
  }

  enemyShoot(x: number, y: number, dir: number, tex = 'bullet_e') {
    const S = this.scene;
    if (!isWithinCamera(S, x, 26)) return;
    SFX.play('shot_mg', 0.45);
    const b = this.enemyBullets;
    const e = b.create(x, y, tex) as Phaser.Physics.Arcade.Image;
    e.setDepth(54).setFlipX(dir < 0);
    (e.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    e.body!.setVelocityX(dir * 430);
    (e as any).dmg = Math.max(1, Math.round(diff().dmgMul)); // рекрут — мягче, хардкор — злее
    const glow = S.add?.ellipse?.(x, y, 16, 7, 0xff524f, 0.45)
      ?.setDepth(53)?.setBlendMode?.(Phaser.BlendModes.ADD);
    if (glow) {
      (e as any).__glow = glow;
      e.once('destroy', () => { if (glow.active) glow.destroy(); });
    }
    S.time.delayedCall(2200, () => { if (e.active) e.destroy(); });
  }

  /** aimed shot toward player (turrets/boss) */
  enemyAimedShot(x: number, y: number, tx: number, ty: number, speed = 380) {
    const S = this.scene;
    if (!isWithinCamera(S, x, 26)) return;
    SFX.play('shot_mg', 0.4);
    const b = this.enemyBullets.create(x, y, 'bullet_e') as Phaser.Physics.Arcade.Image;
    b.setDepth(54);
    (b.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    (b as any).dmg = Math.max(1, Math.round(diff().dmgMul));
    const rad = Math.atan2(ty - y, tx - x);
    b.setRotation(rad);
    const avx = Math.cos(rad) * speed, avy = Math.sin(rad) * speed;
    if (b.body) b.body.velocity.set(avx, avy); else b.setVelocity(avx, avy);
    const glow = S.add?.ellipse?.(x, y, 18, 8, 0xff495c, 0.5)
      ?.setDepth(53)?.setRotation(rad)?.setBlendMode?.(Phaser.BlendModes.ADD);
    if (glow) {
      (b as any).__glow = glow;
      b.once('destroy', () => { if (glow.active) glow.destroy(); });
    }
    S.time.delayedCall(3000, () => { if (b.active) b.destroy(); });
  }

  spawnGrenade(
    x: number,
    y: number,
    dir: number,
    power = 1,
    enemyOwned = false,
    vxOverride?: number,
    vyOverride?: number,
  ) {
    const S = this.scene;
    SFX.play('roll', 0.5);
    const g = this.grenades.create(x, y, 'grenade') as Phaser.Physics.Arcade.Image;
    g.setDepth(56);
    g.body!.setAllowGravity(true);
    g.body!.setBounce(0.45, 0.3);
    g.body!.setCollideWorldBounds(false);
    (g as any).fuse = S.time.now + 1100;
    (g as any).power = power;
    (g as any).enemyOwned = enemyOwned;
    const dot = S.add?.circle?.(x, y, 4, enemyOwned ? 0xff495c : 0x56f7f0, 0.85)
      ?.setDepth(57)?.setBlendMode?.(Phaser.BlendModes.ADD);
    if (dot) {
      (g as any).__fuseDot = dot;
      g.once('destroy', () => { if (dot.active) dot.destroy(); });
    }
    g.setAngularVelocity((dir || 1) * 320);
    const vx = vxOverride !== undefined ? vxOverride : (dir === 0 ? rand(-40, 40) : dir * 260);
    const vy = vyOverride !== undefined ? vyOverride : -330;
    g.body!.setVelocity(vx, vy);
  }

  update(time: number) {
    const S = this.scene;
    this.playerBullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Image & { __glow?: Phaser.GameObjects.Ellipse; isRocket?: boolean; isLaser?: boolean; __trailAt?: number };
      if (!b.active) return;
      if (b.__glow?.active) b.__glow.setPosition(b.x, b.y);
      if ((b.isRocket || b.isLaser) && time - (b.__trailAt || 0) > 42) {
        b.__trailAt = time;
        if (b.isRocket) {
          S.fx?.smoke?.(b.x, b.y, 0.35);
          S.fx?.sparkTrail?.(b.x, b.y, 0xffa64a, 3);
        } else {
          S.fx?.sparkTrail?.(b.x, b.y, 0x56f7f0, 2);
        }
      }
    });
    this.enemyBullets.getChildren().forEach((obj) => {
      const e = obj as Phaser.Physics.Arcade.Image & { __glow?: Phaser.GameObjects.Ellipse };
      if (e.active && e.__glow?.active) e.__glow.setPosition(e.x, e.y);
    });
    // grenades: fuse + ground check
    this.grenades.getChildren().slice().forEach((obj) => {
      const g = obj as Phaser.Physics.Arcade.Image & { __fuseDot?: Phaser.GameObjects.Arc; __trailAt?: number };
      if (!g.active) return;
      g.rotation += 0.2;
      if (g.__fuseDot?.active) {
        const left = Math.max(0, (g as any).fuse - time);
        const pulse = Math.sin(time * (left < 350 ? 0.055 : 0.025)) > 0 ? 1 : 0.25;
        g.__fuseDot.setPosition(g.x, g.y - 3).setAlpha(pulse).setScale(left < 350 ? 1.35 : 0.95);
      }
      if (time - (g.__trailAt || 0) > 90) {
        g.__trailAt = time;
        S.fx?.sparkTrail?.(g.x, g.y - 4, 0xd8dce4, 2);
      }
      if (time > (g as any).fuse || g.y > GROUND_Y + 260) {
        const r = 84 * (g as any).power;
        if ((g as any).enemyOwned) {
          // hurts enemies nearby, not the player (comedy fumble)
          this.explode(g.x, g.y, r, 4, true);
        } else {
          this.explode(g.x, g.y, r, 4, false);
        }
        g.destroy();
      }
    });
  }

  explode(x: number, y: number, radius: number, dmg: number, enemyBlast = false) {
    const S = this.scene;
    SFX.play(radius > 70 ? 'boom_big' : 'boom_small');
    S.fx?.bigBoom?.(x, y, radius / 60);
    shake(S, 140, 0.007);
    const targetSet = new Set<any>();
    if (S.enemies) S.enemies.getChildren().forEach((e) => targetSet.add(e));
    if (S.machines) S.machines.forEach((m: any) => targetSet.add(m));
    if (S.machineGrp) S.machineGrp.getChildren().forEach((m: any) => targetSet.add(m));
    if (S.boss?.alive) targetSet.add(S.boss);
    const targets = Array.from(targetSet);
    // Friendly grenades and rockets do not injure their owner.
    if (enemyBlast && S.player) {
      const p = S.player;
      if (Math.hypot(p.x - x, p.y - y) < radius + 20 && !p.inTank) {
        if (p.hurt(S.time.now)) p.killFx(), S.onPlayerDown?.();
      } else if ((p as any).inTank && Math.hypot(p.x - x, p.y - y) < radius + 30) {
        S.tankSys?.damageTank?.(dmg);
      }
    }
    for (const t of targets) {
      if (!t.active) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < radius) {
        if (enemyBlast && t === S.boss) continue;
        if (t.kind !== undefined && enemyBlast) { /* friendly fire on enemies is good */ }
        t.takeDamage?.(dmg);
      }
    }
    // destructible props in blast
    S.props?.damageInRadius?.(x, y, radius, dmg);
  }

  cleanupOffscreen(camX: number) {
    // Previous expression incorrectly added camX twice, leaving bullets alive
    // far beyond the camera. Kill both friendly and hostile offscreen shots.
    const kill = (group: Phaser.Physics.Arcade.Group) => {
      for (const obj of group.getChildren().slice()) {
        const sprite = obj as Phaser.GameObjects.Sprite;
        if (sprite.x < camX - 180 || sprite.x > camX + VIEW_W + 180
          || sprite.y < -220 || sprite.y > GROUND_Y + 260) sprite.destroy();
      }
    };
    kill(this.playerBullets);
    kill(this.enemyBullets);
  }

}
