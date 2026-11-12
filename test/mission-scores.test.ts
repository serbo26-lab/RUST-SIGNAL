import { describe, expect, it } from 'vitest';
import { DIFFICULTY, run, finalizeEpisodeVictory } from '../src/game/core';
import type Phaser from 'phaser';

describe('mission scores stay separate from the cumulative six-chapter total', () => {
  it('counts only chapter points while leaving the HUD campaign sum intact', () => {
    const before = { ...run };
    const registry = new Map<string, unknown>();
    const scene = {
      events: { emit: () => {} },
      registry: { set: (key: string, value: unknown) => registry.set(key, value) },
    } as unknown as Phaser.Scene;
    try {
      run.difficulty = 'rookie';
      run.lives = 2;
      run.score = 5500;
      run.missionStartScore = 4100;
      const result = finalizeEpisodeVictory(scene, 2, 100);
      const survival = 2 * 400;
      const speed = (260 - 100) * 10;
      const mission = 1400 + 2200 + survival + speed;
      expect(result.combatScore).toBe(1400);
      expect(result.totalScore).toBe(mission);
      expect(result.clearBonus).toBe(2200);
      expect(result.multiplier).toBe(DIFFICULTY.rookie.scoreBonus);
      expect(run.score).toBe(4100 + mission);
      expect(registry.get('finalScore')).toBe(4100 + mission);
      expect(registry.get('scoreBreakdown')).toEqual(result);
    } finally {
      Object.assign(run, before);
    }
  });
});
