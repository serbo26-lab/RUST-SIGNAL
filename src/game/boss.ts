import Phaser from 'phaser';
import { GROUND_Y, WORLD_W, shake, addScaledScore, scorePopup, rand, diff } from './core';
import { alignActorFeet, findClearGroundX, resolveSolidOverlap } from './world-rules';
import { SFX } from './audio';
import { launchBossInterruptTarget, triggerArenaElevationSweep } from './boss-mechanics';

/**
 * BOSS — гигантский портовый кран «МАЯК-6» с ракетными установками.
 * Two phases (MVP requirement):
 *   Phase 1: swings a wrecking hook, fires missile salvos at the ground.
 *   Phase 2 (<50% hp): container clamps drop from above, rocket barrage
 *          sweeps across the arena, weak point (generator cab) exposed.
 */
export class Boss extends Phaser.Physics.Arcade.Sprite {
  hp = 90; hpMax = 90; alive = true; phase = 1;
  overdrive = false;
  exposedUntil = 0;
  private tLastAttack = 0;
  private attackCount = 0;
  private hook?: Phaser.GameObjects.Graphics;
  private beam?: Phaser.GameObjects.Triangle;
  private weakHalo?: Phaser.GameObjects.Arc;
  private weakLabel?: Phaser.GameObjects.Text;
  private hookPos = new Phaser.Math.Vector2(0, 0);
  private hookState: 'idle' | 'swing' = 'idle';
  private weakFlash = 0;
  private readonly anchorX: number;

  static makeTexture(scene: Phaser.Scene) {
    if (scene.textures.exists('boss_crane')) return;
    const W = 240, H = 300;
    const t = scene.textures.createCanvas('boss_crane', W, H)!;
    const c = t.getContext();
    // base rails
    c.fillStyle = '#22262e'; c.fillRect(10, 280, 220, 18);
    c.fillStyle = '#5b6473'; c.fillRect(16, 272, 40, 12); c.fillRect(184, 272, 40, 12);
    // portal legs
    c.fillStyle = '#c9a227';
    c.fillRect(30, 120, 18, 160); c.fillRect(192, 120, 18, 160);
    c.fillStyle = '#a5851d';
    for (let k = 0; k < 5; k++) { c.fillRect(30, 130 + k * 30, 18, 6); c.fillRect(192, 130 + k * 30, 18, 6); }
    // cross beam
    c.fillStyle = '#b08a20'; c.fillRect(24, 108, 192, 16);
    // upper mast & counterweight
    c.fillStyle = '#8a94a6'; c.fillRect(100, 20, 40, 92);
    c.fillStyle = '#5b6473'; c.fillRect(84, 4, 72, 22);
    // operator cab (weak point in phase 2 — drawn darker with glowing vent)
    c.fillStyle = '#3a4250'; c.fillRect(58, 130, 56, 44);
    c.fillStyle = '#7fd4e8'; c.fillRect(64, 138, 44, 14); // windows
    c.fillStyle = '#22262e'; c.fillRect(70, 160, 32, 10); // vent
    // rocket pods on boom
    c.fillStyle = '#6b7484'; c.fillRect(120, 90, 110, 20);
    for (let k = 0; k < 4; k++) { c.fillStyle = '#22262e'; c.fillRect(130 + k * 24, 94, 14, 12); }
    c.fillStyle = '#d8453a'; c.fillRect(226, 92, 6, 16);
    // rust & warning stripes
    c.fillStyle = '#7d4a26'; c.fillRect(34, 200, 10, 40); c.fillRect(196, 170, 8, 30);
    for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#22262e' : '#c9a227'; c.fillRect(24 + k * 24, 100, 24, 8); }
    t.refresh();
  }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'boss_crane');
    this.anchorX = x;
    const dm = diff();
    this.hpMax = Math.round(this.hpMax * dm.hpMul);
    this.hp = this.hpMax;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.setDepth(45);
    (this.body as Phaser.Physics.Arcade.Body).setSize(200, 260).setOffset(20, 30);
    (this.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    this.hook = scene.add.graphics().setDepth(46);
    if (scene.add?.triangle) {
      this.beam = scene.add.triangle(x - 18, y - 138, 0, 0, -230, 150, -85, 165, 0xffd078, 0.14)
        .setOrigin(0, 0).setDepth(44).setBlendMode(Phaser.BlendModes.ADD);
      this.weakHalo = scene.add.circle(x - 24, y - 144, 24, 0xff5a6a, 0)
        .setStrokeStyle(2, 0x5df2e6, 0.8).setDepth(47).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      this.weakLabel = scene.add.text(x - 24, y - 180, 'ПЕРЕГРЕВ x2!', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#ffe875', stroke: '#121822', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(95).setVisible(false);
    }
    this.initArena(scene);
  }

  private initArena(scene: any) {
    if (!scene?.traversal?.addOneWayDeck) return;
    const minL = Math.max(WORLD_W - 920, this.anchorX - 420);
    scene.traversal.addJumpPad(Math.max(minL + 30, this.anchorX - 365), GROUND_Y + 35, -875);
    scene.traversal.addOneWayDeck(Math.max(minL + 75, this.anchorX - 310), GROUND_Y - 62, 175, 'ТРАП КРАНА');
    scene.traversal.addOneWayDeck(Math.max(minL + 135, this.anchorX - 245), GROUND_Y - 128, 165, 'НА КАБИНУ');
  }

  triggerOverheat(bonusDmg: number, durationMs = 4000) {
    if (!this.alive) return;
    const S = this.scene as any;
    this.exposedUntil = Math.max(this.exposedUntil, S.time.now + durationMs);
    this.tLastAttack = Math.max(this.tLastAttack, S.time.now - 300);
    S.fx?.signalGlitch?.(this.x - 24, this.y - 144);
    S.fx?.bigBoom?.(this.x - 24, this.y - 144, 1.15);
    scorePopup(S, this.x - 36, this.y - 185, 'ПЕРЕХВАТ! УЯЗВИМ x2.5', '#ffe875');
    this.takeDamage(bonusDmg);
  }

  takeDamage(d: number) {
    if (!this.alive) return;
    SFX.play('metal', 0.8);
    const now = this.scene.time?.now ?? 0;
    const critMult = (now < this.exposedUntil || this.overdrive) ? 2.2 : 1;
    this.hp -= d * critMult;
    const fx = (this.scene as any).fx;
    fx?.impact?.(this.x + rand(-75, 70), this.y - rand(70, 230), 1, this.phase === 2);
    this.setTintFill(critMult > 1 ? 0xffe878 : this.phase === 2 ? 0xffbaca : 0xffdddd);
    this.scene.time.delayedCall(45, () => { if (this.active) this.clearTint(); });
    if (this.phase === 1 && this.hp <= this.hpMax * 0.5) this.enterPhase2();
    if (this.phase === 2 && !this.overdrive && this.hp > 0 && this.hp <= this.hpMax * 0.25) {
      this.enterOverdrive();
    }
    if (this.hp <= 0) this.die();
  }

  private enterPhase2() {
    this.phase = 2;
    if (this.scene.textures.exists('boss_phase2')) this.setTexture('boss_phase2');
    const S = this.scene as any;
    S.hud?.banner?.('СИГНАЛ ВТОРГСЯ В МЕХАНИЗМ КРАНА');
    S.radio?.say?.('weiss_phase2');
    S.fx?.signalGlitch?.(this.x - 60, this.y - 150);
    S.fx?.debris?.(this.x, this.y - 170, 18, [0xa8fff0, 0xff6c59, 0x536b73]);
    shake(S, 330, 0.014);
    SFX.play('signal'); SFX.play('boss_roar');
    this.weakFlash = 1;
    this.beam?.setFillStyle(0xff4a5c, 0.22);
    this.weakHalo?.setVisible(true);
    this.launchChargeDrum(S.player?.x ?? this.x - 240);
  }

  private enterOverdrive() {
    this.overdrive = true;
    const S = this.scene as any;
    S.hud?.banner?.('КРАН: ПЕРЕГРУЗКА ПРИВОДА!');
    S.hud?.toast?.('Кабина дымит! Поднимайся на мостик и добивай!', 3000);
    this.exposedUntil = S.time.now + 99999;
    S.fx?.signalGlitch?.(this.x - 24, this.y - 150);
    SFX.play('boss_roar', 0.9);
  }

  update(time: number, playerX: number, playerY: number) {
    if (!this.alive) return;
    const S = this.scene as any;
    this.y = this.baseY;
    // Stationary crane. Never chase player or leave the locked camera viewport.
    this.setX(this.anchorX);
    if (this.beam?.active) {
      this.beam.setPosition(this.x - 18, this.y - 138)
        .setRotation(Math.sin(time * (this.phase === 2 ? 0.004 : 0.002)) * 0.24);
    }
    const isExposed = time < this.exposedUntil || this.overdrive;
    if (this.weakHalo?.active) {
      this.weakHalo.setVisible(this.phase === 2 || isExposed);
      if (this.weakHalo.visible) {
        this.weakHalo.setPosition(this.x - 24, this.y - 144)
          .setScale((isExposed ? 1.1 : 0.92) + 0.18 * Math.sin(time * 0.012))
          .setAlpha(0.55 + 0.35 * Math.cos(time * 0.016));
      }
      if (Math.random() < (this.overdrive ? 0.22 : 0.08)) {
        S.fx?.sparkTrail?.(this.x - 24, this.y - 140, this.overdrive ? 0xff9f40 : 0x5df2e6, 3);
      }
    }
    if (this.weakLabel?.active) {
      this.weakLabel.setVisible(isExposed).setPosition(this.x - 24, this.y - 182);
    }
    const cd = this.overdrive ? 950 : this.phase === 1 ? 1650 : 1180;
    if (time - this.tLastAttack < cd) { this.updateHook(time); return; }
    this.tLastAttack = time;
    this.attackCount++;

    if (this.phase === 1) {
      const mod = this.attackCount % 4;
      if (mod === 0) this.triggerDeckShock();
      else if (mod === 1) this.launchChargeDrum(playerX);
      else if (mod === 2) this.fireMissiles(time, playerX);
      else this.swingHook(playerX);
    } else {
      const mod = this.attackCount % 4;
      if (mod === 0) this.triggerDeckShock();
      else if (mod === 1) this.launchChargeDrum(playerX);
      else if (mod === 2) this.fireBarrage(playerX);
      else { this.dropContainers(playerX); this.swingHook(playerX); }
    }
    void playerY;
  }

  private triggerDeckShock() {
    const S = this.scene as any;
    const minL = Math.max(WORLD_W - 940, this.anchorX - 520);
    triggerArenaElevationSweep(S, {
      xStart: this.x - 80,
      xEnd: minL,
      yCenter: GROUND_Y + 4,
      halfHeight: 30,
      warnMs: 920,
      sweepMs: 740,
      color: 0x4fe8ff,
      label: '⚡ РАЗРЯД ПО ПАЛУБЕ — НА МОСТИК!',
      isAliveFn: () => this.alive,
    });
  }

  private launchChargeDrum(playerX: number) {
    const S = this.scene as any;
    const tx = Phaser.Math.Clamp(playerX, WORLD_W - 900, this.x - 130);
    launchBossInterruptTarget(S, {
      startX: this.x - 25,
      startY: this.y - 210,
      targetX: tx,
      targetY: GROUND_Y + 4,
      durationMs: 2250,
      hp: 3,
      texKey: S.textures.exists('prop_barrel') ? 'prop_barrel' : 'rem_container',
      tint: 0xffaa44,
      label: 'СБЕЙ ГРУЗ!',
      onIntercepted: (ix, iy) => {
        S.weapons?.explode?.(ix, iy, 95, 4, false);
        addScaledScore(S, 350);
        this.triggerOverheat(10, 4200);
      },
      onImpact: (ix, iy) => {
        if (!this.alive || !S?.sys?.isActive?.() || S.finished) return;
        S.weapons?.explode?.(ix, iy, 96, 3, true);
        S.fx?.debris?.(ix, iy, 10, [0xc8783a, 0x3b4856, 0xffcf60]);
      },
    });
  }

  get baseY() { return GROUND_Y + 35; }

  /** missiles land where the player stands and explode */
  fireMissiles(_time: number, playerX: number) {
    const S = this.scene as any;
    SFX.play('rocket', 0.7);
    for (let i = 0; i < 3; i++) {
      const targetX = playerX + rand(-140, 160);
      const m = S.add.image(this.x + 60, this.y - 250, 'rocket').setDepth(60).setScale(1.3);
      S.hud?.warnMarker?.(targetX);
      S.time.delayedCall(900 + i * 260, () => {
        if (!this.alive || !S?.sys?.isActive?.() || S.finished) { if (m.active) m.destroy(); return; }
        S.tweens.add({
          targets: m, x: targetX, y: GROUND_Y - 4, duration: 700, ease: 'Quad.easeIn',
          onComplete: () => {
            if (!this.alive || !S?.sys?.isActive?.() || S.finished) { if (m.active) m.destroy(); return; }
            S.weapons?.explode?.(targetX, GROUND_Y - 10, 96, 4, true);
            S.fx?.debris?.(targetX, GROUND_Y - 8, 9);
            SFX.play('boom_big', 0.8);
            m.destroy();
          },
        });
      });
    }
  }

  /** phase-2: sweeping rocket line the player must jump over/run through */
  fireBarrage(playerX: number) {
    const S = this.scene as any;
    for (let i = 0; i < 6; i++) {
      const startX = playerX - 320 + i * 110;
      S.time.delayedCall(i * 130, () => {
        S.weapons?.enemyAimedShot?.(this.x + 40, this.y - 260, startX, GROUND_Y - 20, 420);
        SFX.play('shot_mg', 0.5);
      });
    }
    S.hud?.toast?.('ЗАЛП! Уходи с линии!');
  }

  swingHook(playerX: number) {
    const S = this.scene as any;
    this.hookState = 'swing';
    this.hookPos.set(this.x + 40, this.y - 240);
    const tx = playerX, ty = GROUND_Y - 10;
    const g = S.add.graphics().setDepth(62);
    g.fillStyle(0x8a94a6, 1); g.fillRect(-14, -14, 28, 28);
    g.lineStyle(6, 0x5b6473, 1); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -260); g.strokePath();
    g.setPosition(this.x + 40, this.y - 240);
    S.tweens.add({
      targets: g, x: tx, y: ty, duration: 620, ease: 'Bounce.easeOut',
      onUpdate: () => { /* cable follows implicitly via graphics child? keep simple */ },
      onComplete: () => {
        S.weapons?.explode?.(g.x, g.y, 70, 3, true);
        SFX.play('metal', 1);
        shake(S, 260, 0.01);
        S.time.delayedCall(300, () => g.destroy());
      },
    });
    S.time.delayedCall(700, () => { this.hookState = 'idle'; });
  }

  dropContainers(playerX: number) {
    const S = this.scene as any;
    for (let i = 0; i < 2; i++) {
      const cx = playerX + rand(-60, 260);
      const cont = S.textures.exists('rem_container')
        ? S.add.image(cx, -40, 'rem_container').setDisplaySize(96, 42).setDepth(58)
        : S.add.rectangle(cx, -40, 96, 42, ['#8a4a3a', '#3a6a7a'][i]).setStrokeStyle(3, '#22262e').setDepth(58);
      S.time.delayedCall(i * 350, () => {
        S.hud?.warnMarker?.(cx);
        S.tweens.add({
          targets: cont, y: GROUND_Y + 10, duration: 650, ease: 'Quad.easeIn',
          onComplete: () => {
            shake(S, 180, 0.009);
            SFX.play('boom_big', 0.7);
            S.fx?.bigBoom?.(cx, GROUND_Y, 0.8);
            S.fx?.debris?.(cx, GROUND_Y, 12, [0xbc714f, 0x7e8b86, 0xc8a266]);
            S.weapons?.explode?.(cx, GROUND_Y, 60, 3, true);
            S.time.delayedCall(1200, () => { if (cont.active) cont.destroy(); });
          },
        });
      });
    }
  }

  private updateHook(_time: number) {
    if (!this.hook) return;
    this.hook.clear();
    if (this.hookState === 'idle') {
      const sx = this.x + 40, sy = this.y - 240;
      const dx = Math.sin(Date.now() / 760) * 22;
      this.hook.lineStyle(5, 0x262c36, 1);
      this.hook.beginPath(); this.hook.moveTo(sx, sy); this.hook.lineTo(sx + dx, sy + 92); this.hook.strokePath();
      this.hook.lineStyle(2, 0x7a8599, 0.9);
      this.hook.beginPath(); this.hook.moveTo(sx - 1, sy); this.hook.lineTo(sx + dx - 1, sy + 92); this.hook.strokePath();
      const bx = sx - 14 + dx, by = sy + 92;
      this.hook.fillStyle(0x2d333d, 1).fillRoundedRect(bx, by, 28, 22, 4);
      this.hook.fillStyle(0xb08a20, 1).fillRect(bx + 3, by + 3, 22, 5);
      this.hook.fillStyle(0xff6b45, 0.9).fillCircle(bx + 14, by + 14, 3);
    }
  }

  die() {
    this.alive = false;
    if (this.scene.textures.exists('boss_dead')) this.setTexture('boss_dead');
    const S = this.scene as any;
    S.finished = true; // protect victory during the two-second destruction cascade
    this.hook?.destroy();
    this.beam?.destroy();
    this.weakHalo?.destroy();
    this.weakLabel?.destroy();
    S.fx?.debris?.(this.x, this.y - 155, 28, [0xff6a50, 0xaeb8bb, 0xa67041]);
    SFX.play('boss_roar', 1);
    S.hud?.banner?.('БОСС УНИЧТОЖЕН');
    const bossPts = addScaledScore(S, 1500);
    scorePopup(S, this.x - 40, this.y - 200, `+${bossPts}`, '#ffd24a');
    // staged destruction cascade
    for (let i = 0; i < 10; i++) {
      S.time.delayedCall(i * 180, () => {
        S.fx?.bigBoom?.(this.x + rand(-90, 90), this.y - rand(20, 280), rand(1, 1.8));
        SFX.play(i < 4 ? 'boom_big' : 'boom_small', 0.8);
        shake(S, 150, 0.008);
      });
    }
    S.time.delayedCall(2100, () => {
      this.destroy();
      S.events.emit('rs:boss-defeated');
    });
  }
}

/* =====================================================================
   PLAYER TANK RS-7 «КУВАЛДА» — drivable vehicle (MVP item #5)
   Changes how you fight: cannon blasts + crush jumps, but slower turret,
   vulnerable to sustained fire; armor instead of one-hit deaths.
===================================================================== */
export class TankSystem {
  scene: any;
  tank: Phaser.Physics.Arcade.Sprite | null = null;
  private headlight: Phaser.GameObjects.Triangle | null = null;
  private shadow: Phaser.GameObjects.Ellipse | null = null;
  private prompt: Phaser.GameObjects.Text | null = null;
  private hpBg: Phaser.GameObjects.Rectangle | null = null;
  private hpBar: Phaser.GameObjects.Rectangle | null = null;
  private hpText: Phaser.GameObjects.Text | null = null;
  private criticalCue: Phaser.GameObjects.Text | null = null;
  private criticalWarned = false;
  private treadDustAt = 0;
  hp = 12; hpMax = 12;
  lastCannon = 0;
  active = false;

  constructor(scene: any) { this.scene = scene; }

  spawnAt(x: number) {
    if (this.tank) return;
    const S = this.scene;
    const safeX = findClearGroundX(S, x, 42, GROUND_Y + 35, {
      objectHeight: 48,
      padding: 16,
      avoidPads: true,
      includeMachines: true,
      includeProps: true,
      includeTurrets: true,
    });
    const t = S.physics.add.sprite(safeX, GROUND_Y, 'tank');
    t.play('tank_drive');
    t.setDepth(47);
    alignActorFeet(t, 64, 36, 2);
    const body = t.body as Phaser.Physics.Arcade.Body;
    body.setBounce(0);
    // Tank must remain dynamic (immovable=false) so static floor & containers separate it.
    t.setImmovable(false);
    if ('pushable' in body) (body as any).pushable = false;
    t.y = (GROUND_Y + 35) - (t.height / 2 - 2);
    body.reset(t.x, t.y);
    this.tank = t;
    this.criticalWarned = false;
    const grp = S.tankDummyGroup?.();
    if (grp && !grp.contains(t)) grp.add(t);

    if (S.add?.ellipse) {
      this.shadow = S.add.ellipse(safeX, GROUND_Y + 34, 72, 11, 0x05080d, 0.52).setDepth(39);
      this.headlight = S.add.triangle(safeX + 34, t.y - 6, 0, 0, 140, -26, 140, 28, 0xffe49e, 0.14)
        .setOrigin(0, 0).setDepth(46).setBlendMode(Phaser.BlendModes.ADD);
      this.prompt = S.add.text(safeX, t.y - 60, '[E] СЕСТЬ В ТАНК', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#ffe294', stroke: '#0c121b', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(92);
      this.hpBg = S.add.rectangle(safeX, t.y - 31, 66, 8, 0x0a1019, 0.92)
        .setStrokeStyle(1, 0x456275).setDepth(91);
      this.hpBar = S.add.rectangle(safeX - 32, t.y - 31, 64, 6, 0x8ae068, 1)
        .setOrigin(0, 0.5).setDepth(92);
      this.hpText = S.add.text(safeX, t.y - 43, `РС-7 ${this.hp}/${this.hpMax}`, {
        fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold',
        color: '#d8ffd0', stroke: '#091018', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(92);
      this.criticalCue = S.add.text(safeX, t.y - 60, '⚠ БРОНЯ КРИТИЧЕСКАЯ — [E] ВЫЙТИ!', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#ff6f5c', stroke: '#140608', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(94).setVisible(false);
    }
    t.once('destroy', () => {
      this.shadow?.destroy();
      this.headlight?.destroy();
      this.prompt?.destroy();
      this.hpBg?.destroy();
      this.hpBar?.destroy();
      this.hpText?.destroy();
      this.criticalCue?.destroy();
    });
    S.hud?.toast?.('Броневик РС-7 «Кувалда» на пирсе! Жми [E], чтобы залезть');
  }

  board(player: any): boolean {
    if (!this.tank || this.active) return false;
    if (Math.abs(this.tank.x - player.x) > 76 || Math.abs(this.tank.y - player.y) > 110) return false;
    this.active = true;
    this.tank.setImmovable(false);
    const body = this.tank.body as Phaser.Physics.Arcade.Body;
    if ('pushable' in body) (body as any).pushable = false;
    player.inTank = true;
    player.setVisible(false);
    const pBody = player.body as Phaser.Physics.Arcade.Body | undefined;
    if (pBody) {
      pBody.setAllowGravity(false);
      pBody.setVelocity(0, 0);
      pBody.reset(this.tank.x, this.tank.y);
    }
    this.tank.setData('mounted', true);
    this.prompt?.setVisible(false);
    SFX.play('pickup');
    this.scene.hud?.flashWeapon?.('РС-7 «КУВАЛДА»');
    this.scene.radio?.say?.('boatswain_tank');
    return true;
  }

  eject(player: any) {
    if (!this.tank || !this.active) return;
    this.active = false;
    player.inTank = false;
    player.setVisible(true);
    const exitY = this.tank.y - 36;
    const pBody = player.body as Phaser.Physics.Arcade.Body;
    pBody.setAllowGravity(true);
    pBody.reset(this.tank.x, exitY);
    player.setPosition(this.tank.x, exitY);
    resolveSolidOverlap(player, this.scene);
    player.invulnUntil = this.scene.time.now + 900;
    (this.tank.body as Phaser.Physics.Arcade.Body).setVelocityX(0);
    this.tank.setData('mounted', false);
    this.prompt?.setVisible(true);
  }

  update(
    time: number,
    player: any,
    input: { left: boolean; right: boolean; up: boolean; down?: boolean; fire: boolean; jump: boolean; pointerWorldX?: number; pointerWorldY?: number },
  ) {
    if (!this.tank) return;
    const t = this.tank;
    const b = t.body as Phaser.Physics.Arcade.Body;
    const deckBottom = GROUND_Y + 35;
    if (b.bottom > deckBottom + 2 && (Math.abs(b.velocity.y) < 30 || b.bottom > deckBottom + 36)) {
      t.y -= (b.bottom - deckBottom);
      b.setVelocityY?.(0);
      b.updateFromGameObject?.();
    }

    if (this.active && (!player.inTank || player.dead)) {
      this.active = false;
      b.setVelocityX(0);
      (player.body as Phaser.Physics.Arcade.Body | undefined)?.setAllowGravity?.(true);
      t.setData('mounted', false);
      this.prompt?.setVisible(true);
    }

    const dirSign = t.flipX ? -1 : 1;
    this.shadow?.setPosition(t.x, Math.max(b.bottom - 1, deckBottom - 1));
    this.headlight?.setPosition(t.x + dirSign * 34, t.y - 6).setScale(dirSign, 1);

    const frac = Phaser.Math.Clamp(this.hp / Math.max(1, this.hpMax), 0, 1);
    const showHp = this.active || Math.abs(t.x - player.x) < 340;
    const barY = t.y - 31;
    this.hpBg?.setVisible(showHp).setPosition(t.x, barY);
    this.hpBar?.setVisible(showHp).setPosition(t.x - 32, barY)
      .setDisplaySize(Math.max(2, 64 * frac), 6)
      .setFillStyle(frac > 0.5 ? 0x8ae068 : frac > 0.34 ? 0xffbf4d : 0xff5447);
    this.hpText?.setVisible(showHp).setPosition(t.x, barY - 12)
      .setText(`РС-7 ${Math.max(0, Math.ceil(this.hp))}/${this.hpMax}`)
      .setColor(frac <= 0.34 ? '#ff8f82' : '#d8ffd0');

    const isCritical = this.active && this.hp > 0 && frac <= 0.35;
    if (this.criticalCue?.active) {
      this.criticalCue
        .setVisible(isCritical && Math.floor(time / 210) % 2 === 0)
        .setPosition(t.x, barY - 30);
    }

    if (!this.active) {
      if (this.prompt?.active) {
        this.prompt.setVisible(Math.abs(t.x - player.x) < 190)
          .setPosition(t.x, barY - 30 + Math.sin(time * 0.006) * 2.5);
      }
      return;
    }
    const sp = 250;
    let mv = 0;
    if (input.left) mv -= 1;
    if (input.right) mv += 1;
    b.setVelocityX(mv * sp);
    if (mv !== 0) t.setFlipX(mv < 0);
    if (mv !== 0 && b.blocked.down && time - this.treadDustAt > 120) {
      this.treadDustAt = time;
      this.scene.fx?.landDust?.(t.x - dirSign * 26, b.bottom - 4, 0.55);
    }
    player.x = t.x; player.y = t.y;
    const pBody = player.body as Phaser.Physics.Arcade.Body | undefined;
    if (pBody) {
      pBody.setAllowGravity?.(false);
      pBody.setVelocity?.(0, 0);
      pBody.reset?.(t.x, t.y);
    }
    if (input.jump && b.blocked.down) b.setVelocityY(-595);
    if (input.fire && time - this.lastCannon > 480) {
      this.lastCannon = time;
      let dirX = t.flipX ? -1 : 1;
      let dirY = input.up ? -0.82 : (input.down ? 0.22 : 0);
      if (input.pointerWorldX !== undefined && input.pointerWorldY !== undefined) {
        const dx = input.pointerWorldX - t.x;
        const dy = input.pointerWorldY - (t.y - 10);
        const len = Math.hypot(dx, dy);
        if (len > 16) {
          dirX = dx / len;
          dirY = Phaser.Math.Clamp(dy / len, -0.92, 0.25);
          t.setFlipX(dirX < 0);
        }
      }
      const aimLen = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / aimLen;
      const ny = dirY / aimLen;
      const { muzX, muzY } = computeTankMuzzlePoint(t.x, t.y, nx, ny);
      this.scene.weapons.rocket(muzX, muzY, nx, ny);
      SFX.play('rocket', 0.9);
      this.scene.fx?.debris?.(t.x - (t.flipX ? -1 : 1) * 14, t.y + 18, 3, [0x9e9372, 0x65776d]);
      shake(this.scene, 90, 0.004);
    }
    // crush enemies by driving into them
    this.scene.enemies.children.each((e: any) => {
      if (e.active && (e.kind === 'rifle' || e.kind === 'officer' || e.kind === 'gren')) {
        if (Math.abs(e.x - t.x) < 46 && Math.abs(e.y - t.y) < 42 && Math.abs(b.velocity.x) > 55) {
          e.takeDamage?.(99);
        }
      }
      return true;
    });
    // damage flash
    if (this.hp < this.hpMax * 0.4 && Math.floor(time / 300) % 2 === 0) {
      this.scene.fx?.smoke?.(t.x + rand(-20, 20), t.y - 20);
    }
  }

  damageTank(d: number) {
    if (!this.active || !this.tank) return;
    this.hp = Math.max(0, this.hp - Math.max(1, d));
    this.tank.setTintFill(0xff8e70);
    this.scene.time?.delayedCall?.(75, () => { if (this.tank?.active) this.tank.clearTint(); });
    shake(this.scene, 80, 0.004);
    if (this.hp > 0 && this.hp <= Math.max(4, Math.floor(this.hpMax * 0.35)) && !this.criticalWarned) {
      this.criticalWarned = true;
      SFX.play('alarm', 0.55);
      this.scene.hud?.toast?.('⚠ БРОНЯ НА ИСХОДЕ — ЖМИ [E] И ВЫПРЫГИВАЙ!', 2600);
    }
    if (this.hp <= 0) {
      const S = this.scene;
      S.fx?.bigBoom?.(this.tank.x, this.tank.y, 2);
      S.fx?.debris?.(this.tank.x, this.tank.y, 20, [0x75845d, 0x4a555e, 0xffc871]);
      SFX.play('boom_big');
      shake(S, 300, 0.012);
      const p = S.player;
      p.inTank = false; p.setVisible(true);
      const exitY = this.tank.y - 36;
      const pBody = p.body as Phaser.Physics.Arcade.Body;
      pBody.setAllowGravity(true);
      pBody.reset(this.tank.x, exitY);
      p.setPosition(this.tank.x, exitY);
      resolveSolidOverlap(p, S);
      p.invulnUntil = S.time.now + 1500;
      this.tank.destroy(); this.tank = null; this.active = false;
      S.hud?.toast?.('ТАНК УНИЧТОЖЕН!');
      S.radio?.say?.('boatswain_sad');
    }
  }

  healFull() { this.hp = this.hpMax; }
}

export function computeTankMuzzlePoint(tankX: number, tankY: number, nx: number, ny: number) {
  return {
    muzX: tankX + nx * 36,
    muzY: tankY - 9 + ny * 18,
  };
}
