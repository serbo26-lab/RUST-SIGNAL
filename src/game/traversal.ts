/**
 * Multi-tier traversal, crane booms, moving hoists, bounce pads, ziplines,
 * hanging cargo hazards and parachute/rappel drop-ins shared by all 4 episodes.
 *
 * IMPORTANT: visual geometry stays at depth <= 36 (never depth 41, which is
 * reserved for lower solid step platforms checked by geometric invariants).
 */

import Phaser from 'phaser';
import { GROUND_Y, WORLD_W, addScaledScore, pick, rand, run, scorePopup } from './core';
import { SFX } from './audio';
import { collectSolidWalls, isWithinCamera, resolveSolidOverlap, safeEnemySpawnX } from './world-rules';

export type TraversalTheme = 'harbor' | 'train' | 'jungle' | 'facility' | 'bastion' | 'beacon';

export interface DeckMeta {
  x: number;
  right: number;
  topY: number;
  w: number;
  isLift?: boolean;
}

export interface ActiveZipRide {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  speed: number;
  pulley?: Phaser.GameObjects.Container;
  resetX: number;
  resetY: number;
}

interface ThemePalette {
  beam: number;
  beamTop: number;
  beamEdge: number;
  strut: number;
  accent: number;
  cable: number;
  padBase: number;
  padGlow: number;
}

const THEME_PALETTES: Record<TraversalTheme, ThemePalette> = {
  harbor: {
    beam: 0x3b4856,
    beamTop: 0x5c6d7e,
    beamEdge: 0xe69f28,
    strut: 0x2a333d,
    accent: 0xffb84d,
    cable: 0x9aa6b5,
    padBase: 0x26313d,
    padGlow: 0xffb338,
  },
  train: {
    beam: 0x323b48,
    beamTop: 0x516073,
    beamEdge: 0x62d4ff,
    strut: 0x1e252e,
    accent: 0x72e2ff,
    cable: 0xa6b8cc,
    padBase: 0x28323e,
    padGlow: 0xcceeff,
  },
  jungle: {
    beam: 0x35472c,
    beamTop: 0x537043,
    beamEdge: 0x5ee89c,
    strut: 0x24301c,
    accent: 0x7effb2,
    cable: 0x5c7d42,
    padBase: 0x284d39,
    padGlow: 0x67ffba,
  },
  facility: {
    beam: 0x2c394b,
    beamTop: 0x455a75,
    beamEdge: 0x4fe8ff,
    strut: 0x1a2330,
    accent: 0x6cf2ff,
    cable: 0x64dfff,
    padBase: 0x1b2b3d,
    padGlow: 0x4fe8ff,
  },
  bastion: {
    beam: 0x2a3b52,
    beamTop: 0x6488ad,
    beamEdge: 0xbee4f8,
    strut: 0x182334,
    accent: 0xff9b42,
    cable: 0x8db6d6,
    padBase: 0x1c2c40,
    padGlow: 0x8be2ff,
  },
  beacon: {
    beam: 0x182134,
    beamTop: 0x2e4362,
    beamEdge: 0x5ef5eb,
    strut: 0x0e1422,
    accent: 0xff4b78,
    cable: 0x56f0e6,
    padBase: 0x151e32,
    padGlow: 0xff5a84,
  },
};

interface MovingLiftEntry {
  sprite: Phaser.Physics.Arcade.Image;
  visual: Phaser.GameObjects.Container;
  cables?: Phaser.GameObjects.Rectangle[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  durationMs: number;
  phaseOffset: number;
  prevX: number;
  prevTop: number;
  dx: number;
  dy: number;
}

interface JumpPadEntry {
  x: number;
  topY: number;
  w: number;
  vy: number;
  cap: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Ellipse;
  baseY: number;
  lastTriggered: number;
}

interface ZipLineEntry {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  length: number;
  pulley: Phaser.GameObjects.Container;
  busyUntil: number;
}

interface HangingCargoEntry {
  crate: Phaser.Physics.Arcade.Image;
  cable: Phaser.GameObjects.Rectangle;
  clasp: Phaser.GameObjects.Arc;
  dropped: boolean;
  detonated: boolean;
  anchorY: number;
  triggerX: number;
}

export class StageTraversal {
  scene: any;
  theme: TraversalTheme;
  pal: ThemePalette;

  oneWayDecks: Phaser.Physics.Arcade.StaticGroup;
  lifts: Phaser.Physics.Arcade.Group;
  cargos: Phaser.Physics.Arcade.Group;

  private deckMetas: DeckMeta[] = [];
  private liftEntries: MovingLiftEntry[] = [];
  private padEntries: JumpPadEntry[] = [];
  private zipEntries: ZipLineEntry[] = [];
  private cargoEntries: HangingCargoEntry[] = [];
  private boundActors = new WeakSet<object>();
  private hintShown = false;
  private zipHintShown = false;
  private weaponsBound = false;

  constructor(scene: any, theme: TraversalTheme) {
    this.scene = scene;
    this.theme = theme;
    this.pal = THEME_PALETTES[theme];

    this.oneWayDecks = scene.physics.add.staticGroup();
    this.lifts = scene.physics.add.group({ allowGravity: false, immovable: true });
    this.cargos = scene.physics.add.group({ allowGravity: false, immovable: true });
  }

  getDecks(): readonly DeckMeta[] {
    return this.deckMetas;
  }

  /** One-way collision filter shared by decks, lifts, and grenades. */
  private oneWayProcess = (actorObj: any, platObj: any): boolean => {
    const body = actorObj?.body as Phaser.Physics.Arcade.Body | undefined;
    const pBody = platObj?.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body || !pBody) return false;
    const now = this.scene.time?.now ?? 0;
    if (typeof actorObj.dropThroughUntil === 'number' && now < actorObj.dropThroughUntil) return false;
    if (actorObj.zipState) return false;
    const pVy = pBody.velocity ? pBody.velocity.y : 0;
    if (body.velocity.y < pVy - 28) return false;
    const prevBottom = body.prev ? body.prev.y + body.height : body.bottom;
    const pPrevTop = pBody.prev ? pBody.prev.y : pBody.y;
    return prevBottom <= Math.max(pBody.y, pPrevTop) + 14;
  };

  /** Bind Hero or any Enemy so they can jump up through and stand on upper decks/lifts. */
  bindActor(actor: Phaser.Physics.Arcade.Sprite | undefined | null) {
    if (!actor || this.boundActors.has(actor)) return;
    this.boundActors.add(actor);
    this.scene.physics.add.collider(actor, this.oneWayDecks, undefined, this.oneWayProcess);
    this.scene.physics.add.collider(actor, this.lifts, undefined, this.oneWayProcess);
  }

  /** Let grenades bounce off crane booms / catwalks AND player shots snap hanging cargo. */
  bindWeapons(weapons: any) {
    if (!weapons || this.weaponsBound) return;
    this.weaponsBound = true;
    if (weapons.grenades) {
      this.scene.physics.add.collider(weapons.grenades, this.oneWayDecks, undefined, this.oneWayProcess);
      this.scene.physics.add.collider(weapons.grenades, this.lifts, undefined, this.oneWayProcess);
    }
    if (weapons.playerBullets) {
      this.scene.physics.add.overlap(weapons.playerBullets, this.cargos, (bullet: any, cargoImg: any) => {
        if (!bullet?.active || !cargoImg?.active) return;
        const entry = (cargoImg as any).__cargoEntry as HangingCargoEntry | undefined;
        if (!entry || entry.dropped) return;
        if (bullet.texture?.key !== 'laser_b') bullet.destroy();
        this.releaseCargo(entry);
      });
    }
  }

  private solidGroups: Array<Phaser.GameObjects.Group | Phaser.Physics.Arcade.StaticGroup> = [];

  /** Bind ground and raised platforms so falling hanging cargos detonate cleanly on roofs/containers. */
  bindSolids(solids: Phaser.GameObjects.Group | Phaser.Physics.Arcade.StaticGroup) {
    if (!solids || this.solidGroups.includes(solids)) return;
    this.solidGroups.push(solids);
    this.scene.physics.add.collider(this.cargos, solids);
  }

  /** Add a jump-through upper deck/catwalk (`depth <= 34`, never `41`). */
  addOneWayDeck(xLeft: number, topY: number, width: number, label?: string): DeckMeta {
    const cx = xLeft + width / 2;
    const collider = this.oneWayDecks.create(cx, topY + 7, '__rect') as Phaser.Physics.Arcade.Image;
    collider.setDisplaySize(width, 14).setVisible(false).refreshBody();

    this.drawDeckVisual(xLeft, topY, width, label);

    const meta: DeckMeta = { x: xLeft, right: xLeft + width, topY, w: width };
    this.deckMetas.push(meta);
    return meta;
  }

  private drawDeckVisual(xLeft: number, topY: number, width: number, label?: string) {
    const S = this.scene;
    const p = this.pal;
    const g = S.add.graphics().setDepth(32);

    // Underside structural truss / vines
    if (this.theme === 'jungle') {
      g.fillStyle(p.strut, 0.96);
      g.fillRoundedRect(xLeft, topY + 2, width, 11, 4);
      g.fillStyle(p.beamTop, 0.95);
      g.fillRect(xLeft + 2, topY, width - 4, 4);
      // Hanging bioluminescent vines & knots
      for (let vx = xLeft + 22; vx < xLeft + width - 14; vx += 44) {
        const drop = 14 + ((vx * 7) % 18);
        g.lineStyle(2, p.cable, 0.85);
        g.beginPath(); g.moveTo(vx, topY + 11); g.lineTo(vx - 3, topY + 11 + drop); g.strokePath();
        g.fillStyle(p.accent, 0.82);
        g.fillCircle(vx - 3, topY + 11 + drop, 2.2);
      }
      for (let sx = xLeft + 10; sx < xLeft + width - 10; sx += 26) {
        g.fillStyle(p.beamEdge, 0.72);
        g.fillRect(sx, topY + 1, 7, 2);
      }
    } else {
      // Steel / armored girder with bottom flange and X-truss bays
      g.fillStyle(p.strut, 0.96);
      g.fillRect(xLeft, topY + 3, width, 12);
      g.lineStyle(1.5, p.beamTop, 0.45);
      const bay = 28;
      for (let bx = xLeft; bx < xLeft + width - 8; bx += bay) {
        const bw = Math.min(bay, xLeft + width - bx);
        g.beginPath();
        g.moveTo(bx, topY + 4); g.lineTo(bx + bw, topY + 14);
        g.moveTo(bx + bw, topY + 4); g.lineTo(bx, topY + 14);
        g.strokePath();
      }
      g.fillStyle(p.beam, 1);
      g.fillRect(xLeft, topY, width, 5);
      g.fillStyle(p.beamTop, 0.95);
      g.fillRect(xLeft, topY, width, 2);
      // Safety edge stripes / glow trim
      const stripeStep = this.theme === 'facility' ? 32 : 24;
      for (let sx = xLeft + 6; sx < xLeft + width - 8; sx += stripeStep) {
        g.fillStyle(p.beamEdge, 0.9);
        g.fillRect(sx, topY + 2, 10, 2);
      }
      // Thin catwalk safety posts behind actor (depth 29)
      const rail = S.add.graphics().setDepth(29);
      rail.lineStyle(1.5, p.beamTop, 0.55);
      rail.beginPath(); rail.moveTo(xLeft + 4, topY - 14); rail.lineTo(xLeft + width - 4, topY - 14); rail.strokePath();
      for (let px = xLeft + 4; px <= xLeft + width - 4; px += 46) {
        rail.beginPath(); rail.moveTo(px, topY); rail.lineTo(px, topY - 15); rail.strokePath();
      }
    }

    if (label) {
      S.add.text(xLeft + 10, topY - 15, label, {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: this.theme === 'jungle' ? '#95ffcf' : this.theme === 'facility' ? '#85f4ff' : '#ffd87a',
        stroke: '#0b1017',
        strokeThickness: 3,
      }).setDepth(30).setAlpha(0.92);
    }
  }

  /**
   * Signature Harbor Landmark: tall gantry crane tower + operator cab +
   * mid-level landing + full walkable overhead crane boom + blinking beacon.
   */
  addCraneStructure(opts: {
    towerX: number;
    boomX: number;
    boomW: number;
    boomY?: number;
    midDeckY?: number;
    groundY?: number;
    label?: string;
  }) {
    const S = this.scene;
    const gY = opts.groundY ?? GROUND_Y + 35;
    const boomY = opts.boomY ?? GROUND_Y - 128; // ~342 (163px above 505 ground)
    const midY = opts.midDeckY ?? GROUND_Y - 30; // ~440 (65px above ground — reachable in 1 jump at any FPS!)
    const tX = opts.towerX;
    const p = this.pal;

    // Back crane frame / A-frame pylon / truss / cab (`depth: 22..28`)
    const frame = S.add.graphics().setDepth(22);

    // Rail bogies anchored cleanly into the pier floor
    frame.fillStyle(0x1b222a, 1);
    frame.fillRect(tX - 48, gY - 14, 96, 14);
    frame.fillStyle(0x4a5562, 1);
    frame.fillRect(tX - 44, gY - 17, 88, 5);
    for (const wx of [tX - 34, tX - 16, tX + 16, tX + 34]) {
      frame.fillStyle(0x0f1419, 1); frame.fillCircle(wx, gY - 5, 6);
      frame.fillStyle(0x7c8a99, 1); frame.fillCircle(wx, gY - 5, 2.5);
    }

    // Main A-frame steel legs rising from rail truck up past the boom
    const apexY = boomY - 68;
    const legTopSpread = 16;
    const legBotSpread = 36;
    const topLeft = tX - legTopSpread;
    const topRight = tX + legTopSpread;
    const botLeft = tX - legBotSpread;
    const botRight = tX + legBotSpread;

    frame.fillStyle(0x2a333d, 0.96);
    frame.fillRect(tX - 20, apexY + 8, 40, gY - apexY - 22);
    // Orange/amber industrial crane legs
    frame.lineStyle(7, 0x9b621c, 0.95);
    frame.beginPath();
    frame.moveTo(botLeft, gY - 14); frame.lineTo(topLeft, apexY);
    frame.moveTo(botRight, gY - 14); frame.lineTo(topRight, apexY);
    frame.strokePath();
    frame.lineStyle(2.5, 0xe89c2d, 0.9);
    frame.beginPath();
    frame.moveTo(botLeft - 1, gY - 14); frame.lineTo(topLeft - 1, apexY);
    frame.moveTo(botRight - 1, gY - 14); frame.lineTo(topRight - 1, apexY);
    frame.strokePath();

    // Horizontal & diagonal X-bracing between legs
    const steps = 6;
    frame.lineStyle(2, 0x526170, 0.85);
    for (let i = 0; i < steps; i++) {
      const f0 = i / steps;
      const f1 = (i + 1) / steps;
      const y0 = Phaser.Math.Linear(gY - 16, apexY + 8, f0);
      const y1 = Phaser.Math.Linear(gY - 16, apexY + 8, f1);
      const xl0 = Phaser.Math.Linear(botLeft, topLeft, f0);
      const xr0 = Phaser.Math.Linear(botRight, topRight, f0);
      const xl1 = Phaser.Math.Linear(botLeft, topLeft, f1);
      const xr1 = Phaser.Math.Linear(botRight, topRight, f1);
      frame.beginPath();
      frame.moveTo(xl0, y0); frame.lineTo(xr0, y0);
      frame.moveTo(xl0, y0); frame.lineTo(xr1, y1);
      frame.moveTo(xr0, y0); frame.lineTo(xl1, y1);
      frame.strokePath();
    }

    // Operator control cab + counterweight housing
    const cabSide = opts.boomX + opts.boomW / 2 >= tX ? 1 : -1;
    const cabX = tX + cabSide * 28;
    const cabY = boomY + 24;
    frame.fillStyle(0x28323d, 1);
    frame.fillRoundedRect(cabX - 24, cabY - 16, 48, 32, 4);
    frame.fillStyle(0xd98b2b, 1);
    frame.fillRect(cabX - 24, cabY - 16, 48, 5);
    // Illuminated warm amber cab window
    frame.fillStyle(0xffbe55, 0.85);
    frame.fillRect(cabX + (cabSide > 0 ? 4 : -18), cabY - 9, 14, 13);
    frame.fillStyle(0x161d24, 0.9);
    frame.fillRect(cabX - 18, cabY - 9, 16, 13);

    // Concrete counterweight block on opposite side of tower
    const cwX = tX - cabSide * 56;
    frame.fillStyle(0x3a434e, 1);
    frame.fillRect(cwX - 22, boomY - 6, 44, 24);
    frame.fillStyle(0xe69f28, 0.85);
    for (let sx = cwX - 18; sx < cwX + 18; sx += 10) {
      frame.fillRect(sx, boomY + 12, 5, 4);
    }

    // Tension steel suspension cables from apex pylon down to crane boom ends
    const farEnd = cabSide > 0 ? opts.boomX + opts.boomW - 18 : opts.boomX + 18;
    const midEnd = Phaser.Math.Linear(tX, farEnd, 0.56);
    frame.lineStyle(2, p.cable, 0.9);
    frame.beginPath();
    frame.moveTo(tX, apexY); frame.lineTo(farEnd, boomY);
    frame.moveTo(tX, apexY); frame.lineTo(midEnd, boomY);
    frame.moveTo(tX, apexY); frame.lineTo(cwX, boomY - 4);
    frame.strokePath();

    // Overhead warning beacon at apex
    const beacon = S.add.circle(tX, apexY - 5, 4, 0xff3b30, 1).setDepth(35);
    const halo = S.add.circle(tX, apexY - 5, 11, 0xff4f40, 0.3).setDepth(34)
      .setBlendMode(Phaser.BlendModes.ADD);
    S.tweens.add({ targets: [beacon, halo], alpha: 0.15, duration: 520, yoyo: true, repeat: -1 });

    // Walkable mid-level access deck on the tower & upper crane boom catwalk
    this.addOneWayDeck(tX - 64, midY, 128);
    this.addOneWayDeck(opts.boomX, boomY, opts.boomW, opts.label ?? 'СТРЕЛА КРАНА');
  }

  /** Moving cargo hoist / elevator between (x0,y0) and (x1,y1) with endpoint dwell. */
  addMovingLift(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w = 96,
    durationMs = 3400,
    phaseOffset = 0,
  ) {
    const S = this.scene;
    const p = this.pal;
    const sprite = this.lifts.create(x0, y0 + 7, '__rect') as Phaser.Physics.Arcade.Image;
    sprite.setDisplaySize(w, 14).setVisible(false);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.moves = false;

    const visual = S.add.container(x0, y0).setDepth(34);
    const base = S.add.rectangle(0, 7, w, 14, p.beam).setStrokeStyle(1.5, p.beamTop, 0.9);
    const trim = S.add.rectangle(0, 1.5, w - 4, 3, p.beamEdge, 0.92);
    const ledL = S.add.circle(-w / 2 + 8, 7, 2.5, p.accent, 0.95);
    const ledR = S.add.circle(w / 2 - 8, 7, 2.5, p.accent, 0.95);
    visual.add([base, trim, ledL, ledR]);

    const cables = [-w / 2 + 12, w / 2 - 12].map((cx) =>
      S.add.rectangle(x0 + cx, y0 / 2, 2, y0, p.cable, 0.42).setOrigin(0.5, 0.5).setDepth(28),
    );

    const entry: MovingLiftEntry = {
      sprite,
      visual,
      cables,
      x0,
      y0,
      x1,
      y1,
      w,
      durationMs,
      phaseOffset,
      prevX: x0,
      prevTop: y0,
      dx: 0,
      dy: 0,
    };
    this.liftEntries.push(entry);
    this.deckMetas.push({ x: Math.min(x0, x1) - w / 2, right: Math.max(x0, x1) + w / 2, topY: Math.min(y0, y1), w, isLift: true });
    return entry;
  }

  /** Jump pad / bounce pad: pneumatic bumper, steam vent, elastic spore-cap, or grav emitter. */
  addJumpPad(x: number, surfaceY: number, vy = -805, w = 44) {
    const S = this.scene;
    const p = this.pal;
    const padContainer = S.add.container(x, surfaceY).setDepth(35);

    const base = S.add.rectangle(0, -4, w, 8, p.padBase, 1).setStrokeStyle(1, p.beamTop, 0.8);
    let cap: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse;
    if (this.theme === 'jungle') {
      cap = S.add.ellipse(0, -10, w + 4, 12, 0x3bd88f, 0.95).setStrokeStyle(1.5, 0xa8ffda, 0.9);
    } else {
      cap = S.add.rectangle(0, -9, w - 6, 5, p.padGlow, 0.95).setStrokeStyle(1, 0xffffff, 0.55);
    }
    const ring = S.add.ellipse(x, surfaceY - 12, w * 0.75, 6, p.padGlow, 0.35)
      .setDepth(34).setBlendMode(Phaser.BlendModes.ADD);
    padContainer.add([base, cap]);
    S.tweens.add({ targets: ring, scaleX: 1.25, alpha: 0.12, duration: 750, yoyo: true, repeat: -1 });

    // Upward chevron hint
    const arrow = S.add.text(x, surfaceY - 26, '▲', {
      fontFamily: 'monospace', fontSize: '10px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(34).setAlpha(0.65);
    S.tweens.add({ targets: arrow, y: surfaceY - 32, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });

    this.padEntries.push({
      x,
      topY: surfaceY,
      w,
      vy,
      cap,
      ring,
      baseY: cap.y,
      lastTriggered: -1e9,
    });
  }

  /** Diagonal steel cable / vine / mag-rail zipline (`x0,y0 -> x1,y1`). */
  addZipLine(x0: number, y0: number, x1: number, y1: number) {
    const S = this.scene;
    const p = this.pal;
    const g = S.add.graphics().setDepth(31);

    // Anchor posts & braided cable
    g.fillStyle(p.beam, 1);
    g.fillRect(x0 - 4, y0 - 10, 8, 22);
    g.fillRect(x1 - 4, y1 - 8, 8, 20);
    g.fillStyle(p.accent, 0.95);
    g.fillCircle(x0, y0, 4);
    g.fillCircle(x1, y1, 4);

    g.lineStyle(2.5, p.cable, 0.95);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokePath();
    g.lineStyle(1, p.accent, 0.45);
    g.beginPath(); g.moveTo(x0, y0 - 1); g.lineTo(x1, y1 - 1); g.strokePath();

    // Sliding pulley handle waiting at origin
    const pulley = S.add.container(x0, y0).setDepth(35);
    pulley.add([
      S.add.rectangle(0, 0, 14, 6, p.accent).setStrokeStyle(1, 0x161c22, 1),
      S.add.rectangle(0, 7, 4, 10, p.beamTop),
      S.add.rectangle(0, 13, 14, 3, p.accent),
    ]);

    this.zipEntries.push({
      x0,
      y0,
      x1,
      y1,
      length: Math.hypot(x1 - x0, y1 - y0),
      pulley,
      busyUntil: 0,
    });
  }

  /** Suspended explosive cargo below a crane boom/gantry: shoot it to crush foes below! */
  addHangingCargo(x: number, anchorY: number, cableLen = 58) {
    const S = this.scene;
    const crateY = anchorY + cableLen;
    const cable = S.add.rectangle(x, anchorY + cableLen / 2, 2.5, cableLen, this.pal.cable, 0.9).setDepth(32);
    const clasp = S.add.circle(x, anchorY + cableLen - 12, 5, 0xff5a36, 0.95).setDepth(36);
    S.tweens.add({ targets: clasp, alpha: 0.4, scale: 1.25, duration: 500, yoyo: true, repeat: -1 });

    const crate = this.cargos.create(x, crateY, S.textures.exists('prop_crate') ? 'prop_crate' : 'crate_shotgun') as Phaser.Physics.Arcade.Image;
    crate.setDepth(35).setDisplaySize(32, 26).setTint(0xffaa55);
    const body = crate.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);

    const entry: HangingCargoEntry = {
      crate,
      cable,
      clasp,
      dropped: false,
      detonated: false,
      anchorY,
      triggerX: x,
    };
    (crate as any).__cargoEntry = entry;
    this.cargoEntries.push(entry);
    return entry;
  }

  private releaseCargo(entry: HangingCargoEntry) {
    if (entry.dropped || !entry.crate.active) return;
    entry.dropped = true;
    entry.cable.destroy();
    entry.clasp.destroy();
    SFX.play('metal', 0.9);
    const body = entry.crate.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    body.setImmovable(false);
    body.setVelocity(0, 170);
    this.scene.fx?.impact?.(entry.crate.x, entry.anchorY + 14, 1, true);
  }

  private detonateCargo(entry: HangingCargoEntry) {
    if (entry.detonated) return;
    entry.detonated = true;
    const S = this.scene;
    const x = entry.crate.x;
    const y = entry.crate.y;
    entry.crate.destroy();
    S.weapons?.explode?.(x, y, 130, 8, true);
    S.fx?.debris?.(x, y, 14, [0xc8783a, 0x3b4856, 0xffcf60]);
    const cargoPts = addScaledScore(S, 250);
    scorePopup(S, x, y - 28, `+${cargoPts} ГРУЗ!`, '#ffd26b');
  }

  /** Bonus weapon/life/score cache perched on upper crane booms, canopies, or mezzanines. */
  addBonusCache(x: number, surfaceY: number, reward: 'mg' | 'shotgun' | 'laser' | 'life' | 'intel') {
    const S = this.scene as any;
    if (S.pickupSys?.add) {
      S.pickupSys.add(x, surfaceY, reward, { avoidSolids: false, bonusTag: true });
      return;
    }
    const keyMap: Record<typeof reward, string> = {
      mg: 'crate_mg',
      shotgun: 'crate_shotgun',
      laser: 'crate_laser',
      life: 'crate_life',
      intel: 'crate_laser',
    };
    const key = S.textures.exists(keyMap[reward]) ? keyMap[reward] : 'crate_mg';
    const item = S.physics.add.image(x, surfaceY - 14, key).setDepth(52);
    if (reward === 'intel') item.setTint(0x64f0ff);
    (item.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    S.tweens.add({ targets: item, y: item.y - 5, duration: 700, yoyo: true, repeat: -1 });

    if (!S.player) return;
    S.physics.add.overlap(S.player, item, (p: any, b: any) => {
      if (!b?.active) return;
      const feetY = (p?.body as Phaser.Physics.Arcade.Body | undefined)?.bottom ?? p.y + 24;
      if (Math.abs(p.x - b.x) > 28 || Math.abs(feetY - surfaceY) > 36) return;
      const bx = b.x;
      const by = b.y;
      b.destroy();
      SFX.play('pickup');
      S.fx?.boom?.(bx, by, 0.55);
      const basePts = addScaledScore(S, 250);
      if (reward === 'life') {
        run.lives = Math.min(5, run.lives + 1);
        S.hud?.toast?.('ТРОФЕЙ НА ВЫСОТЕ: +1 ЖИЗНЬ');
      } else if (reward === 'intel') {
        run.intel = (run.intel ?? 0) + 1;
        const extra = addScaledScore(S, 350);
        S.hud?.toast?.(`СЕКРЕТНЫЙ КОНТЕЙНЕР (+${basePts + extra})`);
      } else {
        S.player?.giveWeapon?.(reward);
        S.hud?.toast?.('ВЕРХНИЙ ТАЙНИК: БОЕЗАПАС ПОПОЛНЕН');
      }
    });
  }

  /** Animated parachute/drop-cable enemy arrival onto upper booms or ground! */
  spawnDropIn(kind: string, targetX: number, label = '▼ ДЕСАНТ') {
    const S = this.scene;
    if (!S.spawnEnemyAt) return null;
    const x = safeEnemySpawnX(S, targetX);
    const e = S.spawnEnemyAt(kind, x, 72);
    if (!e || !e.body) return null;

    const body = e.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setVelocity(0, 125);

    const canopyColor = this.theme === 'jungle' ? 0x5ee89c : this.theme === 'facility' ? 0x4fe8ff : 0xd6893a;
    const chute = S.add.container(x, e.y - 34).setDepth(58);
    const dome = S.add.ellipse(0, -10, 44, 16, canopyColor, 0.88).setStrokeStyle(1, 0x161b22, 0.9);
    const cordL = S.add.line(0, 0, -16, -5, -4, 16, 0xcad4e0, 0.75);
    const cordR = S.add.line(0, 0, 16, -5, 4, 16, 0xcad4e0, 0.75);
    chute.add([cordL, cordR, dome]);

    if (isWithinCamera(S, x, 80)) {
      scorePopup(S, x, 48, label, '#ffaa4f');
    }

    const spawnedAt = S.time.now;
    const evt = S.time.addEvent({
      delay: 45,
      loop: true,
      callback: () => {
        if (!e.active) { chute.destroy(); evt.remove(); return; }
        chute.setPosition(e.x, e.y - 32);
        const landed = body.blocked.down || body.touching.down || e.y >= GROUND_Y - 12;
        if (landed || (S.time.now - spawnedAt > 4200 && e.y > 260)) {
          body.setAllowGravity(true);
          evt.remove();
          S.tweens.add({
            targets: chute,
            y: chute.y - 24,
            alpha: 0,
            duration: 420,
            onComplete: () => chute.destroy(),
          });
        }
      },
    });
    e.once('destroy', () => { evt.remove(); if (chute.active) chute.destroy(); });
    return e;
  }

  /** Step lifts, jump pads, ziplines, and falling hanging cargo every frame. */
  update(time: number, delta: number, actors: Array<Phaser.Physics.Arcade.Sprite | undefined | null>) {
    const dt = delta / 1000;
    const hero = this.scene.player as any;

    // 1. Update moving lifts & carry standing actors smoothly
    for (const l of this.liftEntries) {
      const tRaw = ((time / l.durationMs + l.phaseOffset) % 1 + 1) % 1;
      const tri = tRaw < 0.5 ? tRaw * 2 : 2 - tRaw * 2;
      // 15% endpoint dwell so stepping onto/off a hoist feels crisp
      const eased = Phaser.Math.Clamp((tri - 0.12) / 0.76, 0, 1);
      const smooth = eased * eased * (3 - 2 * eased);
      const nx = Phaser.Math.Linear(l.x0, l.x1, smooth);
      const ny = Phaser.Math.Linear(l.y0, l.y1, smooth);

      l.dx = nx - l.prevX;
      l.dy = ny - l.prevTop;
      l.sprite.setPosition(nx, ny + 7);
      (l.sprite.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
      l.visual.setPosition(nx, ny);
      if (l.cables) {
        const xs = [-l.w / 2 + 12, l.w / 2 - 12];
        l.cables.forEach((c, idx) => {
          c.setPosition(nx + xs[idx], ny / 2);
          c.setDisplaySize(2, Math.max(4, ny));
        });
      }

      const left = nx - l.w / 2 - 8;
      const right = nx + l.w / 2 + 8;
      for (const a of actors) {
        if (!a?.active || !a.body) continue;
        const ab = a.body as Phaser.Physics.Arcade.Body;
        if ((a as any).zipState) continue;
        const onTop = ab.velocity.y >= -25 && Math.abs(ab.bottom - l.prevTop) <= 10 && a.x >= left && a.x <= right;
        if (onTop) {
          a.x = Phaser.Math.Clamp(a.x + l.dx, 16, WORLD_W - 16);
          if (l.dy > 0) a.y += l.dy;
        }
      }

      l.prevX = nx;
      l.prevTop = ny;
    }

    // 2. First-time upper-deck drop-through hint
    if (!this.hintShown && hero?.active && hero.body?.blocked?.down && hero.getBottomY?.() < GROUND_Y - 5) {
      this.hintShown = true;
      scorePopup(this.scene, hero.x, hero.y - 38, 'S + SPACE ↓ спрыгнуть', '#9ae6ff');
    }

    // 3. Jump pads (Hero + pursuing ground enemies)
    for (const pad of this.padEntries) {
      for (const a of actors) {
        if (!a?.active || !a.body || (a as any).zipState) continue;
        const ab = a.body as Phaser.Physics.Arcade.Body;
        const isHero = a === hero;
        const minCooldown = isHero ? 260 : 950;
        if (time - pad.lastTriggered < minCooldown && !isHero) continue;
        if (isHero && typeof hero.jumpPadCooldownUntil === 'number' && time < hero.jumpPadCooldownUntil) continue;
        const xOk = Math.abs(a.x - pad.x) < pad.w * 0.56;
        const yOk = ab.bottom >= pad.topY - 14 && ab.bottom <= pad.topY + 18;
        if (xOk && yOk && ab.velocity.y >= -45) {
          const boostVy = isHero ? pad.vy : Math.max(-560, pad.vy * 0.72);
          if (!isHero && hero && hero.y >= pad.topY - 25) continue; // enemies only bounce if pursuing someone higher
          ab.setVelocityY(boostVy);
          if (isHero) {
            hero.jumpPadCooldownUntil = time + 260;
            SFX.play('jump', 1.15);
            this.scene.fx?.jumpDust?.(pad.x, pad.topY);
            for (let i = 0; i < 6; i++) {
              this.scene.fx?.particle?.(pad.x + rand(-14, 14), pad.topY - 6, this.pal.padGlow, rand(-90, 90), rand(-160, -60), 260, 3);
            }
          }
          pad.lastTriggered = time;
          this.scene.tweens.add({ targets: pad.cap, y: pad.baseY + 4, duration: 70, yoyo: true });
        }
      }
    }

    // 4. Ziplines: attach & ride
    if (hero?.active && hero.body) {
      if (hero.zipState) {
        this.stepZipRide(hero, time, dt);
      } else if (time >= (hero.zipCooldownUntil ?? 0)) {
        const hb = hero.body as Phaser.Physics.Arcade.Body;
        const hx = hero.x;
        const hy = hb.center.y - 6;
        for (const z of this.zipEntries) {
          if (time < z.busyUntil) continue;
          const dx = z.x1 - z.x0;
          const dy = z.y1 - z.y0;
          const lenSq = dx * dx + dy * dy;
          if (lenSq < 1) continue;
          const t = Phaser.Math.Clamp(((hx - z.x0) * dx + (hy - z.y0) * dy) / lenSq, 0, 1);
          if (t > 0.78) continue;
          const cx = z.x0 + dx * t;
          const cy = z.y0 + dy * t;
          const dist = Math.hypot(hx - cx, hy - cy);
          if (dist <= 28 && hb.velocity.y >= -130) {
            hero.zipState = {
              x0: z.x0,
              y0: z.y0,
              x1: z.x1,
              y1: z.y1,
              t,
              speed: 440,
              pulley: z.pulley,
              resetX: z.x0,
              resetY: z.y0,
            } satisfies ActiveZipRide;
            hb.setAllowGravity(false);
            hb.setVelocity(0, 0);
            SFX.play('metal', 0.8);
            if (!this.zipHintShown) {
              this.zipHintShown = true;
              scorePopup(this.scene, hx, hy - 34, 'ТРОС: J огонь · SPACE прыжок', '#7ef2ff');
            }
            z.busyUntil = time + 900;
            break;
          }
        }
      }
    }

    // 5. Falling hanging cargos: detonate on enemy contact or floor
    for (const c of this.cargoEntries) {
      if (c.detonated) continue;
      if (!c.dropped && !c.crate.active) { c.detonated = true; continue; }
      if (!c.dropped) continue;
      const crate = c.crate;
      const hitEnemy = (this.scene.enemies?.getChildren?.() ?? []).some((e: any) =>
        e.active && Math.hypot(e.x - crate.x, e.y - crate.y) < 38,
      );
      const cbody = crate.body as Phaser.Physics.Arcade.Body | undefined;
      const hitSolid = !!cbody && (cbody.blocked.down || cbody.touching.down);
      if (hitEnemy || hitSolid || crate.y >= GROUND_Y + 18) {
        this.detonateCargo(c);
      }
    }
  }

  private stepZipRide(hero: any, time: number, dt: number) {
    const z = hero.zipState as ActiveZipRide;
    const len = Math.max(1, Math.hypot(z.x1 - z.x0, z.y1 - z.y0));
    z.t += (z.speed * dt) / len;
    const tClamped = Math.min(1, z.t);
    const px = Phaser.Math.Linear(z.x0, z.x1, tClamped);
    const py = Phaser.Math.Linear(z.y0, z.y1, tClamped);

    let rideY = py + 24;
    const body = hero.body as Phaser.Physics.Arcade.Body | undefined;
    const hw = body && body.width > 0 ? body.halfWidth : 9;
    const topOff = body && body.height > 0 ? body.top - hero.y : -8;
    const botOff = body && body.height > 0 ? body.bottom - hero.y : 28;
    const solids = collectSolidWalls(this.scene);
    const hL = px - hw, hR = px + hw;
    for (let pass = 0; pass < 2; pass++) {
      let adjusted = false;
      for (const s of solids) {
        if (hR > s.left + 1 && hL < s.right - 1 && rideY + botOff > s.top + 1 && rideY + topOff < s.bottom - 1) {
          rideY = Math.min(rideY, s.top - botOff - 1);
          adjusted = true;
        }
      }
      if (!adjusted) break;
    }

    hero.setPosition(px, rideY);
    if (body) {
      body.reset(px, rideY);
      body.setAllowGravity(false);
      body.setVelocity(0, 0);
    }
    if (z.pulley?.active) z.pulley.setPosition(px, py);

    if (Math.random() < 0.45) {
      this.scene.fx?.particle?.(px, py, 0xffe28a, rand(-50, 15), rand(15, 65), 180, 2);
    }

    if (z.t >= 1) {
      this.releaseZip(hero, time, 220, -140);
    }
  }

  releaseZip(hero: any, time: number, vxCarry = 180, vyBoost = -420) {
    const z = hero.zipState as ActiveZipRide | undefined;
    if (!z) return;
    const dir = z.x1 >= z.x0 ? 1 : -1;
    hero.zipState = undefined;
    hero.zipCooldownUntil = time + 360;
    const body = hero.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) {
      body.reset(hero.x, hero.y);
      body.setAllowGravity(true);
      body.setVelocity(dir * vxCarry, vyBoost);
    }
    resolveSolidOverlap(hero, this.scene);
    if (z.pulley?.active) z.pulley.setPosition(z.resetX, z.resetY);
  }

  /** Helper for Enemy platform navigation: finds an overhead one-way deck to climb. */
  findDeckAbove(x: number, feetY: number, maxRise = 128): DeckMeta | null {
    let best: DeckMeta | null = null;
    let bestDy = maxRise + 1;
    for (const d of this.deckMetas) {
      if (d.isLift) continue;
      if (x < d.x - 16 || x > d.right + 16) continue;
      const dy = feetY - d.topY;
      if (dy > 26 && dy <= maxRise && dy < bestDy) {
        best = d;
        bestDy = dy;
      }
    }
    return best;
  }

  /** Helper for Enemy AI: checks whether actor is currently standing on an elevated deck. */
  findCurrentDeck(x: number, feetY: number): DeckMeta | null {
    for (const d of this.deckMetas) {
      if (x >= d.x - 6 && x <= d.right + 6 && Math.abs(feetY - d.topY) <= 14) {
        return d;
      }
    }
    return null;
  }
}

export { pick };
