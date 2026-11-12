import Phaser from 'phaser';
import { GROUND_Y, WORLD_W } from './core';

/**
 * Level 1 "Гавань мёртвых кораблей" — background builder.
 * Parallax layers drawn procedurally into canvas textures (one wide strip each).
 */

const SKY_W = WORLD_W / 2;   // layer scrolls at 0.5 -> half world width
const FAR_W = WORLD_W * 0.7;
const MID_W = WORLD_W * 0.85;

export function buildHarborBackground(scene: Phaser.Scene) {
  const tex = scene.textures;
  const hasRemasterBackdrop = tex.exists('bg_ep1');

  if (!hasRemasterBackdrop) {
    // ---- sky gradient + sun + drifting clouds (fallback if asset pack missing)
    if (!tex.exists('bg_sky')) {
      const t = tex.createCanvas('bg_sky', 480, 360)!;
      const c = t.getContext();
      const g = c.createLinearGradient(0, 0, 0, 360);
      g.addColorStop(0, '#2b3f63');
      g.addColorStop(0.55, '#7c6a6a');
      g.addColorStop(0.8, '#c98a5a');
      g.addColorStop(1, '#e0a060');
      c.fillStyle = g; c.fillRect(0, 0, 480, 360);
      c.fillStyle = '#ffd9a0'; c.beginPath(); c.arc(360, 250, 46, 0, Math.PI * 2); c.fill();
      t.refresh();
    }
    const sky = scene.add.image(0, -120, 'bg_sky').setOrigin(0, 0).setScale(2).setScrollFactor(0.1).setDepth(-30);
    sky.setDisplaySize(Math.max(960, SKY_W), 720);

    if (!tex.exists('bg_far')) {
      const t = tex.createCanvas('bg_far', FAR_W, 300)!;
      const c = t.getContext();
      c.fillStyle = '#3d4a63';
      c.fillRect(0, 240, FAR_W, 60);
      t.refresh();
    }
    scene.add.image(0, 470, 'bg_far').setOrigin(0, 1).setScrollFactor(0.3).setDepth(-20);
  }

  // Harbor sunset haze + gentle drifting fog ribbons above water horizon
  const haze = scene.add.rectangle(480, 392, 960, 120, 0xf29f66, 0.08)
    .setScrollFactor(0).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({ targets: haze, alpha: 0.14, duration: 2800, yoyo: true, repeat: -1 });

  // Ground fallback if world-rules tile unavailable
  // Solid dark concrete base under the playable floor deck (avoids 6200px wide TileSprite canvas)
  scene.add.rectangle(0, GROUND_Y + 35, WORLD_W, 70, 0x4d5563).setOrigin(0, 0).setScrollFactor(1).setDepth(1);

  // Foreground cable/pipe accents scrolling at 1.15x below player boot line
  if (!tex.exists('fg_pipe')) {
    const t = tex.createCanvas('fg_pipe', 120, 20)!;
    const c = t.getContext();
    c.fillStyle = '#2b1b13'; c.fillRect(0, 4, 120, 12);
    c.fillStyle = '#6c4228'; c.fillRect(0, 6, 120, 6);
    c.fillStyle = '#996039'; c.fillRect(0, 6, 120, 2);
    c.fillStyle = '#1b1d24'; c.fillRect(18, 2, 8, 16); c.fillRect(92, 2, 8, 16);
    t.refresh();
  }
  for (let pxp = 360; pxp < WORLD_W; pxp += 860) {
    scene.add.image(pxp, GROUND_Y + 86, 'fg_pipe').setScrollFactor(1.14).setDepth(145).setAlpha(0.82);
  }
}

/** Subtle blinking red industrial mast beacons anchored near horizon silhouettes. */
export function addBeacons(scene: Phaser.Scene) {
  const beacons: Phaser.GameObjects.Arc[] = [];
  for (let x = 180; x < MID_W; x += 460) {
    const by = 296 + ((x * 17) % 36);
    const glow = scene.add.circle(x, by, 3.5, 0xff5a45, 0.14)
      .setScrollFactor(0.45).setDepth(-6).setBlendMode(Phaser.BlendModes.ADD);
    const core = scene.add.circle(x, by, 1.4, 0xff8c69, 0.55)
      .setScrollFactor(0.45).setDepth(-5);
    beacons.push(glow, core);
  }
  scene.tweens.add({
    targets: beacons, alpha: 0.08, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
}
