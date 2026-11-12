import Phaser from 'phaser';
import { beginOnlineRun } from './online-leaderboard';
import {
  VIEW_W, VIEW_H, WORLD_W, GROUND_Y, GRAVITY, run, diff,
  addScaledScore, finalizeEpisodeVictory, recordBest, unlockEpisode4, rand, shake,
} from './core';
import { makePlayerTextures, makeEnemyTextures, makeFxTextures, makeTankTextures } from './sprites';
import { makeMachineTextures, Machine, PropsSystem, FxSystem } from './props';
import { PickupManager } from './pickups';
import { JungleBackdrop, makeJungleArt } from './jungle-art';
import { JungleHeart } from './jungle-boss';
import { StageTraversal } from './traversal';
import { Player } from './player';
import { WeaponsSystem } from './weapons';
import { markSolidPlatform, markGround, safeEnemySpawnX, findSafeRespawnPoint, makeBallisticCover, lockBossArena, confineHeroToArena } from './world-rules';
import { Enemy, type EnemyKind, damageEnemy } from './enemies';
import { TankSystem } from './boss';
import { Hud, ensureWarnTexture } from '../ui/hud';
import { SFX, MUSIC } from './audio';
import { touch, tapEdge } from '../ui/touch';

interface JungleBeat { x: number; fired: boolean; action: () => void }

/**
 * EPISODE 2 — ARMORED TRAIN NO. 7.
 * New level, new chase / visual palette / stage events / original train boss.
 * Shares controls, equipment, remastered actors and scoring with episode one.
 */
export class JungleScene extends Phaser.Scene {
  player!: Player;
  weapons!: WeaponsSystem;
  fx!: FxSystem;
  props!: PropsSystem;
  hud!: Hud;
  enemies!: Phaser.Physics.Arcade.Group;
  machines: Machine[] = [];
  machineGrp!: Phaser.Physics.Arcade.Group;
  tankSys!: TankSystem;
  boss: JungleHeart | null = null;
  finished = false;
  paused = false;
  private backdrop!: JungleBackdrop;
  private follow!: Phaser.GameObjects.Zone;
  traversal!: StageTraversal;
  pickupSys!: PickupManager;
  private beats: JungleBeat[] = [];
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  bossEntered = false;
  podsDestroyed = 0;
  sporeWaves = 0;
  ambushes = 0;
  private activeMs = 0;
  growthPods!: Phaser.Physics.Arcade.Group;

  constructor() { super('Jungle'); }

  create() {
    try { this.createStage(); }
    catch (error: any) {
      (window as any).__RS_FATAL__ = String(error?.stack ?? error).slice(0, 800);
      console.error('[RUST SIGNAL] JungleScene create failed:', error);
      throw error;
    }
  }

  private createStage() {
    run.episode = 3;
    beginOnlineRun({ episode: 3, difficulty: run.difficulty, character: run.character });
    this.podsDestroyed = 0;
    this.activeMs = 0;
    this.registry.set('podsDestroyed', 0);
    this.registry.set('episode', 3);
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
    makeJungleArt(this);
    this.backdrop = new JungleBackdrop(this);

    this.fx = new FxSystem(this);
    this.weapons = new WeaponsSystem(this);
    this.props = new PropsSystem(this);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.machineGrp = this.physics.add.group();
    this.tankSys = new TankSystem(this);
    this.hud = new Hud(this);
    this.player = new Player(this, 85, GROUND_Y - 55, run.character);
    this.player.invulnUntil = this.time.now + 1600;

    // Forest floor and optional ruins/branches form genuinely distinct routes.
    const ground=this.physics.add.staticGroup();
    const solid=(x:number,y:number,w:number,h:number,group=ground)=>{
      const p=this.physics.add.staticImage(x,y,'__rect').setVisible(false);
      p.setDisplaySize(w,h);p.refreshBody();group.add(p);return p;
    };
    solid(WORLD_W/2,GROUND_Y+65,WORLD_W,60);
    markGround(this);
    const raised=this.physics.add.staticGroup();
    for(const [x,y,w] of [
      [760,GROUND_Y-28,132],[1080,GROUND_Y-28,132],
      [1730,GROUND_Y-28,140],[2060,GROUND_Y-28,132],
      [2660,GROUND_Y-28,140],[3090,GROUND_Y-28,140],
      [3620,GROUND_Y-28,145],[4070,GROUND_Y-28,135],
      [4570,GROUND_Y-28,140],
    ] as const) {
      solid(x,y+12,w,24,raised);
      this.add.image(x,y+13,'jg_platform').setDisplaySize(w,26).setDepth(20);
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

    // Multi-tier canopy bridges, glowing elastic spore-cap bounce pads, vine ziplines & living lifts
    this.traversal = new StageTraversal(this, 'jungle');
    this.traversal.addJumpPad(610, GROUND_Y + 35, -850);
    this.traversal.addOneWayDeck(590, GROUND_Y - 116, 350, 'КРОНА ДЕРЕВА');
    this.traversal.addBonusCache(685, GROUND_Y - 116, 'mg');
    this.traversal.addHangingCargo(845, GROUND_Y - 116, 58);
    this.traversal.addZipLine(940, GROUND_Y - 116, 1300, GROUND_Y - 94);

    this.traversal.addMovingLift(1604, GROUND_Y - 14, 1604, GROUND_Y - 130, 92, 3200);
    this.traversal.addOneWayDeck(1710, GROUND_Y - 130, 340, 'ВЕРХНИЙ ЯРУС');
    this.traversal.addBonusCache(1880, GROUND_Y - 130, 'intel');
    this.traversal.addHangingCargo(1940, GROUND_Y - 130, 58);
    this.traversal.addOneWayDeck(2160, GROUND_Y - 84, 240);

    this.traversal.addJumpPad(2960, GROUND_Y + 35, -865);
    this.traversal.addOneWayDeck(2920, GROUND_Y - 124, 360, 'ПЛОЩАДКА ЛИАН');
    this.traversal.addBonusCache(3100, GROUND_Y - 124, 'laser');
    this.traversal.addMovingLift(3335, GROUND_Y - 114, 3510, GROUND_Y - 114, 92, 2700, 0.2);
    this.traversal.addZipLine(3540, GROUND_Y - 114, 3910, GROUND_Y - 90);

    this.traversal.addJumpPad(4305, GROUND_Y + 35, -845);
    this.traversal.addOneWayDeck(4320, GROUND_Y - 106, 360, 'ДРЕВНИЕ ВЕТВИ');
    this.traversal.addHangingCargo(4410, GROUND_Y - 106, 56);

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
    this.initGrowthPods();
    this.initBeats();
    this.pauseKey = this.input.keyboard!.addKey('P');
    this.interactKey = this.input.keyboard!.addKey('E');
    this.input.keyboard!.on('keydown-ESC', this.togglePause, this);
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-ESC', this.togglePause, this));
    window.addEventListener('rs:touch-pause', this.onTouchPause);
    this.events.once('shutdown', () => window.removeEventListener('rs:touch-pause', this.onTouchPause));
    this.events.on('rs:jungle-boss-dead', this.onVictory, this);
    MUSIC.play('level');
    this.hud.banner('ЭПИЗОД 3: ЗЕЛЁНАЯ ЗОНА');
    this.hud.toast('Сжигай коконы по пути — Сердце потеряет броню!', 3700);
  }

  private decorateStage() {
    for (let i = 0; i < 15; i++) {
      const x = 280 + i * 345;
      if (x >= WORLD_W - 1000) continue;
      const plant = this.add.image(x + 42, GROUND_Y + 35 - 38, 'jg_growth')
        .setScale(i % 3 === 0 ? 0.92 : 0.62).setDepth(18).setAlpha(0.84);
      this.tweens.add({ targets: plant, angle: { from: -3, to: 3 }, duration: 1400 + i * 50, repeat: -1, yoyo: true });
    }
    for (const x of [1030, 2940, 4150]) {
      this.add.text(x, GROUND_Y - 130, '⚠ ЗАРАЖЁННЫЕ СПОРЫ', {
        fontFamily: 'monospace', fontSize: '11px', color: '#b5faa7',
        stroke: '#112a25', strokeThickness: 3,
      }).setOrigin(.5).setDepth(70);
    }
  }

  private addPickups() {
    const locations: Array<[number, 'mg' | 'shotgun' | 'laser' | 'life']> = [
      [650, 'mg'], [2060, 'shotgun'], [3510, 'laser'], [4870, 'life'],
    ];
    for (const [x, kind] of locations) {
      this.pickupSys.add(x, GROUND_Y + 35, kind);
    }
  }

  spawnEnemyAt(kind: EnemyKind, x: number, y = GROUND_Y - 30) {
    x = safeEnemySpawnX(this, x, kind === 'spider' ? GROUND_Y : y);
    const enemy = new Enemy(this, x, y, kind === 'spider' ? 'e_spider' : 'e_rifle');
    this.enemies.add(enemy); enemy.init(kind, x, y);
    if (kind === 'spider' && enemy.texture.key !== 'jg_stalker') {
      enemy.anims.stop(); enemy.setTexture('jg_stalker'); enemy.setSizeForKind();
    } else if (kind === 'drone') {
      enemy.setTint(0x8affbd);
    }
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

  private initGrowthPods() {
    this.growthPods = this.physics.add.group({ allowGravity: false, immovable: true });
    const hasPod = this.textures.exists('prop_pod');
    for (const [x, y] of [[1730, GROUND_Y - 60], [3090, GROUND_Y - 60], [4570, GROUND_Y - 140]] as const) {
      const aura = this.add.circle(x, y, 36, 0x62f59a, 0.2)
        .setDepth(63).setBlendMode(Phaser.BlendModes.ADD);
      const pod = hasPod
        ? this.physics.add.image(x, y, 'prop_pod', 'f0').setDepth(65)
        : this.physics.add.image(x, y - 36, 'jg_growth').setDepth(65);
      (pod.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setImmovable(true);
      pod.setData('hp', 7);
      this.growthPods.add(pod);
      const label = this.add.text(x, y - 54, 'ЯДРО СПОР · 7 HP', {
        fontFamily: 'monospace', fontSize: '12px', color: '#d1fab5',
        stroke: '#0d221e', strokeThickness: 4,
      }).setOrigin(.5).setDepth(100);
      pod.setData('label', label);
      pod.once(Phaser.GameObjects.Events.DESTROY, () => { label.destroy(); aura.destroy(); });
      this.tweens.add({ targets: [pod, aura], scale: { from: .95, to: 1.07 }, duration: 930, repeat: -1, yoyo: true });
    }
    this.physics.add.overlap(this.weapons.playerBullets, this.growthPods, (a, b) => {
      const bullet = (this.weapons.playerBullets.contains(a as Phaser.GameObjects.GameObject) ? a : b) as Phaser.Physics.Arcade.Image;
      const pod = (bullet === a ? b : a) as Phaser.Physics.Arcade.Image;
      if (!bullet.active || !pod.active) return;
      const dmg = (bullet as any).dmg ?? 1, x = bullet.x, y = bullet.y;
      this.damagePod(pod, (bullet as any).isRocket ? dmg + 4 : dmg);
      if ((bullet as any).isRocket) {
        bullet.destroy(); this.weapons.explode(x, y, 84, 5, false); return;
      }
      if (!(bullet as any).pierce) bullet.destroy();
    });
  }

  damagePod(pod: Phaser.Physics.Arcade.Image, amount = 1) {
    if (!pod?.active || this.finished) return false;
    const hp = Math.max(0, Number(pod.getData('hp') ?? 7) - amount);
    pod.setData('hp', hp);
    (pod.getData('label') as Phaser.GameObjects.Text).setText('ЯДРО СПОР · ' + Math.ceil(hp) + ' HP');
    this.fx.impact(pod.x, pod.y, 1, true);
    if (hp > 0) {
      if (this.textures.exists('prop_pod') && this.textures.get('prop_pod').has('f1')) {
        pod.setFrame(hp <= 3 ? 'f1' : 'f0');
      }
      pod.setTintFill(0xe7ffe0);
      this.time.delayedCall(70, () => { if (pod.active) pod.clearTint(); });
      return false;
    }
    const x=pod.x,y=pod.y;pod.destroy();
    this.podsDestroyed=Math.min(3,this.podsDestroyed+1);
    this.registry.set('podsDestroyed',this.podsDestroyed);
    this.fx.bigBoom(x,y,1.2);
    this.fx.debris(x,y,12,[0x86f2a3,0x4ebda9,0xb3a882]);
    addScaledScore(this, 600);
    this.hud.toast('КОКОН СОЖЖЁН: '+this.podsDestroyed+'/3 · БРОНЯ БОССА ОСЛАБЛА',2500);
    if(this.podsDestroyed===3)this.hud.banner('ВСЕ КОКОНЫ УНИЧТОЖЕНЫ!');
    return true;
  }

  /** Short-range emergency purge uses the E/touch-interact control. */
  activatePurge() {
    if(this.finished||this.player.dead)return false;
    const pod=this.growthPods.getChildren().find(item=>item.active
      && Math.abs((item as Phaser.GameObjects.Image).x-this.player.x)<85
      && Math.abs((item as Phaser.GameObjects.Image).y-this.player.y)<115) as Phaser.Physics.Arcade.Image|undefined;
    if(!pod)return false;
    this.damagePod(pod,2);
    if(pod.active)this.fx.signalGlitch(pod.x,pod.y);
    return true;
  }

  private initBeats() {
    const once=(x:number,action:()=>void)=>this.beats.push({x,action,fired:false});
    once(90,()=>this.hud.toast('Боцман: из джунглей тянет обрывками речи, тут всё насквозь фонит.',3000));
    once(320,()=>{this.spawnWave(530,['rifle','spider']);this.spawnEnemyAt('rifle',780,GROUND_Y-165);});
    once(900,()=>{this.warnSpore(1080);this.spawnWave(1140,['spider','spider']);this.traversal.spawnDropIn('rifle',1090,'▼ КОКОН');});
    once(1500,()=>{this.hud.banner('КЛАДКА СПОР: БЕЙ ПО ЯДРУ');this.spawnWave(1720,['spider','drone']);this.spawnEnemyAt('gren',1890,GROUND_Y-170);});
    once(2050,()=>this.rootAmbush());
    once(2450,()=>{this.spawnWave(2710,['gren','spider']);this.props.barrel(2680);this.traversal.spawnDropIn('rifle',2640,'▼ КОКОН');});
    once(2820,()=>{this.warnSpore(3010);this.spawnEnemyAt('drone',3220,GROUND_Y-120);this.spawnEnemyAt('rifle',3250,GROUND_Y-170);});
    once(3260,()=>this.sporeStorm());
    once(3750,()=>{this.spawnWave(3970,['heavy','spider']);this.hud.toast('Коконы питают сигнал. Сжигай их по дороге.',2900);});
    once(4210,()=>{this.rootAmbush();this.spawnEnemyAt('gren',4480,GROUND_Y-155);});
    once(4650,()=>{this.spawnWave(4830,['drone','spider']);this.warnSpore(4740);this.traversal.spawnDropIn('rifle',4780);});
    once(5030,()=>this.enterHeartArena());
  }

  /** Three-stage telegraph -> cloud -> decay. Air movement or rolling escapes. */
  warnSpore(x:number,warningMs=1040,radius=92) {
    if(this.finished||!this.sys.isActive())return;
    this.sporeWaves++;
    const marker=this.add.ellipse(x,GROUND_Y+27,radius*2,16,0xa4ed81,.57).setDepth(90);
    const text=this.add.text(x,GROUND_Y-85,'▼ СПОРЫ!',{
      fontFamily:'monospace',fontSize:'13px',color:'#e0ffa3',
      stroke:'#162d2c',strokeThickness:4,
    }).setOrigin(.5).setDepth(99);
    this.tweens.add({targets:[marker,text],alpha:.1,yoyo:true,repeat:5,duration:warningMs/12});
    this.time.delayedCall(warningMs,()=>{
      marker.destroy();text.destroy();
      if(!this.sys.isActive()||this.finished)return;
      const cloud=this.add.image(x,GROUND_Y-23,'jg_spore').setAlpha(.38)
        .setDisplaySize(radius*2,122).setDepth(89);
      this.tweens.add({targets:cloud,alpha:0,duration:1100,
        onComplete:()=>cloud.destroy()});
      for(let i=0;i<5;i++){
        const p=this.add.image(x+rand(-radius,radius),GROUND_Y-rand(23,98),'jg_spore')
          .setScale(rand(.23,.58)).setAlpha(.75).setDepth(91);
        this.tweens.add({targets:p,y:p.y-70,alpha:0,duration:800+rand(0,250),
          onComplete:()=>p.destroy()});
      }
      if(!this.player.dead&&!this.player.inTank
        && Math.abs(this.player.x-x)<radius
        && this.player.y>GROUND_Y-110)this.hurtPlayer();
    });
  }

  private rootAmbush() {
    this.ambushes++;
    this.hud.banner('КОРНИ ДВИЖУТСЯ!');
    const px=this.player.x;
    for(let i=0;i<3;i++)this.time.delayedCall(i*440,()=>{
      if(!this.sys.isActive()||this.finished)return;
      const x=Phaser.Math.Clamp(px+190+i*76,250,WORLD_W-920);
      this.spawnEnemyAt(i===1?'drone':'spider',x,GROUND_Y-95);
      this.fx.signalGlitch(x,GROUND_Y-110);
    });
  }

  private sporeStorm() {
    this.hud.banner('СПОРОВЫЙ ШТОРМ! ИЩИ УКРЫТИЕ');
    for(let i=0;i<4;i++)this.time.delayedCall(i*850,()=>{
      if(!this.sys.isActive()||this.finished)return;
      const x=Phaser.Math.Clamp(this.player.x+(i%2?70:-45),3140,3940);
      this.warnSpore(x,950,76);
    });
  }

  enterHeartArena() {
    if(this.bossEntered)return;
    this.bossEntered=true;
    this.hud.banner('БИОПЕРЕДАТЧИК — СЕРДЦЕ ЗОНЫ');
    MUSIC.play('boss');
    this.boss=new JungleHeart(this, Math.min(WORLD_W - 340, this.player.x + 430));
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
    this.time.addEvent({delay:7900,loop:true,callback:()=>{
      if(!this.boss?.alive||this.finished||this.enemies.countActive(true)>9)return;
      this.spawnEnemyAt('spider',Phaser.Math.Clamp(this.player.x-160,WORLD_W-1000,WORLD_W-340));
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
    this.registry.set('episode', 3);
    this.registry.set('scoreBreakdown', null);
    this.registry.set('finalScore', run.score);
    recordBest();
    this.scene.start('Results');
  }

  private onVictory() {
    if (!this.finished || !this.boss || this.boss.alive) return;
    unlockEpisode4();
    MUSIC.stop();
    const br = finalizeEpisodeVictory(this, 3, Math.max(1, Math.round(this.activeMs / 1000)));
    this.hud.banner('ЭПИЗОД 3 ПРОЙДЕН!');
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
    const usedPurge = interact ? this.activatePurge() : false;
    this.pickupSys.update(this.player, interact && !usedPurge);
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
