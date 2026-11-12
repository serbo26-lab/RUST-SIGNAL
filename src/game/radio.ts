import Phaser from 'phaser';
import { SFX } from './audio';

/**
 * Tactical Radio Comms Module — displays compact framed character/HQ transmissions
 * clear of both the HUD decks and the combat/platform zone.
 */
type Speaker = 'weiss' | 'boatswain' | 'ignis' | 'volt' | 'rubin' | 'signal';

const COLORS: Record<Speaker, string> = {
  weiss: '#7fd4e8',
  boatswain: '#ffd24a',
  ignis: '#ff8a5c',
  volt: '#b8e0a0',
  rubin: '#ff4f6d',
  signal: '#ff4fd8',
};

const HEX: Record<Speaker, number> = {
  weiss: 0x62cfe6,
  boatswain: 0xffcb52,
  ignis: 0xe65b45,
  volt: 0x7fd89e,
  rubin: 0xe84862,
  signal: 0xe852c8,
};

const NAMES: Record<Speaker, string> = {
  weiss: 'Д-Р ВЕЙС',
  boatswain: 'БОЦМАН',
  ignis: 'ИСКРА',
  volt: 'ГРОМ',
  rubin: 'ПОЛКОВНИК РУБИН',
  signal: 'СИГНАЛ',
};

const SIGILS: Record<Speaker, string> = {
  weiss: '⚕',
  boatswain: '⚓',
  ignis: '⚡',
  volt: '★',
  rubin: '◈',
  signal: '⚠',
};

interface Line { who: Speaker; text: string; }

const LINES: Record<string, Line[]> = {
  intro: [
    { who: 'weiss', text: '«Маяк-13» замолчал три дня назад. Последний сигнал: «Не подходите к острову».' },
    { who: 'boatswain', text: 'Движок у «Касатки» чинили на скорую руку перед вылетом. Лишь бы дотянул до берега.' },
  ],
  landing: [
    { who: 'ignis', text: 'На причалах ни души. Не нравится мне такая тишина.' },
    { who: 'volt', text: 'В порту глухо. Или здесь уже кто-то поработал, или все залегли на дно.' },
  ],
  friendly_fire: [
    { who: 'weiss', text: 'Смотри: охрана палит друг в друга. Похоже, сигнал сбил им систему «свой-чужой».' },
    { who: 'signal', text: '...ПРИЧАЛ В РЕЖИМЕ БЛОКИРОВКИ... ПЕРСОНАЛ СПИСАН...' },
  ],
  reinforce: [{ who: 'boatswain', text: 'Сзади бегут свежие! Офицер успел подтянуть людей с баржи, прикрыть тебя сверху нечем.' }],
  tank_found: [
    { who: 'volt', text: 'На пирсе брошен броневик РС-7 «Кувалда». Заведён и почти целый, забираем!' },
    { who: 'boatswain', text: 'Только не сожги его на первом же перекрёстке.' },
  ],
  machine_capture: [{ who: 'ignis', text: 'Водитель выскочил из горящей машины и тут же нырнул в соседнюю. Упрямый чёрт.' }],
  signal_event_1: [
    { who: 'signal', text: '...РЖАВЫЙ СИГНАЛ... СТАЛЬ ПОМНИТ... МЕХАНИЗМЫ ПРОБУЖДЕНЫ...' },
    { who: 'ignis', text: 'Эта жестянка только что встала на лапы?!' },
  ],
  boss_intro: [
    { who: 'rubin', text: 'А, спасатели пожаловали. Кран «Маяк-6» теперь мой. Убирайтесь, пока не раздавило!' },
    { who: 'weiss', text: 'Рубин завёл сигнал прямо на привод крана. Берегись, машина сама ловит темп боя!' },
  ],
  weiss_phase2: [
    { who: 'weiss', text: 'Кожух слетел, кабина дымит! Бей прямо в генератор наверху!' },
    { who: 'boatswain', text: 'Стропы оборвало! Смотри наверх, там контейнеры сыплются!' },
  ],
  boss_dead: [
    { who: 'ignis', text: 'Это был только ретранслятор. Основной сигнал тянет по ветке вглубь острова.' },
    { who: 'rubin', text: 'Идиоты... Кран держал нижний периметр, теперь вы сами туда полезли.' },
    { who: 'signal', text: '...ПЕРЕДАТЧИК УТРАЧЕН... ЛИНИЯ 2 ОТКРЫТА...' },
  ],
  boatswain_tank: [{ who: 'boatswain', text: 'Вижу тебя в «Кувалде»! Только по вертушке случайно не засади.' }],
  boatswain_sad: [{ who: 'boatswain', text: 'Добили броневик... Выбирайся, дальше идёшь пешком.' }],
  hurt: [
    { who: 'ignis', text: 'Зацепило... Броник выдержал, но рёбра гудят.' },
    { who: 'volt', text: 'Вскользь прошло. Двигай дальше, не застывай на линии.' },
  ],
  death: [{ who: 'boatswain', text: 'Держись, снижаюсь! Вытаскиваю на тросе, пригни голову!' }],
  ep5_intro: [
    { who: 'weiss', text: 'След из «Нуля» ушёл на полярный пост «Север». Рубин забрал ключи и заперся в цитадели.' },
    { who: 'boatswain', text: 'На дворе минус сорок, радар забивает помехой. Не зевай на обледенелых трапах.' },
  ],
  ep5_heaters: [
    { who: 'ignis', text: 'Минус одна печка! Обогрев сбит, давление в щитах шагохода сразу упало.' },
    { who: 'weiss', text: 'Так держать! На морозе их броня быстро пойдёт трещинами.' },
  ],
  ep5_boss: [
    { who: 'rubin', text: '«Цитадель-9» на ходу! До «Маяка-13» вы не доползёте, останетесь здесь под снегом.' },
    { who: 'weiss', text: 'Сбивай крио-ракеты ещё в воздухе и бей по красным реле на корпусе!' },
  ],
  ep5_dead: [
    { who: 'rubin', text: 'Шагоход встал... Но вы опоздали, под станцией уже проснулся главный ствол...' },
    { who: 'weiss', text: 'Шахта прямо под нами! Спускаемся к фундаменту «Маяка-13».' },
  ],
  ep6_intro: [
    { who: 'boatswain', text: 'Мы под самым шпилем. Стрелка компаса крутится без толку, сигнал фонит сквозь переборки.' },
    { who: 'weiss', text: 'Впереди Пра-передатчик «Альфа-13». По пути выруби три узла питания, иначе купол не пробить.' },
  ],
  ep6_anchor: [
    { who: 'ignis', text: 'Готово, узел обесточен! Пол под ногами загудел.' },
    { who: 'signal', text: '...ПЕРЕПАД ФАЗЫ... ПЕРЕКЛЮЧЕНИЕ НА РЕЗЕРВ...' },
  ],
  ep6_boss: [
    { who: 'signal', text: '...ПЕРЕДАЧА УСТАНОВЛЕНА... ВМЕШАТЕЛЬСТВО БУДЕТ ПОДАВЛЕНО...' },
    { who: 'volt', text: 'Ну всё, остался главный рубильник. Срезаем пилоны и вырубаем эту шарманку!' },
  ],
  campaign_finale: [
    { who: 'signal', text: '...НЕСУЩАЯ ПОГАШЕНА... СВЯЗЬ ПРЕРВАНА...' },
    { who: 'weiss', text: '«Альфа-13» заглохла! Вышки по всему острову гаснут одна за другой.' },
    { who: 'boatswain', text: 'Небо над гаванью прояснилось! Сажаю «Касатку» на площадку, забираю обоих домой!' },
  ],
};

const PANEL_X = 180;
const PANEL_W = 600;
const PANEL_H = 50;
const RADIO_Y = 66; // sits cleanly below top-left & top-right HUD decks

export class RadioSystem {
  scene: any;
  public strip: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private portraitImg: Phaser.GameObjects.Image | null = null;
  private sigilText: Phaser.GameObjects.Text;
  private eqBars: Phaser.GameObjects.Rectangle[] = [];
  private txtName: Phaser.GameObjects.Text;
  private txtBody: Phaser.GameObjects.Text;
  private queue: Line[] = [];
  private busy = false;
  private killCounts: Record<string, number> = {};
  private heavyQuip = false;

  constructor(scene: any) {
    this.scene = scene;
    this.bg = scene.add.graphics();
    this.drawFrame('weiss');

    const children: Phaser.GameObjects.GameObject[] = [this.bg];

    // Portrait thumbnail slot inside left of comms box
    if (scene.textures.exists('illus_volkova')) {
      const pImg = scene.add.image(25, 25, 'illus_volkova')
        .setDisplaySize(38, 38).setVisible(false);
      this.portraitImg = pImg;
      children.push(pImg);
    }
    this.sigilText = scene.add.text(25, 25, '⚕', {
      fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#7fd4e8',
    }).setOrigin(0.5);
    children.push(this.sigilText);

    // Animated equalizer bars on right of header
    for (let i = 0; i < 4; i++) {
      const b = scene.add.rectangle(PANEL_W - 28 + i * 5, 16, 3, 8, 0x7fd4e8, 0.85).setOrigin(0.5, 1);
      this.eqBars.push(b);
      children.push(b);
    }

    this.txtName = scene.add.text(54, 6, '', {
      fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#fff',
    }).setOrigin(0, 0);
    this.txtBody = scene.add.text(54, 21, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#e6eff8',
      wordWrap: { width: PANEL_W - 76 }, lineSpacing: 1,
    }).setOrigin(0, 0);
    children.push(this.txtName, this.txtBody);

    this.strip = scene.add.container(PANEL_X, RADIO_Y, children)
      .setDepth(890).setScrollFactor(0).setAlpha(0);
  }

  private drawFrame(who: Speaker) {
    const ac = HEX[who] ?? 0x62cfe6;
    this.bg.clear();
    this.bg.fillStyle(0x0a101b, 0.92).fillRect(0, 0, PANEL_W, PANEL_H);
    this.bg.lineStyle(2, ac, 0.9).strokeRect(0, 0, PANEL_W, PANEL_H);
    this.bg.fillStyle(ac, 0.95).fillRect(0, 0, 4, PANEL_H);
    // Portrait cell frame
    this.bg.fillStyle(0x121d2d, 1).fillRect(6, 6, 38, 38);
    this.bg.lineStyle(1, ac, 0.75).strokeRect(6, 6, 38, 38);
  }

  say(key: string) {
    const lines = LINES[key];
    if (!lines) return;
    for (const l of lines) this.queue.push(l);
    this.pump();
  }

  onKill(kind: string) {
    this.killCounts[kind] = (this.killCounts[kind] || 0) + 1;
    if (kind === 'rifle' && this.killCounts['rifle'] === 8) {
      this.sayLine({ who: this.scene.player?.charId ?? 'ignis', text: 'Восемь легло. Похоже, дальше пойдут ребята покрупнее.' });
    }
    if (kind === 'heavy' && !this.heavyQuip) {
      this.heavyQuip = true;
      this.sayLine({ who: 'volt', text: 'Пулемётчик тяжёлый, зато вертится медленно. Заходи за спину!' });
    }
  }

  private pump() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const line = this.queue.shift()!;
    this.sayLine(line, () => {
      this.busy = false;
      this.scene.time.delayedCall(260, () => this.pump());
    });
  }

  private sayLine(line: Line, done?: () => void) {
    SFX.play('radio');
    this.drawFrame(line.who);
    const colHex = HEX[line.who];
    this.txtName.setText(`${NAMES[line.who]}`).setColor(COLORS[line.who]);
    this.txtBody.setText('');

    if (this.portraitImg && (line.who === 'ignis' || line.who === 'volt')) {
      const pKey = line.who === 'ignis' ? 'illus_volkova' : 'illus_orlov';
      if (this.scene.textures.exists(pKey)) {
        this.portraitImg.setTexture(pKey).setDisplaySize(36, 36).setVisible(true);
        this.sigilText.setVisible(false);
      } else {
        this.portraitImg.setVisible(false);
        this.sigilText.setText(SIGILS[line.who]).setColor(COLORS[line.who]).setVisible(true);
      }
    } else {
      this.portraitImg?.setVisible(false);
      this.sigilText.setText(SIGILS[line.who]).setColor(COLORS[line.who]).setVisible(true);
    }

    this.eqBars.forEach(b => b.setFillStyle(colHex, 0.9));

    this.scene.tweens.killTweensOf(this.strip);
    this.strip.y = RADIO_Y - 10;
    this.scene.tweens.add({
      targets: this.strip, alpha: 1, y: RADIO_Y, duration: 150,
      onComplete: () => {
        let i = 0;
        const iv = this.scene.time.addEvent({
          delay: 14, loop: true, callback: () => {
            i++;
            this.txtBody.setText(line.text.slice(0, i));
            // Animate equalizer waveform while speaking
            this.eqBars.forEach((b, bi) => {
              b.height = 4 + ((i * 5 + bi * 3) % 10);
            });
            if (i >= line.text.length) {
              iv.remove();
              this.eqBars.forEach(b => (b.height = 3));
              this.scene.time.delayedCall(2200, () => {
                this.scene.tweens.add({
                  targets: this.strip, alpha: 0, y: RADIO_Y - 12, duration: 180,
                  onComplete: () => done?.(),
                });
              });
            }
          },
        });
      },
    });
  }
}
