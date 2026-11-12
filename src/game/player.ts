import Phaser from 'phaser';
import {
  PLAYER_SPEED, JUMP_VELOCITY, ROLL_SPEED, ROLL_TIME,
  WEAPONS, WeaponId, GROUND_Y, WORLD_W, shake,
} from './core';
import { SFX } from './audio';
import { touch, tapEdge } from '../ui/touch';
import { findSafeRespawnPoint, resolveSolidOverlap } from './world-rules';

/**
 * Playable hero. Characters share the same control scheme; each has one
 * signature trait (per concept doc):
 *  - ignis (Алекс «Искра» Волкова): fast dodge-roll — longer i-frames
 *  - volt  (Макс «Гром» Орлов):     one extra grenade & stronger blasts
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  weapon: WeaponId = 'pistol';
  ammo = 0;
  lastFire = 0;
  rolling = false;
  rollUntil = 0;
  invulnUntil = 0;
  grenades = 4;
  aimUp = false;
  aimDiagUp = false;
  aimDown = false;
  aimDiagDown = false;
  crouching = false;
  dead = false;
  inTank = false;
  charId: 'ignis' | 'volt';
  private readonly levelScene: Phaser.Scene;
  private recoilUntil = 0;
  private recoilAngle = 0;
  private wasGrounded = false;
  private lastGroundContact = -1e9;
  private jumpQueuedAt = -1e9;
  private lastFallSpeed = 0;
  private lastRollDust = 0;
  private wasCrouching = false;
  private hitboxOffsetX = 15;
  private hitboxOffsetY = 20;
  private shadow?: Phaser.GameObjects.Ellipse;
  private aimCue?: Phaser.GameObjects.Line;
  private lastGhostAt = 0;
  dropThroughUntil = 0;
  jumpPadCooldownUntil = 0;
  zipCooldownUntil = 0;
  zipState?: {
    x0: number; y0: number; x1: number; y1: number;
    t: number; speed: number; pulley?: any; resetX: number; resetY: number;
  };

  private kLeft!: Phaser.Input.Keyboard.Key;
  private kRight!: Phaser.Input.Keyboard.Key;
  private kLeftArrow!: Phaser.Input.Keyboard.Key;
  private kRightArrow!: Phaser.Input.Keyboard.Key;
  private kUpArrow!: Phaser.Input.Keyboard.Key;
  private kDownArrow!: Phaser.Input.Keyboard.Key;
  private kUp!: Phaser.Input.Keyboard.Key;
  private kDown!: Phaser.Input.Keyboard.Key;
  private kJump!: Phaser.Input.Keyboard.Key;
  private kFire!: Phaser.Input.Keyboard.Key;
  private kGrenade!: Phaser.Input.Keyboard.Key;
  private kRoll!: Phaser.Input.Keyboard.Key;
  private kAimDown!: Phaser.Input.Keyboard.Key;
  private kShift!: Phaser.Input.Keyboard.Key;

  constructor(scene: Phaser.Scene, x: number, y: number, charId: 'ignis' | 'volt') {
    super(scene, x, y, `p_${charId}_idle`);
    this.levelScene = scene;
    this.charId = charId;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const newArt = !!scene.registry.get('remasterTextures');
    this.hitboxOffsetX = newArt ? 15 : 8;
    this.hitboxOffsetY = newArt ? 20 : 2;
    (this.body as Phaser.Physics.Arcade.Body).setSize(18, 36).setOffset(this.hitboxOffsetX, this.hitboxOffsetY);
    this.shadow = scene.add.ellipse(x, GROUND_Y + 33, 30, 8, 0x05080e, 0.52).setDepth(39);
    this.aimCue = scene.add.line?.(x, y, 0, 0, 0, 26, 0x7ef2ff, 0.72)
      ?.setLineWidth?.(2)?.setDepth(51)?.setVisible(false);
    this.once('destroy', () => { this.shadow?.destroy(); this.aimCue?.destroy(); });
    this.setDepth(50);
    const K = scene.input.keyboard!;
    this.kLeft = K.addKey('A'); this.kRight = K.addKey('D');
    this.kLeftArrow = K.addKey('LEFT'); this.kRightArrow = K.addKey('RIGHT');
    this.kUpArrow = K.addKey('UP'); this.kDownArrow = K.addKey('DOWN');
    this.kUp = K.addKey('W'); this.kDown = K.addKey('S');
    this.kJump = K.addKey('SPACE'); this.kFire = K.addKey('J');
    this.kGrenade = K.addKey('K'); this.kRoll = K.addKey('L');
    this.kAimDown = K.addKey('Q'); this.kShift = K.addKey('SHIFT');
    if (charId === 'volt') this.grenades = 5;
  }

  get baseSpeed() { return this.charId === 'ignis' ? PLAYER_SPEED + 12 : PLAYER_SPEED; }

  update(time: number) {
    if (this.dead || this.inTank) { this.shadow?.setVisible(false); this.aimCue?.setVisible(false); return; }
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Recover safely if a teleport/reset placed hitbox bottom slightly inside a solid ground slab
    if (body.velocity.y >= 0 && body.bottom > GROUND_Y + 35 && body.bottom <= GROUND_Y + 60 && body.top < GROUND_Y + 35) {
      const staticBodies = (this.scene.physics?.world as any)?.staticBodies?.getArray?.() as
        Phaser.Physics.Arcade.StaticBody[] | undefined;
      if (staticBodies?.some(b =>
        b.enable && body.right > b.x && body.x < b.right && Math.abs(b.y - (GROUND_Y + 35)) <= 6
      )) {
        const pen = body.bottom - (GROUND_Y + 35);
        this.y -= pen;
        body.y -= pen;
        body.prev.y = body.y;
        body.velocity.y = 0;
        body.blocked.down = true;
      }
    }
    if (!this.zipState) resolveSolidOverlap(this, this.scene);
    const onGround = body.blocked.down;
    if (this.shadow) {
      this.shadow.setVisible(!this.rolling && body.bottom <= GROUND_Y + 42);
      const lift = Math.max(0, GROUND_Y + 35 - body.bottom);
      const sc = Phaser.Math.Clamp(1 - lift / 220, 0.35, 1);
      this.shadow.setPosition(this.x, onGround ? body.bottom - 1 : GROUND_Y + 34).setScale(sc).setAlpha(0.55 * sc);
    }
    if (onGround) this.lastGroundContact = time;
    // Use the previous physics step to detect a real landing (not initial spawn).
    if (onGround && !this.wasGrounded && this.lastFallSpeed > 130) {
      (this.scene as any).fx?.landDust?.(this.x, body.bottom, this.lastFallSpeed > 480 ? 1.4 : 1);
    }
    this.wasGrounded = onGround;
    this.lastFallSpeed = body.velocity.y;

    // end roll
    if (this.rolling && time > this.rollUntil) this.rolling = false;

    // input -> movement (keyboard + touch overlay merged)
    const T = touch;
    let mv = 0;
    if (this.kLeft.isDown || this.kLeftArrow.isDown || T.left) mv -= 1;
    if (this.kRight.isDown || this.kRightArrow.isDown || T.right) mv += 1;
    if (this.rolling) mv = this.flipX ? -1 : 1;

    const downHeld = this.kDown.isDown || this.kDownArrow.isDown || T.down;
    let wantCrouch = downHeld && onGround && !this.rolling && !this.zipState;
    if (!wantCrouch && this.wasCrouching && onGround && !this.rolling && !this.zipState) {
      // Prevent uncrouching straight into a low overhead block/tunnel ceiling.
      const statics = ((this.scene.physics?.world as any)?.staticBodies?.getArray?.() ?? []) as Phaser.Physics.Arcade.StaticBody[];
      const standTop = body.bottom - 36;
      const headCeiling = statics.some((sb) =>
        sb.enable && sb.right > body.left + 1 && sb.left < body.right - 1
        && sb.bottom > standTop + 1 && sb.top < body.bottom - 18,
      );
      if (headCeiling) wantCrouch = true;
    }
    this.crouching = wantCrouch;
    // Crouch must change the real physical hitbox, not merely the sprite.
    // A low burst can pass over the hero while the feet remain planted.
    if (this.crouching !== this.wasCrouching) {
      body.setSize(18, this.crouching ? 18 : 36)
        .setOffset(this.hitboxOffsetX, this.hitboxOffsetY + (this.crouching ? 18 : 0));
      this.wasCrouching = this.crouching;
    }
    const upHeld = this.kUp.isDown || this.kUpArrow.isDown || T.up;
    const aimDownKey = this.kAimDown.isDown || this.kShift.isDown;
    const elevated = body.bottom < GROUND_Y + 18;
    const aimFlags = resolvePlayerAim({
      upHeld,
      downHeld,
      aimDownKey,
      mv,
      onGround: onGround && !this.zipState,
      crouching: this.crouching,
      elevated,
    });
    this.aimUp = aimFlags.aimUp;
    this.aimDiagUp = aimFlags.aimDiagUp;
    this.aimDown = aimFlags.aimDown;
    this.aimDiagDown = aimFlags.aimDiagDown;

    if (!this.zipState) {
      const sp = this.baseSpeed * (this.crouching ? 0.3 : 1);
      body.setVelocityX(mv * sp);
      if (this.rolling) body.setVelocityX((this.flipX ? -1 : 1) * ROLL_SPEED);
    } else {
      body.setVelocity(0, 0);
    }
    if (mv !== 0 && !this.rolling) this.setFlipX(mv < 0);

    // jump (or vault off zipline, or S+SPACE drop-through on elevated one-way decks)
    if (Phaser.Input.Keyboard.JustDown(this.kJump) || tapEdge('justJump')) {
      if (this.zipState) {
        (this.scene as any).traversal?.releaseZip?.(this, time, 185, -430);
        SFX.play('jump');
      } else if (downHeld && onGround && this.getBottomY() < GROUND_Y + 18) {
        this.dropThroughUntil = time + 260;
        this.jumpQueuedAt = -1e9;
        this.lastGroundContact = -1e9;
        body.setVelocityY(115);
        (this.scene as any).fx?.jumpDust?.(this.x, this.getBottomY());
      } else {
        this.jumpQueuedAt = time;
      }
    }
    // Buffered jumps work 120ms before landing; coyote time permits a
    // jump up to 105ms after walking off an edge, without double-jumps.
    if (!this.rolling && !this.zipState && time - this.jumpQueuedAt < 120
      && time - this.lastGroundContact < 105) {
      this.jumpQueuedAt = -1e9;
      this.lastGroundContact = -1e9;
      body.setVelocityY(-JUMP_VELOCITY);
      SFX.play('jump');
      (this.scene as any).fx?.jumpDust?.(this.x, this.getBottomY());
    }

    // roll with i-frames
    if ((Phaser.Input.Keyboard.JustDown(this.kRoll) || tapEdge('justRoll')) && onGround && !this.rolling && !this.zipState) {
      this.rolling = true;
      SFX.play('roll');
      const bonus = this.charId === 'ignis' ? 120 : 0;
      this.rollUntil = time + ROLL_TIME + (this.charId === 'ignis' ? 0 : 90);
      this.invulnUntil = Math.max(this.invulnUntil, time + ROLL_TIME + bonus + 60);
      this.anims.stop();
      this.play(`p_${this.charId}_roll`, true);
    }
    if (this.rolling && time - this.lastRollDust > 85) {
      this.lastRollDust = time;
      (this.scene as any).fx?.jumpDust?.(this.x, body.bottom);
    }
    if (this.rolling && time - this.lastGhostAt > 48) {
      this.lastGhostAt = time;
      const g = this.scene.add.sprite(this.x, this.y, this.texture.key, this.frame.name)
        .setFlipX(this.flipX).setDepth(49).setAlpha(0.42)
        .setTint(this.charId === 'ignis' ? 0xff7e47 : 0x56d8f0);
      this.scene.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
    }

    // fire (tap or hold — cooldown gates rate)
    if (this.kFire.isDown || touch.fire || this.scene.input.activePointer.leftButtonDown()) this.tryFire(time);
    if (Phaser.Input.Keyboard.JustDown(this.kGrenade) || tapEdge('justGrenade')) this.throwGrenade();

    // animation state
    this.applyAnim(onGround, mv);

    // Brief visual recoil rotates the artwork, not the physics hitbox.
    // Compute it from time so automatic-fire never accumulates tweens.
    if (!this.rolling && time < this.recoilUntil) {
      const fraction = (this.recoilUntil - time) / 100;
      this.setAngle(this.recoilAngle * Math.max(0, fraction));
    } else if (this.angle !== 0) this.setAngle(0);

    if (this.aimCue?.active) {
      const showDownCue = (this.aimDown || this.aimDiagDown) && !this.rolling;
      this.aimCue.setVisible(showDownCue);
      if (showDownCue) {
        const sign = this.flipX ? -1 : 1;
        const dx = this.aimDown ? 0 : sign * 20;
        const dy = this.aimDown ? 26 : 20;
        this.aimCue.setPosition(this.x + (this.aimDown ? 0 : sign * 8), this.y + (this.crouching ? 8 : 2));
        this.aimCue.setTo(0, 0, dx, dy);
      }
    }

    // clamp inside world
    this.x = Phaser.Math.Clamp(this.x, 24, WORLD_W - 24);
    // blink while invulnerable
    if (time < this.invulnUntil) this.setAlpha(Math.floor(time / 90) % 2 ? 0.35 : 1);
    else this.setAlpha(1);
  }

  private applyAnim(onGround: boolean, mv: number) {
    if (this.rolling) return; // roll anim plays itself
    const id = this.charId;
    if (!onGround) { this.anims.stop(); this.setTexture(`p_${id}_jump`, 'f0'); return; }
    if (this.crouching) { this.anims.stop(); this.setTexture(`p_${id}_crouch`); return; }
    if (this.aimUp) { this.anims.stop(); this.setTexture(`p_${id}_aimup`, 'f0'); return; }
    if (mv !== 0) {
      if (this.texture.key !== `p_${id}_run`) this.play(`p_${id}_run`, true);
      return;
    }
    if (this.anims.isPlaying) this.anims.stop();
    if (this.texture.key !== `p_${id}_idle`) this.play(`p_${id}_idle`, true);
  }

  /** Phaser world-space aiming avoids browser CSS/window scaling bugs.
   * W/↑ aims upward, Q/Shift (or S/↓ in mid-air or on elevated ledges) aims downward,
   * and holding mouse-left aims freely toward cursor world position. */
  getAimDirection(): Phaser.Math.Vector2 {
    const pointer = this.scene.input.activePointer;
    if (pointer?.leftButtonDown()) {
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const offset = new Phaser.Math.Vector2(world.x - this.x, world.y - this.y);
      if (offset.lengthSq() > 100) return offset.normalize();
    }
    const sign = this.flipX ? -1 : 1;
    if (this.aimUp) return new Phaser.Math.Vector2(0, -1);
    if (this.aimDiagUp) return new Phaser.Math.Vector2(sign, -1).normalize();
    if (this.aimDown) return new Phaser.Math.Vector2(0, 1);
    if (this.aimDiagDown) return new Phaser.Math.Vector2(sign, 1).normalize();
    return new Phaser.Math.Vector2(sign, 0);
  }

  tryFire(time: number) {
    const spec = WEAPONS[this.weapon];
    if (time - this.lastFire < spec.cooldown) return;
    if (spec.ammoMax > 0 && this.ammo <= 0) {
      this.weapon = 'pistol'; this.ammo = 0;
      (this.scene as any).hud?.flashWeapon?.('ПАТРОНЫ КОНЧИЛИСЬ');
      return;
    }
    this.lastFire = time;
    if (spec.ammoMax > 0) this.ammo--;

    const dir = this.getAimDirection();
    // Mouse direction also controls facing; keyboards use left/right + up/down.
    if (Math.abs(dir.x) > .15) this.setFlipX(dir.x < 0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    const onGround = body?.blocked?.down ?? false;
    const onOneWay = onGround && !!(this.scene as any).traversal?.findCurrentDeck?.(this.x, body.bottom);
    let mx = this.x + dir.x * (dir.y > 0.25 && onGround ? 22 : 20);
    let my = this.y + (this.crouching ? 10 : -2) + dir.y * 16;
    if (dir.y > 0.25 && onGround) {
      if (onOneWay) {
        // Drop shot cleanly below one-way bridge/crane boom.
        my = body.bottom + 2;
      } else {
        // Keep diagonal shots spawned above solid container tops so they clear ledges cleanly.
        my = Math.min(my, body.bottom - 5);
        mx = this.x + dir.x * 23;
      }
    }
    const w = (this.scene as any).weapons;
    if (w?.playerShoot) w.playerShoot(this, spec, mx, my, dir);
    const strength = this.weapon === 'shotgun' ? 1.55 : this.weapon === 'mg' ? 1.1 : 1;
    this.recoilUntil = time + 100;
    this.recoilAngle = (this.flipX ? -1 : 1) * (this.weapon === 'shotgun' ? -8 : this.weapon === 'mg' ? -3 : -5);
    (this.scene as any).fx?.muzzle?.(mx, my, dir, strength);
  }

  throwGrenade() {
    if (this.grenades <= 0 || this.dead) return;
    this.grenades--;
    const power = this.charId === 'volt' ? 1.25 : 1;
    (this.scene as any).weapons?.spawnGrenade?.(this.x, this.y - 8, this.flipX ? -1 : 1, power);
  }

  giveWeapon(w: WeaponId) {
    this.weapon = w;
    this.ammo = WEAPONS[w].ammoMax;
    (this.scene as any).hud?.flashWeapon?.(WEAPONS[w].name);
  }

  /** returns true if damage actually applied */
  hurt(time: number): boolean {
    if (!this.active || !this.scene || time < this.invulnUntil || this.dead || this.inTank) return false;
    this.dead = true;
    return true;
  }

  respawn(x: number, time: number, y?: number) {
    this.dead = false;
    this.inTank = false;
    this.rolling = false;
    this.setVisible(true);
    this.zipState = undefined;
    this.dropThroughUntil = 0;
    this.jumpPadCooldownUntil = 0;
    this.zipCooldownUntil = 0;
    const safe = y !== undefined ? { x, y } : findSafeRespawnPoint(this.scene, x);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    this.invulnUntil = time + 2300;
    this.weapon = 'pistol'; this.ammo = 0;
    this.grenades = this.charId === 'volt' ? 5 : 4;
    this.recoilUntil = 0;
    this.lastFallSpeed = 0;
    this.wasGrounded = false;
    this.lastGroundContact = -1e9;
    this.jumpQueuedAt = -1e9;
    this.wasCrouching = false;
    this.crouching = false;
    this.aimUp = false;
    this.aimDiagUp = false;
    this.aimDown = false;
    this.aimDiagDown = false;
    body.setSize(18, 36)
      .setOffset(this.hitboxOffsetX, this.hitboxOffsetY);
    body.reset(safe.x, safe.y);
    this.setPosition(safe.x, safe.y);
    this.setAngle(0);
    resolveSolidOverlap(this, this.scene);
  }

  killFx() {
    this.setVisible(false);
    this.aimCue?.setVisible(false);
    SFX.play('hurt');
    if (!this.levelScene.sys.isActive()) return;
    const fx = (this.levelScene as any).fx;
    fx?.bigBoom?.(this.x, this.y);
    shake(this.levelScene, 220, 0.008);
  }

  getBottomY() { return (this.body as Phaser.Physics.Arcade.Body).bottom; }
}

export interface PlayerAimFlags {
  aimUp: boolean;
  aimDiagUp: boolean;
  aimDown: boolean;
  aimDiagDown: boolean;
}

/**
 * Resolve vertical & diagonal player aiming without breaking grounded S/↓ crouch.
 * - Q/Shift always allow aiming downward (straight down on bridges/air, diag down elsewhere).
 * - S/↓ aims downward when airborne, on a zipline, or moving horizontally along elevated decks.
 */
export function resolvePlayerAim(opts: {
  upHeld: boolean;
  downHeld: boolean;
  aimDownKey: boolean;
  mv: number;
  onGround: boolean;
  crouching: boolean;
  elevated: boolean;
}): PlayerAimFlags {
  const { upHeld, downHeld, aimDownKey, mv, onGround, crouching, elevated } = opts;
  if (upHeld && (!crouching || mv !== 0)) {
    return {
      aimUp: mv === 0 && !crouching,
      aimDiagUp: mv !== 0,
      aimDown: false,
      aimDiagDown: false,
    };
  }
  if (aimDownKey) {
    return {
      aimUp: false,
      aimDiagUp: false,
      aimDown: mv === 0 && (!onGround || elevated),
      aimDiagDown: mv !== 0 || (onGround && !elevated),
    };
  }
  if (downHeld && (!onGround || (elevated && mv !== 0))) {
    return {
      aimUp: false,
      aimDiagUp: false,
      aimDown: !onGround && mv === 0,
      aimDiagDown: mv !== 0,
    };
  }
  return { aimUp: false, aimDiagUp: false, aimDown: false, aimDiagDown: false };
}
