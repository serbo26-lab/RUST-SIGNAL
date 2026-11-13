import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DIFFICULTY, scaledScore, computeMissionBonuses } from '../src/game/core';
import {
  LEADERBOARD_STORAGE_KEY,
  sanitizeNickname,
  validateNickname,
  loadLeaderboard,
  getLeaderboardEntries,
  submitLeaderboardEntry,
  clearLeaderboard,
  formatDuration,
} from '../src/game/leaderboard';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
    key(index: number) { return Array.from(store.keys())[index] ?? null; },
    removeItem(key: string) { store.delete(key); },
    setItem(key: string, value: string) { store.set(key, String(value)); },
  };
}

describe('difficulty score scaling & mission bonuses', () => {
  it('defines clear difficulty multipliers and starting lives', () => {
    expect(DIFFICULTY.rookie.scoreBonus).toBe(1);
    expect(DIFFICULTY.veteran.scoreBonus).toBe(1.25);
    expect(DIFFICULTY.hardcore.scoreBonus).toBe(2);
    expect(DIFFICULTY.rookie.lives).toBeGreaterThan(DIFFICULTY.veteran.lives);
    expect(DIFFICULTY.veteran.lives).toBeGreaterThan(DIFFICULTY.hardcore.lives);
  });

  it('scales base score identically to difficulty scoreBonus', () => {
    expect(scaledScore(100, 'rookie')).toBe(100);
    expect(scaledScore(100, 'veteran')).toBe(125);
    expect(scaledScore(100, 'hardcore')).toBe(200);
    expect(scaledScore(0, 'hardcore')).toBe(0);
  });

  it('computes episode clear, lives, and speed bonuses transparently', () => {
    const rookieRun = computeMissionBonuses({
      episode: 1,
      difficulty: 'rookie',
      combatScore: 2000,
      livesRemaining: 3,
      elapsedSec: 90,
    });
    const hardcoreRun = computeMissionBonuses({
      episode: 1,
      difficulty: 'hardcore',
      combatScore: 2000,
      livesRemaining: 3,
      elapsedSec: 90,
    });
    const slowRun = computeMissionBonuses({
      episode: 1,
      difficulty: 'rookie',
      combatScore: 2000,
      livesRemaining: 3,
      elapsedSec: 999,
    });

    expect(rookieRun.totalScore).toBe(
      rookieRun.combatScore + rookieRun.clearBonus + rookieRun.livesBonus + rookieRun.timeBonus,
    );
    expect(rookieRun.clearBonus).toBeGreaterThan(0);
    expect(rookieRun.livesBonus).toBeGreaterThan(0);
    expect(rookieRun.timeBonus).toBeGreaterThan(0);
    expect(slowRun.timeBonus).toBe(0);
    expect(hardcoreRun.clearBonus).toBe(rookieRun.clearBonus * 2);
    expect(hardcoreRun.livesBonus).toBe(rookieRun.livesBonus * 2);
  });
});

describe('leaderboard persistence & validation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    clearLeaderboard();
  });

  it('sanitizes and validates Cyrillic and Latin nicknames safely', () => {
    expect(sanitizeNickname('  <b>Serbo_26</b>  ')).toBe('bSerbo_26/b');
    expect(sanitizeNickname('   Иван   Петров  ')).toBe('Иван Петров');
    expect(validateNickname('   ').ok).toBe(false);
    expect(validateNickname('А').ok).toBe(false);
    const valid = validateNickname('  Боец-01  ');
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value).toBe('Боец-01');
  });

  it('separates entries by difficulty and sorts descending up to Top-15', () => {
    for (let i = 1; i <= 17; i++) {
      submitLeaderboardEntry({
        nickname: `Player_${i}`,
        score: i * 500,
        episode: 1,
        character: i % 2 === 0 ? 'volt' : 'ignis',
        difficulty: 'veteran',
        livesLeft: 2,
        elapsedSec: 120,
      });
    }
    submitLeaderboardEntry({
      nickname: 'RookieHero',
      score: 99999,
      episode: 4,
      character: 'ignis',
      difficulty: 'rookie',
      livesLeft: 5,
      elapsedSec: 80,
    });

    const veteranEntries = getLeaderboardEntries('veteran');
    const rookieEntries = getLeaderboardEntries('rookie');
    const hardcoreEntries = getLeaderboardEntries('hardcore');

    expect(veteranEntries).toHaveLength(15);
    expect(veteranEntries[0].score).toBe(17 * 500);
    expect(veteranEntries[veteranEntries.length - 1].score).toBe(3 * 500);
    expect(rookieEntries).toHaveLength(1);
    expect(rookieEntries[0].nickname).toBe('RookieHero');
    expect(hardcoreEntries).toHaveLength(0);

    const raw = JSON.parse(localStorage.getItem(LEADERBOARD_STORAGE_KEY) || '{}');
    expect(raw.veteran).toHaveLength(15);
    expect(loadLeaderboard().rookie).toHaveLength(1);
  });

  it('formats elapsed run duration in m:ss', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});
