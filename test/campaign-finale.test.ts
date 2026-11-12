import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  EPISODE_CLEAR_BASE,
  EPISODE_PAR_SECONDS,
  unlockEpisode5,
  unlockEpisode6,
  run,
} from '../src/game/core';
import {
  EPISODE_LABELS,
  submitLeaderboardEntry,
  getLeaderboardEntries,
} from '../src/game/leaderboard';
import type { EnemyKind } from '../src/game/enemies';

describe('Campaign Finale — Episodes 5 & 6 (Bastion & Beacon)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
      },
      configurable: true,
    });
    run.difficulty = 'veteran';
    run.lives = 3;
    run.score = 1000;
    run.episode5Unlocked = false;
    run.episode6Unlocked = false;
  });

  it('defines clear base bonuses, par seconds, and progressive unlocks for episodes 5 and 6', () => {
    expect(Object.keys(EPISODE_CLEAR_BASE)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(Object.keys(EPISODE_PAR_SECONDS)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(EPISODE_CLEAR_BASE[5]).toBe(4200);
    expect(EPISODE_CLEAR_BASE[6]).toBe(5000);
    expect(EPISODE_PAR_SECONDS[5]).toBe(320);
    expect(EPISODE_PAR_SECONDS[6]).toBe(340);

    expect(run.episode5Unlocked).toBe(false);
    expect(run.episode6Unlocked).toBe(false);
    unlockEpisode5();
    expect(run.episode5Unlocked).toBe(true);
    expect(localStorage.getItem('rs_episode5_unlocked')).toBe('1');
    unlockEpisode6();
    expect(run.episode6Unlocked).toBe(true);
    expect(localStorage.getItem('rs_episode6_unlocked')).toBe('1');
  });

  it('registers Sentinel enemy, Bastion & Beacon world rules, and remaster strip specs', () => {
    const sentinelKind: EnemyKind = 'sentinel';
    expect(sentinelKind).toBe('sentinel');

    const enemiesSrc = fs.readFileSync(new URL('../src/game/enemies.ts', import.meta.url), 'utf8');
    expect(enemiesSrc).toContain("case 'sentinel':");
    expect(enemiesSrc).toContain('e_sentinel_walk');

    const remasterSrc = fs.readFileSync(new URL('../src/game/remaster.ts', import.meta.url), 'utf8');
    expect(remasterSrc).toContain("targetKey: 'ep5_boss_citadel'");
    expect(remasterSrc).toContain("targetKey: 'ep6_boss_source'");
    expect(remasterSrc).toContain("targetKey: 'e_sentinel'");

    const rulesSrc = fs.readFileSync(new URL('../src/game/world-rules.ts', import.meta.url), 'utf8');
    expect(rulesSrc).toContain("Bastion: ['ep5_platform'");
    expect(rulesSrc).toContain("Beacon: ['ep6_platform'");
    expect(rulesSrc).toContain("Bastion: 'ep5_ground'");
    expect(rulesSrc).toContain("Beacon: 'ep6_ground'");
  });

  it('records Episode 5 and Episode 6 entries cleanly in the offline fallback leaderboard', () => {
    expect(EPISODE_LABELS[5]).toBe('Эп. 5 · Бастион');
    expect(EPISODE_LABELS[6]).toBe('Эп. 6 · Маяк-13');

    submitLeaderboardEntry({
      nickname: 'NordVanguard',
      score: 12400,
      episode: 5,
      character: 'volt',
      difficulty: 'hardcore',
      livesLeft: 2,
      elapsedSec: 210,
    });
    submitLeaderboardEntry({
      nickname: 'SpireBreaker',
      score: 16200,
      episode: 6,
      character: 'ignis',
      difficulty: 'hardcore',
      livesLeft: 3,
      elapsedSec: 230,
    });

    const board = getLeaderboardEntries('hardcore');
    expect(board.map((e) => e.episode)).toEqual([6, 5]);
    expect(board[0].nickname).toBe('SpireBreaker');
    expect(board[1].nickname).toBe('NordVanguard');
  });
});
