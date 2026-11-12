// CI regression tests for browser game modules and pure functions.
import { describe, it, expect } from 'vitest';

describe('smoke: module imports', () => {
  const mods = [
    './src/game/core.ts', './src/game/sprites.ts', './src/game/player.ts',
    './src/game/enemies.ts', './src/game/weapons.ts', './src/game/props.ts',
    './src/game/boss.ts', './src/game/bastion-art.ts', './src/game/bastion-boss.ts',
    './src/game/bastion.ts', './src/game/beacon-art.ts', './src/game/beacon-boss.ts',
    './src/game/beacon.ts', './src/game/background.ts', './src/game/radio.ts',
    './src/game/level.ts', './src/ui/menu.ts', './src/ui/hud.ts', './src/ui/results.ts',
    './src/game/audio.ts', './src/ui/touch.ts',
  ];
  for (const m of mods) {
    it(`imports ${m}`, async () => { await expect(import(m)).resolves.toBeTruthy(); });
  }
});

import * as core from './src/game/core';

describe('smoke: core sanity', () => {
  it('world constants are sane', () => {
    expect(core.WORLD_W).toBeGreaterThan(core.VIEW_W);
    expect(core.GROUND_Y).toBeGreaterThan(0);
  });
  it('weapon table has pistol + specials', () => {
    const ids = Object.keys(core.WEAPONS);
    for (const w of ['pistol','mg','shotgun','laser']) expect(ids).toContain(w);
  });
});

import * as touch from './src/ui/touch';

describe('audio + touch modules (Node-safe)', () => {
  it('touch state defaults are all false', () => {
    for (const k of Object.keys(touch.touch)) expect((touch.touch as any)[k]).toBe(false);
  });
  it('tapEdge consumes flag exactly once', () => {
    touch.touch.justJump = true;
    expect(touch.tapEdge('justJump')).toBe(true);
    expect(touch.tapEdge('justJump')).toBe(false);
  });
  it('isTouchDevice is false in Node', () => {
    expect(touch.isTouchDevice()).toBe(false);
  });
  it('SFX.play is a no-op without AudioContext (no throw)', async () => {
    const { SFX } = await import('./src/game/audio');
    // enabled but no window/AudioContext in Node -> resume/init guarded
    let threw = false;
    try { SFX.enabled = false; SFX.play('shot_pistol'); } catch { threw = true; }
    expect(threw).toBe(false);
  });
});

describe('difficulty system', () => {
  it('has three modes with sane multipliers', () => {
    const ids = Object.keys(core.DIFFICULTY);
    for (const d of ['rookie', 'veteran', 'hardcore']) expect(ids).toContain(d);
    expect(core.DIFFICULTY.rookie.hpMul).toBeLessThan(core.DIFFICULTY.hardcore.hpMul);
    expect(core.DIFFICULTY.hardcore.lives).toBe(1);
    expect(core.DIFFICULTY.veteran.lives).toBe(3);
    for (const id of ids) expect(core.DIFFICULTY[id as core.DifficultyId].scoreBonus).toBeGreaterThanOrEqual(1);
  });
  it('run state carries a valid difficulty and diff() resolves it', () => {
    expect(['rookie', 'veteran', 'hardcore']).toContain(core.run.difficulty);
    expect(core.diff().name).toBeTruthy();
  });
  it('recordBest updates best without throwing in Node (no localStorage)', () => {
    const before = core.run.best;
    core.run.score = before + 999;
    core.recordBest();
    expect(core.run.best).toBe(before + 999);
    core.run.score = 0;
  });
});

import { blendHex, heroStyle, paletteFromRef } from './src/game/style';

describe('style refs', () => {
  it('blendHex mixes toward reference color', () => {
    expect(blendHex('#000000', 0xffffff, 0.5)).toBe('#808080');
    expect(blendHex('#ff0000', 0x00ff00, 0)).toBe('#ff0000');
  });
  it('heroStyle/paletteFromRef return empty without loaded refs (graceful fallback)', () => {
    expect(paletteFromRef('volkova')).toEqual([]);
    expect(heroStyle('orlov')).toBeNull();
  });
});
