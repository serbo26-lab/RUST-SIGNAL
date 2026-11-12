import Phaser from 'phaser';
import { paintNaturalCrouchPose } from './crouch-pose';
import { addTileStrip } from './world-rules';

/**
 * Rebuilds the authored atlas at exact 1:1 native pixel fidelity (without destructive
 * horizontal scaling) AND unpacks our bespoke Episode 1-4 sprite strips & seamless tiles
 * into Phaser frame textures (`f0`, `f1`, ...).
 */
type FrameBox = [number, number, number, number];
type AtlasEntry = { w: number; h: number; frames: Record<string, FrameBox> };
type AtlasMap = Record<string, AtlasEntry>;

/** Crop/fit overrides for atlas sprites:
 *  - rem_deck / rem_deck_wood trim blank outer padding so TileSprites wrap seamlessly
 *  - p_* heroes preserve exact 48px width (matching physics/smoke assertions) with 1:1 uncrushed vertical pixels on idle/run/aimup `[8, 3, 48, 56]`! */
const atlasCropOverride: Record<string, FrameBox> = {
  rem_deck: [36, 0, 87, 39],
  rem_deck_wood: [51, 0, 58, 39],
};

const HERO_KEYS = new Set([
  'p_ignis_idle', 'p_ignis_run', 'p_ignis_jump', 'p_ignis_crouch', 'p_ignis_roll', 'p_ignis_aimup',
  'p_volt_idle', 'p_volt_run', 'p_volt_jump', 'p_volt_crouch', 'p_volt_roll', 'p_volt_aimup',
]);

interface StripSpec {
  sourceKey: string;
  targetKey: string;
  frameW: number;
  frameH: number;
  frames: number;
  override?: boolean;
}

const STRIP_SPECS: StripSpec[] = [
  { sourceKey: 'raw_ep2_boss_loco', targetKey: 'ep2_boss_loco', frameW: 310, frameH: 196, frames: 3, override: true },
  { sourceKey: 'raw_ep3_boss_heart', targetKey: 'ep3_boss_heart', frameW: 230, frameH: 270, frames: 3, override: true },
  { sourceKey: 'raw_ep4_boss_core', targetKey: 'ep4_boss_core', frameW: 230, frameH: 280, frames: 3, override: true },
  { sourceKey: 'raw_ep5_boss_citadel', targetKey: 'ep5_boss_citadel', frameW: 230, frameH: 260, frames: 3, override: true },
  { sourceKey: 'raw_ep6_boss_source', targetKey: 'ep6_boss_source', frameW: 230, frameH: 290, frames: 3, override: true },
  { sourceKey: 'raw_veh_apc', targetKey: 'veh_apc', frameW: 118, frameH: 64, frames: 2, override: true },
  { sourceKey: 'raw_veh_apc', targetKey: 'enemy_apc', frameW: 118, frameH: 64, frames: 2, override: true },
  { sourceKey: 'raw_veh_heli', targetKey: 'veh_heli', frameW: 156, frameH: 68, frames: 2, override: true },
  { sourceKey: 'raw_prop_turret', targetKey: 'prop_turret', frameW: 58, frameH: 48, frames: 2, override: true },
  { sourceKey: 'raw_e_stalker', targetKey: 'jg_stalker', frameW: 64, frameH: 48, frames: 3, override: true },
  { sourceKey: 'raw_e_bio', targetKey: 'e_bio', frameW: 60, frameH: 58, frames: 4, override: true },
  { sourceKey: 'raw_e_exo', targetKey: 'e_exo', frameW: 60, frameH: 58, frames: 4, override: true },
  { sourceKey: 'raw_e_sentinel', targetKey: 'e_sentinel', frameW: 60, frameH: 58, frames: 4, override: true },
  { sourceKey: 'raw_prop_breaker', targetKey: 'prop_breaker', frameW: 48, frameH: 64, frames: 2, override: true },
  { sourceKey: 'raw_prop_pod', targetKey: 'prop_pod', frameW: 60, frameH: 64, frames: 2, override: true },
  { sourceKey: 'raw_prop_terminal', targetKey: 'prop_terminal', frameW: 56, frameH: 74, frames: 2, override: true },
  { sourceKey: 'raw_prop_gate', targetKey: 'prop_gate', frameW: 56, frameH: 156, frames: 2, override: true },
];

function unpackStrip(scene: Phaser.Scene, spec: StripSpec): boolean {
  if (!scene.textures.exists(spec.sourceKey)) return false;
  const src = scene.textures.get(spec.sourceKey).getSourceImage() as HTMLImageElement;
  if (!src || !src.width) return false;
  if (scene.textures.exists(spec.targetKey)) {
    if (!spec.override) return false;
    scene.textures.remove(spec.targetKey);
  }
  const out = scene.textures.createCanvas(spec.targetKey, spec.frameW * spec.frames, spec.frameH);
  if (!out) return false;
  const ctx = out.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  for (let i = 0; i < spec.frames; i++) {
    out.add(`f${i}`, 0, i * spec.frameW, 0, spec.frameW, spec.frameH);
  }
  out.refresh();
  return true;
}

export function installRemasterTextures(scene: Phaser.Scene): number {
  let created = 0;
  if (scene.textures.exists('rs_atlas')) {
    const map = scene.cache.json.get('rs_atlas_map') as AtlasMap | undefined;
    const source = scene.textures.get('rs_atlas').getSourceImage() as HTMLImageElement;
    if (map && source && source.width) {
      for (const [key, entry] of Object.entries(map)) {
        if (scene.textures.exists(key)) continue;
        const ids = Object.keys(entry.frames).sort((a, b) => Number(a) - Number(b));
        if (!ids.length) continue;
        const crop = atlasCropOverride[key];
        const isHero = HERO_KEYS.has(key);
        const w = crop ? crop[2] : (isHero ? 48 : entry.w);
        const h = crop ? crop[3] : (isHero ? 56 : entry.h);
        const output = scene.textures.createCanvas(key, w * ids.length, h);
        if (!output) continue;
        const ctx = output.getContext();
        ctx.imageSmoothingEnabled = false;
        ids.forEach((id, index) => {
          const [fx, fy, fw, fh] = entry.frames[id];
          if (isHero) {
            if (key.endsWith('_crouch')) {
              const idleKey = key.replace('_crouch', '_idle');
              const idleEntry = map[idleKey];
              const idleFrame = idleEntry?.frames ? (Object.values(idleEntry.frames)[0] as [number, number, number, number] | undefined) : undefined;
              const isx = idleFrame ? idleFrame[0] + 8 : fx + 8;
              const isy = idleFrame ? idleFrame[1] + 3 : fy + 3;
              paintNaturalCrouchPose(source, isx, isy, 48, 56, ctx, index * w, 0, {
                dropRatio: 0.28,
                upperRatio: 0.58,
                bootRatio: 0.22,
                kneeShiftX: 2,
              });
            } else {
              const wide = key.endsWith('_roll') || (key === 'p_ignis_jump' && index > 0);
              const sx = wide ? fx + 2 : fx + 8;
              const sw = wide ? 60 : 48;
              ctx.drawImage(source, sx, fy + 3, sw, 56, index * w, 0, w, h);
            }
          } else {
            const sx = crop ? fx + crop[0] : fx;
            const sy = crop ? fy + crop[1] : fy;
            const sw = crop ? crop[2] : fw;
            const sh = crop ? crop[3] : fh;
            ctx.drawImage(source, sx, sy, sw, sh, index * w, 0, w, h);
          }
          output.add('f' + index, 0, index * w, 0, w, h);
        });
        output.refresh();
        created++;
      }
    }
  }

  for (const spec of STRIP_SPECS) {
    if (unpackStrip(scene, spec)) created++;
  }

  // Register crisp frame animations for our bespoke multi-frame sprites
  const ensureAnim = (key: string, tex: string, frames: number, fps: number) => {
    if (scene.anims.exists(key) || !scene.textures.exists(tex)) return;
    scene.anims.create({
      key,
      frames: Array.from({ length: frames }, (_, i) => ({ key: tex, frame: `f${i}` })),
      frameRate: fps,
      repeat: -1,
    });
  };
  ensureAnim('veh_apc_roll', 'veh_apc', 2, 7);
  ensureAnim('veh_heli_spin', 'veh_heli', 2, 18);
  ensureAnim('e_stalker_prowl', 'jg_stalker', 3, 9);
  ensureAnim('e_bio_walk', 'e_bio', 4, 8);
  ensureAnim('e_exo_walk', 'e_exo', 4, 8);
  ensureAnim('e_sentinel_walk', 'e_sentinel', 4, 8);

  scene.registry.set('remasterTextures', created);
  return created;
}

/** Materialize decoded HTMLImageElement textures (WebPs/SVGs) into CanvasTextures
 *  once at boot so Canvas2D & SwiftShader never re-upload software bitmaps per frame. */
export function bakeFastCanvasTextures(scene: Phaser.Scene): number {
  if (typeof document === 'undefined' || typeof HTMLImageElement === 'undefined') return 0;
  const tm = scene.textures;
  let converted = 0;
  for (const key of Object.keys(tm.list)) {
    if (key.startsWith('__') || key.startsWith('raw_')) continue;
    const tex = tm.get(key);
    if (!tex || tex.frameTotal > 1) continue;
    const src = tex.getSourceImage() as any;
    if (!(src instanceof HTMLImageElement)) continue;
    const w = src.naturalWidth || src.width || 0;
    const h = src.naturalHeight || src.height || 0;
    if (!w || !h) continue;
    const tmpKey = `${key}__fast_tmp`;
    const ct = tm.createCanvas(tmpKey, w, h);
    if (!ct) continue;
    ct.getContext().drawImage(src, 0, 0, w, h);
    ct.refresh();
    tm.remove(key);
    tm.renameTexture(tmpKey, key);
    converted++;
  }
  return converted;
}

export function addRemasterHarbor(scene: Phaser.Scene, worldWidth: number, groundY: number): void {
  const key = scene.textures.exists('bg_ep1') ? 'bg_ep1' : (scene.textures.exists('rs_harbor') ? 'rs_harbor' : '');
  if (!key) return;
  // Seamless 2D orthographic dusk harbor panorama (`depth = -8` preserves smoke assertion).
  const spanW = Math.min(worldWidth, Math.ceil(worldWidth * 0.24 + 980));
  addTileStrip(scene, 0, -10, spanW, 520, key, -8, 0.24);

  // Midground harbor structures (shipping containers, towers, dock lights, antennae) behind action
  if (scene.textures.exists('rem_container')) {
    for (let x = 220; x < worldWidth - 500; x += 680) {
      scene.add.image(x, groundY + 14, 'rem_container').setOrigin(0.5, 1)
        .setScale(1.15).setTint(0x8892a4).setAlpha(0.72).setScrollFactor(0.75).setDepth(-4);
    }
  }
  if (scene.textures.exists('rem_lamp')) {
    for (let x = 140; x < worldWidth - 200; x += 520) {
      scene.add.image(x, groundY + 18, 'rem_lamp').setOrigin(0.5, 1)
        .setAlpha(0.88).setDepth(-2);
      // Warm amber cone wash onto dock pavement (normal alpha avoids expensive Canvas2D ADD composite)
      const g = scene.add.graphics().setDepth(-3);
      g.fillStyle(0xffaa44, 0.08);
      g.fillTriangle(x - 6, groundY - 48, x - 64, groundY + 26, x + 52, groundY + 26);
    }
  }
  if (scene.textures.exists('rem_antenna')) {
    for (let x = 480; x < worldWidth - 600; x += 1180) {
      scene.add.image(x, groundY + 12, 'rem_antenna').setOrigin(0.5, 1)
        .setAlpha(0.78).setScrollFactor(0.62).setDepth(-5);
    }
  }
}
