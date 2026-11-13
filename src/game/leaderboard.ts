import type { DifficultyId, EpisodeId } from './core';

export const LEADERBOARD_STORAGE_KEY = 'rs_leaderboard_v1';
export const NICKNAME_STORAGE_KEY = 'rs_nickname_v1';
export const MAX_ENTRIES_PER_DIFFICULTY = 15;

export interface LeaderboardEntry {
  id: string;
  nickname: string;
  score: number;
  episode: EpisodeId;
  character: 'ignis' | 'volt';
  difficulty: DifficultyId;
  livesLeft: number;
  elapsedSec: number;
  dateIso: string;
  /** Number of distinct missions contributing to an overall online result. */
  missionsCompleted?: number;
}

export type LeaderboardBoard = Record<DifficultyId, LeaderboardEntry[]>;

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['rookie', 'veteran', 'hardcore'] as const;

export const DIFFICULTY_META: Record<
  DifficultyId,
  { title: string; multLabel: string; summary: string; livesLabel: string }
> = {
  rookie: {
    title: 'Рекрут',
    multLabel: '×1.0',
    livesLabel: '4 жизни',
    summary: '4 жизни · ×1.0 к очкам · урон по вам вдвое ниже',
  },
  veteran: {
    title: 'Ветеран',
    multLabel: '×1.25',
    livesLabel: '3 жизни',
    summary: '3 жизни · ×1.25 к очкам · основной режим',
  },
  hardcore: {
    title: 'Хардкор',
    multLabel: '×2.0',
    livesLabel: '1 жизнь',
    summary: '1 жизнь · ×2.0 к очкам · враги бьют на 50% больнее и живут дольше',
  },
};

export const EPISODE_LABELS: Record<EpisodeId, string> = {
  1: 'Эп. 1 · Гавань',
  2: 'Эп. 2 · Поезд',
  3: 'Эп. 3 · Зона',
  4: 'Эп. 4 · «Нуль»',
  5: 'Эп. 5 · Бастион',
  6: 'Эп. 6 · Маяк-13',
};

export const HERO_LABELS: Record<'ignis' | 'volt', string> = {
  ignis: 'Искра',
  volt: 'Гром',
};

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* ignore storage quota / restricted environments */
  }
}

export function sanitizeNickname(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

export function validateNickname(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = sanitizeNickname(raw);
  if (value.length < 2) {
    return { ok: false, error: 'Введите позывной от 2 до 16 символов.' };
  }
  return { ok: true, value };
}

function emptyBoard(): LeaderboardBoard {
  return { rookie: [], veteran: [], hardcore: [] };
}

function normalizeEntry(raw: unknown): LeaderboardEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const diff = item.difficulty;
  if (diff !== 'rookie' && diff !== 'veteran' && diff !== 'hardcore') return null;
  const nickname = sanitizeNickname(String(item.nickname ?? ''));
  if (nickname.length < 2) return null;
  const score = Math.max(0, Math.round(Number(item.score ?? 0)));
  const ep = Number(item.episode);
  const episode: EpisodeId = ep === 6 ? 6 : ep === 5 ? 5 : ep === 4 ? 4 : ep === 3 ? 3 : ep === 2 ? 2 : 1;
  const character: 'ignis' | 'volt' = item.character === 'volt' ? 'volt' : 'ignis';
  const livesLeft = Math.max(0, Math.round(Number(item.livesLeft ?? 0)));
  const elapsedSec = Math.max(1, Math.round(Number(item.elapsedSec ?? 60)));
  const id = typeof item.id === 'string' && item.id ? item.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const dateIso = typeof item.dateIso === 'string' && item.dateIso ? item.dateIso : new Date().toISOString();
  return { id, nickname, score, episode, character, difficulty: diff, livesLeft, elapsedSec, dateIso };
}

function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.elapsedSec !== b.elapsedSec) return a.elapsedSec - b.elapsedSec;
    if (b.episode !== a.episode) return b.episode - a.episode;
    return b.dateIso.localeCompare(a.dateIso);
  });
}

export function loadLeaderboard(): LeaderboardBoard {
  const raw = safeGet(LEADERBOARD_STORAGE_KEY);
  const board = emptyBoard();
  if (!raw) return board;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<DifficultyId, unknown[]>>;
    for (const d of DIFFICULTY_ORDER) {
      const list = Array.isArray(parsed?.[d]) ? parsed[d]! : [];
      board[d] = sortEntries(
        list.map(normalizeEntry).filter((x): x is LeaderboardEntry => x !== null),
      ).slice(0, MAX_ENTRIES_PER_DIFFICULTY);
    }
  } catch {
    return emptyBoard();
  }
  return board;
}

export function getLeaderboardEntries(difficulty: DifficultyId): LeaderboardEntry[] {
  return loadLeaderboard()[difficulty];
}

export function getLastNickname(): string {
  return sanitizeNickname(safeGet(NICKNAME_STORAGE_KEY) ?? '');
}

export function submitLeaderboardEntry(input: {
  nickname: string;
  score: number;
  episode: EpisodeId;
  character: 'ignis' | 'volt';
  difficulty: DifficultyId;
  livesLeft: number;
  elapsedSec: number;
}): { entry: LeaderboardEntry; rank: number; entries: LeaderboardEntry[] } {
  const checked = validateNickname(input.nickname);
  if (!checked.ok) {
    throw new Error(checked.error);
  }
  const entry: LeaderboardEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nickname: checked.value,
    score: Math.max(0, Math.round(input.score)),
    episode: input.episode,
    character: input.character,
    difficulty: input.difficulty,
    livesLeft: Math.max(0, Math.round(input.livesLeft)),
    elapsedSec: Math.max(1, Math.round(input.elapsedSec)),
    dateIso: new Date().toISOString(),
  };
  const board = loadLeaderboard();
  const nextList = sortEntries([...board[input.difficulty], entry]).slice(0, MAX_ENTRIES_PER_DIFFICULTY);
  board[input.difficulty] = nextList;
  safeSet(NICKNAME_STORAGE_KEY, entry.nickname);
  safeSet(LEADERBOARD_STORAGE_KEY, JSON.stringify(board));
  const idx = nextList.findIndex((item) => item.id === entry.id);
  return {
    entry,
    rank: idx >= 0 ? idx + 1 : nextList.length + 1,
    entries: nextList,
  };
}

export function clearLeaderboard(): void {
  try {
    globalThis.localStorage?.removeItem(LEADERBOARD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function formatDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = String(secs % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
