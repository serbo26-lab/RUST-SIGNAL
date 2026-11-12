import Phaser from 'phaser';
import { submitOnlineScore } from '../game/online-leaderboard';
import { VIEW_W, VIEW_H, run, DIFFICULTY, type EpisodeId, type ScoreBreakdown } from '../game/core';
import { SFX, MUSIC, unlockAudio } from '../game/audio';
import {
  submitLeaderboardEntry,
  validateNickname,
  getLastNickname,
  formatDuration,
  DIFFICULTY_META,
} from '../game/leaderboard';

/** Tactical Mission Debrief, Score Breakdown, Leaderboard Entry & Rank Screen. */
export class ResultsScene extends Phaser.Scene {
  constructor() { super('Results'); }

  create() {
    const gameover = !!this.registry.get('gameover');
    const breakdown = this.registry.get('scoreBreakdown') as ScoreBreakdown | null | undefined;
    // The victory snapshot is captured at boss defeat. During the outro,
    // remaining projectiles may still alter the mutable run.score/run.lives.
    // Display and submit the same immutable value that the server validates.
    const score = !gameover && breakdown ? breakdown.totalScore
      : Number(this.registry.get('finalScore') ?? run.score);
    const episodeNum = Number(this.registry.get('episode') ?? run.episode);
    const episode: EpisodeId = (episodeNum >= 1 && episodeNum <= 6 ? Math.round(episodeNum) : 1) as EpisodeId;

    if (!gameover) {
      unlockAudio();
      [523, 659, 784, 1046].forEach((_f, i) => this.time.delayedCall(i * 120, () => SFX.play('pickup', 0.9)));
    } else {
      SFX.play('hurt', 0.8);
    }

    this.cameras.main.setBackgroundColor('#090d16');
    const locKey = `loc_ep${episode}`;
    if (this.textures.exists(locKey)) {
      this.add.image(VIEW_W / 2, VIEW_H / 2, locKey).setDisplaySize(VIEW_W, VIEW_H).setAlpha(0.24).setDepth(0);
    }
    const bg = this.add.graphics().setDepth(1);
    bg.fillGradientStyle(0x080c15, 0x080c15, 0x080c15, 0x080c15, 0.78, 0.78, 0.94, 0.94);
    bg.fillRect(0, 0, VIEW_W, VIEW_H);

    // Central Debrief Card Frame
    const cardW = 740, cardH = gameover ? 390 : 454;
    const cx = VIEW_W / 2, cy = gameover ? 268 : 272;
    bg.fillStyle(0x0e1522, 0.93).fillRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
    bg.lineStyle(2, gameover ? 0xd8453a : 0x5ee3d2, 0.95).strokeRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
    bg.fillStyle(gameover ? 0xd8453a : 0xffca68, 0.95).fillRect(cx - cardW / 2, cy - cardH / 2, cardW, 5);

    const campaignComplete = !gameover && episode === 6;
    this.add.text(cx, gameover ? 104 : 78, gameover ? 'МИССИЯ ПРОВАЛЕНА' : campaignComplete ? 'КАМПАНИЯ ЗАВЕРШЕНА · ФИНАЛ' : `ЭПИЗОД ${episode} ПРОЙДЕН`, {
      fontFamily: 'monospace', fontSize: gameover ? '36px' : campaignComplete ? '28px' : '32px', fontStyle: 'bold',
      color: gameover ? '#ff645c' : campaignComplete ? '#ffe27a' : '#7fe6f2',
      stroke: '#1e1008', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(5);

    const briefing = !gameover
      ? (episode === 1 ? 'Кран разбит, но сигнал потянул дальше по ветке.'
        : episode === 2 ? 'Бронепоезд встал. След сигнала уходит глубже в джунгли.'
        : episode === 3 ? 'Сердце колонии рассыпалось, но ретрансляторы под землёй ещё работают.'
        : episode === 4 ? 'Комплекс «Нуль» обесточен. Записи ведут на полярный пост «Север».'
        : episode === 5 ? '«Цитадель-9» остановлена. Спуск к основанию «Маяка-13» свободен.'
        : '«Альфа-13» разбита, вышки замолкли. Над островом снова чистый эфир.')
      : (episode === 6 ? '«Альфа-13» задавила помехами. Сначала глуши три узла питания в шахте.'
        : episode === 5 ? 'Холод и щиты «Цитадели-9» оказались крепче. Отключай термоконтуры на башнях [E].'
        : episode === 4 ? 'Створы «Нуля» остались закрыты. Сними хотя бы два терминала.'
        : episode === 3 ? 'Споры накрыли отряд. Сожги по пути коконы, чтобы ослабить Сердце.'
        : episode === 2 ? 'Бронепоезд ушёл в тоннель. Держи темп и бей с самого старта.'
        : 'Катер вернётся за тобой на рассвете. Попробуй прорваться ещё раз.');

    this.add.text(cx, gameover ? 152 : 114, briefing, {
      fontFamily: 'monospace', fontSize: '13px', color: gameover ? '#a8b4c4' : '#ff7ce2',
      wordWrap: { width: 660 }, align: 'center',
    }).setOrigin(0.5).setDepth(5);

    if (!gameover) {
      const nextTease = episode === 1 ? 'СЛЕДУЮЩАЯ МИССИЯ: «Бронепоезд №7»'
        : episode === 2 ? 'СЛЕДУЮЩАЯ МИССИЯ: «Зелёная зона»'
        : episode === 3 ? 'СЛЕДУЮЩАЯ МИССИЯ: «Комплекс «Нуль»»'
        : episode === 4 ? 'СЛЕДУЮЩАЯ МИССИЯ: «Бастион «Север»»'
        : episode === 5 ? 'ФИНАЛЬНАЯ МИССИЯ: «Ядро «Маяк-13»»'
        : 'ЭПИЛОГ: БОЦМАН САЖАЕТ «КАСАТКУ» · ОСТРОВ ОСВОБОЖДЁН (6/6)';
      this.add.text(cx, 141, nextTease, {
        fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#ffe590',
      }).setOrigin(0.5).setDepth(5);
    }

    // Score & Mission Metrics Panels
    const boxY = gameover ? 196 : 162;
    const boxH = gameover ? 142 : 158;
    bg.fillStyle(0x131d2e, 0.95).fillRect(142, boxY, 444, boxH);
    bg.lineStyle(1, 0x334b68, 0.9).strokeRect(142, boxY, 444, boxH);

    const heaters = Number(this.registry.get('heatersDisabled') ?? 0);
    const anchors = Number(this.registry.get('anchorsDisabled') ?? 0);
    const objLine = episode === 1
      ? `ПЕРЕХВАТЫ:     ${run.intel}/3${run.intel === 3 ? ' ★ ВСЕ!' : ''}`
      : episode === 2 ? 'БРОНЕПОЕЗД №7 · ПУТЬ ОТКРЫТ'
      : episode === 3 ? `КОКОНЫ:        ${this.registry.get('podsDestroyed') ?? 0}/3`
      : episode === 4 ? `КОДЫ ДОСТУПА:  ${this.registry.get('terminalsHacked') ?? 0}/3`
      : episode === 5 ? `ТЕРМОКОНТУРЫ:  ${heaters}/3${heaters === 3 ? ' ★ ВСЕ!' : ''}`
      : `УЗЛЫ «АЛЬФЫ»:  ${anchors}/3${anchors === 3 ? ' ★ ВСЕ!' : ''}`;

    if (!gameover && breakdown) {
      this.add.text(160, boxY + 11, `БОЕВЫЕ (×${breakdown.multiplier}):  ${breakdown.combatScore}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#b7d5ec',
      }).setDepth(5);
      this.add.text(160, boxY + 30, `ГЛАВА ${episode} (×${breakdown.multiplier}):   +${breakdown.clearBonus}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#9cf5c4',
      }).setDepth(5);
      this.add.text(160, boxY + 49, `ЖИЗНИ (${breakdown.livesRemaining}) И СКОРОСТЬ (${formatDuration(breakdown.elapsedSec)}): +${breakdown.livesBonus + breakdown.timeBonus}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#8ef5ff',
      }).setDepth(5);
      this.add.text(160, boxY + 75, `ИТОГО ОЧКОВ: ${score}`, {
        fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ffd24a',
      }).setDepth(5);
      this.add.text(160, boxY + 104, `СЛОЖНОСТЬ:   ${DIFFICULTY[run.difficulty].name} (×${DIFFICULTY[run.difficulty].scoreBonus})  · РЕК ${run.best}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#d5e2ee',
      }).setDepth(5);
      this.add.text(160, boxY + 126, objLine, {
        fontFamily: 'monospace', fontSize: '12px', color: '#8effdf',
      }).setDepth(5);
    } else {
      this.add.text(162, boxY + 16, `ИТОГОВЫЙ СЧЁТ:   ${score}`, {
        fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ffd24a',
      }).setDepth(5);
      this.add.text(162, boxY + 50, `ЛУЧШИЙ РЕКОРД:   ${run.best}`, {
        fontFamily: 'monospace', fontSize: '14px', color: '#9ed8f2',
      }).setDepth(5);
      this.add.text(162, boxY + 74, `СЛОЖНОСТЬ:       ${DIFFICULTY[run.difficulty].name} (×${DIFFICULTY[run.difficulty].scoreBonus})`, {
        fontFamily: 'monospace', fontSize: '14px', color: '#cfe0ee',
      }).setDepth(5);
      this.add.text(162, boxY + 102, objLine, {
        fontFamily: 'monospace', fontSize: '13px', color: '#8effdf',
      }).setDepth(5);
    }

    // Rank Stamp Box on Right
    const pods = Number(this.registry.get('podsDestroyed') ?? 0);
    const terms = Number(this.registry.get('terminalsHacked') ?? 0);
    const perfectObj = (episode === 1 && run.intel === 3)
      || (episode === 3 && pods === 3)
      || (episode === 4 && terms === 3)
      || (episode === 5 && heaters === 3)
      || (episode === 6 && anchors === 3);
    const grade = gameover ? 'F' : (score >= 5500 || perfectObj || run.difficulty === 'hardcore') ? 'S' : score >= 3000 ? 'A' : 'B';
    const gradeCol = grade === 'S' ? '#ffda59' : grade === 'A' ? '#7ef0d6' : grade === 'B' ? '#7fc4ff' : '#ff5a54';

    bg.fillStyle(0x101826, 0.95).fillRect(606, boxY, 210, boxH);
    bg.lineStyle(2, gameover ? 0xd8453a : 0xffca68, 0.9).strokeRect(606, boxY, 210, boxH);
    this.add.text(711, boxY + 20, 'РАНГ МИССИИ', { fontFamily: 'monospace', fontSize: '11px', color: '#8ea3b8' }).setOrigin(0.5).setDepth(5);
    const rankTxt = this.add.text(711, boxY + boxH * 0.62, grade, {
      fontFamily: 'monospace', fontSize: '70px', fontStyle: 'bold', color: gradeCol,
    }).setOrigin(0.5).setDepth(5).setScale(1.8).setAlpha(0);
    this.tweens.add({ targets: rankTxt, scale: 1, alpha: 1, duration: 360, delay: 180, ease: 'Back.easeOut' });

    if (gameover && run.difficulty === 'hardcore') {
      this.add.text(cx, 358, 'ХАРДКОР: ОДНА ЖИЗНЬ, ЗАТО МНОЖИТЕЛЬ ×2 К ОЧКАМ', {
        fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#ff8a6b',
      }).setOrigin(0.5).setDepth(5);
    }

    // DOM leaderboard nickname entry form on Victory (!gameover)
    let formActions: { cleanup: () => void; saveIfNamed: () => Promise<void> } | undefined;
    if (!gameover) {
      formActions = this.mountLeaderboardForm({
        score,
        episode,
        elapsedSec: breakdown?.elapsedSec ?? 90,
        combatScore: breakdown?.combatScore ?? 0,
        livesLeft: breakdown?.livesRemaining ?? run.lives,
      });
    }

    // Action Buttons
    const btnY = gameover ? 416 : 464;
    const backBtn = this.add.text(gameover || episode === 6 ? cx : cx - 155, btnY, 'ENTER — В МЕНЮ', {
      fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#f5ffe9',
      backgroundColor: '#1a273a', padding: { x: 18, y: 8 },
    }).setOrigin(0.5).setDepth(6).setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: backBtn, alpha: { from: 1, to: 0.72 }, yoyo: true, repeat: -1, duration: 650 });

    let transitioned = false;
    const isTypingInForm = () => {
      const ae = document.activeElement;
      return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
    };
    const back = () => {
      if (transitioned || isTypingInForm()) return;
      transitioned = true;
      const go = () => { unlockAudio(); MUSIC.play('menu'); this.scene.start('Menu'); };
      // On the final screen, finish the upload before leaving when a nickname is saved.
      if (formActions) void formActions.saveIfNamed().then(go, go);
      else go();
    };
    backBtn.on('pointerdown', back);
    this.input.keyboard!.on('keydown-ENTER', back);

    let onward: (() => void) | undefined;
    if (!gameover && episode < 6) {
      const next = this.add.text(cx + 150, btnY,
        episode === 1 ? '▶ C — БРОНЕПОЕЗД №7'
          : episode === 2 ? '▶ C — ЗЕЛЁНАЯ ЗОНА'
            : episode === 3 ? '▶ C — КОМПЛЕКС «НУЛЬ»'
              : episode === 4 ? '▶ C — БАСТИОН «СЕВЕР»'
                : '▶ C — ЯДРО «МАЯК-13»', {
          fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#9effeb',
          backgroundColor: '#194a56', padding: { x: 18, y: 8 },
        }).setOrigin(0.5).setDepth(6).setInteractive({ useHandCursor: true });
      onward = () => {
        if (transitioned || isTypingInForm()) return;
        transitioned = true;
        const go = () => {
          // The HUD retains the six-mission total, but each ranked mission
          // must submit only the score earned in its own chapter.
          run.missionStartScore = run.score;
          run.episode = (episode + 1) as EpisodeId;
          unlockAudio(); MUSIC.play('level');
          this.scene.start(
            episode === 1 ? 'Train'
              : episode === 2 ? 'Jungle'
                : episode === 3 ? 'Facility'
                  : episode === 4 ? 'Bastion'
                    : 'Beacon',
          );
        };
        // Wait for the one-use upload before starting the next chapter; the
        // server can then attach its ticket to the same continuous campaign.
        if (formActions) void formActions.saveIfNamed().then(go, go);
        else go();
      };
      next.on('pointerdown', onward);
      this.input.keyboard!.on('keydown-C', onward);
    }

    const onWinKey = (ev: KeyboardEvent) => {
      if (transitioned || isTypingInForm()) return;
      if (ev.key === 'Enter') back();
      else if (onward && (ev.key === 'c' || ev.key === 'C' || ev.code === 'KeyC')) onward();
    };
    window.addEventListener('keydown', onWinKey);
    const cleanup = () => {
      window.removeEventListener('keydown', onWinKey);
      if (this.input.keyboard) this.input.keyboard.enabled = true;
      formActions?.cleanup();
    };
    this.events.once('shutdown', cleanup);
    this.events.once('destroy', cleanup);
    void VIEW_H;
  }

  private mountLeaderboardForm(opts: {
    score: number;
    episode: EpisodeId;
    elapsedSec: number;
    combatScore: number;
    livesLeft: number;
  }): { cleanup: () => void; saveIfNamed: () => Promise<void> } | undefined {
    const app = document.getElementById('app');
    if (!app) return undefined;

    document.getElementById('rs-result-form-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'rs-result-form-wrap';
    wrap.style.cssText = [
      'position:absolute',
      'z-index:25',
      'background:rgba(13,22,34,0.95)',
      'border:1px solid #486b82',
      'padding:8px 12px',
      'box-sizing:border-box',
      'color:#e8f1f4',
      'font-family:ui-monospace,Consolas,monospace',
      'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
    ].join(';');

    const form = document.createElement('form');
    form.noValidate = true;
    form.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0;';

    const label = document.createElement('label');
    label.htmlFor = 'rs-nick-input';
    label.textContent = `ТАБЛИЦА РЕКОРДОВ (${DIFFICULTY_META[run.difficulty].title}, ×${DIFFICULTY[run.difficulty].scoreBonus}):`;
    label.style.cssText = 'font-size:12px;color:#ffd885;font-weight:700;flex:1 1 100%;margin:0;';

    const input = document.createElement('input');
    input.id = 'rs-nick-input';
    input.name = 'nickname';
    input.type = 'text';
    input.required = true;
    input.minLength = 2;
    input.maxLength = 16;
    input.value = getLastNickname();
    input.placeholder = 'Позывной (2–16 симв.)';
    input.setAttribute('autocomplete', 'nickname');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'none');
    input.spellcheck = false;
    input.enterKeyHint = 'done';
    input.style.cssText = [
      'flex:1 1 170px',
      'min-width:140px',
      'min-height:36px',
      'padding:6px 10px',
      'font:inherit',
      'font-size:max(16px, 1em)',
      'color:#f4f8fa',
      'background:#0a111a',
      'border:1px solid #597c93',
      'box-sizing:border-box',
    ].join(';');

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'СОХРАНИТЬ РЕЗУЛЬТАТ';
    submit.style.cssText = [
      'min-height:36px',
      'padding:6px 14px',
      'font:inherit',
      'font-size:12px',
      'font-weight:800',
      'background:#ffb57e',
      'color:#12181d',
      'border:1px solid #ffd5b0',
      'cursor:pointer',
      'white-space:nowrap',
    ].join(';');

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'font-size:11px;color:#8ef5dc;flex:1 1 100%;min-height:14px;';

    form.append(label, input, submit, status);
    wrap.append(form);
    app.append(wrap);

    const syncPos = () => {
      const canvas = this.game?.canvas;
      if (!canvas || !wrap.isConnected) return;
      const ar = app.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const scaleW = cr.width > 80 ? cr.width : Math.min(ar.width - 16, 680);
      const scaleH = cr.height > 80 ? cr.height : Math.min(ar.height - 16, 420);
      const leftOff = cr.width > 80 ? (cr.left - ar.left) : (ar.width - scaleW) / 2;
      const topOff = cr.height > 80 ? (cr.top - ar.top) : (ar.height - scaleH) / 2;
      const w = Math.round(Math.min(Math.max(268, scaleW * 0.72), ar.width - 16));
      wrap.style.width = `${w}px`;
      wrap.style.left = `${Math.round(leftOff + (scaleW - w) / 2)}px`;
      wrap.style.top = `${Math.round(topOff + scaleH * 0.625)}px`;
    };
    syncPos();
    const onResize = () => syncPos();
    window.addEventListener('resize', onResize);

    // Do NOT autofocus input: preserve keyboard shortcuts (Enter/C) until player chooses to enter nickname.
    const onFocus = () => {
      if (this.input.keyboard) this.input.keyboard.enabled = false;
    };
    const onBlur = () => {
      if (this.input.keyboard) this.input.keyboard.enabled = true;
    };
    const onInput = () => {
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
      if (status.dataset.err === '1') {
        status.dataset.err = '';
        status.textContent = '';
      }
    };
    const onInputKey = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' && !ev.isComposing) input.blur();
    };

    let locallySaved = false;
    let onlineSaved = false;
    let pending: Promise<void> | null = null;
    const sendScore = (): Promise<void> => {
      if (onlineSaved) return Promise.resolve();
      if (pending) return pending;
      const check = validateNickname(input.value);
      if (!check.ok) {
        input.setAttribute('aria-invalid', 'true');
        input.setCustomValidity(check.error);
        status.dataset.err = '1';
        status.style.color = '#ff8b80';
        status.textContent = check.error;
        input.focus();
        return Promise.resolve();
      }
      if (!locallySaved) {
        submitLeaderboardEntry({
          nickname: check.value, score: opts.score, episode: opts.episode,
          character: run.character, difficulty: run.difficulty,
          livesLeft: opts.livesLeft, elapsedSec: opts.elapsedSec,
        });
        locallySaved = true;
      }
      submit.disabled = true;
      status.dataset.err = '';
      status.style.color = '#8ef5dc';
      status.textContent = 'Сохраняем результат для вашего профиля…';
      pending = (async () => {
        try {
          const result = await submitOnlineScore({
            nickname: check.value,
            score: opts.score,
            combatScore: opts.combatScore,
            episode: opts.episode,
            character: run.character,
            difficulty: run.difficulty,
            livesLeft: opts.livesLeft,
            elapsedSec: opts.elapsedSec,
          });
          onlineSaved = true;
          submit.textContent = 'СОХРАНЕНО ✓';
          submit.style.background = '#75e8c8';
          input.disabled = true;
          const resultText = result.improved ? 'Личный рекорд миссии обновлён.' : 'Лучший результат миссии сохранён.';
          const rankText = result.rank === null ? ' Вне топ-15.' : ' Место #' + result.rank + '.';
          const campaignText = result.campaign?.completed
            ? ' КАМПАНИЯ 6/6: ' + result.campaign.totalScore + ' очков. Общий рейтинг: #' + (result.campaign.rank ?? '—') + '.'
            : result.campaign ? ' Кампания: ' + result.campaign.missions + '/6.' : '';
          status.textContent = '✓ ' + resultText + rankText + campaignText;
        } catch (error) {
          submit.disabled = false;
          submit.textContent = 'ПОВТОРИТЬ ОТПРАВКУ';
          status.style.color = '#ffbc85';
          status.textContent = 'Результат сохранён в этом браузере. Сервер: ' +
            (error instanceof Error ? error.message : 'Ошибка соединения');
        } finally {
          pending = null;
        }
      })();
      return pending;
    };
    const onSubmit = (ev: SubmitEvent) => { ev.preventDefault(); void sendScore(); };

    input.addEventListener('focus', onFocus);
    input.addEventListener('blur', onBlur);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onInputKey);
    form.addEventListener('submit', onSubmit);
    // Returning players no longer need to type their nickname or click save
    // after every mission. First-time players enter a nickname once.
    if (validateNickname(input.value).ok) void sendScore();

    return {
      saveIfNamed: async () => {
        if (validateNickname(input.value).ok) await sendScore();
      },
      cleanup: () => {
      window.removeEventListener('resize', onResize);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onInputKey);
      form.removeEventListener('submit', onSubmit);
      wrap.remove();
      },
    };
  }
}
