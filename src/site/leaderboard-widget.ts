import type { DifficultyId, EpisodeId } from '../game/core';
import { DIFFICULTY_META, DIFFICULTY_ORDER, EPISODE_LABELS, HERO_LABELS, formatDuration, type LeaderboardEntry } from '../game/leaderboard';
import { getOnlineLeaderboard, type OnlineScope } from '../game/online-leaderboard';

function savedDifficulty(): DifficultyId {
  try {
    const d = localStorage.getItem('rs_diff');
    if (d === 'rookie' || d === 'veteran' || d === 'hardcore') return d;
  } catch { /* browsing without storage */ }
  return 'veteran';
}

function message(body: HTMLElement, value: string, isError = false): void {
  body.replaceChildren();
  const element = document.createElement('div');
  element.className = 'lb-empty';
  element.setAttribute('role', isError ? 'alert' : 'status');
  const p = document.createElement('p');
  p.textContent = value;
  element.appendChild(p);
  if (!isError) {
    const link = document.createElement('a');
    link.href = '/play/';
    link.className = 'lb-empty-link';
    link.textContent = 'Открыть миссию →';
    element.appendChild(link);
  }
  body.appendChild(element);
}

function scopeTitle(scope: OnlineScope): string {
  if (scope === 'campaign') return 'Кампания 6/6';
  if (scope === 'all') return 'Все миссии';
  return EPISODE_LABELS[scope];
}

function renderRows(body: HTMLElement, diff: DifficultyId, entries: LeaderboardEntry[], scope: OnlineScope): void {
  if (!entries.length) {
    const messageText = scope === 'campaign'
      ? 'Полных прохождений шести миссий подряд пока нет. Начните с первой миссии и продолжайте через «C».'
      : 'В разделе «' + scopeTitle(scope) + '» на сложности «' + DIFFICULTY_META[diff].title + '» пока нет результатов.';
    message(body, messageText);
    return;
  }
  const ol = document.createElement('ol');
  ol.className = 'lb-list';
  for (const [index, entry] of entries.slice(0, 15).entries()) {
    const li = document.createElement('li');
    li.className = index === 0 ? 'lb-row top1' : 'lb-row';
    const rank = document.createElement('span');
    rank.className = 'lb-rank'; rank.textContent = '#' + (index + 1);
    const main = document.createElement('span');
    main.className = 'lb-player';
    const name = document.createElement('strong');
    name.textContent = entry.nickname;
    const meta = document.createElement('small');
    meta.textContent = (scope === 'campaign' ? '6 миссий подряд' : EPISODE_LABELS[entry.episode]) +
      ' · ' + HERO_LABELS[entry.character] + ' · ' + formatDuration(entry.elapsedSec);
    main.append(name, meta);
    const score = document.createElement('span');
    score.className = 'lb-score';
    score.textContent = entry.score.toLocaleString('ru-RU');
    li.append(rank, main, score);
    ol.append(li);
  }
  body.replaceChildren(ol);
}

export function initLeaderboardWidget(root: HTMLElement | null = document.getElementById('rs-leaderboard')): void {
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = new Map<DifficultyId, HTMLElement>();
  const scopeSelect = root.querySelector<HTMLSelectElement>('#rs-lb-scope');
  const scopeHelp = root.querySelector<HTMLElement>('#rs-lb-scope-help');
  for (const d of DIFFICULTY_ORDER) {
    const p = root.querySelector<HTMLElement>('[role="tabpanel"][data-diff="' + d + '"]');
    if (p) panels.set(d, p);
  }
  if (!tabs.length || panels.size !== DIFFICULTY_ORDER.length) return;
  let activeDifficulty = savedDifficulty();
  let activeScope: OnlineScope = 'all';
  let requestVersion = 0;

  const selectTab = (difficulty: DifficultyId, focus = false) => {
    activeDifficulty = difficulty;
    for (const tab of tabs) {
      const selected = tab.dataset.diff === difficulty;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const [diff, panel] of panels) {
      if (diff === difficulty) {
        panel.removeAttribute('hidden');
        panel.tabIndex = 0;
      } else {
        panel.setAttribute('hidden', '');
        panel.removeAttribute('tabindex');
      }
    }
  };

  const updateScopeHelp = () => {
    if (!scopeHelp) return;
    scopeHelp.textContent = activeScope === 'campaign'
      ? 'Сумма 6 миссий за одно непрерывное прохождение, сложность и боец не меняются.'
      : activeScope === 'all'
        ? 'Лучший результат каждого игрока; старые рекорды сохранены.'
        : 'Лучший результат каждого игрока за эту миссию.';
  };

  async function refresh() {
    const version = ++requestVersion;
    const difficulty = activeDifficulty, scope = activeScope;
    const panel = panels.get(difficulty);
    const body = panel?.querySelector<HTMLElement>('.lb-rows');
    if (!body) return;
    message(body, 'Загружаем таблицу рекордов…', true);
    try {
      const result = await getOnlineLeaderboard(difficulty, scope);
      if (version !== requestVersion) return;
      renderRows(body, difficulty, result.entries, scope);
      const count = root!.querySelector<HTMLElement>('[data-lb-count="' + difficulty + '"]');
      if (count) count.textContent = result.entries.length ? String(result.entries.length) : '';
    } catch {
      if (version !== requestVersion) return;
      message(body, 'Таблица рекордов сейчас не загрузилась. Проверь сеть и обнови страницу.', true);
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      selectTab(tab.dataset.diff as DifficultyId);
      void refresh();
    });
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      let target = -1;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      if (target >= 0) {
        event.preventDefault();
        selectTab(tabs[target].dataset.diff as DifficultyId, true);
        void refresh();
      }
    });
  }
  for (const [diff, panel] of panels) {
    panel.addEventListener('beforematch', () => {
      selectTab(diff);
      void refresh();
    });
  }
  scopeSelect?.addEventListener('change', () => {
    const value = scopeSelect.value;
    activeScope = value === 'campaign' ? 'campaign' : value === 'all' ? 'all'
      : (Number(value) as EpisodeId);
    updateScopeHelp();
    void refresh();
  });
  selectTab(activeDifficulty);
  updateScopeHelp();
  void refresh();
  window.addEventListener('focus', () => { void refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initLeaderboardWidget());
  else initLeaderboardWidget();
}
