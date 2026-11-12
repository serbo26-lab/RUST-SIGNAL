// src/game/style.ts — загрузка референсов персонажей из public/characters/
// и их использование: портреты в меню, палитра для процедурных спрайтов.
// Если файлов нет — всё работает как раньше (чистый процедурный пиксель-арт).
import Phaser from 'phaser';

export const USE_STYLE_BG = true; // ориентир стиля на фоне уровня (если есть референс)

const EXT_CANDIDATES = ['png', 'jpg', 'jpeg', 'webp'];
const DIRS = ['characters', 'characters/pic'];

export type StyleKey = 'volkova' | 'orlov';

interface RefDef { key: StyleKey; file: string }
export const STYLE_REFS: RefDef[] = [
  { key: 'volkova', file: 'volkova' },
  { key: 'orlov', file: 'orlov' },
];

// кэш загруженных изображений (для анализа палитры через canvas)
const imgCache = new Map<StyleKey, HTMLImageElement>();
const loadedKeys = new Set<StyleKey>();

// Прямая загрузка через Image() — без Phaser Loader, поэтому отсутствующие
// файлы не засоряют консоль и не ломают очередь загрузки сцены.
function loadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve();
    probe.onerror = () => reject(new Error('404'));
    probe.src = url;
  });
}

async function findAndLoad(def: RefDef): Promise<HTMLImageElement | null> {
  for (const d of DIRS) {
    for (const e of EXT_CANDIDATES) {
      const url = `/${d}/${def.file}.${e}`;
      try {
        await loadImage(url);
        const img = new Image();
        img.src = url;
        await (img.complete ? Promise.resolve() : new Promise<void>((res) => { img.onload = () => res(); }));
        return img;
      } catch { /* пробуем следующее расширение/папку */ }
    }
  }
  return null;
}

export async function preloadStyleRefs(scene: Phaser.Scene): Promise<StyleKey[]> {
  const loaded: StyleKey[] = [];
  for (const def of STYLE_REFS) {
    if (loadedKeys.has(def.key)) { loaded.push(def.key); continue; }
    const img = await findAndLoad(def);
    if (!img || !img.naturalWidth) continue;
    imgCache.set(def.key, img);
    // регистрируем текстуру для отображения портретов в UI
    scene.textures.addImage(`style_${def.key}`, img as any);
    loadedKeys.add(def.key);
    loaded.push(def.key);
  }
  if (loaded.length) console.log('[RUST SIGNAL] style refs loaded:', loaded.join(', '));
  else console.log('[RUST SIGNAL] style refs not found — using procedural pixel art (положите volkova.png / orlov.png в public/characters/)');
  return loaded;
}

export function hasStyleRef(key: StyleKey): boolean {
  return loadedKeys.has(key);
}

export function styleTextureKey(key: StyleKey): string {
  return `style_${key}`;
}

// ---- извлечение доминирующей палитры из референса ----
export function paletteFromRef(key: StyleKey, n = 5): number[] {
  const img = imgCache.get(key);
  if (!img) return [];
  try {
    const c = document.createElement('canvas');
    const w = 48;
    const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
    const h = Math.max(1, Math.round(w * ratio));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const bins = new Map<number, { r: number; g: number; b: number; c: number }>();
    for (let p = 0; p < data.length; p += 4) {
      const a = data[p + 3]; if (a < 200) continue;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 40) continue; // почти чёрный — фон/контур, не характер
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (sat < 0.12 && mx < 90) continue; // тёмно-серый — тоже фон
      const rq = (r >> 4) << 4, gq = (g >> 4) << 4, bq = (b >> 4) << 4;
      const k = (rq << 16) | (gq << 8) | bq;
      const bin = bins.get(k) || { r: 0, g: 0, b: 0, c: 0 };
      bin.r += r; bin.g += g; bin.b += b; bin.c++;
      bins.set(k, bin);
    }
    return [...bins.values()]
      .sort((a, b) => b.c - a.c)
      .slice(0, n)
      .map((b) => {
        const r = Math.round(b.r / b.c), g = Math.round(b.g / b.c), bl = Math.round(b.b / b.c);
        return (r << 16) | (g << 8) | bl;
      });
  } catch { return []; } // CORS-tainted canvas и пр. — тихо откатываемся к процедурной палитре
}

// Смешивание цвета спрайта с цветом из референса (t = доля референса, 0..1)
export function blendHex(base: string, ref: number, t: number): string {
  const v = parseInt(base.replace('#', ''), 16);
  const br = (v >> 16) & 255, bg = (v >> 8) & 255, bb = v & 255;
  const rr = (ref >> 16) & 255, rg = (ref >> 8) & 255, rb = ref & 255;
  const mix = (a: number, b: number) => Math.round(a * (1 - t) + b * t);
  const to2 = (x: number) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0');
  return '#' + to2(mix(br, rr)) + to2(mix(bg, rg)) + to2(mix(bb, rb));
}

// Палитра героя из референса или null (тогда остаётся базовая процедурная)
export interface HeroStyle { main: string; second: string; accent: string; skin: string }
export function heroStyle(key: StyleKey): HeroStyle | null {
  const pal = paletteFromRef(key, 6);
  if (pal.length < 3) return null;
  const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
  // самый насыщенный цвет берём как акцент (бандана/детали), остальные — форма
  const satOf = (c: number) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return Math.max(r, g, b) - Math.min(r, g, b); };
  const sorted = [...pal].sort((a, b) => satOf(b) - satOf(a));
  return {
    main: hex(pal[0]),
    second: hex(pal[1]),
    accent: hex(sorted[0]),
    skin: hex(pal[Math.min(3, pal.length - 1)]),
  };
}
