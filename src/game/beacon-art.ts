import Phaser from 'phaser';
import { GROUND_Y, VIEW_W, WORLD_W } from './core';
import { ParallaxStrip } from './world-rules';

/** Builds procedural fallback & Signal Anchor conduit textures for Episode 6 («Ядро «Маяк-13»»). */
export function makeBeaconArt(scene: Phaser.Scene) {
  if (!scene?.textures?.createCanvas) return;

  if (!scene.textures.exists('sp_anchor_on')) {
    const tex = scene.textures.createCanvas('sp_anchor_on', 46, 68);
    if (tex) {
      const ctx = tex.getContext();
      ctx.fillStyle = '#0d1a26'; ctx.fillRect(10, 6, 26, 62);
      ctx.fillStyle = '#1c3e54'; ctx.fillRect(13, 10, 20, 54);
      ctx.fillStyle = '#5ef5eb'; ctx.fillRect(17, 14, 12, 30);
      ctx.fillStyle = '#d9fffc'; ctx.fillRect(21, 18, 4, 22);
      ctx.fillStyle = '#ff4fd8'; ctx.fillRect(14, 48, 18, 4);
      ctx.fillStyle = '#142a3a'; ctx.fillRect(4, 60, 38, 8);
      tex.refresh();
    }
  }

  if (!scene.textures.exists('sp_anchor_off')) {
    const tex = scene.textures.createCanvas('sp_anchor_off', 46, 68);
    if (tex) {
      const ctx = tex.getContext();
      ctx.fillStyle = '#14151c'; ctx.fillRect(10, 6, 26, 62);
      ctx.fillStyle = '#262b36'; ctx.fillRect(13, 10, 20, 54);
      ctx.fillStyle = '#33404f'; ctx.fillRect(17, 14, 12, 30);
      ctx.fillStyle = '#ff5e5e'; ctx.fillRect(16, 48, 14, 4);
      ctx.fillStyle = '#181c24'; ctx.fillRect(4, 60, 38, 8);
      tex.refresh();
    }
  }

  if (!scene.textures.exists('sp_platform')) {
    const tex = scene.textures.createCanvas('sp_platform', 128, 24);
    if (tex) {
      const ctx = tex.getContext();
      ctx.fillStyle = '#182433'; ctx.fillRect(0, 0, 128, 24);
      ctx.fillStyle = '#5ef5eb'; ctx.fillRect(0, 0, 128, 3);
      ctx.fillStyle = '#0c131d'; ctx.fillRect(6, 7, 116, 13);
      ctx.fillStyle = '#ff54b8'; ctx.fillRect(12, 12, 20, 3); ctx.fillRect(96, 12, 20, 3);
      tex.refresh();
    }
  }
}

/** Subterranean Signal Spire cathedral backdrop with pulsing plasma conduits & rising signal embers. */
export class BeaconBackdrop {
  private scene: Phaser.Scene;
  private strip: ParallaxStrip | null = null;
  private conduitColumns: Array<{ obj: Phaser.GameObjects.Rectangle; baseX: number; factor: number; phase: number }> = [];
  private embers: Array<{ x: number; y: number; vx: number; vy: number; color: number; obj: Phaser.GameObjects.Arc }> = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.cameras.main.setBackgroundColor('#070b14');

    // Deep obsidian bedrock below GROUND_Y
    scene.add.rectangle(WORLD_W / 2, GROUND_Y + 260, WORLD_W, 440, 0x060911).setDepth(-20);

    if (scene.textures.exists('bg_ep6')) {
      this.strip = new ParallaxStrip(scene, 'bg_ep6', 252, -14, 0.96, false);
    }

    // Pulsing vertical Spire energy conduits in background chamber
    for (let x = 220; x < WORLD_W; x += 520) {
      const col = (Math.floor(x / 520) % 2 === 0) ? 0x45f0e2 : 0xf048b8;
      const obj = scene.add.rectangle(x, 220, 8, 440, col, 0.14)
        .setDepth(-10).setBlendMode(Phaser.BlendModes.ADD);
      this.conduitColumns.push({ obj, baseX: x, factor: 0.45, phase: x * 0.01 });
    }

    // Floating resonant signal sparks rising gently toward Spire crown
    for (let i = 0; i < 34; i++) {
      const x = Math.random() * VIEW_W;
      const y = Math.random() * 520;
      const color = i % 3 === 0 ? 0xff5ce8 : 0x62f5eb;
      const obj = scene.add.circle(x, y, i % 4 === 0 ? 2 : 1.3, color, 0.48)
        .setScrollFactor(0).setDepth(78).setBlendMode(Phaser.BlendModes.ADD);
      this.embers.push({
        x, y,
        vx: ((i % 5) - 2) * 8,
        vy: -24 - (i % 4) * 9,
        color,
        obj,
      });
    }
  }

  update(camX: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    const now = this.scene.time.now;
    this.strip?.setScroll(camX * 0.36, 0);

    for (const c of this.conduitColumns) {
      c.obj.x = c.baseX + camX * (1 - c.factor) * 0.2;
      c.obj.setAlpha(0.11 + 0.08 * Math.sin(now * 0.0024 + c.phase));
    }
    for (const e of this.embers) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.y < -10) { e.y = 530; e.x = Math.random() * VIEW_W; }
      if (e.x < -10) e.x = VIEW_W + 10;
      if (e.x > VIEW_W + 10) e.x = -10;
      e.obj.setPosition(e.x, e.y);
      void e.color;
    }
  }
}
