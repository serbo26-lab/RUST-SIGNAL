import Phaser from 'phaser';
import { GROUND_Y, WORLD_W, VIEW_W, VIEW_H, addScaledScore, scorePopup, rand, run } from './core';
import { SFX } from './audio';
import { findSurfaceTopAtX } from './world-rules';
import type { LevelScene } from './level';

/** Accessible upper routes reward players willing to explore rather than run right. */
export const INTEL_CACHES = [
  { id: 'harbor-ledger', x: 1500, y: 363, label: 'МАНИФЕСТ' },
  { id: 'hidden-frequency', x: 2690, y: 363, label: 'ЧАСТОТА' },
  { id: 'crane-orders', x: 4305, y: 363, label: 'ПРИКАЗ' },
] as const;

export const INTEL_COUNT = INTEL_CACHES.length;

/** Level-specific events: three reachable caches, an overhead cargo ambush,
 * and a signal-distortion ambush. All timers belong to Phaser's Scene clock:
 * pausing/shutting down the level stops the hazards automatically. */
export class HarborDirector {
  readonly scene: LevelScene;
  readonly intel: Phaser.Physics.Arcade.Group;
  cargoStarted = false;
  signalStarted = false;
  cargoImpacts = 0;
  collectedIds = new Set<string>();

  constructor(scene: LevelScene) {
    this.scene = scene;
    this.intel = scene.physics.add.group({ allowGravity: false, immovable: true });
  }

  installCaches() {
    const hasProp = this.scene.textures.exists('prop_intel');
    for (const cache of INTEL_CACHES) {
      const aura = this.scene.add.circle(cache.x, cache.y, 18, 0x4fe8ff, 0.22)
        .setDepth(93).setBlendMode(Phaser.BlendModes.ADD);
      const icon = hasProp
        ? this.scene.physics.add.sprite(cache.x, cache.y, 'prop_intel')
        : this.scene.physics.add.sprite(cache.x, cache.y, 'signal_orb', 'f0');
      this.intel.add(icon);
      icon.setData('intelId', cache.id).setData('label', cache.label);
      icon.setDepth(95).setScale(hasProp ? 1.05 : 1.4);
      (icon.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setImmovable(true).setSize(22, 22);
      if (!hasProp) icon.play('orb_pulse');
      const caption = this.scene.add.text(cache.x, cache.y - 28, '◇ КОД МАЯКА', {
        fontFamily: 'monospace', fontSize: '11px', color: '#96fff0',
        stroke: '#091922', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(95);
      icon.once(Phaser.GameObjects.Events.DESTROY, () => { caption.destroy(); aura.destroy(); });
      this.scene.tweens.add({
        targets: [icon, aura], y: cache.y - 7, yoyo: true, repeat: -1,
        duration: 850, ease: 'Sine.easeInOut',
      });
      this.scene.tweens.add({
        targets: aura, scale: 1.35, alpha: 0.42, yoyo: true, repeat: -1, duration: 750,
      });
      this.scene.tweens.add({
        targets: caption, alpha: 0.5, yoyo: true, repeat: -1, duration: 700,
      });
    }
    this.scene.physics.add.overlap(this.scene.player, this.intel, (_hero, collectible) =>
      this.collectIntel(collectible as Phaser.Physics.Arcade.Sprite));
  }

  collectIntel(item: Phaser.Physics.Arcade.Sprite) {
    if (!item.active || this.scene.finished || this.scene.player.dead) return false;
    const id = String(item.getData('intelId') ?? '');
    if (!id || this.collectedIds.has(id)) return false;
    this.collectedIds.add(id);
    const label = String(item.getData('label') ?? 'РАЗВЕДДАННЫЕ');
    const x = item.x, y = item.y;
    item.destroy();
    run.intel = Math.min(INTEL_COUNT, this.collectedIds.size);
    this.scene.registry.set('intel', run.intel);
    const bonus = addScaledScore(this.scene, 500);
    scorePopup(this.scene, x, y - 23, '+' + bonus + ' СЕКРЕТ!', '#96fff0');
    this.scene.player.grenades = Math.min(8, this.scene.player.grenades + 1);
    if (this.scene.player.weapon !== 'pistol') {
      this.scene.player.ammo = Math.min(this.scene.player.ammo + 35, 999);
    }
    this.scene.hud.toast('ПЕРЕХВАТ: ' + label + '  ·  ' + run.intel + '/' + INTEL_COUNT, 2300);
    this.scene.fx.signalGlitch(x, y);
    SFX.play('pickup', 0.85);
    if (run.intel === INTEL_COUNT) {
      this.scene.time.delayedCall(900, () => {
        if (!this.scene.finished && this.scene.sys.isActive()) {
          const allPts = addScaledScore(this.scene, 2000);
          scorePopup(this.scene, this.scene.player.x, this.scene.player.y - 40, `+${allPts} ВСЕ КОДЫ!`, '#96fff0');
          this.scene.hud.banner('ВСЕ КОДЫ МАЯКА СОБРАНЫ!');
        }
      });
    }
    return true;
  }

  /** Chapter set-piece: the hostile crane drops three containers. Every
   * landing is preceded by a floor marker and >=900ms reaction window. */
  startCargoAmbush() {
    if (this.cargoStarted || this.scene.finished) return;
    this.cargoStarted = true;
    this.scene.hud.banner('ВНИМАНИЕ! ГРУЗ НАД ПРИЧАЛОМ');
    SFX.play('alarm', 0.65);
    for (let n = 0; n < 3; n++) {
      this.scene.time.delayedCall(n * 1150, () => {
        if (!this.scene.sys.isActive() || this.scene.finished || this.scene.player.dead) return;
        const x = Phaser.Math.Clamp(this.scene.player.x + (n % 2 === 0 ? 70 : -45), 1640, 2250);
        this.dropCargo(x);
      });
    }
  }

  dropCargo(worldX: number) {
    if (!this.scene.sys.isActive() || this.scene.finished) return;
    const s = this.scene;
    const landY = Math.min(GROUND_Y - 5, findSurfaceTopAtX(s, worldX, GROUND_Y + 35) - 22);
    const mark = s.add.rectangle(worldX, landY + 28, 100, 8, 0xffc253, 0.75).setDepth(93);
    const warning = s.add.text(worldX, landY - 73, '▼ ОПАСНО', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffcf76',
      stroke: '#14151c', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(100);
    s.tweens.add({ targets: [mark, warning], alpha: 0.2, duration: 140, yoyo: true, repeat: 5 });
    s.time.delayedCall(950, () => {
      mark.destroy(); warning.destroy();
      if (!s.sys.isActive() || s.finished) return;
      const container = s.textures.exists('rem_container')
        ? s.add.image(worldX, -90, 'rem_container')
        : s.add.image(worldX, -90, 'prop_crate');
      container.setDisplaySize(104, 48).setDepth(88);
      s.tweens.add({
        targets: container, y: landY, duration: 610, ease: 'Quad.easeIn',
        onComplete: () => {
          if (!s.sys.isActive()) return;
          this.cargoImpacts++;
          s.weapons.explode(worldX, landY + 1, 75, 2, true);
          s.fx.debris(worldX, landY - 5, 9);
          s.tweens.add({
            targets: container, alpha: 0, delay: 1300, duration: 420,
            onComplete: () => container.destroy(),
          });
        },
      });
    });
  }

  /** A second staged encounter: the radio signal causes an EMP-like pulse
   * and dispatches mechanical enemies. The light effect is visual; contact
   * damage is performed by the actual spider enemies and remains avoidable. */
  startSignalSurge() {
    if (this.signalStarted || this.scene.finished) return;
    this.signalStarted = true;
    this.scene.hud.banner('СИГНАЛ ЗАХВАТИЛ ТЕХНИКУ НА ПРИЧАЛЕ');
    SFX.play('signal', 0.7);
    const s = this.scene;
    const veil = s.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x67f7f0, 0.14)
      .setOrigin(0).setScrollFactor(0).setDepth(210);
    s.tweens.add({
      targets: veil, alpha: 0, duration: 780, ease: 'Quad.easeOut',
      onComplete: () => veil.destroy(),
    });
    s.time.delayedCall(650, () => {
      if (!s.sys.isActive() || s.finished) return;
      const center = Phaser.Math.Clamp(s.player.x + 170, 3160, WORLD_W - 1150);
      s.fx.signalGlitch(center, GROUND_Y - 95);
      s.spawnEnemyAt('spider', center - 70, 120);
      s.spawnEnemyAt('drone', center + 115, GROUND_Y - 100);
      s.hud.toast('ЗАСАДА! СБЕЙ ДРОНА!', 1950);
    });
    s.time.delayedCall(1800, () => {
      if (!s.sys.isActive() || s.finished) return;
      const x = Phaser.Math.Clamp(s.player.x + 235, 3150, 3700);
      s.spawnEnemyAt('spider', x, 120);
    });
  }
}
