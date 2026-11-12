import Phaser from 'phaser';
import { diff, GROUND_Y, WORLD_W, rand, shake, addScaledScore, scorePopup } from './core';
import { SFX } from './audio';
import { BossShieldNodes, triggerArenaElevationSweep } from './boss-mechanics';

/** Living radio-transmitter organism with breakable bio-nodes that heal & shield it,
 * vertical root/spore elevation attacks, and core exposure bursts. */
export class JungleHeart extends Phaser.Physics.Arcade.Sprite {
  hpMax: number;
  hp: number;
  phase: 1 | 2 = 1;
  overdrive = false;
  exposedUntil = 0;
  alive = true;
  nextAttack = 0;
  attacks = 0;
  private readonly usesPackArt: boolean;
  private readonly anchorX: number;
  private bioGlow: Phaser.GameObjects.Arc | null = null;
  private weakTag: Phaser.GameObjects.Text | null = null;
  private nodes: BossShieldNodes | null = null;
  private lastRegen = 0;

  constructor(scene: Phaser.Scene, x = WORLD_W - 320) {
    const usesPack = scene.textures.exists('ep3_boss_heart');
    super(scene, x, usesPack ? GROUND_Y - 100 : GROUND_Y - 88, 'jg_heart1');
    this.usesPackArt = usesPack;
    this.anchorX = x;
    scene.add.existing(this); scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (usesPack) {
      body.setAllowGravity(false).setImmovable(true).setSize(166, 228).setOffset(32, 34);
      this.setDepth(64);
    } else {
      body.setAllowGravity(false).setImmovable(true).setSize(190, 178).setOffset(46, 40);
      this.setDepth(64).setScale(0.92);
    }
    this.hpMax = Math.round(56 * diff().hpMul);
    this.hp = this.hpMax;
    this.nextAttack = scene.time.now + 1550;
    if (scene.add?.circle) {
      this.bioGlow = scene.add.circle(x - 10, this.y - 12, 84, 0x62f58f, 0.18)
        .setDepth(63).setBlendMode(Phaser.BlendModes.ADD);
      this.weakTag = scene.add.text(x - 10, this.y - 120, 'ЯДРО ОГОЛЕНО x2.2!', {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
        color: '#a8ffcf', stroke: '#0c1d15', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(95).setVisible(false);
      scene.tweens?.add?.({
        targets: this, scaleX: { from: 0.98, to: 1.03 }, scaleY: { from: 1.02, to: 0.97 },
        duration: 920, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      this.once('destroy', () => { this.bioGlow?.destroy(); this.weakTag?.destroy(); this.nodes?.clearNodes(); });
    }
    this.initArena(scene);
  }

  private initArena(scene: any) {
    if (!scene?.traversal?.addOneWayDeck) return;
    const minL = Math.max(WORLD_W - 920, this.anchorX - 420);
    scene.traversal.addJumpPad(Math.max(minL + 26, this.anchorX - 385), GROUND_Y + 35, -855);
    scene.traversal.addOneWayDeck(Math.max(minL + 85, this.anchorX - 350), GROUND_Y - 115, 210, 'ВЕТКА КРОНЫ');

    this.nodes = new BossShieldNodes(scene, this, () => {
      if (!this.alive) return;
      this.exposedUntil = Math.max(this.exposedUntil, scene.time.now + 4400);
      this.nextAttack = Math.max(this.nextAttack, scene.time.now + 950);
      scene.fx?.signalGlitch?.(this.x, this.y);
      scorePopup(scene, this.x - 15, this.y - 120, 'БИО-ЩИТ СНЯТ! x2.2', '#95ffcf');
      this.takeDamage(7);
    });
    this.spawnBioNodes(4);
  }

  private spawnBioNodes(nodeHp = 4) {
    this.nodes?.spawnWave([
      { offsetX: -145, offsetY: -62, hp: nodeHp, color: 0x2f8e5b, trimColor: 0x7effb2, label: 'СБЕЙ БИО-УЗЛЫ!' },
      { offsetX: -175, offsetY: 56, hp: nodeHp, color: 0x2f8e5b, trimColor: 0x7effb2, label: 'СБЕЙ БИО-УЗЛЫ!' },
    ]);
  }

  bulletDamageScale(): number {
    return (this.nodes?.activeCount ?? 0) > 0 ? 0.55 : 1;
  }

  takeDamage(amount: number) {
    if (!this.alive) return;
    const s = this.scene as any;
    const cleared = Math.min(3, s.podsDestroyed ?? 0);
    // 25/50/75/100% damage as the three upstream radio roots are destroyed.
    const damageFactor = .25 + cleared * .25;
    const now = this.scene.time?.now ?? 0;
    const crit = (now < this.exposedUntil || this.overdrive) ? 2.1 : 1;
    this.hp = Math.max(0, this.hp - amount * damageFactor * crit);
    s.fx?.impact?.(this.x - 35 + rand(-28, 28), this.y + rand(-52, 24), 1, true);
    this.setTintFill(crit > 1 ? 0xffe885 : 0xe5f9ba);
    this.scene.time.delayedCall(75, () => { if (this.active) this.clearTint(); });
    if (this.hp <= 0) { this.defeat(); return; }
    if (this.phase === 1 && this.hp <= this.hpMax * .47) {
      this.phase = 2;
      this.setTexture('jg_heart2');
      this.bioGlow?.setFillStyle(0xff66a3, 0.28);
      this.nextAttack = this.scene.time.now + 1800;
      s.hud?.banner?.('ЯДРО ПРОБУЖДАЕТСЯ!');
      s.fx?.signalGlitch?.(this.x, this.y);
      s.fx?.debris?.(this.x, this.y, 18, [0x86dda8, 0xe386a4, 0x7acc84]);
      shake(this.scene, 310, .013);
      SFX.play('signal');
      this.spawnBioNodes(5);
    }
    if (this.phase === 2 && !this.overdrive && this.hp <= this.hpMax * 0.25) {
      this.overdrive = true;
      this.exposedUntil = now + 99999;
      s.hud?.banner?.('СЕРДЦЕ ЗОНЫ ТРЕЩИТ!');
      s.hud?.toast?.('Панцирь лопнул — добивай открытое ядро!', 3000);
      SFX.play('boss_roar', 0.9);
    }
  }

  updateBoss(time: number, playerX: number, playerY: number) {
    this.nodes?.update(time);
    const s = this.scene as any;
    if (this.alive && (this.nodes?.activeCount ?? 0) > 0 && time - this.lastRegen > 3400 && this.hp < this.hpMax) {
      this.lastRegen = time;
      this.hp = Math.min(this.hpMax, this.hp + 0.8);
      s.fx?.sparkTrail?.(this.x - 20, this.y - 10, 0x7effb2, 3);
    }
    if (this.phase === 2 && this.nodes?.canRespawn(time) && !this.overdrive) {
      this.spawnBioNodes(5);
    }
    const exposed = time < this.exposedUntil || this.overdrive;
    if (this.weakTag?.active) {
      this.weakTag.setVisible(exposed && this.alive).setPosition(this.x - 10, this.y - 122);
    }
    if (this.bioGlow?.active) {
      this.bioGlow.setPosition(this.x - 10, this.y - 12)
        .setScale((exposed ? 1.12 : 0.95) + 0.16 * Math.sin(time * (this.phase === 2 ? 0.009 : 0.005)));
    }
    if (!this.alive || time < this.nextAttack) return;
    if (!s.sys.isActive() || s.finished) return;

    this.attacks++;
    const rate = this.overdrive ? 0.78 : 1;
    this.nextAttack = time + (this.phase === 1 ? 1900 : 1320) * diff().rateMul * rate;
    const mod = this.attacks % 4;
    if (mod === 0) {
      const minL = Math.max(WORLD_W - 920, this.anchorX - 500);
      triggerArenaElevationSweep(s, {
        xStart: this.x - 90,
        xEnd: minL,
        yCenter: GROUND_Y + 6,
        halfHeight: 28,
        warnMs: 920,
        sweepMs: 720,
        color: 0x6dff9e,
        label: '! УДАР КОРНЕЙ ПО ПОЛУ — НА ВЕТКУ!',
        isAliveFn: () => this.alive,
      });
    } else if (mod === 1 && this.phase === 2) {
      const minL = Math.max(WORLD_W - 920, this.anchorX - 500);
      triggerArenaElevationSweep(s, {
        xStart: this.x - 90,
        xEnd: minL,
        yCenter: GROUND_Y - 138,
        halfHeight: 34,
        warnMs: 960,
        sweepMs: 740,
        color: 0xff66b8,
        label: '▲ ОБЛАКО СПОР НАВЕРХУ — ВНИЗ (S+SPACE)!',
        isAliveFn: () => this.alive,
      });
    } else if (mod === 2) {
      const x = Phaser.Math.Clamp(playerX + (this.attacks % 2 ? -42 : 38), WORLD_W - 900, WORLD_W - 110);
      s.warnSpore(x, 970, this.phase === 2 ? 105 : 80);
    } else {
      const count = this.phase === 1 ? 3 : 5;
      const sx = this.x - 99, sy = this.y - 39;
      s.fx?.enemyMuzzle?.(sx, sy, -1);
      for (let i = 0; i < count; i++) this.scene.time.delayedCall(i * 155, () => {
        if (!this.alive || !s.sys.isActive()) return;
        s.weapons.enemyAimedShot(sx, sy, s.player.x, s.player.y + (i % 2 ? -22 : 0),
          this.phase === 1 ? 320 : 430);
      });
    }
    void playerY;
  }

  private defeat() {
    if (!this.alive) return;
    this.alive = false;
    const s = this.scene as any;
    s.finished = true;
    this.nodes?.clearNodes();
    this.weakTag?.setVisible(false);
    this.bioGlow?.setVisible(false);
    this.scene.tweens?.killTweensOf?.(this);
    this.setTexture('jg_heart3');
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    s.hud?.showBoss?.(false);
    const bossPts = addScaledScore(s, 2400);
    scorePopup(s, this.x - 30, this.y - 120, `+${bossPts}`, '#ffd24a');
    SFX.play('boom_big');
    shake(this.scene, 470, .02);
    for (let i = 0; i < 8; i++) this.scene.time.delayedCall(i * 155, () => {
      if (!this.scene.sys.isActive()) return;
      s.fx?.bigBoom?.(this.x + rand(-80, 85), this.y + rand(-62, 58), 1.2);
      s.fx?.debris?.(this.x, this.y, 8, [0xb8f2a5, 0x67cfab, 0xbd7298]);
    });
    this.scene.time.delayedCall(1900, () => {
      if (this.scene.sys.isActive()) this.scene.events.emit('rs:jungle-boss-dead');
    });
  }
}
