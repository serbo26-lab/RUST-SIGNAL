import Phaser from 'phaser';
import { beginOnlineRun } from './online-leaderboard';
import {
  VIEW_W, VIEW_H, WORLD_W, GROUND_Y, GRAVITY, run, diff,
  addScaledScore, finalizeEpisodeVictory, recordBest, unlockEpisode5, rand, shake,
} from './core';
import { makePlayerTextures, makeEnemyTextures, makeFxTextures, makeTankTextures } from './sprites';
import { makeMachineTextures, Machine, PropsSystem, FxSystem } from './props';
import { PickupManager } from './pickups';
import { FacilityBackdrop, makeFacilityArt } from './facility-art';
import { FacilityCore } from './facility-boss';
import { StageTraversal } from './traversal';
import { Player } from './player';
import { WeaponsSystem } from './weapons';
import { markSolidPlatform, markGround, safeEnemySpawnX, findClearGroundX, findSafeRespawnPoint, makeBallisticCover, lockBossArena, confineHeroToArena } from './world-rules';
import { Enemy, type EnemyKind, damageEnemy } from './enemies';
import { TankSystem } from './boss';
import { Hud, ensureWarnTexture } from '../ui/hud';
import { SFX, MUSIC } from './audio';
import { touch, tapEdge } from '../ui/touch';

interface FacilityBeat { x: number; fired: boolean; action: () => void }

/**
 * EPISODE 2 — ARMORED TRAIN NO. 7.
 * New level, new chase / visual palette / stage events / original train boss.
 * Shares controls, equipment, remastered actors and scoring with episode one.
 */
export class FacilityScene extends Phaser.Scene {
  player!: Player;
  weapons!: WeaponsSystem;
  fx!: FxSystem;
  props!: PropsSystem;
  hud!: Hud;
  enemies!: Phaser.Physics.Arcade.Group;
  machines: Machine[] = [];
  machineGrp!: Phaser.Physics.Arcade.Group;
  tankSys!: TankSystem;
  boss: FacilityCore | null = null;
  finished = false;
  paused = false;
  private backdrop!: FacilityBackdrop;
  private follow!: Phaser.GameObjects.Zone;
  traversal!: StageTraversal;
  pickupSys!: PickupManager;
  private beats: FacilityBeat[] = [];
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  bossEntered = false;
  terminalsHacked = 0;
  laserWarnings = 0;
  securityWaves = 0;
  private activeMs = 0;
  terminals!: Phaser.Physics.Arcade.Group;
  accessGate!: Phaser.GameObjects.Image;
  gateBody!: Phaser.Physics.Arcade.StaticBody;

  constructor() { super('Facility'); }

  create() {
    try { this.createStage(); }
    catch (error: any) {
      (window as any).__RS_FATAL__ = String(error?.stack ?? error).slice(0, 800);
      console.error('[RUST SIGNAL] FacilityScene create failed:', error);
      throw error;
    }
  }

  private createStage() {
    run.episode = 4;
    beginOnlineRun({ episode: 4, difficulty: run.difficulty, character: run.character });
    this.terminalsHacked = 0;
    this.activeMs = 0;
    this.registry.set('terminalsHacked', 0);
    this.registry.set('episode', 4);
    this.registry.set('gameover', false);
    this.registry.set('scoreBreakdown', null);
    this.finished = false;
    window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: true }));
    this.events.once('shutdown', () =>
      window.dispatchEvent(new CustomEvent('rs:touch-controls', { detail: false })));

    this.physics.world.gravity.y = GRAVITY;
    this.physics.world.setBounds(0, -350, WORLD_W, 1400);
    this.cameras.main.setBounds(0, -60, WORLD_W, VIEW_H + 200);
    this.cameras.main.fadeIn(620, 10, 12, 24);
    this.follow = this.add.zone(95, GROUND_Y - 50, 1, 1);
    this.cameras.main.startFollow(this.follow, true, .15, .1);
    this.cameras.main.setDeadzone(260, 95);

    makePlayerTextures(this); makeEnemyTextures(this); makeFxTextures(this);
    makeTankTextures(this); makeMachineTextures(this); ensureWarnTexture(this);
    makeFacilityArt(this);
    this.backdrop = new FacilityBackdrop(this);

    this.fx = new FxSystem(this);
    this.weapons = new WeaponsSystem(this);
    this.props = new PropsSystem(this);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.machineGrp = this.physics.add.group();
    this.tankSys = new TankSystem(this);
    this.hud = new Hud(this);
    this.player = new Player(this, 85, GROUND_Y - 55, run.character);
    this.player.invulnUntil = this.time.now + 1600;

    // Underground factory; raised walkways form optional alternate combat routes.
    const ground=this.physics.add.staticGroup();
    const solid=(x:number,y:number,w:number,h:number,group=ground)=>{
      const o=this.physics.add.staticImage(x,y,'__rect').setVisible(false);
      o.setDisplaySize(w,h);o.refreshBody();group.add(o);return o;
    };
    solid(WORLD_W/2,GROUND_Y+65,WORLD_W,60);
    markGround(this);
    const raised=this.physics.add.staticGroup();
    for(const [x,y,w] of [
      [680,GROUND_Y-28,142],[1030,GROUND_Y-28,135],
      [1530,GROUND_Y-28,145],[2130,GROUND_Y-28,142],
      [2650,GROUND_Y-28,150],[3140,GROUND_Y-28,145],
      [3790,GROUND_Y-28,148],[4150,GROUND_Y-28,140],
      [4640,GROUND_Y-28,145],
    ] as const){
      solid(x,y+12,w,24,raised);
      this.add.image(x,y+13,'fz_platform').setDisplaySize(w,26).setDepth(19);
      markSolidPlatform(this, x, y + 12, w, 24);
    }

    this.physics.add.collider(this.player, ground);
    this.physics.add.collider(this.player, raised);
    this.physics.add.collider(this.enemies, ground);
    this.physics.add.collider(this.enemies, raised);
    this.physics.add.collider(this.weapons.grenades, ground);
    // Real cover: shots hit solid walls instead of travelling through scenery.
    makeBallisticCover(this, raised, this.weapons.playerBullets, this.weapons.enemyBullets);
    this.physics.add.collider(this.weapons.grenades, raised);

    this.pickupSys = new PickupManager(this);

    // Multi-tier Facility antigrav jumpers, reactor mezzanines, mag-rail lifts & ziplines
    this.traversal = new StageTraversal(this, 'facility');
    this.traversal.addJumpPad(576, GROUND_Y + 35, -885);
    this.traversal.addOneWayDeck(580, GROUND_Y - 134, 350, 'ЯРУС НАБЛЮДЕНИЯ');
    this.traversal.addBonusCache(695, GROUND_Y - 134, 'mg');
    this.traversal.addHangingCargo(850, GROUND_Y - 134, 62);
    this.traversal.addZipLine(930, GROUND_Y - 134, 1260, GROUND_Y - 94);

    this.traversal.addMovingLift(1795, GROUND_Y - 14, 1795, GROUND_Y - 128, 92, 3200);
    this.traversal.addOneWayDeck(1865, GROUND_Y - 128, 350, 'МОНТ. МОСТИК');
    this.traversal.addBonusCache(2030, GROUND_Y - 128, 'intel');
    this.traversal.addHangingCargo(2120, GROUND_Y - 128, 60);
    this.traversal.addMovingLift(2275, GROUND_Y - 116, 2530, GROUND_Y - 116, 94, 2700, 0.25);

    this.traversal.addJumpPad(3242, GROUND_Y + 35, -890);
    this.traversal.addOneWayDeck(3180, GROUND_Y - 138, 380, 'АВТО-ГАЛЕРЕЯ');
    this.traversal.addBonusCache(3360, GROUND_Y - 138, 'laser');
    this.traversal.addZipLine(3560, GROUND_Y - 138, 3920, GROUND_Y - 98);

    this.traversal.addJumpPad(4042, GROUND_Y + 35, -870);
    this.traversal.addOneWayDeck(4100, GROUND_Y - 124, 340, 'ЭСТАКАДА РЕАКТОРА');
    this.traversal.addBonusCache(4260, GROUND_Y - 124, 'life');
    this.traversal.addHangingCargo(4370, GROUND_Y - 124, 58);

    this.traversal.bindActor(this.player);
    this.traversal.bindActor(this.enemies as any);
    this.traversal.bindWeapons(this.weapons);
    this.traversal.bindSolids(ground);
    this.traversal.bindSolids(raised);
    this.props.bindSolids(ground);
    this.props.bindSolids(raised);

    this.physics.add.overlap(this.weapons.playerBullets, this.enemies, (a, b) => {
      const bullet = (this.weapons.playerBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const enemy = (bullet === a ? b : a) as Enemy;
      if (!bullet.active || !enemy.active) return;
      if ((bullet as any).isRocket) {
        const x = bullet.x, y = bullet.y;
        bullet.destroy(); this.weapons.explode(x, y, 94, 5, false); return;
      }
      damageEnemy(this, enemy, (bullet as any).dmg ?? 1);
      if (!(bullet as any).pierce) bullet.destroy();
    });
    this.physics.add.overlap(this.weapons.playerBullets, this.props.group, (a, b) => {
      const bullet = (this.weapons.playerBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const prop = bullet === a ? b : a;
      if (!bullet.active || !(prop as any).active) return;
      (prop as any).takeDamage?.((bullet as any).dmg ?? 1);
      if (!(bullet as any).pierce) bullet.destroy();
    });
    this.physics.add.overlap(this.weapons.enemyBullets, this.player, (a, b) => {
      const bullet = (a === this.player ? b : a) as Phaser.Physics.Arcade.Image;
      if (!bullet.active) return;
      bullet.destroy();
      if (!this.finished && diff().dmgMul >= 1) this.hurtPlayer();
      else if (!this.finished) this.player.invulnUntil = Math.max(this.player.invulnUntil, this.time.now + 400);
    });
    this.physics.add.overlap(this.player, this.enemies, (_a, b) => {
      const e = b as Enemy;
      if ((e.kind === 'spider' || e.kind === 'drone') && !this.finished) this.hurtPlayer();
    });
    this.physics.add.overlap(this.weapons.enemyBullets, this.props.group, (a, b) => {
      const bullet = (this.weapons.enemyBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const prop = bullet === a ? b : a;
      if (bullet.active) { (prop as any).takeDamage?.(1); bullet.destroy(); }
    });

    this.decorateStage();
    this.addPickups();
    this.initTerminals();
    this.initBeats();
    this.pauseKey = this.input.keyboard!.addKey('P');
    this.interactKey = this.input.keyboard!.addKey('E');
    this.input.keyboard!.on('keydown-ESC', this.togglePause, this);
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-ESC', this.togglePause, this));
    window.addEventListener('rs:touch-pause', this.onTouchPause);
    this.events.once('shutdown', () => window.removeEventListener('rs:touch-pause', this.onTouchPause));
    this.events.on('rs:facility-boss-dead', this.onVictory, this);
    MUSIC.play('level');
    this.hud.banner('ЭПИЗОД 4: КОМПЛЕКС «НУЛЬ»');
    this.hud.toast('Взломай два терминала [E] из трёх, чтобы снять броню ядра!', 3700);
  }

  private decorateStage() {
    for (let i = 0; i < 12; i++) {
      const rawX = 260 + i * 420;
      if (rawX > WORLD_W - 1050) continue;
      const x = findClearGroundX(this, rawX, 34, GROUND_Y + 35, { objectHeight: 60 });
      const machine = this.add.image(x, GROUND_Y + 12, 'fz_console')
        .setScale(0.54).setDepth(16).setAlpha(0.72);
      this.tweens.add({ targets: machine, alpha: { from: 0.78, to: 0.56 }, yoyo: true, repeat: -1, duration: 1100 + i * 23 });
    }
    for (const x of [1200, 2950, 4260]) {
      this.add.text(x, GROUND_Y - 132, '⚠ ЛАЗЕРНЫЙ КОНТРОЛЬ', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffc2a5',
        stroke: '#161d2c', strokeThickness: 4,
      }).setOrigin(.5).setDepth(85);
    }
  }

  private addPickups() {
    const locations: Array<[number, 'mg' | 'shotgun' | 'laser' | 'life']> = [
      [690, 'mg'], [2020, 'shotgun'], [3390, 'laser'], [4700, 'life'],
    ];
    for (const [x, kind] of locations) {
      this.pickupSys.add(x, GROUND_Y + 35, kind);
    }
  }

  spawnEnemyAt(kind: EnemyKind, x: number, y = GROUND_Y - 30) {
    x = safeEnemySpawnX(this, x, kind === 'spider' ? GROUND_Y : y);
    const enemy = new Enemy(this, x, y, kind === 'spider' ? 'e_spider' : 'e_rifle');
    this.enemies.add(enemy); enemy.init(kind, x, y);
    if (kind === 'drone') enemy.setTint(0x64dfed);
    else if (kind === 'spider') enemy.setTint(0x85d7c6);
    else if (!this.textures.exists('e_exo')) enemy.setTint(0x92b4c3);
    return enemy;
  }

  spawnWave(x: number, kinds: EnemyKind[]) {
    for (let i = 0; i < kinds.length; i++) {
      if (this.enemies.countActive(true) >= 13) return;
      if (i < 2) {
        this.spawnEnemyAt(kinds[i], x + 105 * i);
      } else {
        this.time.delayedCall((i - 1) * 440, () => {
          if (!this.finished && this.enemies.countActive(true) < 7) {
            this.spawnEnemyAt(kinds[i], x + 100 * i);
          }
        });
      }
    }
  }

  nearestDamaged(_x: number): Machine | null { return null; }

  requestReinforcement(x: number) {
    if (this.finished || this.enemies.countActive(true) > 10) return;
    this.spawnWave(Phaser.Math.Clamp(x, 25, WORLD_W - 950), ['rifle', 'gren']);
  }

  /** Three security access terminals. Two distinct codes open the final
   * blast gate and disable the reactor's armor. E/touch interaction only. */
  private initTerminals() {
    this.terminals = this.physics.add.group({ allowGravity: false, immovable: true });
    const hasTerm = this.textures.exists('prop_terminal');
    for (const [idx, rawX] of [1675, 2980, 4465].entries()) {
      const x = findClearGroundX(this, rawX, 34, GROUND_Y + 35, { objectHeight: 80, includeProps: true, includeMachines: true, includeTurrets: true, avoidPads: true });
      const aura = this.add.circle(x, GROUND_Y - 8, 26, 0x52dce8, 0.18)
        .setDepth(63).setBlendMode(Phaser.BlendModes.ADD);
      const terminal = hasTerm
        ? this.physics.add.image(x, GROUND_Y - 2, 'prop_terminal', 'f0').setDepth(64)
        : this.physics.add.image(x, GROUND_Y - 20, 'fz_console').setDepth(64);
      (terminal.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setImmovable(true);
      terminal.setData('id', idx).setData('hacked', false).setData('aura', aura);
      this.terminals.add(terminal);
      const label = this.add.text(x, GROUND_Y - 88, '[E] ВЗЛОМ ' + (idx + 1) + '/3', {
        fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#92ffed',
        stroke: '#091e2b', strokeThickness: 4,
      }).setOrigin(.5).setDepth(101);
      terminal.setData('label', label);
      terminal.once(Phaser.GameObjects.Events.DESTROY, () => { label.destroy(); aura.destroy(); });
      this.tweens.add({ targets: aura, alpha: 0.36, scale: 1.25, duration: 850, repeat: -1, yoyo: true });
    }
    const x = 4980;
    const hasGate = this.textures.exists('prop_gate');
    this.accessGate = hasGate
      ? this.add.image(x, GROUND_Y - 70, 'prop_gate', 'f0').setDisplaySize(68, 210).setDepth(72)
      : this.add.image(x, GROUND_Y - 91, 'fz_gate').setDisplaySize(68, 260).setDepth(72);
    const collider = this.physics.add.staticImage(x, GROUND_Y - 74, '__rect').setVisible(false);
    collider.setDisplaySize(50, 235).refreshBody();
    this.gateBody = collider.body as Phaser.Physics.Arcade.StaticBody;
    this.physics.add.collider(this.player, collider);
    this.add.text(x - 15, GROUND_Y - 216, 'БЛОКИРОВКА · 2 КОДА', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffbb91',
      stroke: '#172333', strokeThickness: 4,
    }).setOrigin(.5).setDepth(95);
  }

  hackNearbyTerminal() {
    if(this.finished||this.player.dead)return false;
    const item=this.terminals.getChildren().find(obj=>obj.active
      && !obj.getData('hacked')
      && Math.abs((obj as Phaser.GameObjects.Image).x-this.player.x)<=91
      && Math.abs((obj as Phaser.GameObjects.Image).y-this.player.y)<=115) as Phaser.Physics.Arcade.Image|undefined;
    if(!item)return false;
    return this.hackTerminal(item);
  }

  hackTerminal(item: Phaser.Physics.Arcade.Image) {
    if (!item.active || item.getData('hacked') || this.finished) return false;
    item.setData('hacked', true);
    if (this.textures.exists('prop_terminal') && this.textures.get('prop_terminal').has('f1')) {
      item.setFrame('f1');
    } else {
      item.setTint(0x67f5cc);
    }
    const aura = item.getData('aura') as Phaser.GameObjects.Arc | undefined;
    if (aura?.active) aura.setFillStyle(0x52f59a, 0.25);
    (item.getData('label') as Phaser.GameObjects.Text).setText('КОД ПРИНЯТ').setColor('#75ffaa');
    this.terminalsHacked = Math.min(3, this.terminalsHacked + 1);
    this.registry.set('terminalsHacked', this.terminalsHacked);
    this.fx.signalGlitch(item.x, item.y);
    addScaledScore(this, 600);
    SFX.play('pickup');
    this.hud.toast('ДОСТУП: ' + this.terminalsHacked + '/3 · ТРЕБУЕТСЯ 2 КОДА', 2100);
    if (this.terminalsHacked === 2) this.openSecurityGate();
    if (this.terminalsHacked === 3) this.hud.banner('ПОЛНЫЙ ДОСТУП К АРХИВУ!');
    return true;
  }

  private openSecurityGate() {
    if (!this.gateBody.enable) return;
    this.gateBody.enable = false;
    if (this.textures.exists('prop_gate') && this.textures.get('prop_gate').has('f1')) {
      (this.accessGate as Phaser.GameObjects.Image).setFrame('f1');
    }
    this.hud.banner('БРОНЕДВЕРЬ ОТКРЫТА!');
    this.tweens.add({ targets: this.accessGate, y: this.accessGate.y - 270,
      alpha: 0.08, duration: 1250, ease: 'Cubic.easeInOut' });
    this.hud.toast('БРОНЯ РЕАКТОРА СНЯТА!', 3200);
    this.fx.signalGlitch(this.accessGate.x, this.accessGate.y);
  }

  /** Laser is a warned area pulse, not instant/offscreen damage. */
  warnLaser(x: number, warningMs = 950) {
    if (this.finished || !this.sys.isActive()) return;
    this.laserWarnings++;
    const sight = this.add.rectangle(x, GROUND_Y - 120, 2, 310, 0xff5a6a, 0.45)
      .setDepth(94).setBlendMode(Phaser.BlendModes.ADD);
    const marker = this.add.rectangle(x, GROUND_Y + 29, 110, 9, 0xff9e74, 0.8).setDepth(95);
    const label = this.add.text(x, GROUND_Y - 103, '▼ ЛАЗЕР', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffd9b5',
      stroke: '#2d1a27', strokeThickness: 4,
    }).setOrigin(.5).setDepth(96);
    this.tweens.add({ targets: [marker, label, sight], alpha: 0.13, duration: 100, yoyo: true, repeat: 5 });
    this.time.delayedCall(warningMs, () => {
      marker.destroy(); label.destroy(); sight.destroy();
      if (!this.sys.isActive() || this.finished) return;
      const pulse = this.add.image(x, GROUND_Y - 50, 'fz_beam')
        .setDisplaySize(38, 198).setDepth(95).setAlpha(0.95).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: pulse, alpha: 0, scaleX: 2.6, duration: 310,
        onComplete: () => pulse.destroy() });
      this.fx.impact(x, GROUND_Y - 15, 1, true);
      if (!this.player.dead && !this.player.inTank
        && Math.abs(this.player.x - x) < 56
        && this.player.y > GROUND_Y - 154) this.hurtPlayer();
    });
  }

  private securityLockdown() {
    this.securityWaves++;
    this.hud.banner('ПРОТОКОЛ БЕЗОПАСНОСТИ — ТРЕВОГА!');
    this.spawnWave(this.player.x+230,['heavy','rifle']);
    for(let i=0;i<4;i++)this.time.delayedCall(i*660,()=>{
      if(!this.sys.isActive()||this.finished)return;
      this.warnLaser(Phaser.Math.Clamp(this.player.x+(i%2?50:-70),3360,4240),
        900);
    });
  }

  private initBeats() {
    const once=(x:number,action:()=>void)=>this.beats.push({x,action,fired:false});
    once(90,()=>this.hud.toast('Боцман: в архивах «Нуля» записано, откуда пошёл сигнал.',3200));
    once(340,()=>{this.spawnWave(560,['rifle','drone']);this.spawnEnemyAt('rifle',780,GROUND_Y-180);});
    once(870,()=>{this.hud.banner('ЦЕХ НАБЛЮДЕНИЯ');this.warnLaser(1040);this.spawnWave(1160,['rifle','gren']);this.traversal.spawnDropIn('rifle',1110,'▼ ШАХТА');});
    once(1390,()=>this.hud.toast('Жми [E] у пульта. Чтобы открыть дверь, хватит двух терминалов.',3600));
    once(1680,()=>{this.spawnWave(1900,['heavy','rifle']);this.spawnEnemyAt('gren',2060,GROUND_Y-175);this.props.barrel(2010);});
    once(2180,()=>{this.warnLaser(2380);this.spawnWave(2450,['drone','rifle']);this.traversal.spawnDropIn('rifle',2420,'▼ ШАХТА');});
    once(2700,()=>{this.hud.banner('ОХРАННЫЙ КОРИДОР');this.spawnWave(2910,['gren','heavy']);this.spawnEnemyAt('rifle',3380,GROUND_Y-185);});
    once(3400,()=>{this.securityLockdown();this.traversal.spawnDropIn('gren',3510,'▼ ШАХТА');});
    once(3970,()=>{this.warnLaser(4180);this.spawnWave(4200,['rifle','drone']);this.spawnEnemyAt('rifle',4290,GROUND_Y-172);});
    once(4700,()=>this.hud.toast('НУЖНЫ ДВА КОДА, ЧТОБЫ ОТКРЫТЬ ДВЕРЬ РЕАКТОРА',2900));
    once(5100,()=>this.enterCoreArena());
  }

  enterCoreArena() {
    if(this.bossEntered||this.gateBody.enable)return;
    this.bossEntered=true;
    this.hud.banner('РЕАКТОР «НУЛЬ»');
    MUSIC.play('boss');
    this.boss=new FacilityCore(this, Math.min(WORLD_W - 340, this.player.x + 430));
    lockBossArena(this,this.player,this.boss);
    this.hud.showBoss(true);
    this.physics.add.overlap(this.weapons.playerBullets,this.boss,(a,b)=>{
      const bullet=(a===this.boss?b:a) as Phaser.Physics.Arcade.Image;
      if(!bullet.active||!this.boss?.alive)return;
      const dmg=(bullet as any).dmg??1,x=bullet.x,y=bullet.y;
      if((bullet as any).isRocket){
        bullet.destroy();this.weapons.explode(x,y,95,5,false);return;
      }
      this.boss.takeDamage(dmg * (this.boss.bulletDamageScale?.() ?? 1));
      if(!(bullet as any).pierce)bullet.destroy();
    });
    this.time.addEvent({delay:8100,loop:true,callback:()=>{
      if(!this.boss?.alive||this.finished||this.enemies.countActive(true)>9)return;
      this.spawnEnemyAt('drone',Phaser.Math.Clamp(this.player.x-160,
        WORLD_W-1020,WORLD_W-340));
    }});
  }

  hurtPlayer() {
    if (this.finished || this.player.dead) return;
    if (this.player.hurt(this.time.now)) {
      this.player.killFx();
      this.onPlayerDown();
    }
  }

  onPlayerDown() {
    run.lives--;
    if (run.lives <= 0) this.time.delayedCall(1200, () => this.gameOver());
    else this.time.delayedCall(1400, () => {
      if (this.finished || !this.sys.isActive()) return;
      const safe = findSafeRespawnPoint(this, Math.max(65, this.player.x - 160), { minX: 65 });
      this.player.respawn(safe.x, this.time.now, safe.y);
      this.player.invulnUntil = this.time.now + 2700;
    });
  }

  private gameOver() {
    if (this.finished) return;
    MUSIC.stop();
    this.registry.set('gameover', true);
    this.registry.set('episode', 4);
    this.registry.set('scoreBreakdown', null);
    this.registry.set('finalScore', run.score);
    recordBest();
    this.scene.start('Results');
  }

  private onVictory() {
    if (!this.finished || !this.boss || this.boss.alive) return;
    MUSIC.stop();
    unlockEpisode5();
    const br = finalizeEpisodeVictory(this, 4, Math.max(1, Math.round(this.activeMs / 1000)));
    this.hud.banner('ЭПИЗОД 4 ПРОЙДЕН!');
    this.hud.toast(`БОНУС ГЛАВЫ: +${br.clearBonus + br.livesBonus + br.timeBonus} (×${br.multiplier})`, 2600);
    this.time.delayedCall(2800, () => {
      if (!this.sys.isActive()) return;
      this.scene.start('Results');
    });
  }

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) this.togglePause();
    if (this.paused) return;
    if (!this.finished) this.activeMs += delta;
    this.player.update(time);
    this.traversal.update(time, delta, [this.player, ...(this.enemies.getChildren() as Enemy[])]);
    if (!this.player.dead && this.player.y > 690) {
      this.player.dead = true;
      this.player.killFx();
      this.onPlayerDown();
    }
    const interact = Phaser.Input.Keyboard.JustDown(this.interactKey) || tapEdge('justBoard');
    const usedTerminal = interact ? this.hackNearbyTerminal() : false;
    this.pickupSys.update(this.player, interact && !usedTerminal);
    const left = this.cameras.main.scrollX;
    this.enemies.children.each(obj => {
      const e = obj as Enemy;
      if (e.active && e.x > left - 100 && e.x < left + VIEW_W + 120) e.behavior(time, this.player);
      return true;
    });
    this.weapons.update(time);
    this.weapons.cleanupOffscreen(left);
    if (!this.finished && !this.player.dead) {
      for (const beat of this.beats) if (!beat.fired && this.player.x >= beat.x) {
        beat.fired = true; beat.action();
      }
    }
    const bounds = this.cameras.main.getBounds();
    const x = Phaser.Math.Clamp(this.player.x + 130, bounds.x + 430, bounds.right - 480);
    this.follow.setPosition(x, this.player.y - 45);
    this.backdrop.update(left, delta);
    if (this.boss?.alive) {
      confineHeroToArena(this, this.player);
      this.boss.updateBoss(time, this.player.x, this.player.y);
    }
    this.hud.update(time, this.player, this.tankSys);
  }

  private onTouchPause = () => this.togglePause();

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.physics.pause();
      this.hud.toast('ПАУЗА', 999999);
    } else {
      this.physics.resume();
      this.hud.toast('ПОЕХАЛИ!', 900);
    }
  }
}
