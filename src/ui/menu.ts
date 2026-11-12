import Phaser from 'phaser';
import { resetOnlineCampaign } from '../game/online-leaderboard';
import { VIEW_W, VIEW_H, run, saveRunPrefs, DIFFICULTY, DifficultyId, type EpisodeId } from '../game/core';
import { makePlayerTextures, makeEnemyTextures, makeFxTextures, makeTankTextures } from '../game/sprites';
import { SFX, MUSIC, unlockAudio, isAudioMuted, toggleAudioMute } from '../game/audio';
import { ParallaxStrip } from '../game/world-rules';

interface ChapterDef {
  id: EpisodeId;
  tab: string;
  heading: string;
  thumb: string;
  accent: number;
  unlocked: () => boolean;
}

/** Main Title, Hero Dossier & Chapter Briefing Screen. */
export class MenuScene extends Phaser.Scene {
  private cards: Phaser.GameObjects.Graphics[] = [];
  private artFrames: Phaser.GameObjects.Graphics[] = [];
  private diffText!: Phaser.GameObjects.Text;
  private diffIdx = 1;
  private readonly diffs: DifficultyId[] = ['rookie', 'veteran', 'hardcore'];
  private startAt = 0;
  private starting = false;
  public selectedEpisode: EpisodeId = 1;

  constructor() { super('Menu'); }

  private ensurePixelSprites() {
    makePlayerTextures(this);
    makeEnemyTextures(this);
    makeFxTextures(this);
    makeTankTextures(this);
    const addAnim = (key: string, tex: string, frames: string[], frameRate: number, repeat = -1) => {
      if (!this.anims.exists(key) && this.textures.exists(tex)) {
        this.anims.create({ key, frames: frames.map(f => ({ key: tex, frame: f })), frameRate, repeat });
      }
    };
    for (const c of ['ignis', 'volt'] as const) {
      addAnim(`p_${c}_idle`, `p_${c}_idle`, ['f0', 'f1'], 4);
      addAnim(`p_${c}_run`, `p_${c}_run`, ['f0', 'f1', 'f2', 'f3'], 10);
      addAnim(`p_${c}_jump`, `p_${c}_jump`, ['f0', 'f1'], 6, 0);
      addAnim(`p_${c}_roll`, `p_${c}_roll`, ['f0', 'f1', 'f2', 'f3'], 16);
      addAnim(`p_${c}_crouch`, `p_${c}_crouch`, ['f0'], 1);
      addAnim(`p_${c}_aimup`, `p_${c}_aimup`, ['f0'], 1);
    }
    addAnim('e_rifle_walk', 'e_rifle', ['f0', 'f1', 'f2', 'f3'], 8);
    addAnim('e_gren_idle', 'e_gren', ['f0', 'f1'], 4);
    addAnim('e_spider_crawl', 'e_spider', ['f0', 'f1'], 8);
    addAnim('e_drone_fly', 'e_drone', ['f0', 'f1'], 8);
    addAnim('tank_roll', 'tank', ['f0', 'f1', 'f2', 'f3'], 8);
    addAnim('fx_boom', 'explosion', ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'], 16, 0);
  }

  private drawHeroBackdrop() {
    this.cameras.main.setBackgroundColor('#090d16');
    const bgKey = this.textures.exists('bg_ep1') ? 'bg_ep1' : (this.textures.exists('rs_harbor') ? 'rs_harbor' : (this.textures.exists('menu_harbor') ? 'menu_harbor' : ''));
    const bgStrip = bgKey ? new ParallaxStrip(this, bgKey, 0, 0, 0.58) : null;
    let scrollX = 0;
    // Deep twilight tactical vignette + industrial grid accents
    const vig = this.add.graphics().setDepth(1);
    vig.fillGradientStyle(0x070a12, 0x070a12, 0x070a12, 0x070a12, 0.72, 0.72, 0.92, 0.92);
    vig.fillRect(0, 0, VIEW_W, VIEW_H);
    // Subtle industrial girder frame around screen edges
    vig.lineStyle(2, 0x2a394e, 0.75).strokeRect(10, 10, VIEW_W - 20, VIEW_H - 20);
    vig.fillStyle(0xd8453a, 0.9).fillRect(10, 10, 68, 3);
    vig.fillStyle(0xffc966, 0.9).fillRect(VIEW_W - 78, 10, 68, 3);

    // Floating sunset harbor embers in background
    const embers: Array<{ g: Phaser.GameObjects.Rectangle; vx: number; vy: number }> = [];
    for (let i = 0; i < 24; i++) {
      const sz = i % 3 === 0 ? 3 : 2;
      const col = i % 4 === 0 ? 0x67e8f9 : 0xffb347;
      const g = this.add.rectangle(Math.random() * VIEW_W, Math.random() * VIEW_H, sz, sz, col, 0.35 + Math.random() * 0.45).setDepth(2);
      embers.push({ g, vx: -8 - Math.random() * 14, vy: -10 - Math.random() * 18 });
    }
    const onUpdate = (_t: number, dt: number) => {
      const s = dt / 1000;
      scrollX += 14 * s;
      bgStrip?.setScroll(scrollX);
      for (const e of embers) {
        e.g.x += e.vx * s;
        e.g.y += e.vy * s;
        if (e.g.y < -10) { e.g.y = VIEW_H + 10; e.g.x = Math.random() * VIEW_W; }
        if (e.g.x < -10) e.g.x = VIEW_W + 10;
      }
    };
    this.events.on('update', onUpdate);
    this.events.once('shutdown', () => this.events.off('update', onUpdate));
  }

  create() {
    this.startAt = this.time.now;
    this.starting = false;
    this.events.once('shutdown', () => { this.starting = false; });
    this.cards = [];
    this.artFrames = [];
    this.selectedEpisode = 1;
    window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: false }));
    this.ensurePixelSprites();
    this.drawHeroBackdrop();
    try { MUSIC.play('menu'); } catch { /* audio waits for user gesture */ }

    // --- Header Emblem + Record & Audio Mute ---
    this.add.text(VIEW_W / 2, 34, 'РЖАВЫЙ СИГНАЛ', {
      fontFamily: 'monospace', fontSize: '36px', fontStyle: 'bold', color: '#ffd27a',
      stroke: '#3c160d', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(10);
    this.add.text(VIEW_W / 2, 62, 'ОПЕРАЦИЯ «МАЯК-13»  ·  6 ЭПИЗОДОВ', {
      fontFamily: 'monospace', fontSize: '11px', color: '#7dd4e8', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(10);

    this.add.text(28, 22, `РЕКОРД: ${run.best}`, {
      fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#ffcf70',
      backgroundColor: '#121b28dd', padding: { x: 8, y: 4 },
    }).setDepth(12);

    const muteBtn = this.add.text(VIEW_W - 28, 22, isAudioMuted() ? 'ЗВУК: ВЫКЛ [M]' : 'ЗВУК: ВКЛ [M]', {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#9ee8f5',
      backgroundColor: '#121b28dd', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setDepth(12).setInteractive({ useHandCursor: true });
    muteBtn.on('pointerdown', () => {
      const m = toggleAudioMute();
      muteBtn.setText(m ? 'ЗВУК: ВЫКЛ [M]' : 'ЗВУК: ВКЛ [M]');
      if (!m) SFX.play('ui_move', 0.6);
    });

    // --- Chapter Mission Selector Strip (y=78..148) + Preview Thumbnail ---
    const chapters: ChapterDef[] = [
      { id: 1, tab: '01 ГАВАНЬ', heading: 'МИССИЯ: 01 ГАВАНЬ МЁРТВЫХ КОРАБЛЕЙ', thumb: 'loc_ep1', accent: 0xf4a852, unlocked: () => true },
      { id: 2, tab: '02 ПОЕЗД', heading: 'МИССИЯ: 02 БРОНЕПОЕЗД №7', thumb: 'loc_ep2', accent: 0x7dd4e8, unlocked: () => run.episode2Unlocked },
      { id: 3, tab: '03 ЗОНА', heading: 'МИССИЯ: 03 ЗЕЛЁНАЯ ЗОНА', thumb: 'loc_ep3', accent: 0x6ce8a0, unlocked: () => run.episode3Unlocked },
      { id: 4, tab: '04 «НУЛЬ»', heading: 'МИССИЯ: 04 КОМПЛЕКС «НУЛЬ»', thumb: 'loc_ep4', accent: 0x62e5ff, unlocked: () => run.episode4Unlocked },
      { id: 5, tab: '05 БАСТИОН', heading: 'МИССИЯ: 05 БАСТИОН «СЕВЕР»', thumb: 'loc_ep5', accent: 0x8ef2ff, unlocked: () => run.episode5Unlocked },
      { id: 6, tab: '06 МАЯК-13', heading: 'МИССИЯ: 06 ЯДРО «МАЯК-13» (ФИНАЛ)', thumb: 'loc_ep6', accent: 0xff7ce2, unlocked: () => run.episode6Unlocked },
    ];

    const stripPanel = this.add.graphics().setDepth(5);
    stripPanel.fillStyle(0x0c1320, 0.88).fillRect(88, 78, VIEW_W - 176, 66);
    stripPanel.lineStyle(1, 0x334760, 0.9).strokeRect(88, 78, VIEW_W - 176, 66);

    const heading = this.add.text(434, 130, chapters[0].heading, {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#ffd080',
    }).setOrigin(0.5).setDepth(10);

    const thumbBox = this.add.graphics().setDepth(6);
    let thumbImg: Phaser.GameObjects.Image | null = null;
    if (this.textures.exists('loc_ep1')) {
      thumbImg = this.add.image(VIEW_W - 134, 111, 'loc_ep1').setDisplaySize(78, 44).setDepth(7);
      thumbBox.lineStyle(1, 0x6eaec4, 0.8).strokeRect(VIEW_W - 174, 88, 80, 46);
    }

    const lockHint = this.add.text(434, 130, '', {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#ff857a',
      backgroundColor: '#1a0a10ee', padding: { x: 8, y: 2 },
    }).setOrigin(0.5).setDepth(11).setVisible(false);

    const chapterItems: Array<{ ch: ChapterDef; bg: Phaser.GameObjects.Graphics; txt: Phaser.GameObjects.Text }> = [];
    const chooseChapter = (id: EpisodeId) => {
      const ch = chapters.find(c => c.id === id)!;
      if (!ch.unlocked()) {
        SFX.play('hurt', 0.45);
        heading.setVisible(false);
        lockHint.setText(`ЗАКРЫТО: ПРОЙДИТЕ ЭПИЗОД ${id - 1}`).setVisible(true).setAlpha(1);
        this.tweens.killTweensOf(lockHint);
        this.tweens.add({
          targets: lockHint, alpha: 0, delay: 1400, duration: 300,
          onComplete: () => { lockHint.setVisible(false); heading.setVisible(true); },
        });
        return;
      }
      lockHint.setVisible(false);
      heading.setVisible(true);
      this.selectedEpisode = id;
      run.episode = id;
      SFX.play('ui_move');
      heading.setText(ch.heading).setColor('#ffd080');
      if (thumbImg && this.textures.exists(ch.thumb)) thumbImg.setTexture(ch.thumb).setDisplaySize(78, 44);
      chapterItems.forEach(({ ch: c, bg, txt }) => {
        const active = c.id === id;
        const ok = c.unlocked();
        const cx = 98 + (c.id - 1) * 113;
        bg.clear();
        bg.fillStyle(active ? 0x1d2d42 : 0x101826, 0.95).fillRect(cx, 84, 108, 28);
        bg.lineStyle(active ? 2 : 1, active ? c.accent : (ok ? 0x3b4f69 : 0x242c38), 1).strokeRect(cx, 84, 108, 28);
        txt.setColor(active ? '#ffe79e' : ok ? '#a2c9db' : '#556070');
      });
    };

    chapters.forEach((ch, idx) => {
      const cx = 98 + idx * 113;
      const bg = this.add.graphics().setDepth(8);
      const label = ch.unlocked() ? ch.tab : `${ch.tab} ×`;
      const txt = this.add.text(cx + 54, 98, label, {
        fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#a2c9db',
      }).setOrigin(0.5).setDepth(9).setInteractive({ useHandCursor: true });
      txt.on('pointerdown', () => chooseChapter(ch.id));
      chapterItems.push({ ch, bg, txt });
    });
    chooseChapter(1);

    // --- Hero Dossier Cards (y=156..406): REAL Portraits ON TOP of card + Live Animated Sprite! ---
    const defs = [
      {
        id: 'ignis' as const,
        name: 'ЛЕНА «ИСКРА» ВОЛКОВА',
        role: 'РАЗВЕДКА · МОБИЛЬНОСТЬ',
        stats: '+СКОРОСТЬ  ·  ДЛИННЫЙ ПЕРЕКАТ',
        statBars: [92, 68, 86],
        illus: 'illus_volkova',
        fallback: 'portrait_ignis',
        accent: 0xe65343,
        badge: '#ff8a70',
      },
      {
        id: 'volt' as const,
        name: 'МАКС «ГРОМ» ОРЛОВ',
        role: 'ШТУРМОВИК · ТЯЖЁЛОЕ ОРУЖИЕ',
        stats: 'СТАРТ: ПУЛЕМЁТ · +БРОНЯ · 5 ГРАНАТ',
        statBars: [72, 95, 92],
        illus: 'illus_orlov',
        fallback: 'portrait_volt',
        accent: 0x48b8d6,
        badge: '#7ee3fa',
      },
    ];

    defs.forEach((d, i) => {
      const x = VIEW_W / 2 + (i === 0 ? -206 : 206);
      const cy = 158;
      const w = 376, h = 246;

      // Outer chamfered card panel (depth 6)
      const box = this.add.graphics().setDepth(6);
      box.setInteractive(new Phaser.Geom.Rectangle(x - w / 2, cy, w, h), Phaser.Geom.Rectangle.Contains);
      box.on('pointerdown', () => { run.character = d.id; SFX.play('ui_move'); this.highlight(); });
      this.cards.push(box);

      // Portrait frame (depth 7-9 — GUARANTEED ABOVE panel box!)
      const frameX = x - w / 2 + 16;
      const frameY = cy + 16;
      const pf = this.add.graphics().setDepth(9);
      pf.lineStyle(2, d.accent, 0.95).strokeRect(frameX - 2, frameY - 2, 134, 152);
      this.artFrames[i] = pf;

      this.add.rectangle(frameX + 65, frameY + 74, 130, 148, 0x0a0f18, 1).setDepth(7);
      const artKey = this.textures.exists(d.illus) ? d.illus : (this.textures.exists(d.fallback) ? d.fallback : '');
      if (artKey) {
        const art = this.add.image(frameX + 65, frameY + 74, artKey).setDepth(8);
        const s = Math.min(130 / art.width, 148 / art.height);
        art.setScale(Math.max(130 / art.width, 148 / art.height)); // cover nicely inside crop mask
        // Crop/fit cleanly inside the 130x148 portrait box using displaySize
        if (d.illus === artKey) art.setDisplaySize(130, 148);
        else art.setScale(s);
      }

      // Live animated sprite beside stats (right column inside dossier!)
      this.add.ellipse(x + 128, cy + 166, 48, 10, 0x000000, 0.55).setDepth(7);
      const spr = this.add.sprite(x + 128, cy + 136, `p_${d.id}_idle`, 'f0')
        .setScale(1.45).setDepth(8);
      spr.play(`p_${d.id}_idle`);

      // Dossier typography & stat bars (depth 10)
      const tx = frameX + 146;
      this.add.text(tx, cy + 18, d.name, {
        fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: d.badge,
        wordWrap: { width: 204 },
      }).setDepth(10);
      this.add.text(tx, cy + 48, d.role, {
        fontFamily: 'monospace', fontSize: '10px', color: '#9ab0c4',
      }).setDepth(10);

      // Compact visual stat bars (СКОР / БРОН / МОЩЬ)
      const statNames = ['СКОР', 'БРОН', 'ОГНЬ'];
      statNames.forEach((sn, si) => {
        const sy = cy + 72 + si * 18;
        this.add.text(tx, sy, sn, { fontFamily: 'monospace', fontSize: '10px', color: '#8398ad' }).setDepth(10);
        const barG = this.add.graphics().setDepth(10);
        barG.fillStyle(0x142030, 1).fillRect(tx + 38, sy + 2, 92, 8);
        barG.fillStyle(d.accent, 0.92).fillRect(tx + 39, sy + 3, Math.round(90 * d.statBars[si] / 100), 6);
      });

      this.add.text(x, cy + h - 38, d.stats, {
        fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#f3d488',
        align: 'center',
      }).setOrigin(0.5).setDepth(10);

      // Active badge placeholder (managed via highlight redraw)
      this.add.text(x, cy + h - 16, i === 0 ? '[ A / ← ] РЫВОК И МАНЁВР' : '[ D / → ] ПУЛЕМЁТ И БРОНЯ', {
        fontFamily: 'monospace', fontSize: '10px', color: '#78899e',
      }).setOrigin(0.5).setDepth(10);
    });

    this.diffIdx = Math.max(0, this.diffs.indexOf(run.difficulty));
    this.highlight();

    // --- Difficulty Switcher + Prominent Tactical START CTA centered over (480, 472) ---
    this.diffText = this.add.text(VIEW_W / 2, 424, '', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffd984',
      backgroundColor: '#121b2add', padding: { x: 14, y: 5 },
    }).setOrigin(0.5).setDepth(11).setInteractive({ useHandCursor: true });

    const renderDiff = () => {
      const id = this.diffs[this.diffIdx];
      run.difficulty = id;
      const spec = DIFFICULTY[id];
      this.diffText.setText(`СЛОЖНОСТЬ: ${spec.name} [W/S] · ${spec.desc}`);
      this.diffText.setColor(id === 'hardcore' ? '#ff7d70' : id === 'rookie' ? '#95f5b2' : '#ffd984');
    };
    renderDiff();
    this.diffText.on('pointerdown', () => {
      this.diffIdx = (this.diffIdx + 1) % 3; SFX.play('ui_move'); renderDiff();
    });

    // Start CTA centered cleanly at (480, 472) — guarantees mobile smoke tap {x:480,y:472} & eye focus!
    const ctaBg = this.add.graphics().setDepth(10);
    const drawCta = (hot: boolean) => {
      ctaBg.clear();
      ctaBg.fillStyle(hot ? 0x245663 : 0x163844, 0.96).fillRect(VIEW_W / 2 - 190, 449, 380, 44);
      ctaBg.lineStyle(2, hot ? 0xffd268 : 0x5ee3d2, 1).strokeRect(VIEW_W / 2 - 190, 449, 380, 44);
      ctaBg.fillStyle(0xffc966, 1).fillRect(VIEW_W / 2 - 186, 453, 6, 36);
      ctaBg.fillStyle(0xffc966, 1).fillRect(VIEW_W / 2 + 180, 453, 6, 36);
    };
    drawCta(false);

    const startButton = this.add.text(VIEW_W / 2, 471, '▶   НАЧАТЬ ОПЕРАЦИЮ  [ENTER / J]', {
      fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#e6fff9',
    }).setOrigin(0.5).setDepth(12).setInteractive({ useHandCursor: true });
    startButton.on('pointerover', () => drawCta(true));
    startButton.on('pointerout', () => drawCta(false));
    startButton.on('pointerdown', () => this.start());
    this.tweens.add({ targets: startButton, scale: { from: 1, to: 1.03 }, duration: 750, yoyo: true, repeat: -1 });

    // Footer tactical legend
    this.add.text(VIEW_W / 2, 514, 'УПРАВЛЕНИЕ: A/D ХОД · W/S/Q ПРИЦЕЛ · SPACE ПРЫЖОК · J/ЛКМ ОГОНЬ · K ГРАНАТА · L ПЕРЕКАТ · E ДЕЙСТВИЕ', {
      fontFamily: 'monospace', fontSize: '9.5px', color: '#8da1b8',
    }).setOrigin(0.5).setDepth(10);

    const K = this.input.keyboard!;
    K.on('keydown-W', () => { this.diffIdx = (this.diffIdx + 2) % 3; SFX.play('ui_move'); renderDiff(); });
    K.on('keydown-S', () => { this.diffIdx = (this.diffIdx + 1) % 3; SFX.play('ui_move'); renderDiff(); });
    K.on('keydown-UP', () => { this.diffIdx = (this.diffIdx + 2) % 3; SFX.play('ui_move'); renderDiff(); });
    K.on('keydown-DOWN', () => { this.diffIdx = (this.diffIdx + 1) % 3; SFX.play('ui_move'); renderDiff(); });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) return;
      if (p.y > 445) { this.start(); return; }
      const want = p.x < VIEW_W / 2 ? 'ignis' : 'volt';
      if (run.character !== want) { run.character = want; SFX.play('ui_move'); this.highlight(); }
    });
    K.on('keydown', () => { unlockAudio(); MUSIC.play('menu'); });
    this.input.on('pointerdown', () => { unlockAudio(); MUSIC.play('menu'); });
    K.on('keydown-A', () => this.move(-1));
    K.on('keydown-D', () => this.move(1));
    K.on('keydown-LEFT', () => this.move(-1));
    K.on('keydown-RIGHT', () => this.move(1));
    K.on('keydown-ENTER', () => this.start());
    K.on('keydown-J', () => this.start());
    K.on('keydown-SPACE', () => this.start());
    K.on('keydown-ONE', () => chooseChapter(1));
    K.on('keydown-TWO', () => chooseChapter(2));
    K.on('keydown-THREE', () => chooseChapter(3));
    K.on('keydown-FOUR', () => chooseChapter(4));
    K.on('keydown-FIVE', () => chooseChapter(5));
    K.on('keydown-SIX', () => chooseChapter(6));
    K.on('keydown-R', () => { window.location.reload(); });
  }

  private move(dir: -1 | 1) {
    SFX.play('ui_move');
    run.character = dir < 0 ? 'ignis' : 'volt';
    this.highlight();
  }

  private highlight() {
    this.cards.forEach((box, i) => {
      const sel = (i === 0 && run.character === 'ignis') || (i === 1 && run.character === 'volt');
      const x = VIEW_W / 2 + (i === 0 ? -206 : 206);
      const cy = 158, w = 376, h = 246;
      const accent = i === 0 ? 0xe65343 : 0x48b8d6;
      box.clear();
      box.fillStyle(sel ? 0x162235 : 0x0f1623, 0.94).fillRect(x - w / 2, cy, w, h);
      box.lineStyle(sel ? 3 : 1, sel ? 0xffd25a : 0x35465d, 1).strokeRect(x - w / 2, cy, w, h);
      box.fillStyle(accent, sel ? 0.95 : 0.45).fillRect(x - w / 2 + 2, cy + 2, w - 4, 4);
      this.artFrames[i]?.setAlpha(sel ? 1 : 0.6);
    });
  }

  private showFatal(msg: string) {
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2, 740, 120, 0x26080b, 0.95)
      .setStrokeStyle(2, 0xff5a5a).setDepth(500);
    this.add.text(VIEW_W / 2, VIEW_H / 2, `ОШИБКА ЗАПУСКА УРОВНЯ:\n${msg}`, {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffe5e5', align: 'center', wordWrap: { width: 700 },
    }).setOrigin(0.5).setDepth(501);
  }

  private start(episode: EpisodeId = this.selectedEpisode) {
    if (episode === 2 && !run.episode2Unlocked) return;
    if (episode === 3 && !run.episode3Unlocked) return;
    if (episode === 4 && !run.episode4Unlocked) return;
    if (episode === 5 && !run.episode5Unlocked) return;
    if (episode === 6 && !run.episode6Unlocked) return;
    if (this.time.now - this.startAt < 500) return;
    if (this.starting) return;
    this.starting = true;
    SFX.play('ui_start');
    try { unlockAudio(); MUSIC.play('level'); } catch { /* audio optional */ }
    resetOnlineCampaign();
    run.score = 0; run.missionStartScore = 0;
    run.lives = DIFFICULTY[run.difficulty].lives;
    run.episode = episode;
    run.intel = 0;
    saveRunPrefs();
    (window as any).__RS_FATAL__ = undefined;
    const target = episode === 6 ? 'Beacon'
      : episode === 5 ? 'Bastion'
        : episode === 4 ? 'Facility'
          : episode === 3 ? 'Jungle'
            : episode === 2 ? 'Train'
              : 'Level';
    try {
      this.scene.start(target);
    } catch (e: any) {
      this.showFatal(String(e?.message ?? e));
      return;
    }
    this.time.delayedCall(1200, () => {
      const lvl = (this.scene as any).getScene?.(target);
      const running = lvl?.scene?.isActive?.() || lvl?.scene?.isPaused?.();
      if (!running) {
        this.scene.restart();
        const msg = (window as any).__RS_FATAL__ || 'Сцена уровня не запустилась (см. консоль браузера — F12).';
        this.time.delayedCall(100, () => this.showFatal(msg));
      }
    });
  }
}
