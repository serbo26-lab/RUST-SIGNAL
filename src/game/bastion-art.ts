import Phaser from 'phaser';
import { GROUND_Y, VIEW_W, WORLD_W } from './core';
import { ParallaxStrip } from './world-rules';

/** Builds procedural fallback & tactical relay textures for Episode 5 («Бастион «Север»»). */
export function makeBastionArt(scene: Phaser.Scene) {
  if (!scene?.textures?.createCanvas) return;

  if (!scene.textures.exists('bz_heater_on')) {
    const tex = scene.textures.createCanvas('bz_heater_on', 44, 62);
    if (tex) {
      const ctx = tex.getContext();
      ctx.fillStyle = '#182436'; ctx.fillRect(6, 8, 32, 54);
      ctx.fillStyle = '#334d68'; ctx.fillRect(8, 10, 28, 50);
      ctx.fillStyle = '#101822'; ctx.fillRect(12, 14, 20, 24);
      ctx.fillStyle = '#5ee8ff'; ctx.fillRect(14, 17, 16, 6);
      ctx.fillStyle = '#ff6a3d'; ctx.fillRect(14, 27, 16, 8);
      ctx.fillStyle = '#9dd8f2'; ctx.fillRect(10, 44, 24, 3);
      ctx.fillStyle = '#243548'; ctx.fillRect(4, 56, 36, 6);
      tex.refresh();
    }
  }

  if (!scene.textures.exists('bz_heater_off')) {
    const tex = scene.textures.createCanvas('bz_heater_off', 44, 62);
    if (tex) {
      const ctx = tex.getContext();
      ctx.fillStyle = '#241820'; ctx.fillRect(6, 8, 32, 54);
      ctx.fillStyle = '#3d2830'; ctx.fillRect(8, 10, 28, 50);
      ctx.fillStyle = '#120d14'; ctx.fillRect(12, 14, 20, 24);
      ctx.fillStyle = '#ff4f4f'; ctx.fillRect(14, 18, 16, 4);
      ctx.fillStyle = '#ffb852'; ctx.fillRect(16, 26, 12, 6);
      ctx.fillStyle = '#523438'; ctx.fillRect(10, 44, 24, 3);
      ctx.fillStyle = '#1a1216'; ctx.fillRect(4, 56, 36, 6);
      tex.refresh();
    }
  }

  if (!scene.textures.exists('bz_platform')) {
    const tex = scene.textures.createCanvas('bz_platform', 128, 24);
    if (tex) {
      const ctx = tex.getContext();
      ctx.fillStyle = '#26384d'; ctx.fillRect(0, 0, 128, 24);
      ctx.fillStyle = '#89cbe8'; ctx.fillRect(0, 0, 128, 4);
      ctx.fillStyle = '#141f2d'; ctx.fillRect(4, 8, 120, 12);
      tex.refresh();
    }
  }
}

/** Polar twilight radar bastion parallax backdrop + drifting arctic snowstorm. */
export class BastionBackdrop {
  private scene: Phaser.Scene;
  private strip: ParallaxStrip | null = null;
  private auroraBar: Phaser.GameObjects.Rectangle | null = null;
  private girders: Array<{ img: Phaser.GameObjects.Rectangle; factor: number; baseX: number }> = [];
  private flakes: Array<{ x: number; y: number; r: number; vx: number; vy: number; a: number; obj: Phaser.GameObjects.Arc }> = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.cameras.main.setBackgroundColor('#091320');

    // Deep sub-floor permafrost apron beneath GROUND_Y
    scene.add.rectangle(WORLD_W / 2, GROUND_Y + 260, WORLD_W, 440, 0x0a131f).setDepth(-20);

    // Aurora sky glow wash
    this.auroraBar = scene.add.rectangle(VIEW_W / 2, 118, VIEW_W + 40, 140, 0x36e6c8, 0.08)
      .setScrollFactor(0).setDepth(-16).setBlendMode(Phaser.BlendModes.ADD);

    if (scene.textures.exists('bg_ep5')) {
      this.strip = new ParallaxStrip(scene, 'bg_ep5', 252, -14, 0.96, false);
    }

    // Distant silhouette radar trusses (midground parallax)
    for (let x = 260; x < WORLD_W; x += 620) {
      const rect = scene.add.rectangle(x, GROUND_Y - 120, 18, 280, 0x132236, 0.65).setDepth(-9);
      this.girders.push({ img: rect, factor: 0.55, baseX: x });
    }

    // Subtle blowing arctic snow across camera viewport
    for (let i = 0; i < 42; i++) {
      const x = Math.random() * VIEW_W;
      const y = Math.random() * 520;
      const r = 1 + (i % 3) * 0.6;
      const obj = scene.add.circle(x, y, r, 0xdff6ff, 0.38).setScrollFactor(0).setDepth(78);
      this.flakes.push({
        x, y, r,
        vx: -28 - (i % 5) * 14,
        vy: 32 + (i % 4) * 12,
        a: 0.25 + (i % 4) * 0.1,
        obj,
      });
    }
  }

  update(camX: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    this.strip?.setScroll(camX * 0.34, 0);
    if (this.auroraBar?.active) {
      this.auroraBar.setAlpha(0.06 + 0.03 * Math.sin(this.scene.time.now * 0.0014));
    }
    for (const g of this.girders) {
      g.img.x = g.baseX + camX * (1 - g.factor) * 0.22;
    }
    for (const f of this.flakes) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -12) f.x = VIEW_W + 12;
      if (f.y > 540) { f.y = -8; f.x = Math.random() * VIEW_W; }
      f.obj.setPosition(f.x, f.y).setAlpha(f.a);
    }
  }
}
