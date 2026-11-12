import Phaser from 'phaser';
import { VIEW_W, run, WEAPONS, diff, DIFFICULTY, WeaponId } from '../game/core';
import { isAudioMuted, toggleAudioMute, SFX } from '../game/audio';

const WEAP_TEX: Record<WeaponId, string> = {
  pistol: 'weap_pistol',
  mg: 'weap_mg',
  shotgun: 'weap_shotgun',
  laser: 'weap_laser',
};

const BOSS_NAMES: Record<string, string> = {
  Level: 'КРАН «МАЯК-6»',
  Train: 'БРОНЕПОЕЗД №7',
  Jungle: 'СЕРДЦЕ ДЖУНГЛЕЙ',
  Facility: 'РЕАКТОР «НУЛЬ»',
  Bastion: 'ШАГОХОД «ЦИТАДЕЛЬ-9»',
  Beacon: 'ПРА-ПЕРЕДАТЧИК «АЛЬФА-13»',
};

/** Tactical Neo-Retro Arcade HUD: hero badge, armor pips, score, weapon deck, mute & dramatic boss bar. */
export class Hud {
  scene: Phaser.Scene;
  private livesPips: Phaser.GameObjects.Rectangle[] = [];
  private scoreTxt!: Phaser.GameObjects.Text;
  private bestTxt!: Phaser.GameObjects.Text;
  private weapTxt!: Phaser.GameObjects.Text;
  private ammoBar!: Phaser.GameObjects.Rectangle;
  private ammoBg!: Phaser.GameObjects.Rectangle;
  private weapIcon!: Phaser.GameObjects.Image | null;
  private grenTxt!: Phaser.GameObjects.Text;
  private tankBar!: Phaser.GameObjects.Rectangle;
  private tankBg!: Phaser.GameObjects.Rectangle;
  private tankTxt!: Phaser.GameObjects.Text;
  private muteTxt!: Phaser.GameObjects.Text;

  private bossPanel!: Phaser.GameObjects.Container;
  private bossBar!: Phaser.GameObjects.Rectangle;
  private bossBarBg!: Phaser.GameObjects.Rectangle;
  private bossLabel!: Phaser.GameObjects.Text;

  private bannerBox!: Phaser.GameObjects.Container;
  private bannerTxt!: Phaser.GameObjects.Text;
  private toastTxt!: Phaser.GameObjects.Text;
  private lastWeapon: WeaponId = 'pistol';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const isIgnis = run.character === 'ignis';
    const accent = isIgnis ? 0xe65343 : 0x48b8d6;

    // --- Top-Left Tactical Vitals Deck (x:10..274, y:8..58) ---
    const leftG = scene.add.graphics().setScrollFactor(0).setDepth(900);
    leftG.fillStyle(0x0a101b, 0.88).fillRect(10, 8, 266, 50);
    leftG.lineStyle(1, 0x32465f, 0.95).strokeRect(10, 8, 266, 50);
    leftG.fillStyle(accent, 0.95).fillRect(10, 8, 4, 50);

    // Hero micro-portrait icon
    const pKey = isIgnis ? 'illus_volkova' : 'illus_orlov';
    if (scene.textures.exists(pKey)) {
      scene.add.image(33, 33, pKey).setDisplaySize(38, 40).setScrollFactor(0).setDepth(901);
      leftG.lineStyle(1, accent, 0.85).strokeRect(14, 13, 38, 40);
    }

    // Hero callsign & score
    const badge = isIgnis ? 'ИСКРА' : 'ГРОМ';
    scene.add.text(58, 12, `${badge} · ${DIFFICULTY[run.difficulty].name}`, {
      fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: isIgnis ? '#ff947a' : '#7ee3fa',
    }).setScrollFactor(0).setDepth(901);

    // 5 armor heart/cell pips + grenades readout
    for (let i = 0; i < 5; i++) {
      const pip = scene.add.rectangle(64 + i * 16, 33, 12, 10, 0xe84855, 1)
        .setStrokeStyle(1, 0x0c0e14).setScrollFactor(0).setDepth(902);
      this.livesPips.push(pip);
    }

    this.grenTxt = scene.add.text(144, 28, 'ГР×3', {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#ffd468',
    }).setScrollFactor(0).setDepth(901);

    this.scoreTxt = scene.add.text(184, 12, '000000', {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#ffe594',
    }).setScrollFactor(0).setDepth(901);
    this.bestTxt = scene.add.text(184, 30, `РЕК ${run.best}`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#8ba4ba',
    }).setScrollFactor(0).setDepth(901);

    // Tank shield sub-gauge below top-left deck (only visible while driving tank)
    this.tankBg = scene.add.rectangle(10, 62, 148, 8, 0x101722, 0.9)
      .setOrigin(0).setStrokeStyle(1, 0x5c7a62).setScrollFactor(0).setDepth(901).setVisible(false);
    this.tankBar = scene.add.rectangle(11, 63, 146, 6, 0x99d96e, 1)
      .setOrigin(0).setScrollFactor(0).setDepth(902).setVisible(false);
    this.tankTxt = scene.add.text(162, 59, 'РС-7', {
      fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#99d96e',
    }).setScrollFactor(0).setDepth(901).setVisible(false);

    // --- Top-Right Weapon & System Deck (x:706..950, y:8..58) ---
    const rightG = scene.add.graphics().setScrollFactor(0).setDepth(900);
    rightG.fillStyle(0x0a101b, 0.88).fillRect(VIEW_W - 254, 8, 244, 50);
    rightG.lineStyle(1, 0x32465f, 0.95).strokeRect(VIEW_W - 254, 8, 244, 50);
    rightG.fillStyle(0x5ee3d2, 0.95).fillRect(VIEW_W - 14, 8, 4, 50);

    this.weapIcon = scene.textures.exists('weap_pistol')
      ? scene.add.image(VIEW_W - 222, 33, 'weap_pistol').setDisplaySize(50, 34).setScrollFactor(0).setDepth(901)
      : null;
    if (this.weapIcon) rightG.lineStyle(1, 0x3b5470, 0.9).strokeRect(VIEW_W - 248, 15, 52, 36);

    this.weapTxt = scene.add.text(VIEW_W - 190, 12, 'ПИСТОЛЕТ  ∞', {
      fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#9cf5ff',
    }).setScrollFactor(0).setDepth(901);

    this.ammoBg = scene.add.rectangle(VIEW_W - 190, 32, 166, 7, 0x162232, 1)
      .setOrigin(0).setStrokeStyle(1, 0x2c425e).setScrollFactor(0).setDepth(901);
    this.ammoBar = scene.add.rectangle(VIEW_W - 189, 33, 164, 5, 0x56e0ec, 1)
      .setOrigin(0).setScrollFactor(0).setDepth(902);

    this.muteTxt = scene.add.text(VIEW_W - 190, 42, isAudioMuted() ? '[M] ЗВУК: ВЫКЛ' : '[M] ЗВУК · [ESC] ПАУЗА', {
      fontFamily: 'monospace', fontSize: '9px', color: '#8ba2b8',
    }).setScrollFactor(0).setDepth(902).setInteractive({ useHandCursor: true });
    this.muteTxt.on('pointerdown', () => this.toggleMute());

    scene.input.keyboard?.on('keydown-M', () => this.toggleMute());

    // --- Top-Center Boss Health Bar (x: center, y: 12..46) ---
    const bw = 380;
    const bBg = scene.add.graphics();
    bBg.fillStyle(0x160a0e, 0.94).fillRect(-bw / 2, 0, bw, 32);
    bBg.lineStyle(2, 0xe84855, 1).strokeRect(-bw / 2, 0, bw, 32);
    const bossTitle = BOSS_NAMES[scene.scene.key] ?? 'БОСС';
    this.bossLabel = scene.add.text(0, 7, bossTitle, {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#ffd080',
    }).setOrigin(0.5);
    this.bossBarBg = scene.add.rectangle(-bw / 2 + 10, 18, bw - 20, 9, 0x2c1118, 1).setOrigin(0);
    this.bossBar = scene.add.rectangle(-bw / 2 + 10, 18, bw - 20, 9, 0xe84448, 1).setOrigin(0);
    const midTick = scene.add.rectangle(0, 22.5, 2, 11, 0xffe48b, 0.95);
    this.bossPanel = scene.add.container(VIEW_W / 2, 10, [bBg, this.bossLabel, this.bossBarBg, this.bossBar, midTick])
      .setScrollFactor(0).setDepth(905).setVisible(false);

    // --- Tactical Center-Top Mission Banner + Sub-Toast ---
    const bnBg = scene.add.rectangle(0, 0, 520, 42, 0x0b1220, 0.92).setStrokeStyle(2, 0xffca68);
    this.bannerTxt = scene.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ffd878',
      stroke: '#160906', strokeThickness: 3,
    }).setOrigin(0.5);
    this.bannerBox = scene.add.container(VIEW_W / 2, 146, [bnBg, this.bannerTxt])
      .setScrollFactor(0).setDepth(910).setAlpha(0);

    this.toastTxt = scene.add.text(VIEW_W / 2, 184, '', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#8ef5ff',
      backgroundColor: '#0c1522dd', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(910).setAlpha(0);

    void diff;
  }

  private toggleMute() {
    const m = toggleAudioMute();
    this.muteTxt.setText(m ? '[M] ЗВУК: ВЫКЛ' : '[M] ЗВУК · [ESC] ПАУЗА');
    this.toast(m ? 'ЗВУК ВЫКЛЮЧЕН' : 'ЗВУК ВКЛЮЧЕН', 900);
    if (!m) SFX.play('ui_move', 0.6);
  }

  refresh(score: number) {
    this.scoreTxt.setText(String(score).padStart(6, '0'));
  }

  update(_time: number, player: any, tank: any) {
    for (let i = 0; i < this.livesPips.length; i++) {
      const pip = this.livesPips[i];
      if (i < run.lives) {
        pip.setFillStyle(run.lives <= 1 ? 0xff4b4b : 0xf05252, 1).setAlpha(1);
      } else {
        pip.setFillStyle(0x1f2836, 0.7).setAlpha(0.5);
      }
    }
    this.scoreTxt.setText(String(run.score).padStart(6, '0'));
    this.bestTxt.setText(`РЕК ${Math.max(run.best, run.score)}`);

    const wId = (player?.weapon ?? 'pistol') as WeaponId;
    const w = WEAPONS[wId] ?? WEAPONS.pistol;
    const ammoStr = wId === 'pistol' ? '∞' : `${player?.ammo ?? 0}`;
    this.weapTxt.setText(`${w.name}  ${ammoStr}`);

    if (wId !== this.lastWeapon) {
      this.lastWeapon = wId;
      if (this.weapIcon && this.scene.textures.exists(WEAP_TEX[wId])) {
        this.weapIcon.setTexture(WEAP_TEX[wId]).setDisplaySize(50, 34);
      }
    }
    const frac = wId === 'pistol' || w.ammoMax <= 0 ? 1 : Phaser.Math.Clamp((player?.ammo ?? 0) / w.ammoMax, 0, 1);
    this.ammoBar.width = Math.max(2, 164 * frac);
    this.ammoBar.setFillStyle(wId === 'laser' ? 0x62f2ff : wId === 'shotgun' ? 0xffb852 : wId === 'mg' ? 0xffde6a : 0x7fd4e8);
    this.grenTxt.setText(`ГР×${player?.grenades ?? 0}`);

    const showT = !!tank?.active;
    this.tankBg.setVisible(showT);
    this.tankBar.setVisible(showT);
    this.tankTxt.setVisible(showT);
    if (showT) {
      const cur = Math.max(0, Math.ceil(tank.hp ?? 0));
      const maxHp = Math.max(1, tank.hpMax ?? 1);
      const tf = Phaser.Math.Clamp(cur / maxHp, 0, 1);
      this.tankBar.width = Math.max(2, 146 * tf);
      const crit = tf <= 0.35;
      this.tankBar.setFillStyle(tf > 0.5 ? 0x99d96e : tf > 0.35 ? 0xffbf4d : 0xff5447);
      this.tankTxt
        .setText(crit ? `РС-7 ${cur}/${maxHp} ⚠ [E]` : `РС-7 ${cur}/${maxHp}`)
        .setColor(crit ? '#ff7c6e' : '#99d96e');
    }

    // Update live Boss HP smoothly whenever bossPanel is shown
    if (this.bossPanel.visible) {
      const boss = (this.scene as any).boss;
      if (boss && !boss.dead) {
        const bf = Phaser.Math.Clamp((boss.hp ?? 0) / Math.max(1, boss.hpMax ?? 1), 0, 1);
        this.bossBar.width = Math.max(2, 360 * bf);
        this.bossBar.setFillStyle(boss.phase >= 2 ? 0xff4fd8 : 0xe84448);
      } else {
        this.bossBar.width = 0;
      }
    }
  }

  showBoss(on: boolean) {
    this.bossPanel.setVisible(on);
  }

  flashWeapon(name: string) {
    this.weapTxt.setColor('#ffe488');
    this.scene.time.delayedCall(250, () => {
      if (this.weapTxt.active) this.weapTxt.setColor('#9cf5ff');
    });
    const msg = /КОНЧИЛ|ПУСТ|ВЫШЛ/.test(name) ? name : `ВЗЯТО: ${name}`;
    this.toast(msg, 1600);
  }

  toast(text: string, dur = 1800) {
    this.scene.tweens.killTweensOf(this.toastTxt);
    this.toastTxt.setText(text).setAlpha(1);
    if (dur > 9000) return; // indefinite pause toast
    this.scene.tweens.add({ targets: this.toastTxt, alpha: 0, delay: dur, duration: 350 });
  }

  banner(text: string) {
    this.scene.tweens.killTweensOf(this.bannerBox);
    this.bannerTxt.setText(text);
    this.bannerBox.setAlpha(0).setScale(0.92);
    this.scene.tweens.add({
      targets: this.bannerBox, alpha: 1, scale: 1, duration: 220, ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({ targets: this.bannerBox, alpha: 0, delay: 1900, duration: 420 });
      },
    });
  }

  warnMarker(worldX: number) {
    const cam = this.scene.cameras.main;
    const onLeft = worldX < cam.scrollX + cam.width / 2;
    const sx = onLeft ? 26 : VIEW_W - 26;
    const t = this.scene.add.text(sx, 260, onLeft ? '◀ !' : '! ▶', {
      fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ff5252',
      backgroundColor: '#1a0608cc', padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(920);
    this.scene.tweens.add({
      targets: t, alpha: { from: 1, to: 0.2 }, scale: { from: 1, to: 1.18 },
      yoyo: true, repeat: 3, duration: 150, onComplete: () => t.destroy(),
    });
  }
}

export function ensureWarnTexture(scene: Phaser.Scene) {
  if (scene.textures.exists('warn_arrow')) return;
  const t = scene.textures.createCanvas('warn_arrow', 28, 28)!;
  const c = t.getContext();
  c.fillStyle = '#ff5252';
  c.beginPath(); c.moveTo(14, 2); c.lineTo(26, 25); c.lineTo(2, 25); c.closePath(); c.fill();
  c.fillStyle = '#12080a'; c.fillRect(12, 9, 4, 9); c.fillRect(12, 20, 4, 3);
  t.refresh();
}
