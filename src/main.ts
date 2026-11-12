import Phaser from 'phaser';
import { VIEW_W, VIEW_H } from './game/core';
import { MenuScene } from './ui/menu';
import { LevelScene } from './game/level';
import { TrainScene } from './game/train';
import { JungleScene } from './game/jungle';
import { FacilityScene } from './game/facility';
import { BastionScene } from './game/bastion';
import { BeaconScene } from './game/beacon';
import { ResultsScene } from './ui/results';
import { installTouchControls } from './ui/touch';
import { preloadStyleRefs } from './game/style';
import { installRemasterTextures, bakeFastCanvasTextures } from './game/remaster';

/**
 * RUST SIGNAL — browser website boot.
 * Load published static artwork before starting Phaser.
 */
/** Boot-сцена: до генерации спрайтов успевает подгрузить референсы персонажей
 * из public/characters/ (если они там лежат) — см. src/game/style.ts.
 * Защита «чёрного экрана»: если при загрузке референсов возникает любая ошибка,
 * сцена всё равно переходит в меню; плюс страховочной таймер на 4 секунды. */
class BootScene extends Phaser.Scene {
  private booted = false;
  constructor() { super('Boot'); }
  preload() {
    this.load.svg('menu_harbor', '/art/harbor-scene.svg');
    this.load.svg('portrait_ignis', '/art/hero-alex.svg');
    this.load.svg('portrait_volt', '/art/hero-max.svg');
    this.load.image('rs_atlas', '/remaster/atlas.webp');
    this.load.image('rs_harbor', '/remaster/harbor.webp');
    this.load.json('rs_atlas_map', '/remaster/atlas.json');

    // Cohesive site illustrations for UI dossier, episode preview cards, weapons & debrief
    this.load.image('illus_volkova', '/illustrations/hero-volkova.webp');
    this.load.image('illus_orlov', '/illustrations/hero-orlov.webp');
    this.load.image('loc_ep1', '/illustrations/location-harbor.webp');
    this.load.image('loc_ep2', '/illustrations/location-train.webp');
    this.load.image('loc_ep3', '/illustrations/location-jungle.webp');
    this.load.image('loc_ep4', '/illustrations/location-facility.webp');
    this.load.image('loc_ep5', '/illustrations/location-bastion.webp');
    this.load.image('loc_ep6', '/illustrations/location-beacon.webp');
    this.load.image('weap_pistol', '/illustrations/weapon-pistol.webp');
    this.load.image('weap_mg', '/illustrations/weapon-mg.webp');
    this.load.image('weap_shotgun', '/illustrations/weapon-shotgun.webp');
    this.load.image('weap_laser', '/illustrations/weapon-laser.webp');

    // Bespoke orthographic game-art pack (backdrops, ground/platform decks, bosses, enemies, vehicles, props)
    this.load.image('bg_ep1', '/game-art/ep1_backdrop.webp');
    this.load.image('bg_ep2', '/game-art/ep2_backdrop.webp');
    this.load.image('ep2_poles', '/game-art/ep2_poles.webp');
    this.load.image('bg_ep3', '/game-art/ep3_backdrop.webp');
    this.load.image('bg_ep4', '/game-art/ep4_backdrop.webp');
    this.load.image('bg_ep5', '/game-art/ep5_backdrop.webp');
    this.load.image('bg_ep6', '/game-art/ep6_backdrop.webp');
    this.load.image('ep1_ground', '/game-art/ep1_ground.webp');
    this.load.image('ep1_platform', '/game-art/ep1_platform.webp');
    this.load.image('ep2_ground', '/game-art/ep2_ground.webp');
    this.load.image('ep2_platform', '/game-art/ep2_platform.webp');
    this.load.image('ep3_ground', '/game-art/ep3_ground.webp');
    this.load.image('ep3_platform', '/game-art/ep3_platform.webp');
    this.load.image('ep4_ground', '/game-art/ep4_ground.webp');
    this.load.image('ep4_platform', '/game-art/ep4_platform.webp');
    this.load.image('ep5_ground', '/game-art/ep5_ground.webp');
    this.load.image('ep5_platform', '/game-art/ep5_platform.webp');
    this.load.image('ep6_ground', '/game-art/ep6_ground.webp');
    this.load.image('ep6_platform', '/game-art/ep6_platform.webp');
    this.load.image('raw_ep2_boss_loco', '/game-art/ep2_boss_loco.webp');
    this.load.image('raw_ep3_boss_heart', '/game-art/ep3_boss_heart.webp');
    this.load.image('raw_ep4_boss_core', '/game-art/ep4_boss_core.webp');
    this.load.image('raw_ep5_boss_citadel', '/game-art/ep5_boss_citadel.webp');
    this.load.image('raw_ep6_boss_source', '/game-art/ep6_boss_source.webp');
    this.load.image('raw_veh_apc', '/game-art/veh_apc.webp');
    this.load.image('raw_veh_heli', '/game-art/veh_heli.webp');
    this.load.image('raw_prop_turret', '/game-art/prop_turret.webp');
    this.load.image('raw_e_stalker', '/game-art/e_stalker.webp');
    this.load.image('raw_e_bio', '/game-art/e_bio.webp');
    this.load.image('raw_e_exo', '/game-art/e_exo.webp');
    this.load.image('raw_e_sentinel', '/game-art/e_sentinel.webp');
    this.load.image('raw_prop_breaker', '/game-art/prop_breaker.webp');
    this.load.image('raw_prop_pod', '/game-art/prop_pod.webp');
    this.load.image('raw_prop_terminal', '/game-art/prop_terminal.webp');
    this.load.image('raw_prop_gate', '/game-art/prop_gate.webp');
    this.load.image('prop_intel', '/game-art/prop_intel.webp');
  }
  private go() {
    if (this.booted) return;
    this.booted = true;
    bakeFastCanvasTextures(this);
    this.scene.start('Menu');
    // The website splash screen must disappear after Phaser enters the menu.
    // Nginx serves the compiled index.html; never expose build tools to players.
    document.getElementById('site-loading')?.remove();
  }
  async create() {
    const count = installRemasterTextures(this);
    console.info('[RUST SIGNAL] remastered pixel art:', count);
    // страховка: даже если что-то зависнет — меню откроется через 4 секунды
    this.time.delayedCall(4000, () => this.go());
    try {
      await Promise.race([
        preloadStyleRefs(this),
        new Promise((r) => this.time.delayedCall(2500, () => r(null))),
      ]);
    } catch (e) {
      console.warn('[RUST SIGNAL] style refs skipped:', e);
    }
    this.go();
  }
}

const wantsCanvas = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('renderer') === 'canvas';
let useCanvas = wantsCanvas;
let gameCanvas: HTMLCanvasElement | undefined;
let gameContext: CanvasRenderingContext2D | undefined;
if (typeof document !== 'undefined') {
  if (!useCanvas) {
    try {
      const probe = document.createElement('canvas');
      useCanvas = !(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch { useCanvas = true; }
  }
  if (useCanvas) {
    // Match Phaser CanvasTexture's CPU-backed surface across ALL 2D canvases (TileSprite, CanvasPool, gameCanvas)
    // so Canvas2D/SwiftShader never mixes GPU OOP-R surfaces with CPU textures and stalls on readback/uploads.
    if (typeof HTMLCanvasElement !== 'undefined') {
      const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & { __rs2dReadFrequently?: boolean };
      if (!proto.__rs2dReadFrequently) {
        const origGetContext = proto.getContext as (...args: unknown[]) => RenderingContext | null;
        (proto as { getContext: unknown }).getContext = function (
          this: HTMLCanvasElement,
          type: string,
          attrs?: Record<string, unknown>,
        ) {
          const nextAttrs = type === '2d' ? { ...(attrs || {}), willReadFrequently: true } : attrs;
          return origGetContext.call(this, type, nextAttrs);
        };
        proto.__rs2dReadFrequently = true;
      }
    }
    gameCanvas = document.createElement('canvas');
    gameContext = gameCanvas.getContext('2d', { alpha: false, willReadFrequently: true }) ?? undefined;
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: useCanvas ? Phaser.CANVAS : Phaser.AUTO,
  ...(gameCanvas && gameContext ? { canvas: gameCanvas, context: gameContext } : {}),
  parent: 'app',
  width: VIEW_W,
  height: VIEW_H,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#0c0e14',
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 1900 }, debug: false },
  },
  input: { gamepad: true },
  scene: [BootScene, MenuScene, LevelScene, TrainScene, JungleScene, FacilityScene, BastionScene, BeaconScene, ResultsScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

// Mobile touch overlay (auto-hidden on desktop / non-touch devices)
installTouchControls(typeof document !== 'undefined' ? (document.getElementById('app') ?? document.body) : (null as any));

// Последний рубеж против «чёрного экрана»: если Phaser проглотил ошибку асинхронно —
// показываем её прямо на странице.
if (typeof window !== 'undefined') {
  const banner = (msg: string) => {
    try {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#1a0f12ee;color:#ff7a6a;font:12px monospace;padding:8px 12px;max-width:90%;white-space:pre-wrap;border:1px solid #d8453a';
      d.textContent = '[RUST SIGNAL] ' + msg.slice(0, 300);
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 30000);
    } catch { /* ignore */ }
  };
  window.addEventListener('error', (e) => { if (e.message) banner('JS error: ' + e.message); });
  window.addEventListener('unhandledrejection', (e: any) => banner('Promise error: ' + String(e?.reason?.message ?? e?.reason)));
}

const game = new Phaser.Game(config);
// Diagnostic game handle used by browser regression tests.
if (typeof window !== 'undefined') (window as any).__RS_GAME__ = game;
