import Phaser from 'phaser';

/** Global game tuning constants for RUST SIGNAL prototype. */
export const VIEW_W = 960;
export const VIEW_H = 540;
export const WORLD_W = 6200; // Episode 1: Harbor of Dead Ships
export const GROUND_Y = 470;
export const GRAVITY = 1900;

export const PLAYER_SPEED = 235;
export const JUMP_VELOCITY = 615;
export const ROLL_SPEED = 470;
export const ROLL_TIME = 300; // ms of i-frames
export const FIRE_COOLDOWN = 145; // ms between shots (pistol)

export type WeaponId = 'pistol' | 'mg' | 'shotgun' | 'laser';

export interface WeaponSpec {
  name: string;
  cooldown: number;
  dmg: number;
  speed: number;
  count: number;    // pellets / bullets per shot
  spread: number;   // radians total spread
  pierce: boolean;
  explode: number;  // explosion radius (0 = none)
  ammoMax: number;  // 0 = infinite
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol:  { name: 'ПИСТОЛЕТ',   cooldown: 145, dmg: 1,  speed: 640, count: 1, spread: 0,    pierce: false, explode: 0,  ammoMax: 0 },
  mg:      { name: 'ПУЛЕМЁТ',    cooldown: 62,  dmg: 1,  speed: 700, count: 1, spread: 0.03,  pierce: false, explode: 0,  ammoMax: 240 },
  shotgun: { name: 'ДРОБОВИК',   cooldown: 430, dmg: 1,  speed: 600, count: 5, spread: 0.5,   pierce: false, explode: 0,  ammoMax: 60 },
  laser:   { name: 'ЛАЗЕР',      cooldown: 210, dmg: 2,  speed: 900, count: 1, spread: 0,     pierce: true,  explode: 0,  ammoMax: 120 },
};

export type DifficultyId = 'rookie' | 'veteran' | 'hardcore';

export interface DiffSpec {
  name: string;
  desc: string;
  hpMul: number;     // множитель здоровья врагов и боссов
  dmgMul: number;    // множитель урона снарядов/взрывов игроку
  rateMul: number;   // множитель скорострельности врагов (меньше = чаще)
  lives: number;     // стартовое число жизней
  scoreBonus: number;// множитель очков за убийства
}

export const DIFFICULTY: Record<DifficultyId, DiffSpec> = {
  rookie:   { name: 'РЕКРУТ',   desc: '4 жизни · очки ×1 · враги бьют вдвое слабее',      hpMul: 0.7,  dmgMul: 0.5, rateMul: 1.4,  lives: 4, scoreBonus: 1 },
  veteran:  { name: 'ВЕТЕРАН',  desc: '3 жизни · очки ×1.25 · стандартная сложность',    hpMul: 1,    dmgMul: 1,   rateMul: 1,    lives: 3, scoreBonus: 1.25 },
  hardcore: { name: 'ХАРДКОР',  desc: '1 жизнь · очки ×2 · враги на 50% злее и крепче', hpMul: 1.5, dmgMul: 1.5, rateMul: 0.8, lives: 1, scoreBonus: 2 },
};

export interface ScoreBreakdown {
  episode: EpisodeId;
  difficulty: DifficultyId;
  multiplier: number;
  combatScore: number;
  clearBonus: number;
  livesRemaining: number;
  livesBonus: number;
  elapsedSec: number;
  timeBonus: number;
  totalScore: number;
}

export type EpisodeId = 1 | 2 | 3 | 4 | 5 | 6;

export const EPISODE_CLEAR_BASE: Record<EpisodeId, number> = {
  1: 1500,
  2: 2200,
  3: 2800,
  4: 3500,
  5: 4200,
  6: 5000,
};

export const EPISODE_PAR_SECONDS: Record<EpisodeId, number> = {
  1: 240,
  2: 260,
  3: 280,
  4: 300,
  5: 320,
  6: 340,
};

/** Shared runtime state carried between scenes (character select -> level -> results). */
export interface RunState {
  character: 'ignis' | 'volt';
  difficulty: DifficultyId;
  score: number;
  missionStartScore: number;
  lives: number;
  best: number;
  episode: EpisodeId;
  episode2Unlocked: boolean;
  episode3Unlocked: boolean;
  episode4Unlocked: boolean;
  episode5Unlocked: boolean;
  episode6Unlocked: boolean;
  intel: number; // hidden signal intercepts collected in the current run
}

export function diff(): DiffSpec { return DIFFICULTY[run.difficulty]; }

// Безопасное чтение localStorage (может отсутствовать в Node/SSR-окружении)
function lsGet(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function lsSet(key: string, val: string) {
  try { globalThis.localStorage?.setItem(key, val); } catch {}
}

function loadBest(): number {
  return Number(lsGet('rs_best') || 0);
}
function loadChar(): 'ignis' | 'volt' {
  return lsGet('rs_char') === 'volt' ? 'volt' : 'ignis';
}
function loadDiff(): DifficultyId {
  const d = lsGet('rs_diff');
  return d === 'rookie' || d === 'veteran' || d === 'hardcore' ? d : 'veteran';
}

export const run: RunState = {
  character: loadChar(),
  difficulty: loadDiff(),
  score: 0,
  missionStartScore: 0,
  lives: DIFFICULTY[loadDiff()].lives,
  best: loadBest(),
  episode: 1,
  episode2Unlocked: lsGet('rs_episode2_unlocked') === '1',
  episode3Unlocked: lsGet('rs_episode3_unlocked') === '1',
  episode4Unlocked: lsGet('rs_episode4_unlocked') === '1',
  episode5Unlocked: lsGet('rs_episode5_unlocked') === '1',
  episode6Unlocked: lsGet('rs_episode6_unlocked') === '1',
  intel: 0,
};

export function unlockEpisode2() {
  run.episode2Unlocked = true;
  lsSet('rs_episode2_unlocked', '1');
}

export function unlockEpisode3() {
  run.episode3Unlocked = true;
  lsSet('rs_episode3_unlocked', '1');
}

export function unlockEpisode4() {
  run.episode4Unlocked = true;
  lsSet('rs_episode4_unlocked','1');
}

export function unlockEpisode5() {
  run.episode5Unlocked = true;
  lsSet('rs_episode5_unlocked', '1');
}

export function unlockEpisode6() {
  run.episode6Unlocked = true;
  lsSet('rs_episode6_unlocked', '1');
}

export function saveRunPrefs() {
  lsSet('rs_char', run.character);
  lsSet('rs_diff', run.difficulty);
}

export function recordBest() {
  if (run.score > run.best) { run.best = run.score; lsSet('rs_best', String(run.best)); }
}

export function addScore(scene: Phaser.Scene, n: number) {
  run.score += n;
  scene?.events?.emit?.('rs:score', run.score);
}

/** Scale an arcade point value by the active difficulty multiplier (×1 / ×1.25 / ×2). */
export function scaledScore(basePoints: number, difficulty: DifficultyId = run.difficulty): number {
  return Math.round(basePoints * DIFFICULTY[difficulty].scoreBonus);
}

export function addScaledScore(scene: Phaser.Scene, basePoints: number): number {
  const pts = scaledScore(basePoints);
  addScore(scene, pts);
  return pts;
}

/** Pure mission-clear bonus breakdown so UI, HUD & tests compute identical totals. */
export function computeMissionBonuses(opts: {
  episode: EpisodeId;
  difficulty: DifficultyId;
  combatScore: number;
  livesRemaining: number;
  elapsedSec: number;
}): ScoreBreakdown {
  const mult = DIFFICULTY[opts.difficulty].scoreBonus;
  const clearBonus = Math.round(EPISODE_CLEAR_BASE[opts.episode] * mult);
  const lives = Math.max(0, Math.round(opts.livesRemaining));
  const livesBonus = Math.round(lives * 400 * mult);
  const secs = Math.max(1, Math.round(opts.elapsedSec));
  const savedSec = Math.max(0, Math.min(180, EPISODE_PAR_SECONDS[opts.episode] - secs));
  const timeBonus = Math.round(savedSec * 10 * mult);
  return {
    episode: opts.episode,
    difficulty: opts.difficulty,
    multiplier: mult,
    combatScore: opts.combatScore,
    clearBonus,
    livesRemaining: lives,
    livesBonus,
    elapsedSec: secs,
    timeBonus,
    totalScore: opts.combatScore + clearBonus + livesBonus + timeBonus,
  };
}

/** Apply mission clear + survival + speed bonuses on episode victory and populate Results registry. */
export function finalizeEpisodeVictory(scene: Phaser.Scene, episode: EpisodeId, elapsedSec: number): ScoreBreakdown {
  const breakdown = computeMissionBonuses({
    episode,
    difficulty: run.difficulty,
    combatScore: Math.max(0, run.score - run.missionStartScore),
    livesRemaining: run.lives,
    elapsedSec,
  });
  const totalBonus = breakdown.clearBonus + breakdown.livesBonus + breakdown.timeBonus;
  addScore(scene, totalBonus);
  // Stage score is a delta; run.score remains the cumulative HUD total.
  breakdown.totalScore = breakdown.combatScore + totalBonus;
  recordBest();
  scene.registry.set('episode', episode);
  scene.registry.set('gameover', false);
  scene.registry.set('finalScore', run.score);
  scene.registry.set('scoreBreakdown', breakdown);
  return breakdown;
}

export function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Floating "+100" score popups & tiny bit of juice. */
export function scorePopup(scene: Phaser.Scene, x: number, y: number, text: string, color = '#ffd24a') {
  const t = scene.add.text(x, y, text, { fontFamily: 'monospace', fontSize: '14px', color }).setDepth(300);
  scene.tweens.add({ targets: t, y: y - 46, alpha: 0, duration: 800, onComplete: () => t.destroy() });
}

/** Screen shake helper that works in any scene. */
export function shake(scene: Phaser.Scene, dur = 120, intensity = 0.006) {
  if (scene.cameras && scene.cameras.main) scene.cameras.main.shake(dur, intensity);
}
