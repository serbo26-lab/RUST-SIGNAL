import Phaser from 'phaser';
import { GROUND_Y, WORLD_W, VIEW_W, VIEW_H } from './core';
import { ParallaxStrip, addTileStrip } from './world-rules';

/** Original train art drawn once into canvas textures (no external dependencies).
 * Native 2D pixels are deliberately high-contrast so they survive scaling. */
export function makeTrainArt(scene: Phaser.Scene) {
  if (!scene.textures.exists('tr_night')) {
    const t = scene.textures.createCanvas('tr_night', 1200, 540)!;
    const c = t.getContext();
    const sky = c.createLinearGradient(0, 0, 0, 540);
    sky.addColorStop(0, '#080c20');
    sky.addColorStop(0.48, '#20263c');
    sky.addColorStop(0.77, '#704459');
    sky.addColorStop(1, '#be6a60');
    c.fillStyle = sky; c.fillRect(0, 0, 1200, 540);
    // The full moon, slow fog bands and radio-tower skyline.
    c.fillStyle = '#f4c4a5'; c.beginPath(); c.arc(865, 173, 68, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffd6b0'; c.beginPath(); c.arc(856, 168, 57, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e09d8f';
    for (let i = 0; i < 20; i++) {
      const x = (i * 163 + 51) % 1200, y = 310 + (i % 5) * 16;
      c.fillRect(x, y, 170, 6);
    }
    // Mountains at the horizon, deliberately lower than the playable train roof.
    c.fillStyle = '#23293c'; c.beginPath(); c.moveTo(0, 390);
    for (let x = 0; x < 1300; x += 72) c.lineTo(x, 335 + Math.sin(x * 0.013) * 53);
    c.lineTo(1200, 540); c.lineTo(0, 540); c.fill();
    c.fillStyle = '#141e30'; c.beginPath(); c.moveTo(0, 422);
    for (let x = 0; x < 1300; x += 65) c.lineTo(x, 376 + Math.cos(x * 0.021) * 34);
    c.lineTo(1200, 540); c.lineTo(0, 540); c.fill();
    for (let i = 0; i < 175; i++) {
      const x = (i * 797 + 47) % 1200, y = (i * 173 + 37) % 290;
      c.fillStyle = i % 4 === 0 ? '#e2a4a5' : '#6d7896';
      c.fillRect(x, y, i % 11 === 0 ? 3 : 1, i % 8 === 0 ? 2 : 1);
    }
    t.refresh();
  }
  if (!scene.textures.exists('tr_towers')) {
    const t = scene.textures.createCanvas('tr_towers', 960, 270)!;
    const c = t.getContext();
    c.strokeStyle = '#243243'; c.lineWidth = 5;
    for (let x = 10; x < 1000; x += 160) {
      const h = 120 + (x % 4) * 18;
      c.beginPath(); c.moveTo(x + 20, 265); c.lineTo(x + 20, 265 - h); c.stroke();
      c.beginPath(); c.moveTo(x, 265 - h + 20); c.lineTo(x + 75, 265 - h + 20); c.stroke();
      c.beginPath(); c.moveTo(x + 20, 265 - h); c.lineTo(x + 46, 265 - h - 28); c.stroke();
      c.fillStyle = '#ffa16f'; c.fillRect(x + 16, 263 - h, 8, 5);
      c.fillStyle = '#344052'; c.fillRect(x + 40, 265 - h + 25, 36, 9);
    }
    c.strokeStyle = '#414356'; c.lineWidth = 2;
    for (let y = 70; y < 205; y += 32) {
      c.beginPath(); c.moveTo(0, y);
      for (let x = 0; x < 960; x += 30) c.lineTo(x, y + 13 * Math.sin(x * .009));
      c.stroke();
    }
    t.refresh();
  }
  if (!scene.textures.exists('tr_wagon')) {
    const t = scene.textures.createCanvas('tr_wagon', 480, 152)!;
    const c = t.getContext();
    c.fillStyle = '#131b27'; c.fillRect(0, 0, 480, 152);
    c.fillStyle = '#6c7a83'; c.fillRect(0, 0, 480, 12);
    c.fillStyle = '#282f3c'; c.fillRect(0, 13, 480, 130);
    c.fillStyle = '#3d4654'; c.fillRect(8, 24, 463, 100);
    c.fillStyle = '#172633'; c.fillRect(20, 34, 440, 81);
    for (let x = 22; x < 464; x += 75) {
      c.fillStyle = '#75848c'; c.fillRect(x, 28, 3, 99);
      c.fillStyle = '#2b3c4b'; c.fillRect(x + 10, 43, 51, 42);
      c.fillStyle = '#a4bbba'; c.fillRect(x + 14, 46, 42, 4);
      c.fillStyle = '#f1b779'; c.fillRect(x + 16, 58, 38, 19);
      c.fillStyle = '#6c4246'; c.fillRect(x + 21, 62, 27, 12);
      c.fillStyle = '#1b212d'; c.fillRect(x + 18, 86, 38, 4);
    }
    c.fillStyle = '#b47f56'; c.fillRect(0, 127, 480, 6);
    c.fillStyle = '#111b27'; c.fillRect(0, 134, 480, 18);
    for (let x = 25; x < 480; x += 90) {
      c.fillStyle = '#60707b'; c.fillRect(x, 133, 68, 10);
      c.fillStyle = '#0e131d'; c.fillRect(x + 6, 137, 17, 11);
      c.fillRect(x + 44, 137, 17, 11);
    }
    c.fillStyle = '#e2b577'; c.font = 'bold 30px monospace'; c.fillText('07', 391, 112);
    t.refresh();
  }
  if (!scene.textures.exists('tr_roof')) {
    const t = scene.textures.createCanvas('tr_roof', 480, 34)!;
    const c = t.getContext();
    c.fillStyle = '#71808a'; c.fillRect(0, 0, 480, 34);
    c.fillStyle = '#252f3d'; c.fillRect(0, 6, 480, 24);
    c.fillStyle = '#aab5ab'; c.fillRect(0, 6, 480, 3);
    for (let x = 0; x < 480; x += 40) {
      c.fillStyle = '#495666'; c.fillRect(x + 4, 11, 31, 15);
      c.fillStyle = '#c58e4b'; c.fillRect(x + 10, 15, 20, 3);
      c.fillStyle = '#151d29'; c.fillRect(x + 2, 24, 36, 4);
    }
    t.refresh();
  }
  if (!scene.textures.exists('tr_cover')) {
    const t = scene.textures.createCanvas('tr_cover', 86, 44)!;
    const c = t.getContext();
    c.fillStyle = '#141c26'; c.fillRect(0, 0, 86, 44);
    c.fillStyle = '#536273'; c.fillRect(2, 2, 82, 40);
    c.fillStyle = '#758699'; c.fillRect(2, 2, 82, 6);
    c.fillStyle = '#253140'; c.fillRect(10, 11, 66, 26);
    c.fillStyle = '#334254'; c.fillRect(14, 15, 58, 18);
    // Hazard stripes & steel bolts
    c.fillStyle = '#c48942';
    for (let x = 14; x < 68; x += 12) c.fillRect(x, 32, 6, 4);
    c.fillStyle = '#9aa8b8';
    c.fillRect(5, 11, 3, 3); c.fillRect(78, 11, 3, 3);
    c.fillRect(5, 34, 3, 3); c.fillRect(78, 34, 3, 3);
    t.refresh();
  }
  if (!scene.textures.exists('tr_rain')) {
    const t = scene.textures.createCanvas('tr_rain', 960, 540)!;
    const c = t.getContext();
    c.lineWidth = 1;
    for (let i = 0; i < 96; i++) {
      const rx = (i * 193 + (i % 5) * 41) % 960;
      const ry = (i * 251 + (i % 7) * 29) % 540;
      const len = 14 + (i % 4) * 5;
      c.strokeStyle = i % 3 === 0 ? 'rgba(180, 220, 248, 0.17)' : 'rgba(155, 198, 230, 0.11)';
      c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx - len * 0.55, ry + len); c.stroke();
    }
    t.refresh();
  }
  if (!scene.textures.exists('tr_wheel')) {
    const t = scene.textures.createCanvas('tr_wheel', 36, 36)!;
    const c = t.getContext();
    c.fillStyle = '#141922'; c.beginPath(); c.arc(18, 18, 16, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#4e5d6e'; c.beginPath(); c.arc(18, 18, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#222b38'; c.fillRect(6, 16, 24, 4); c.fillRect(16, 6, 4, 24);
    c.fillStyle = '#8b99ab'; c.beginPath(); c.arc(18, 18, 4, 0, Math.PI * 2); c.fill();
    t.refresh();
  }
  if (!scene.textures.exists('tr_engine1')) {
    if (scene.textures.exists('ep2_boss_loco') && scene.textures.get('ep2_boss_loco').has('f0')) {
      const src = scene.textures.get('ep2_boss_loco');
      const img = src.getSourceImage() as CanvasImageSource;
      for (const phase of [1, 2, 3]) {
        const frame = src.get(`f${phase - 1}`);
        const t = scene.textures.createCanvas('tr_engine' + phase, frame.cutWidth, frame.cutHeight)!;
        t.getContext().drawImage(img, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
        t.refresh();
      }
    } else for (const phase of [1, 2, 3]) {
      const key = 'tr_engine' + phase;
      const t = scene.textures.createCanvas(key, 320, 220)!;
      const c = t.getContext();
      const hot = phase === 2 ? '#ff5481' : '#efbd7a';
      c.fillStyle = '#111a26'; c.fillRect(6, 103, 310, 115);
      c.fillStyle = '#586977'; c.fillRect(14, 93, 292, 96);
      c.fillStyle = '#293947'; c.fillRect(21, 111, 279, 65);
      c.fillStyle = '#8d9497'; c.fillRect(32, 106, 235, 8);
      c.fillStyle = '#b68050'; c.fillRect(22, 170, 282, 11);
      c.fillStyle = '#1a2430'; c.fillRect(203, 45, 87, 124);
      c.fillStyle = '#54687b'; c.fillRect(211, 49, 72, 44);
      c.fillStyle = hot; c.fillRect(217, 56, 58, 30);
      c.fillStyle = '#252e3a'; c.fillRect(221, 60, 51, 20);
      c.fillStyle = '#728996'; c.fillRect(43, 84, 174, 22);
      c.fillStyle = '#191f2a'; c.fillRect(91, 40, 99, 54);
      c.fillStyle = '#465d6d'; c.fillRect(94, 45, 94, 45);
      c.fillStyle = hot; c.fillRect(106, 54, 69, 15);
      c.fillStyle = '#131d28'; c.fillRect(119, 57, 41, 8);
      c.fillStyle = '#17202c'; c.fillRect(28, 184, 274, 16);
      for (let x = 45; x < 299; x += 51) {
        c.fillStyle = '#101721'; c.fillRect(x, 172, 38, 37);
        c.fillStyle = '#88959c'; c.fillRect(x + 10, 181, 18, 18);
        c.fillStyle = '#344454'; c.fillRect(x + 16, 185, 7, 7);
      }
      c.fillStyle = '#536979'; c.fillRect(8, 70, 96, 18);
      c.fillStyle = '#9eaeb1'; c.fillRect(0, 73, 104, 7);
      c.fillStyle = '#1d2933'; c.fillRect(72, 40, 64, 26);
      c.fillStyle = hot; c.fillRect(80, 45, 43, 11);
      c.fillStyle = '#ffd186'; c.font = 'bold 18px monospace'; c.fillText('№ 07', 218, 149);
      if (phase === 2) {
        c.fillStyle = '#ff6b77'; c.fillRect(78, 126, 138, 8);
        c.fillRect(145, 130, 14, 49);
        c.fillStyle = '#55eee0'; c.fillRect(151, 136, 37, 25);
        c.fillStyle = '#2b363e'; c.fillRect(158, 141, 23, 16);
        c.fillStyle = '#eb5b4f'; c.fillRect(26, 97, 17, 17);
      }
      if (phase === 3) {
        c.fillStyle = '#151b23'; c.fillRect(74, 30, 143, 70);
        c.fillStyle = '#ff785f'; c.fillRect(139, 84, 66, 12);
        c.fillStyle = '#171d27'; c.fillRect(218, 34, 62, 69);
        c.fillStyle = '#9a543c'; c.fillRect(35, 122, 188, 19);
      }
      t.refresh();
    }
  }
}

/** Painted layers belong to this stage only and never replace the harbor art. */
export class TrainBackdrop {
  private readonly scene: Phaser.Scene;
  private sky: ParallaxStrip;
  private wires?: ParallaxStrip;
  private rain?: ParallaxStrip;
  private skyX = 0;
  private wireX = 0;
  private rainX = 0;
  private rainY = 0;
  private wheels: Phaser.GameObjects.Image[] = [];
  private sparkAt = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const hasArt = scene.textures.exists('bg_ep2');
    this.sky = hasArt
      ? new ParallaxStrip(scene, 'bg_ep2', -10, -110)
      : new ParallaxStrip(scene, 'tr_night', -70, -110);

    if (scene.textures.exists('ep2_poles')) {
      this.wires = new ParallaxStrip(scene, 'ep2_poles', -10, -95, 0.9);
    } else if (scene.textures.exists('tr_towers')) {
      this.wires = new ParallaxStrip(scene, 'tr_towers', 235, -100, 0.78);
    }
    if (scene.textures.exists('tr_rain')) {
      this.rain = new ParallaxStrip(scene, 'tr_rain', 0, 135, 0.72, true);
    }

    // Steel rail track bed beneath speeding train
    scene.add.rectangle(0, GROUND_Y + 186, WORLD_W, 24, 0x0b0f17, 0.95).setOrigin(0).setDepth(-5);
    scene.add.rectangle(0, GROUND_Y + 184, WORLD_W, 4, 0x3b4859, 0.9).setOrigin(0).setDepth(-4);

    // Artwork and colliders use the *same* wagon sections.
    for (const [left, right] of [[0, 1345], [1430, 2780], [2865, WORLD_W]] as const) {
      addTileStrip(scene, left, GROUND_Y + 35, right - left, 152, 'tr_wagon', -3);
      addTileStrip(scene, left, GROUND_Y + 32, right - left, 34, 'tr_roof', 2);
      if (scene.textures.exists('tr_wheel')) {
        for (let wx = left + 56; wx < right - 40; wx += 260) {
          this.wheels.push(scene.add.image(wx, GROUND_Y + 174, 'tr_wheel').setDepth(4));
          this.wheels.push(scene.add.image(wx + 42, GROUND_Y + 174, 'tr_wheel').setDepth(4));
        }
      }
    }
  }
  update(cameraX: number, delta: number) {
    this.skyX += delta * 0.045;
    this.sky.setScroll(this.skyX);
    if (this.wires) {
      this.wireX += delta * 0.42;
      this.wires.setScroll(this.wireX + cameraX * 0.18);
    }
    if (this.rain) {
      this.rainX += delta * 0.95;
      this.rainY -= delta * 0.55;
      this.rain.setScroll(this.rainX, this.rainY);
    }
    for (const w of this.wheels) {
      if (w.active) w.rotation += delta * 0.025;
    }
    this.sparkAt += delta;
    if (this.sparkAt > 360) {
      this.sparkAt = 0;
      const sx = cameraX + 180 + Math.random() * 620;
      (this.scene as any)?.fx?.sparkTrail?.(sx, GROUND_Y + 182, 0xffbe59, 3);
    }
  }
}
