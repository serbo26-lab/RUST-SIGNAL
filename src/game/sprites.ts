import Phaser from 'phaser';
import { heroStyle, type StyleKey } from './style';

/**
 * Procedural pixel-art sprite factory. Every texture is drawn once into a
 * canvas at boot — no external assets, works offline. Scale factor: 1px cells.
 */

type Ctx = CanvasRenderingContext2D;

export class TextureFactory {
  private scene: Phaser.Scene;
  private g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.g = scene.add.graphics();
    this.g.setVisible(false);
  }

  /** Create a single-frame canvas texture from a draw callback. */
  single(key: string, w: number, h: number, draw: (ctx: Ctx) => void) {
    if (this.scene.textures.exists(key)) return;
    const t = this.scene.textures.createCanvas(key, w, h)!;
    const ctx = t.getContext();
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    t.refresh();
  }

  /** Create a multi-frame canvas texture (frame width = fw). */
  strip(key: string, fw: number, fh: number, frames: number, draw: (ctx: Ctx, i: number) => void) {
    if (this.scene.textures.exists(key)) return;
    const t = this.scene.textures.createCanvas(key, fw * frames, fh)!;
    const ctx = t.getContext();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < frames; i++) {
      ctx.save();
      ctx.translate(i * fw, 0);
      draw(ctx, i);
      ctx.restore();
    }
    for (let i = 0; i < frames; i++) t.add(`f${i}`, 0, i * fw, 0, fw, fh);
    t.refresh();
  }

  /** Add animation from a strip texture. */
  anim(name: string, key: string, frames: number, frameRate: number, repeat = -1) {
    if (this.scene.anims.exists(name)) return;
    this.scene.anims.create({
      key: name,
      frames: Array.from({ length: frames }, (_, i) => ({ key, frame: `f${i}` })),
      frameRate,
      repeat,
    });
  }

  destroy() {
    this.g.destroy();
  }
}

/* ---------- tiny drawing helpers (operate on raw ctx) ---------- */

export function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function outlineFill(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, line = '#14121a') {
  px(ctx, x, y, w, h, fill);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2);
}

/* =====================================================================
   PALETTE
===================================================================== */
export const PAL = {
  dark: '#14121a',
  skin: '#e8b088',
  skinDark: '#c8905f',
  ignisSuit: '#3d6b4f',
  ignisSuitDk: '#2c4f3a',
  red: '#d8453a',
  redDk: '#a52e28',
  voltSuit: '#4a5568',
  voltSuitDk: '#333d4d',
  tan: '#c9b458',
  metal: '#8a94a6',
  metalDk: '#5b6473',
  metalLt: '#c0c8d4',
  rust: '#b06a3a',
  rustDk: '#7d4a26',
  enemyUniform: '#6b6f4a',
  enemyUniformDk: '#4d5136',
  officer: '#2f3a52',
  glass: '#7fd4e8',
  laser: '#ff4fd8',
  laserCore: '#ffd6fb',
  fire: '#ffb02e',
  fireHot: '#ffe98a',
  smoke: '#9aa0ad',
  bloodRust: '#c8552e',
  hairBrown: '#6e4a2a',
};

// локальная версия blend без циклического импорта деталей
function shadeOf(hex: string, f: number): string {
  const v = parseInt(hex.replace('#',''),16);
  const r=Math.max(0,Math.min(255,Math.round(((v>>16)&255)*f)));
  const g=Math.max(0,Math.min(255,Math.round(((v>>8)&255)*f)));
  const b=Math.max(0,Math.min(255,Math.round((v&255)*f)));
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function blendHexLocal(base: string, ref: string, t: number): string {
  const p = (h: string) => { const v = parseInt(h.replace('#',''),16); return [(v>>16)&255,(v>>8)&255,v&255]; };
  const [br,bg,bb] = p(base); const [rr,rg,rb] = p(ref);
  const m = (a:number,b:number)=>Math.round(a*(1-t)+b*t);
  const to2=(x:number)=>Math.max(0,Math.min(255,x)).toString(16).padStart(2,'0');
  return '#'+to2(m(br,rr))+to2(m(bg,rg))+to2(m(bb,rb));
}
// акцентные цвета, заданные референсами (обновляются до генерации текстур)
export const BANDANA_COLORS: { ignis: string } = { ignis: PAL.red };

/* =====================================================================
   PLAYER SPRITES  (32x40 per frame)
   char: 'ignis' (Алекс «Искра» Волкова) | 'volt' (Макс «Гром» Орлов)
===================================================================== */

function drawSoldierBase(ctx: Ctx, opts: {
  suit: string; suitDk: string; boots: string; vest: string;
  hair: string; bandana?: boolean; beard?: boolean; bulk?: number; bandColor?: string;
}) {
  const bulk = opts.bulk || 0; // extra torso width for Max
  // legs (mid-stride default handled by caller offsets)
  px(ctx, 10, 26, 5, 10, opts.suit);
  px(ctx, 17 + bulk, 26, 5, 10, opts.suit);
  px(ctx, 9, 35, 7, 4, opts.boots);
  px(ctx, 16 + bulk, 35, 7, 4, opts.boots);
  // torso
  px(ctx, 9, 14, 13 + bulk, 13, opts.suit);
  px(ctx, 9, 14, 13 + bulk, 4, opts.vest); // chest rig
  px(ctx, 11, 18, 3 + bulk, 6, opts.suitDk);
  // head
  px(ctx, 11, 4, 9, 10, PAL.skin);
  px(ctx, 13, 9, 2, 2, PAL.dark); // eye
  // hair / bandana
  if (opts.bandana) {
    const bc = opts.bandColor || PAL.red;
    px(ctx, 10, 3, 11, 4, bc);
    px(ctx, 21, 4, 6, 2, bc); // trailing tail
    px(ctx, 24, 6, 4, 2, shadeOf(bc, 0.75));
    px(ctx, 10, 7, 11, 2, opts.hair);
  } else {
    px(ctx, 10, 2, 11, 5, opts.hair);
  }
  if (opts.beard) {
    px(ctx, 11, 10, 8, 4, opts.hair);
    px(ctx, 10, 3, 12, 4, opts.hair); // full head hair
    px(ctx, 13, 9, 2, 2, PAL.dark);
  }
  // arms (gun-holding forward)
  px(ctx, 20 + bulk, 16, 8, 4, opts.suitDk);
  px(ctx, 26 + bulk, 15, 5, 5, PAL.metal); // gun block
  px(ctx, 30 + bulk, 16, 6, 3, PAL.metalDk); // barrel
}

export function makePlayerTextures(scene: Phaser.Scene) {
  const tf = new TextureFactory(scene);
  const FW = 34, FH = 40;

  // Если в public/characters/ лежат референсы (volkova.png / orlov.png),
  // извлекаем из них палитру и подмешиваем в процедурные спрайты героев.
  const refFor = (key: StyleKey | null) => (key ? heroStyle(key) : null);
  const ri = refFor('volkova'), rv = refFor('orlov');
  const shade = (hex: string, f: number) => {
    const v = parseInt(hex.replace('#',''),16);
    const r=Math.max(0,Math.min(255,Math.round(((v>>16)&255)*f)));
    const g=Math.max(0,Math.min(255,Math.round(((v>>8)&255)*f)));
    const b=Math.max(0,Math.min(255,Math.round((v&255)*f)));
    return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  };
  const t = 0; // keep canonical game palette even when old external illustrations differ
  const mixc = (base: string, ref?: string) => ref ? blendHexLocal(base, ref, t) : base;
  const chars = {
    ignis: { suit: mixc(PAL.ignisSuit, ri?.main), suitDk: mixc(PAL.ignisSuitDk, ri?.second), boots: '#2a2a30', vest: mixc('#22301f', ri?.second), hair: '#241a14', bandana: true, beard: false, bulk: 0 },
    volt:  { suit: mixc(PAL.voltSuit, rv?.main),  suitDk: mixc(PAL.voltSuitDk, rv?.second),  boots: '#3a2c1e', vest: mixc('#262c36', rv?.second), hair: '#6e4a2a', bandana: false, beard: true,  bulk: 3 },
  } as const;
  BANDANA_COLORS.ignis = PAL.red; // signature red bandana must match hero artwork

  (['ignis', 'volt'] as const).forEach((id) => {
    const o = chars[id];
    // idle: subtle breathing bob
    tf.strip(`p_${id}_idle`, FW, FH, 2, (ctx, i) => {
      ctx.save(); ctx.translate(0, i === 1 ? 1 : 0);
      drawSoldierBase(ctx, o as any);
      ctx.restore();
    });
    // run: 4-frame leg cycle
    tf.strip(`p_${id}_run`, FW, FH, 4, (ctx, i) => {
      drawSoldierBase(ctx, o as any);
      // overwrite legs with stride poses
      px(ctx, 8, 26, 6, 10, o.suit); px(ctx, 18 + o.bulk, 26, 6, 10, o.suit);
      px(ctx, 7, 35, 8, 4, o.boots); px(ctx, 19 + o.bulk, 35, 8, 4, o.boots);
      if (i % 4 === 1) { px(ctx, 12, 24, 6, 12, o.suit); px(ctx, 11, 34, 8, 4, o.boots); }
      if (i % 4 === 3) { px(ctx, 16 + o.bulk, 24, 6, 12, o.suit); px(ctx, 15 + o.bulk, 34, 8, 4, o.boots); }
      if (i === 0 || i === 2) { /* neutral stride already drawn */ }
    });
    // jump/fall
    tf.strip(`p_${id}_jump`, FW, FH, 2, (ctx, i) => {
      drawSoldierBase(ctx, o as any);
      // tucked legs
      px(ctx, 9, 26, 6, 7, o.suit); px(ctx, 18 + o.bulk, 26, 6, 7, o.suit);
      px(ctx, 8, 31, 8, 4, o.boots); px(ctx, 18 + o.bulk, 31, 8, 4, o.boots);
      if (i === 1) { px(ctx, 9, 26, 6, 10, o.suit); px(ctx, 18 + o.bulk, 26, 6, 10, o.suit); }
    });
    // crouch (aim low/forward)
    tf.single(`p_${id}_crouch`, FW, FH, (ctx) => {
      ctx.save(); ctx.translate(0, 14);
      drawSoldierBase(ctx, o as any);
      ctx.restore();
      px(ctx, 6, 34, 22, 6, o.suit); // widened low stance
    });
    // roll (Ignis signature): ball spinning 4 frames
    tf.strip(`p_${id}_roll`, FW, FH, 4, (ctx, i) => {
      const cx = 17, cy = 24, r = 11;
      ctx.fillStyle = o.suit; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = o.suitDk; ctx.lineWidth = 2; ctx.stroke();
      // spin marks
      const a = (i / 4) * Math.PI * 2;
      px(ctx, cx + Math.cos(a) * 6 - 1, cy + Math.sin(a) * 6 - 1, 4, 4, id === 'ignis' ? BANDANA_COLORS.ignis : PAL.hairBrown);
      px(ctx, cx - Math.cos(a) * 6 - 1, cy - Math.sin(a) * 6 - 1, 3, 3, o.vest);
    });
    // aim-up variant (head tilted, gun raised) — reuse body, gun up
    tf.strip(`p_${id}_aimup`, FW, FH, 1, (ctx) => {
      drawSoldierBase(ctx, o as any);
      // erase gun-forward area & draw gun up
      px(ctx, 20 + o.bulk, 15, 16, 6, o.suit);
      px(ctx, 22 + o.bulk, 2, 5, 14, PAL.metal);
      px(ctx, 23 + o.bulk, 0, 3, 4, PAL.metalDk);
    });
    tf.anim(`p_${id}_idle`, `p_${id}_idle`, 2, 4);
    tf.anim(`p_${id}_run`, `p_${id}_run`, 4, 12);
    tf.anim(`p_${id}_roll`, `p_${id}_roll`, 4, 15);
  });

  // grenade (shared)
  tf.single('grenade', 10, 12, (ctx) => {
    px(ctx, 2, 3, 7, 8, '#3f5a3a');
    px(ctx, 4, 1, 4, 3, PAL.metalDk);
    px(ctx, 7, 0, 3, 2, '#c9b458');
  });

  tf.destroy();
}

/* =====================================================================
   ENEMIES (5 varieties)
===================================================================== */

export function makeEnemyTextures(scene: Phaser.Scene) {
  const tf = new TextureFactory(scene);

  // --- rifle soldier: runs, stops, fires bursts, seeks cover (AI in code)
  tf.strip('e_rifle', 30, 36, 4, (ctx, i) => {
    px(ctx, 9, 22, 5, 10, PAL.enemyUniform);
    px(ctx, 16, 22, 5, 10, PAL.enemyUniform);
    px(ctx, 8, 31, 7, 4, '#2a2a30'); px(ctx, 15, 31, 7, 4, '#2a2a30');
    if (i % 2 === 1) { px(ctx, 6, 30, 8, 5, '#2a2a30'); }
    px(ctx, 8, 10, 13, 13, PAL.enemyUniform);
    px(ctx, 8, 10, 13, 4, PAL.enemyUniformDk);
    px(ctx, 10, 2, 9, 8, PAL.skin);
    px(ctx, 9, 0, 11, 4, PAL.enemyUniformDk); // helmet
    px(ctx, 12, 6, 2, 2, PAL.dark);
    px(ctx, 19, 12, 10, 3, PAL.metalDk); // rifle
    px(ctx, 27, 11, 3, 5, '#241a14');
  });
  tf.anim('e_rifle_run', 'e_rifle', 4, 10);

  // --- grenadier: nervous, occasionally drops his own grenade
  tf.strip('e_gren', 30, 36, 2, (ctx, i) => {
    const wob = i === 1 ? 1 : 0;
    px(ctx, 9, 22, 5, 10, '#5a5440'); px(ctx, 16, 22, 5, 10, '#5a5440');
    px(ctx, 8, 31, 7, 4, '#2a2a30'); px(ctx, 15, 31, 7, 4, '#2a2a30');
    px(ctx, 8, 10 + wob, 13, 13, '#5a5440');
    px(ctx, 10, 2 + wob, 9, 8, PAL.skin);
    px(ctx, 9, 0 + wob, 11, 4, '#463f2c');
    px(ctx, 12, 6 + wob, 2, 2, PAL.dark);
    // raised arm with grenade
    px(ctx, 19, 4 + wob, 4, 8, '#5a5440');
    px(ctx, 19, 1 + wob, 5, 5, '#3f5a3a');
  });
  tf.anim('e_gren_idle', 'e_gren', 2, 6);

  // --- heavy gunner: big silhouette, slow deploy (state machine in AI)
  tf.single('e_heavy', 44, 44, (ctx) => {
    px(ctx, 12, 28, 8, 12, PAL.metalDk); px(ctx, 24, 28, 8, 12, PAL.metalDk);
    px(ctx, 10, 39, 12, 5, '#222'); px(ctx, 22, 39, 12, 5, '#222');
    px(ctx, 8, 10, 28, 20, '#57606e');           // armour plate
    px(ctx, 8, 10, 28, 6, PAL.metalDk);
    px(ctx, 14, 2, 14, 10, PAL.skin);            // helmeted head
    px(ctx, 12, 0, 18, 5, PAL.metal);
    px(ctx, 17, 7, 3, 2, PAL.dark);
    px(ctx, 34, 14, 12, 5, PAL.metalDk);         // minigun
    px(ctx, 42, 13, 4, 7, PAL.metal);
    px(ctx, 2, 16, 8, 8, '#3a4250');             // backpack ammo
  });

  // --- mechanical spider: crawls on ceilings
  tf.strip('e_spider', 34, 24, 2, (ctx, i) => {
    px(ctx, 10, 6, 14, 9, '#2c3442');
    px(ctx, 12, 8, 4, 3, '#ff4fd8');             // glowing eye
    for (let k = 0; k < 3; k++) {
      const ph = i === 0 ? k % 2 : 1 - (k % 2);
      px(ctx, 4 + k * 2, 8 + ph * 3, 8, 2, PAL.metalDk);
      px(ctx, 22 - k * 0 + k * 2, 8 + (1 - ph) * 3, 8, 2, PAL.metalDk);
    }
    px(ctx, 8, 14, 4, 8, PAL.metalDk); px(ctx, 22, 14, 4, 8, PAL.metalDk);
  });
  tf.anim('e_spider_crawl', 'e_spider', 2, 8);

  // --- officer: calls reinforcements, flees when losing
  tf.single('e_officer', 30, 36, (ctx) => {
    px(ctx, 9, 22, 5, 10, PAL.officer); px(ctx, 16, 22, 5, 10, PAL.officer);
    px(ctx, 8, 31, 7, 4, '#111'); px(ctx, 15, 31, 7, 4, '#111');
    px(ctx, 8, 10, 13, 13, PAL.officer);
    px(ctx, 10, 12, 3, 6, '#c9a227'); // gold braid
    px(ctx, 10, 2, 9, 8, PAL.skin);
    px(ctx, 8, 0, 13, 4, '#1c2436'); px(ctx, 20, 2, 6, 2, '#1c2436'); // peaked cap
    px(ctx, 12, 6, 2, 2, PAL.dark);
    px(ctx, 20, 14, 7, 3, PAL.metalDk); // pistol
  });

  // --- repair drone: heals machines
  tf.strip('e_drone', 26, 20, 2, (ctx, i) => {
    const b = i === 1 ? 2 : 0;
    px(ctx, 4, 6 + b, 18, 8, PAL.metal);
    px(ctx, 2, 8 + b, 4, 4, PAL.metalDk); px(ctx, 20, 8 + b, 4, 4, PAL.metalDk);
    px(ctx, 10, 8 + b, 6, 4, '#39e07a'); // green weld light
    px(ctx, 8, 2 + b, 10, 3, PAL.metalDk);
  });
  tf.anim('e_drone_hover', 'e_drone', 2, 6);

  tf.destroy();
}

/* =====================================================================
   PICKUPS / FX / PROJECTILES
===================================================================== */

export function makeFxTextures(scene: Phaser.Scene) {
  const tf = new TextureFactory(scene);

  // 1x1 white texture used as invisible static collision bodies
  tf.single('__rect', 1, 1, (ctx) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1, 1); });

  // weapon crates
  const crate = (key: string, color: string, glyph: (ctx: Ctx) => void) =>
    tf.single(key, 24, 22, (ctx) => {
      px(ctx, 1, 1, 22, 20, '#3a3f4a');
      px(ctx, 3, 3, 18, 16, color);
      px(ctx, 3, 3, 18, 3, '#00000055');
      glyph(ctx);
    });
  crate('crate_mg', PAL.metalDk, (ctx) => { px(ctx, 6, 10, 12, 3, '#dde'); px(ctx, 16, 8, 3, 6, '#dde'); });
  crate('crate_shotgun', PAL.rust, (ctx) => { px(ctx, 5, 12, 14, 3, '#dde'); px(ctx, 5, 8, 5, 4, '#9c6'); });
  crate('crate_laser', '#463a6e', (ctx) => { px(ctx, 6, 11, 12, 3, PAL.laser); px(ctx, 4, 7, 4, 8, PAL.laserCore); });
  crate('crate_life', '#2e6b46', (ctx) => { px(ctx, 10, 6, 4, 12, '#fff'); px(ctx, 6, 10, 12, 4, '#fff'); });

  // bullets
  tf.single('bullet', 10, 4, (ctx) => { px(ctx, 0, 0, 10, 4, '#ffe98a'); px(ctx, 0, 1, 10, 2, '#fff'); });
  tf.single('bullet_e', 8, 4, (ctx) => { px(ctx, 0, 0, 8, 4, '#ff8a5c'); px(ctx, 0, 1, 8, 2, '#fff'); });
  tf.single('laser_b', 26, 5, (ctx) => { px(ctx, 0, 0, 26, 5, PAL.laser); px(ctx, 0, 1, 26, 3, PAL.laserCore); });
  tf.single('rocket', 18, 8, (ctx) => {
    px(ctx, 0, 2, 12, 4, PAL.metalLt); px(ctx, 12, 1, 6, 6, PAL.red);
    px(ctx, 0, 3, 4, 2, PAL.fire);
  });
  tf.single('enemy_turret', 36, 30, (ctx) => {
    px(ctx, 2, 18, 32, 10, PAL.metalDk); px(ctx, 8, 6, 20, 14, PAL.metal);
    px(ctx, 26, 8, 12, 5, PAL.metalDk); px(ctx, 12, 10, 8, 6, '#222');
  });

  // explosion strip (used with scale)
  tf.strip('explosion', 48, 48, 6, (ctx, i) => {
    const t = i / 5;
    const r = 6 + t * 20;
    const col = i < 2 ? PAL.fireHot : i < 4 ? PAL.fire : (i < 5 ? '#d8622e' : PAL.smoke);
    ctx.globalAlpha = i === 5 ? 0.55 : 1;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(24, 24, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = i < 3 ? PAL.fire : '#8a4a2a';
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + i;
      ctx.beginPath(); ctx.arc(24 + Math.cos(a) * r * 0.7, 24 + Math.sin(a) * r * 0.7, r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
  tf.anim('boom', 'explosion', 6, 20, 0);

  // smoke puff
  tf.strip('smoke', 24, 24, 4, (ctx, i) => {
    ctx.globalAlpha = 0.7 - i * 0.16;
    ctx.fillStyle = PAL.smoke;
    ctx.beginPath(); ctx.arc(12, 12, 5 + i * 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });
  tf.anim('puff', 'smoke', 4, 12, 0);

  // signal glitch orb (the "rust signal" mote)
  tf.strip('signal_orb', 18, 18, 4, (ctx, i) => {
    const c = i % 2 === 0 ? '#ff4fd8' : '#4fe8ff';
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(9, 9, 5 + (i % 2), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(9, 9, 2, 0, Math.PI * 2); ctx.fill();
    px(ctx, 1 + i * 2, 8, 3, 2, c); px(ctx, 14 - i * 2, 8, 3, 2, c);
  });
  tf.anim('orb_pulse', 'signal_orb', 4, 10);

  tf.destroy();
}

/* =====================================================================
   SLUG-STYLE PLAYER TANK ("Ржавый Сlug" -> callsign RS-7 «Кувалда»)
===================================================================== */

export function makeTankTextures(scene: Phaser.Scene) {
  const tf = new TextureFactory(scene);
  const FW = 76, FH = 46;
  tf.strip('tank', FW, FH, 4, (ctx, i) => {
    const bounce = i % 2;
    // tracks
    px(ctx, 2, 32, 72, 12, '#22262e');
    for (let k = 0; k < 7; k++) px(ctx, 4 + k * 10 + (i * 2), 34, 6, 8, PAL.metalDk);
    // hull
    px(ctx, 4, 18 - bounce, 68, 16, '#6b7a52');
    px(ctx, 4, 18 - bounce, 68, 4, '#55633f');
    px(ctx, 60, 20 - bounce, 10, 10, PAL.rust); // rusted nose
    // turret
    px(ctx, 22, 6 - bounce, 26, 14, '#77875c');
    px(ctx, 46, 9 - bounce, 26, 5, PAL.metalDk); // cannon
    px(ctx, 70, 8 - bounce, 5, 7, '#3a4250');
    // hatch + pilot hint
    px(ctx, 30, 3 - bounce, 8, 4, '#46523a');
    px(ctx, 32, 4 - bounce, 4, 2, PAL.skin);
    // emblem
    px(ctx, 12, 24 - bounce, 6, 6, PAL.red);
  });
  tf.anim('tank_drive', 'tank', 4, 10);
  tf.destroy();
}
