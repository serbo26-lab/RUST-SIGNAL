import type { DifficultyId, EpisodeId } from './core';
import type { LeaderboardEntry } from './leaderboard';

// A persistent player identity is not the same as a one-use mission ticket.
// Only the player key is stored on this device. The database keeps its SHA-256 hash.
const API = '/api';
export const PLAYER_KEY_STORAGE = 'rs_player_token_v1';
type Hero = 'ignis' | 'volt';
export type OnlineScope = 'all' | 'campaign' | EpisodeId;

export interface OnlineBoard {
  difficulty: DifficultyId;
  entries: LeaderboardEntry[];
  scope: 'all' | 'episode' | 'campaign';
  episode?: EpisodeId | null;
  limit: number;
}

interface Ticket {
  token: string;
  playerToken: string;
  campaignId: string | null;
}
interface GameSession {
  episode: EpisodeId;
  difficulty: DifficultyId;
  character: Hero;
  token: Promise<Ticket>;
}
let currentSession: GameSession | null = null;
let identityPromise: Promise<string> | null = null;
// Campaign progress exists only while Results -> [C] continues the same run.
let campaignId: string | null = null;
let nextCampaignEpisode = 1;

async function requestJson<T>(route: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(API + route, {
    ...options, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  let body: any;
  try { body = await response.json(); }
  catch { throw new Error('Сервер рекордов не отвечает'); }
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Ошибка сервера рекордов');
  return body as T;
}

function storedPlayerToken(): string | null {
  try {
    const token = globalThis.localStorage?.getItem(PLAYER_KEY_STORAGE) ?? '';
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch { return null; }
}
async function ensurePlayerToken(): Promise<string> {
  const existing = storedPlayerToken();
  if (existing) return existing;
  if (!identityPromise) {
    identityPromise = requestJson<{playerToken:string}>('/players', {
      method: 'POST', body: '{}',
    }).then(result => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(result.playerToken)) throw new Error('Неверный ключ игрока');
      // Refuse to create an unrememberable account: identity would be lost on reload.
      try {
        globalThis.localStorage?.setItem(PLAYER_KEY_STORAGE, result.playerToken);
        if (storedPlayerToken() !== result.playerToken) throw new Error('Хранилище отключено');
      } catch { throw new Error('Разрешите сохранение данных сайта в браузере для постоянного профиля'); }
      return result.playerToken;
    }).finally(() => { identityPromise = null; });
  }
  return identityPromise;
}

export function getOnlineLeaderboard(difficulty: DifficultyId, scope: OnlineScope = 'all'): Promise<OnlineBoard> {
  const suffix = scope === 'all' ? '' : scope === 'campaign' ? '&scope=campaign' : '&episode=' + scope;
  return requestJson<OnlineBoard>('/leaderboard?difficulty=' + encodeURIComponent(difficulty) + suffix);
}

export function resetOnlineCampaign(): void {
  campaignId = null;
  nextCampaignEpisode = 1;
}

// Called on mission start, before a result exists. The session ticket stays
// single-use and server-time-bound even when the player identity is persistent.
export function beginOnlineRun(input: { episode: EpisodeId; difficulty: DifficultyId; character: Hero }): void {
  if (input.episode === 1) resetOnlineCampaign();
  const continuing = input.episode > 1 && nextCampaignEpisode === input.episode ? campaignId : null;
  const token = ensurePlayerToken().then(playerToken =>
    requestJson<{token:string;campaignId:string|null}>('/runs', {
      method: 'POST',
      body: JSON.stringify({ ...input, playerToken, ...(continuing ? {campaignId: continuing} : {}) }),
    }).then(session => ({ ...session, playerToken })));
  token.catch(() => {}); // gameplay remains possible offline
  currentSession = { ...input, token };
}

export interface OnlineSubmission {
  rank: number | null;
  improved: boolean;
  entry: LeaderboardEntry;
  campaign: null | {
    completed: boolean;
    missions: number;
    totalScore: number;
    elapsedSec: number;
    rank?: number | null;
  };
}

export async function submitOnlineScore(input: {
  nickname: string;
  score: number;
  combatScore: number;
  episode: EpisodeId;
  difficulty: DifficultyId;
  character: Hero;
  livesLeft: number;
  elapsedSec: number;
}): Promise<OnlineSubmission> {
  const session = currentSession;
  if (!session || session.episode !== input.episode
      || session.difficulty !== input.difficulty || session.character !== input.character)
    throw new Error('Попытка устарела. Перезапусти миссию и попробуй снова.');
  let ticket: Ticket;
  try { ticket = await session.token; }
  catch { throw new Error('В начале миссии не было связи с сервером. Счёт сохранён только локально.'); }
  const result = await requestJson<OnlineSubmission>('/leaderboard', {
    method: 'POST',
    body: JSON.stringify({ ...input, token: ticket.token, playerToken: ticket.playerToken }),
  });
  // An older slow HTTP response must not detach a newer mission's ticket.
  if (currentSession === session) currentSession = null;
  if (result.campaign && !result.campaign.completed && ticket.campaignId) {
    campaignId = ticket.campaignId;
    nextCampaignEpisode = input.episode + 1;
  } else {
    resetOnlineCampaign();
  }
  return result;
}
