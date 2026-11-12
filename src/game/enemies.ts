import Phaser from 'phaser';
import { paintNaturalCrouchPose } from './crouch-pose';
import { SFX } from './audio';
import { GROUND_Y, addScore, scorePopup, shake, rand, diff } from './core';
import { alignActorFeet, isWithinCamera } from './world-rules';

/**
 * Enemy roster — 5+ behavioural varieties (per concept section 6):
 *  rifle   — advances, fires bursts, hides behind containers briefly
 *  gren    — nervous grenadier, sometimes fumbles & drops his own grenade
 *  heavy   — armored gunner, long deploy time before firing (telegraphed)
 *  spider  — mechanical spider, crawls on ceiling, drops down near player
 *  officer — calls reinforcements, flees when his squad is wiped
 *  drone   — repair drone, heals nearby machines (priority target)
 *  sentinel — armored polar/spire commando firing rapid plasma bursts
 *  turret  — emplaced MG nest; destructible cover object that shoots back
 */

export type EnemyKind = 'rifle' | 'gren' | 'heavy' | 'spider' | 'officer' | 'drone' | 'sentinel';

let enemyIdCounter = 1;

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  kind: EnemyKind;
  hp = 2;
  hpMax = 2;
  scoreValue = 100;
  lastShot = 0;
  state: 'idle' | 'advance' | 'aim' | 'fire' | 'cover' | 'deploy' | 'flee' | 'crawl' | 'windup' | 'drop' | 'hover' = 'idle';
  stateUntil = 0;
  homeX = 0;
  facingLeft = true;
  id = enemyIdCounter++;
  /** set true for the "surrender gag" soldier */
  surrendering = false;
  private eatTimer = 0;
  private lastFootstep = 0;
  private nextEvadeAt = 0;
  private nextSeparationJumpAt = 0;
  dropThroughUntil = 0;
  private nextClimbAt = 0;
  private nextLungeAt = 0;
  private nextObstacleJumpAt = 0;
  crouching = false;
  private crouchedUntil = 0;
  private baseTexKey = 'e_rifle';
  private baseAnimKey = '';
  rallyBuffUntil = 0;
  evades = 0;
  private intentCue: Phaser.GameObjects.Text | null = null;
  private shadow: Phaser.GameObjects.Ellipse | null = null;
  private hpBg: Phaser.GameObjects.Rectangle | null = null;
  private hpFill: Phaser.GameObjects.Rectangle | null = null;
  private aimBeam: Phaser.GameObjects.Rectangle | null = null;
  private webLine: Phaser.GameObjects.Rectangle | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, textureKey: string) {
    super(scene, x, y, textureKey);
    this.kind = 'rifle';
    scene.add.existing(this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.intentCue?.destroy();
      this.intentCue = null;
      this.shadow?.destroy();
      this.hpBg?.destroy();
      this.hpFill?.destroy();
      this.aimBeam?.destroy();
    });
  }

  /** Threat cue is displayed before an attack, not after the bullet leaves. */
  private showIntent(text: string, duration: number) {
    if (this.intentCue?.active) return;
    const scene = this.scene;
    if (!scene.sys.isActive()) return;
    const cue = scene.add.text(this.x, this.y - this.displayHeight * 0.7, text, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffd080',
      stroke: '#2a1512', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(110);
    this.intentCue = cue;
    scene.tweens.add({ targets: cue, y: cue.y - 13, duration, alpha: 0.35 });
    scene.time.delayedCall(duration, () => {
      if (cue.active) cue.destroy();
      if (this.intentCue === cue) this.intentCue = null;
    });
  }

  init(kind: EnemyKind, x: number, y: number) {
    this.kind = kind;
    this.homeX = x;
    const S = this.scene as any;
    const skey = S.scene?.key || '';
    const isJungle = skey === 'Jungle';
    const isFacility = skey === 'Facility';
    switch (kind) {
      case 'rifle':
        if (isJungle && S.textures?.exists('e_bio')) {
          this.baseTexKey = 'e_bio';
          this.setTexture('e_bio');
          if (S.anims?.exists('e_bio_walk')) { this.baseAnimKey = 'e_bio_walk'; this.play('e_bio_walk', true); }
        } else if (isFacility && S.textures?.exists('e_exo')) {
          this.baseTexKey = 'e_exo';
          this.setTexture('e_exo');
          if (S.anims?.exists('e_exo_walk')) { this.baseAnimKey = 'e_exo_walk'; this.play('e_exo_walk', true); }
        } else {
          this.baseTexKey = 'e_rifle';
          this.setTexture('e_rifle');
          if (S.anims?.exists('e_rifle_run')) { this.baseAnimKey = 'e_rifle_run'; this.play('e_rifle_run', true); }
        }
        this.hp = 2; this.scoreValue = 100; break;
      case 'gren':
        this.baseTexKey = 'e_gren';
        this.setTexture('e_gren');
        if (S.anims?.exists('e_gren_idle')) { this.baseAnimKey = 'e_gren_idle'; this.play('e_gren_idle', true); }
        this.hp = 2; this.scoreValue = 150; break;
      case 'heavy':
        this.baseTexKey = 'e_heavy';
        this.baseAnimKey = '';
        this.setTexture('e_heavy');
        this.hp = 8; this.scoreValue = 400; break;
      case 'spider':
        if (isJungle && S.textures?.exists('jg_stalker')) {
          this.baseTexKey = 'jg_stalker';
          this.setTexture('jg_stalker');
          if (S.anims?.exists('e_stalker_prowl')) { this.baseAnimKey = 'e_stalker_prowl'; this.play('e_stalker_prowl', true); }
        } else {
          this.baseTexKey = 'e_spider';
          this.setTexture('e_spider');
          if (S.anims?.exists('e_spider_crawl')) { this.baseAnimKey = 'e_spider_crawl'; this.play('e_spider_crawl', true); }
        }
        this.hp = 3; this.scoreValue = 200; break;
      case 'officer':
        if (isFacility && S.textures?.exists('e_exo')) {
          this.baseTexKey = 'e_exo';
          this.baseAnimKey = '';
          this.setTexture('e_exo', S.textures.get('e_exo').has('f0') ? 'f0' : undefined);
        } else {
          this.baseTexKey = 'e_officer';
          this.baseAnimKey = '';
          this.setTexture('e_officer');
        }
        this.hp = 3; this.scoreValue = 300; break;
      case 'drone':
        this.baseTexKey = 'e_drone';
        this.setTexture('e_drone');
        if (S.anims?.exists('e_drone_hover')) { this.baseAnimKey = 'e_drone_hover'; this.play('e_drone_hover', true); }
        this.hp = 2; this.scoreValue = 250; break;
      case 'sentinel':
        if (S.textures?.exists('e_sentinel')) {
          this.baseTexKey = 'e_sentinel';
          this.setTexture('e_sentinel');
          if (S.anims?.exists('e_sentinel_walk')) { this.baseAnimKey = 'e_sentinel_walk'; this.play('e_sentinel_walk', true); }
        } else {
          this.baseTexKey = 'e_heavy';
          this.baseAnimKey = '';
          this.setTexture('e_heavy');
        }
        this.hp = 4; this.scoreValue = 260; break;
    }
    if (!this.body) S.physics.add.existing(this); // body must exist before setSize
    this.setSizeForKind();
    // масштабирование под выбранную сложность (hpMul / scoreBonus)
    const d = diff();
    this.hp = Math.max(1, Math.round(this.hp * d.hpMul));
    this.hpMax = this.hp;
    this.scoreValue = Math.round(this.scoreValue * d.scoreBonus);
    this.setDepth(40);
    (this.body as Phaser.Physics.Arcade.Body).setAllowGravity(kind !== 'spider' && kind !== 'drone');
    (this.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(false);
    if (kind === 'spider') {
      this.y = 120;
      this.state = 'crawl';
      this.webLine = S.add?.rectangle?.(x, 55, 2, 110, 0x9aa6b8, 0.7)?.setDepth(35) ?? null;
      this.once?.(Phaser.GameObjects.Events.DESTROY, () => {
        this.webLine?.destroy();
        this.webLine = null;
      });
    }
    if (kind === 'drone') { this.y = y - 90; this.state = 'hover'; }
    // one in eight riflemen sits down and eats a canned lunch (Metal-Slug gag)
    if (kind === 'rifle' && Math.random() < 0.16) { this.eatTimer = rand(2500, 4500); this.state = 'idle'; }
    const barW = (kind === 'heavy' || kind === 'sentinel') ? 38 : 28;
    if (S.add?.ellipse) {
      this.shadow = S.add.ellipse(x, GROUND_Y + 32, kind === 'heavy' ? 38 : 26, 7, 0x05080d, 0.42).setDepth(37);
      this.hpBg = S.add.rectangle(x, y - 32, barW, 4, 0x0d121a, 0.88).setDepth(95).setVisible(false);
      this.hpFill = S.add.rectangle(x - barW / 2 + 1, y - 32, barW - 2, 2, 0xff5a52)
        .setOrigin(0, 0.5).setDepth(96).setVisible(false);
      this.aimBeam = S.add.rectangle(x, y - 6, 120, 1.5, 0xff495c, 0.55)
        .setOrigin(0, 0.5).setDepth(90).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    }
    return this;
  }

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);
    if (!this.active) return;
    const body = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (this.shadow?.active) {
      if (this.kind === 'drone') {
        this.shadow.setPosition(this.x, GROUND_Y + 32).setScale(0.75).setAlpha(0.24).setVisible(this.visible);
      } else if (body && body.top < GROUND_Y + 25) {
        const sy = body.blocked.down ? body.bottom - 1 : GROUND_Y + 32;
        const airborne = !body.blocked.down && body.allowGravity;
        this.shadow.setPosition(this.x, sy).setAlpha(airborne ? 0.2 : 0.42).setVisible(this.visible && body.allowGravity);
      } else {
        this.shadow.setVisible(false);
      }
    }
    if (this.hpBg?.active && this.hpFill?.active) {
      const show = this.visible && this.hp < this.hpMax && this.hp > 0 && this.hpMax > 1;
      const barW = (this.kind === 'heavy' || this.kind === 'sentinel') ? 38 : 28;
      const by = this.y - this.displayHeight * 0.52;
      this.hpBg.setVisible(show).setPosition(this.x, by);
      const frac = Math.max(0, Math.min(1, this.hp / Math.max(1, this.hpMax)));
      this.hpFill.setVisible(show).setPosition(this.x - barW / 2 + 1, by)
        .setDisplaySize(Math.max(1, Math.round((barW - 2) * frac)), 2);
    }
    if (this.aimBeam?.active && (!this.visible || this.state !== 'aim' || this.surrendering)) {
      this.aimBeam.setVisible(false);
    }
    if (this.webLine?.active) {
      if (this.kind === 'spider' && (this.state === 'crawl' || this.state === 'windup') && this.y < GROUND_Y - 60) {
        const len = Math.max(8, this.y - 10);
        this.webLine.setVisible(this.visible).setPosition(this.x, len / 2).setDisplaySize(2, len);
      } else {
        this.webLine.destroy();
        this.webLine = null;
      }
    }
  }

  standingDimensions(): [number, number] {
    return this.kind === 'heavy' ? [34, 40]
      : this.kind === 'sentinel' ? [24, 38]
      : this.kind === 'spider' ? [34, 30]
      : this.kind === 'drone' ? [28, 23] : [20, 34];
  }

  crouchingDimensions(): [number, number] {
    return this.kind === 'heavy' ? [32, 22]
      : this.kind === 'sentinel' ? [24, 22]
      : this.kind === 'spider' ? [32, 18]
      : [20, 18];
  }

  setSizeForKind() {
    // Derive body offsets from each visible frame, not arbitrary atlas margins.
    // Body bottom sits at the soles instead of down inside the train/terrain.
    const [w, h] = this.crouching ? this.crouchingDimensions() : this.standingDimensions();
    alignActorFeet(this, w, h);
  }

  setCrouch(on: boolean) {
    if (this.kind === 'drone' || !this.activeBody()) return;
    if (this.crouching === on) return;
    this.crouching = on;
    if (on) {
      this.anims?.stop?.();
      const crouchKey = ensureEnemyCrouchTexture(this.scene, this.baseTexKey);
      if (this.scene.textures?.exists(crouchKey)) {
        this.setTexture(crouchKey);
      }
    } else {
      if (this.scene.textures?.exists(this.baseTexKey)) {
        const hasF0 = this.scene.textures.get(this.baseTexKey).has('f0');
        this.setTexture(this.baseTexKey, hasF0 ? 'f0' : undefined);
      }
      if (this.baseAnimKey && this.scene.anims?.exists(this.baseAnimKey)) {
        this.play(this.baseAnimKey, true);
      }
    }
    this.setSizeForKind();
  }

  private getStaticObstacles(): ObstacleBox[] {
    const entries = ((this.scene as any)?.physics?.world?.staticBodies?.entries ?? []) as Array<Phaser.Physics.Arcade.StaticBody>;
    const boxes: ObstacleBox[] = [];
    for (const sb of entries) {
      if (!sb?.enable) continue;
      boxes.push({ left: sb.left, right: sb.right, top: sb.top, bottom: sb.bottom });
    }
    return boxes;
  }

  private navigateObstacles(time: number, b: Phaser.Physics.Arcade.Body, dirToPlayer: number) {
    if (this.kind === 'drone' || !b.allowGravity || this.state === 'crawl' || this.state === 'windup' || this.state === 'drop') {
      return;
    }
    const obstacles = this.getStaticObstacles();
    if (!obstacles.length) return;
    const [, standH] = this.standingDimensions();
    const [, crouchH] = this.crouchingDimensions();
    const vx = b.velocity.x;
    const moveDir = Math.abs(vx) > 5 ? Math.sign(vx) : dirToPlayer;
    const probe = evaluateObstacleAhead(
      { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      standH,
      crouchH,
      moveDir,
      obstacles,
      Math.abs(vx) > 5,
    );

    if (probe.crouch) {
      this.crouchedUntil = time + 260;
      this.setCrouch(true);
      if (b.blocked.down && Math.abs(vx) > 5) {
        b.setVelocityX(moveDir * Math.max(72, Math.abs(vx) * 0.9));
      }
      return;
    }

    if (this.crouching && time >= this.crouchedUntil && !probe.ceilingOverhead) {
      this.setCrouch(false);
    }

    const blockedHoriz = (b.blocked.left && moveDir < 0) || (b.blocked.right && moveDir > 0) || probe.jump;
    if (blockedHoriz && b.blocked.down && Math.abs(vx) > 5 && !probe.ceilingOverhead && time > this.nextObstacleJumpAt) {
      this.nextObstacleJumpAt = time + 880;
      b.setVelocityY(-545);
      this.showIntent('↑', 260);
      (this.scene as any).fx?.jumpDust?.(this.x, b.bottom);
    }
  }

  takeDamage(d: number) { damageEnemy(this.scene, this, d); }

  behavior(time: number, player: Phaser.GameObjects.Sprite) {
    if (this.surrendering || !this.activeBody()) return;
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Fallen enemies must never remain alive and shooting under the floor.
    // Under-floor actors are never left alive or permitted to shoot from below.
    // Judge actual hurtbox top, not sprite origin (remastered frames have
    // large transparent margins). A ground spider can have y > 502 while
    // its entire hittable body is still above the 505px floor.
    if (body.top > GROUND_Y + 55) { this.destroy(); return; }
    // Never attack, wind up, throw grenades, or rally from outside the camera viewport.
    if (!isWithinCamera(this.scene, this.x, 22)) {
      this.aimBeam?.setVisible(false);
      const cam = this.scene.cameras.main;
      const viewCenter = cam.scrollX + cam.width / 2;
      const dirIn = viewCenter >= this.x ? 1 : -1;
      if (this.kind !== 'drone' && this.kind !== 'spider' && Math.abs(this.x - player.x) <= 580) {
        body.setVelocityX(dirIn * 68);
        this.setFlipX(dirIn < 0);
      } else {
        body.setVelocityX(0);
        if (this.kind === 'drone' || (this.kind === 'spider' && !body.allowGravity)) body.setVelocityY(0);
      }
      return;
    }
    const S = this.scene as any;
    const px = player.x, py = player.y;
    const dx = px - this.x;
    const dirToPlayer = dx >= 0 ? 1 : -1;
    this.setFlipX(dirToPlayer < 0);
    const dist = Math.abs(dx);
    const b = this.body as Phaser.Physics.Arcade.Body;
    // Separation / disengagement is mandatory for *all* grounded hostiles.
    // Previously landed spiders ran straight through the hero forever;
    // bullets originate beyond the overlapping sprite, making it seem immortal.
    // Don't override downward air motion while a spider is still dropping.
    if (dist < 72 && Math.abs(py - this.y) < 70
      && (this.kind !== 'spider' || b.blocked.down || this.state === 'idle')) {
      b.setVelocityX(-dirToPlayer * (this.kind === 'heavy' ? 115 : 175));
      if (this.kind === 'spider' && b.blocked.down && time > this.nextSeparationJumpAt) {
        // One short hop away, not an endless contact-damage loop.
        this.nextSeparationJumpAt = time + 2000;
        b.setVelocityY(-270);
      }
      return;
    }
    // Ordinary soldiers sometimes *react* to bullets rather than standing
    // motionless until killed. Cooldown and real incoming-shot detection keep
    // it readable and prevent endless dodging.
    if ((this.kind === 'rifle' || this.kind === 'gren' || this.kind === 'sentinel') && dist < 380
      && b.blocked.down && time > this.nextEvadeAt) {
      const bullets = S.weapons?.playerBullets?.getChildren?.() ?? [];
      const threatened = bullets.some((obj: Phaser.GameObjects.GameObject) => {
        const shot = obj as Phaser.Physics.Arcade.Image;
        const velocityX = (shot.body as Phaser.Physics.Arcade.Body | null)?.velocity.x ?? 0;
        return shot.active && !(shot as any).isRocket && Math.abs(shot.x - this.x) < 155
          && Math.abs(shot.y - this.y) < 53 && (this.x - shot.x) * velocityX > 0;
      });
      if (threatened) {
        b.setVelocityY(-390);
        this.nextEvadeAt = time + rand(2700, 3900);
        this.evades++;
        this.showIntent('↗', 300);
        if (this.kind === 'rifle') {
          this.state = 'cover';
          this.stateUntil = time + 680;
        }
        S.fx?.jumpDust?.(this.x, b.bottom);
      }
    }

    switch (this.kind) {
      case 'rifle': {
        if (this.eatTimer > 0 && time > this.rallyBuffUntil) {
          this.eatTimer -= 16;
          b.setVelocityX(0);
          if (this.eatTimer <= 0 && dist < 520) {
            this.state = 'advance'; this.stateUntil = time + 350;
          }
          break;
        }
        const speedMul = time < this.rallyBuffUntil ? 1.25 : 1;
        // Advance -> visible aiming cue -> short burst -> retreat behind cover.
        // All transitions are time-gated to prevent firing every physics frame.
        if (this.state === 'idle' && dist < 540) {
          this.state = 'advance'; this.stateUntil = time + 480;
        }
        if (this.state === 'advance' && dist < 325 && time >= this.stateUntil && isWithinCamera(this.scene, this.x, 26)) {
          this.state = 'aim';
          this.stateUntil = time + 440 * diff().rateMul;
          this.showIntent('!', 400 * diff().rateMul);
        }
        if (this.state === 'aim' && this.aimBeam?.active) {
          const muzY = this.y + (this.crouching ? 4 : -6);
          const beamLen = Math.min(260, Math.max(40, dist - 8));
          const ang = Math.atan2((py - 8) - muzY, px - this.x);
          this.aimBeam.setVisible(true).setPosition(this.x + dirToPlayer * 12, muzY)
            .setRotation(ang).setDisplaySize(beamLen, 1.6)
            .setAlpha(0.32 + 0.28 * Math.sin(time * 0.04));
        }
        if (this.state === 'aim' && time >= this.stateUntil) {
          this.aimBeam?.setVisible(false);
          if (dist < 500) this.shootBurst(time, dirToPlayer, 2);
          this.lastShot = time;
          this.state = 'cover';
          this.stateUntil = time + 620 * diff().rateMul;
        } else if (this.state === 'cover' && time >= this.stateUntil) {
          this.state = 'advance';
          this.stateUntil = time + 650 * diff().rateMul;
        }
        if (this.state === 'advance') b.setVelocityX(dirToPlayer * (dist < 90 ? 60 : 105) * speedMul);
        else if (this.state === 'cover') b.setVelocityX(dist < 165 ? -dirToPlayer * 90 : 0);
        else b.setVelocityX(0);
        break;
      }
      case 'gren': {
        if (this.state === 'deploy' && time >= this.stateUntil) {
          if (isWithinCamera(this.scene, this.x, 24)) {
            const fumble = Math.random() < 0.16;
            const elevated = py < this.y - 38;
            const vxArc = fumble ? 0 : Phaser.Math.Clamp((px - this.x) * 1.15, -360, 360);
            const vyArc = fumble ? -300 : (elevated ? -560 : -345);
            S.weapons.spawnGrenade(
              this.x + (fumble ? 0 : dirToPlayer * 30),
              this.y - 14,
              fumble ? 0 : dirToPlayer,
              0.8,
              true,
              vxArc,
              vyArc,
            );
            if (fumble) S.hud?.toast?.(`${this.squadText()} уронил гранату!`);
          }
          this.state = 'idle';
          this.stateUntil = time + rand(1800, 2700) * diff().rateMul;
        } else if (this.state !== 'deploy' && time >= this.stateUntil) {
          if (dist < 420 && dist > 105 && isWithinCamera(this.scene, this.x, 30)) {
            this.state = 'deploy';
            this.stateUntil = time + 660 * diff().rateMul;
            this.showIntent('G!', 600 * diff().rateMul);
          } else this.stateUntil = time + 450;
        }
        b.setVelocityX(this.state === 'deploy' ? 0 : dist > 165 ? dirToPlayer * 58 : -dirToPlayer * 42);
        break;
      }
      case 'heavy': {
        if (this.state === 'idle') {
          b.setVelocityX(dirToPlayer * 42);
          if (dist < 380 && isWithinCamera(this.scene, this.x, 30)) {
            this.state = 'deploy';
            this.stateUntil = time + 1500 * diff().rateMul;
            S.fx.smoke?.(this.x, this.y);
            this.showIntent('!!!', 1100 * diff().rateMul);
          }
        } else if (this.state === 'deploy') {
          b.setVelocityX(0);
          if (time > this.stateUntil) { this.state = 'fire'; this.stateUntil = time + 1500 * diff().rateMul; }
        } else if (this.state === 'fire') {
          b.setVelocityX(0);
          if (time - this.lastShot > 680 * diff().rateMul) {
            this.shootBurst(time, dirToPlayer, 4, 'bullet_e');
            this.lastShot = time;
          }
          if (time > this.stateUntil) { this.state = 'deploy'; this.stateUntil = time + 1150 * diff().rateMul; this.showIntent('↻', 900 * diff().rateMul); }
        }
        break;
      }
      case 'spider': {
        if (this.state === 'crawl') {
          b.setVelocityX(dirToPlayer * 108);
          if (dist < 115) {
            this.state = 'windup';
            this.stateUntil = time + 650 * diff().rateMul;
            b.setVelocityX(0);
            this.showIntent('▼', 600 * diff().rateMul);
          }
        } else if (this.state === 'windup') {
          b.setVelocityX(0);
          if (time >= this.stateUntil) {
            this.state = 'drop';
            b.setAllowGravity(true);
            S.fx.smoke?.(this.x, this.y + 10);
          }
        } else if (this.state === 'drop') {
          if (b.blocked.down) {
            this.state = 'idle'; this.stateUntil = time + 350;
            this.setRotation(0);
            // Keep sprite/body in sync after the ceiling-to-floor transition.
            this.setSizeForKind();
          }
        } else {
          // Ground stalker/spider charges, performs periodic lunges, and retreats below 92 px.
          if (dist > 100 && dist < 190 && b.blocked.down && time > this.nextLungeAt && Math.abs(py - this.y) < 110) {
            this.nextLungeAt = time + rand(2300, 3400);
            b.setVelocity(dirToPlayer * 235, -315);
            this.showIntent('⚡', 340);
          } else if (b.blocked.down) {
            if (dist > 128) b.setVelocityX(dirToPlayer * 98);
            else if (dist < 92) b.setVelocityX(-dirToPlayer * 145);
            else b.setVelocityX(0);
          }
        }
        break;
      }
      case 'officer': {
        if (this.state === 'idle') {
          // Call reinforcement and rally nearby squad once when player approaches in view.
          if (dist < 420 && isWithinCamera(this.scene, this.x, 28)) {
            this.state = 'flee';
            const allies = (S.enemies?.getChildren?.() ?? []) as Enemy[];
            const activeCount = allies.filter((a) => a.active).length;
            allies.forEach((ally) => {
              if (ally.active && ally !== this && Math.abs(ally.x - this.x) < 380) {
                ally.rallyBuffUntil = time + 5000;
              }
            });
            if (activeCount < 5) {
              if (Math.random() < 0.5) S.requestReinforcement?.(this.x + dirToPlayer * 260);
              else S.traversal?.spawnDropIn?.('rifle', px + 180, '▼ ДЕСАНТ');
            }
            S.hud?.toast?.('Офицер вызывает подкрепление!');
            S.radio?.say?.('reinforce');
          }
          b.setVelocityX(0);
        } else {
          b.setVelocityX(-dirToPlayer * 150); // runs away
          if (this.x < 30 || this.x > GROUND_Y_XMAX()) this.state = 'idle';
        }
        break;
      }
      case 'drone': {
        // Priority 1: hover toward nearest damaged machine and weld it.
        const target = S.nearestDamaged?.(this.x);
        if (target) {
          const tdx = target.x - this.x;
          b.setVelocityX(Math.sign(tdx) * Math.min(120, Math.abs(tdx)));
          b.setVelocityY(Math.cos(time / 500 + this.id) * 24);
          this.setFlipX(tdx < 0);
          if (Math.abs(tdx) < 46 && time - this.lastShot > 450) {
            target.heal?.(1);
            this.lastShot = time;
            S.fx.weld?.(target.x, target.y - 10);
          }
        } else {
          // Priority 2: active high-flank gun drone firing telegraphed angled plasma shots.
          const desiredX = px - dirToPlayer * 225;
          const flankDx = desiredX - this.x;
          const swayX = Math.sin(time / 650 + this.id) * 48;
          const vx = Phaser.Math.Clamp(flankDx * 0.9, -110, 110) + swayX * 0.5;
          const targetY = Phaser.Math.Clamp(py - 105, 115, 290);
          const vy = Phaser.Math.Clamp((targetY - this.y) * 1.4, -75, 75) + Math.cos(time / 480 + this.id) * 22;
          b.setVelocity(vx, vy);

          if (dist < 420 && isWithinCamera(this.scene, this.x, 40)) {
            if (this.state !== 'aim' && time >= this.stateUntil && time - this.lastShot > 2100 * diff().rateMul) {
              this.state = 'aim';
              this.stateUntil = time + 440 * diff().rateMul;
              this.showIntent('⚡', 420 * diff().rateMul);
            } else if (this.state === 'aim' && time >= this.stateUntil) {
              this.state = 'hover';
              this.lastShot = time;
              this.stateUntil = time + 1200 * diff().rateMul;
              S.weapons?.enemyAimedShot?.(this.x, this.y + 8, px, py - 6, 335);
              S.fx?.enemyMuzzle?.(this.x, this.y + 8, dirToPlayer);
            }
          }
        }
        break;
      }
      case 'sentinel': {
        const speedMul = time < this.rallyBuffUntil ? 1.25 : 1;
        if (this.state === 'idle' && dist < 560) {
          this.state = 'advance';
          this.stateUntil = time + 420;
        }
        if (this.state === 'advance' && dist < 375 && time >= this.stateUntil && isWithinCamera(this.scene, this.x, 26)) {
          this.state = 'aim';
          this.stateUntil = time + 450 * diff().rateMul;
          this.showIntent('!⚡', 420 * diff().rateMul);
        }
        if (this.state === 'aim' && this.aimBeam?.active) {
          const muzY = this.y + (this.crouching ? 4 : -6);
          const beamLen = Math.min(280, Math.max(40, dist - 8));
          const ang = Math.atan2((py - 8) - muzY, px - this.x);
          this.aimBeam.setVisible(true).setPosition(this.x + dirToPlayer * 14, muzY)
            .setRotation(ang).setDisplaySize(beamLen, 1.8)
            .setAlpha(0.38 + 0.28 * Math.sin(time * 0.05));
        }
        if (this.state === 'aim' && time >= this.stateUntil) {
          this.aimBeam?.setVisible(false);
          if (dist < 520) this.shootBurst(time, dirToPlayer, 3, 'bullet_e');
          this.lastShot = time;
          this.state = 'cover';
          this.stateUntil = time + 620 * diff().rateMul;
        } else if (this.state === 'cover' && time >= this.stateUntil) {
          this.state = 'advance';
          this.stateUntil = time + 560 * diff().rateMul;
        }
        if (this.state === 'advance') b.setVelocityX(dirToPlayer * (dist < 105 ? 64 : 116) * speedMul);
        else if (this.state === 'cover') b.setVelocityX(dist < 190 ? -dirToPlayer * 96 : 0);
        else b.setVelocityX(0);
        break;
      }
    }

    // Platform verticality AI: climb overhead one-way decks or drop through to pursue hero!
    if ((this.kind === 'rifle' || this.kind === 'gren' || this.kind === 'spider' || this.kind === 'sentinel')
      && this.state !== 'crawl' && this.state !== 'windup' && this.state !== 'drop' && S.traversal) {
      if (b.blocked.down && dist < 390 && time > this.nextClimbAt && this.state !== 'aim' && this.state !== 'deploy') {
        if (py < this.y - 44) {
          const above = S.traversal.findDeckAbove?.(this.x, b.bottom, 130);
          if (above) {
            this.nextClimbAt = time + rand(2100, 3200);
            b.setVelocityY(-615);
            this.showIntent('↑', 280);
            S.fx?.jumpDust?.(this.x, b.bottom);
          }
        } else if (py > this.y + 52) {
          const currentDeck = S.traversal.findCurrentDeck?.(this.x, b.bottom);
          if (currentDeck && !currentDeck.isLift) {
            this.dropThroughUntil = time + 280;
            this.nextClimbAt = time + 1900;
            b.setVelocityY(95);
            this.showIntent('↓', 280);
          }
        }
      }
      // Keep perched troops from accidentally stepping off a narrow upper deck unless dropping
      const deck = b.blocked.down ? S.traversal.findCurrentDeck?.(this.x, b.bottom) : null;
      if (deck && !deck.isLift && time > this.dropThroughUntil) {
        if ((this.x <= deck.x + 14 && b.velocity.x < 0) || (this.x >= deck.right - 14 && b.velocity.x > 0)) {
          b.setVelocityX(0);
        }
      }
    }
    this.navigateObstacles(time, b, dirToPlayer);
    // Stop at the screen boundary instead of moving out of sight and firing.
    const camera = this.scene.cameras.main;
    const camLeft = camera.scrollX + 46, camRight = camera.scrollX + camera.width - 46;
    if ((this.x <= camLeft && b.velocity.x < 0) || (this.x >= camRight && b.velocity.x > 0)) b.setVelocityX(0);
    // A few pixel dust puffs give advancing squads a sense of physical weight.
    if (this.kind !== 'drone' && this.kind !== 'spider' && b.blocked.down
      && Math.abs(b.velocity.x) > 45 && time - this.lastFootstep > 250) {
      this.lastFootstep = time;
      S.fx?.landDust?.(this.x, b.bottom, 0.45);
    }
  }

  activeBody() { return this.body && this.active; }

  shootBurst(time: number, dir: number, shots = 3, tex = 'bullet_e') {
    const S = this.scene as any;
    for (let i = 0; i < shots; i++) {
      S.time.delayedCall(i * 90, () => {
        if (!this.active || !this.scene.sys.isActive()
          || !isWithinCamera(this.scene, this.x, 26)) return;
        const hero = (this.scene as any).player;
        if (!hero?.active || hero.dead || Math.abs(hero.x - this.x) > 580) return;
        const mx = this.x + dir * (this.kind === 'heavy' ? 32 : this.kind === 'sentinel' ? 21 : 19);
        const my = this.crouching ? this.y + 4 : this.y - (this.kind === 'heavy' ? 8 : 4);
        const dy = (hero.y - 6) - my;
        if (Math.abs(dy) > 28 && S.weapons.enemyAimedShot) {
          const jitterY = i === 0 ? 0 : rand(-14, 14);
          const speed = this.kind === 'heavy' ? 350 : this.kind === 'sentinel' ? 410 : 375;
          S.weapons.enemyAimedShot(mx, my, hero.x, hero.y - 8 + jitterY, speed);
        } else {
          S.weapons.enemyShoot?.(mx, my, dir, tex);
        }
        S.fx?.enemyMuzzle?.(mx, my, dir);
      });
    }
    void time;
  }

  squadText() { return rand(0, 1) > 0.5 ? 'Солдат' : 'Гранатомётчик'; }

  static GROUND_LIMIT = 99999;
}

function GROUND_Y_XMAX() { return Enemy.GROUND_LIMIT; }

export interface ObstacleBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Inspect nearby static barriers to decide whether an enemy should crouch
 * underneath a low-clearance overhang or jump onto a floor-level obstacle.
 */
export function evaluateObstacleAhead(
  actor: ObstacleBox,
  standH: number,
  crouchH: number,
  moveDir: number,
  obstacles: ObstacleBox[],
  isMoving: boolean,
): { crouch: boolean; jump: boolean; ceilingOverhead: boolean } {
  let crouch = false;
  let jump = false;
  let ceilingOverhead = false;
  const aheadLeft = moveDir < 0 ? actor.left - 34 : actor.left - 4;
  const aheadRight = moveDir > 0 ? actor.right + 34 : actor.right + 4;
  const jumpLeft = moveDir < 0 ? actor.left - 24 : actor.left;
  const jumpRight = moveDir > 0 ? actor.right + 24 : actor.right;

  for (const obs of obstacles) {
    // Ignore ground deck directly beneath the actor's soles.
    if (obs.top >= actor.bottom - 8) continue;
    const clearance = actor.bottom - obs.bottom;
    const overlapsOverhead = obs.right > actor.left - 4 && obs.left < actor.right + 4;
    const overlapsAhead = obs.right > aheadLeft && obs.left < aheadRight;
    const isLowCeiling = clearance >= crouchH + 1 && clearance <= standH + 6;

    if (overlapsOverhead && clearance >= 4 && clearance <= standH + 6) {
      ceilingOverhead = true;
      if (isLowCeiling) crouch = true;
    } else if (isMoving && overlapsAhead && isLowCeiling) {
      crouch = true;
    } else if (
      isMoving &&
      obs.right > jumpLeft &&
      obs.left < jumpRight &&
      clearance < crouchH + 1 &&
      (actor.bottom - obs.top) <= 104
    ) {
      jump = true;
    }
  }
  if (ceilingOverhead) jump = false;
  return { crouch, jump, ceilingOverhead };
}

function ensureEnemyCrouchTexture(scene: Phaser.Scene, baseKey: string): string {
  const crouchKey = `${baseKey}_crouch`;
  if (!scene?.textures || scene.textures.exists(crouchKey)) return crouchKey;
  if (!scene.textures.exists(baseKey) || !scene.textures.createCanvas) return baseKey;
  const srcTex = scene.textures.get(baseKey);
  const frame = (srcTex.has('f0') ? srcTex.get('f0') : srcTex.get(0)) as Phaser.Textures.Frame | undefined;
  const source = frame?.source?.image as CanvasImageSource | undefined;
  if (!frame || !source) return baseKey;
  const w = Math.max(16, Math.round(frame.realWidth || frame.width || 32));
  const h = Math.max(16, Math.round(frame.realHeight || frame.height || 36));
  const tex = scene.textures.createCanvas(crouchKey, w, h);
  if (!tex) return baseKey;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, w, h);
  const cw = frame.cutWidth || w;
  const ch = frame.cutHeight || h;
  const ox = frame.x || 0;
  const oy = frame.y || 0;
  paintNaturalCrouchPose(source, frame.cutX, frame.cutY, cw, ch, ctx, ox, oy, {
    dropRatio: baseKey.includes('heavy') ? 0.25 : 0.28,
    upperRatio: baseKey.includes('heavy') ? 0.60 : 0.58,
    bootRatio: 0.22,
    kneeShiftX: 2,
  });
  tex.refresh();
  return crouchKey;
}

/** Generic damage handling + death FX shared by enemies & machines. */
export function damageEnemy(scene: Phaser.Scene, e: Enemy, dmg: number) {
  if (!e.active || e.hp <= 0) return;
  e.hp -= dmg;
  const fx = (scene as any).fx;
  fx?.impact?.(e.x + (e.flipX ? -8 : 8), e.y - 4, e.flipX ? -1 : 1,
    e.kind === 'spider' || e.kind === 'drone');
  e.setTintFill(e.kind === 'spider' || e.kind === 'drone' ? 0xa8fff1 : 0xffdfb3);
  scene.time.delayedCall(60, () => { if (e.active) e.clearTint(); });
  if (e.hp <= 0) killEnemy(scene, e);
}

export function killEnemy(scene: Phaser.Scene, e: Enemy) {
  SFX.play('boom_small');
  const fx = (scene as any).fx;
  const mech = e.kind === 'spider' || e.kind === 'drone';
  fx?.defeat?.(e, mech);
  fx?.boom?.(e.x, e.y, e.kind === 'heavy' ? 1.25 : mech ? 0.9 : 0.55);
  scorePopup(scene, e.x, e.y - 20, `+${e.scoreValue}`);
  addScore(scene, e.scoreValue);
  (scene as any).radio?.onKill?.(e.kind);
  e.destroy();
}

/** Surrender gag: soldier raises hands; if his robot keeps attacking, comedy ensues. */
export function spawnSurrenderGag(scene: any, x: number) {
  const s = new Enemy(scene, x, GROUND_Y - 30, 'e_rifle');
  scene.enemies.add(s);
  s.init('rifle', x, GROUND_Y - 30);
  (s as Enemy).surrendering = true;
  (s as Enemy).setVelocity(0);
  (s as Enemy).anims.stop();
  (s as Enemy).setTexture('e_rifle', 'f0');
  (s as Enemy).setRotation(-0.1);
  const flag = scene.add.text(x - 20, (s as Enemy).y - 44, 'НЕ СТРЕЛЯЙТЕ!', {
    fontFamily: 'monospace', fontSize: '11px', color: '#ffe9a0',
  }).setDepth(60);
  scene.tweens.add({ targets: s, angle: { from: -6, to: 6 }, duration: 220, yoyo: true, repeat: 5 });
  scene.time.delayedCall(2600, () => { flag.destroy(); if ((s as Enemy).active) s.destroy(); });
  void shake;
}
