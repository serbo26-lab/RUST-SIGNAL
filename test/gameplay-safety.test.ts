import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SFX } from '../src/game/audio';
import { GRAVITY, GROUND_Y, JUMP_VELOCITY, WORLD_W } from '../src/game/core';
import { TankSystem } from '../src/game/boss';
import { Player } from '../src/game/player';
import { StageTraversal } from '../src/game/traversal';
import { WeaponsSystem } from '../src/game/weapons';
import {
  findClearGroundX,
  findSafeRespawnPoint,
  hasGroundAt,
  lockBossArena,
  MAX_JUMP_RISE,
  resolveClearX,
  resolveSolidOverlap,
} from '../src/game/world-rules';

function makeStaticBody(left: number, top: number, right: number, bottom: number, opts: { ground?: boolean; enable?: boolean } = {}) {
  return {
    enable: opts.enable ?? true,
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    gameObject: opts.ground ? { getData: (k: string) => k === 'ground' } : {},
  };
}

function makeFakeActor(x: number, y: number, w = 24, h = 56) {
  const hw = w / 2;
  const hh = h / 2;
  const actor: any = {
    x,
    y,
    body: {
      left: x - hw,
      right: x + hw,
      top: y - hh,
      bottom: y + hh,
      width: w,
      height: h,
      velocity: { x: 40, y: 120 },
      reset(nx: number, ny: number) {
        actor.x = nx;
        actor.y = ny;
        this.left = nx - hw;
        this.right = nx + hw;
        this.top = ny - hh;
        this.bottom = ny + hh;
      },
      setVelocity(vx: number, vy: number) {
        this.velocity.x = vx;
        this.velocity.y = vy;
      },
    },
    setPosition(nx: number, ny: number) {
      actor.x = nx;
      actor.y = ny;
      return actor;
    },
  };
  return actor;
}

describe('gameplay placement, respawn, and anti-stuck safety', () => {
  it('resolveClearX clears wide 3-container stacks without falling back inside obstacle', () => {
    // 326px wide container cluster matching Harbor/Train clusters
    const stack = [{ left: 2515, right: 2841, top: GROUND_Y - 12, bottom: GROUND_Y + 35 }];
    const x = resolveClearX(2600, 48, stack, { surfaceY: GROUND_Y + 35, objectHeight: 48, padding: 12 });
    const fitsLeft = x + 48 + 12 <= 2515;
    const fitsRight = x - 48 - 12 >= 2841;
    expect(fitsLeft || fitsRight).toBe(true);
  });

  it('hasGroundAt detects inter-car chasms while accepting train decks', () => {
    const spans = [
      { left: 0, right: 1345, top: GROUND_Y + 35 },
      { left: 1430, right: 2780, top: GROUND_Y + 35 },
    ];
    expect(hasGroundAt(spans, 1290, 16)).toBe(true);
    expect(hasGroundAt(spans, 1388, 16)).toBe(false);
    expect(hasGroundAt(spans, 1435, 16)).toBe(false); // straddles left lip
    expect(hasGroundAt(spans, 1460, 16)).toBe(true);
  });

  it('findSafeRespawnPoint moves hero clear of solid stacks, chasms, vehicles, and pads', () => {
    const scene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, 1345, GROUND_Y + 95, { ground: true }),
              makeStaticBody(1430, GROUND_Y + 35, 2900, GROUND_Y + 95, { ground: true }),
              // Container wall on car 1 near lip & raised solid on car 2
              makeStaticBody(1200, GROUND_Y - 25, 1320, GROUND_Y + 35),
              makeStaticBody(1600, GROUND_Y - 30, 1850, GROUND_Y + 35),
            ],
          },
        },
      },
      traversal: {
        oneWayGroup: { getChildren: () => [] },
        padEntries: [{ x: 1120, topY: GROUND_Y + 35, w: 46 }],
      },
      machines: [{ x: 1520, y: GROUND_Y + 11, active: true, body: { width: 104, height: 48 } }],
      turrets: [],
      props: { group: { getChildren: () => [] } },
      tankSys: { tank: null },
    };

    // Trying to respawn right over the train gap (1385) or inside solid (1260) or on jump pad (1120)
    const fromGap = findSafeRespawnPoint(scene, 1385);
    expect(fromGap.y).toBe(GROUND_Y - 24);
    expect(hasGroundAt([{ left: 0, right: 1345, top: GROUND_Y + 35 }, { left: 1430, right: 2900, top: GROUND_Y + 35 }], fromGap.x, 14)).toBe(true);
    expect(fromGap.x + 14 <= 1200 || fromGap.x - 14 >= 1320).toBe(true);
    expect(Math.abs(fromGap.x - 1120)).toBeGreaterThanOrEqual(30);

    const fromApc = findSafeRespawnPoint(scene, 1520);
    expect(Math.abs(fromApc.x - 1520)).toBeGreaterThan(56);
    expect(fromApc.x + 14 <= 1600 || fromApc.x - 14 >= 1850).toBe(true);
  });

  it('findSafeRespawnPoint never spawns player past a locked boss gate or outside active boss arena', () => {
    const gate = makeStaticBody(4950, 200, 5010, GROUND_Y + 35);
    const dataMap = new Map<string, number>();
    const lockedScene: any = {
      bossEntered: false,
      gateBody: gate, // matches Facility where scene.gateBody IS the StaticBody directly
      data: { get: (k: string) => dataMap.get(k) },
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true }),
              gate,
            ],
          },
        },
      },
      traversal: { oneWayGroup: { getChildren: () => [] }, padEntries: [] },
    };

    const preGate = findSafeRespawnPoint(lockedScene, 4960);
    expect(preGate.x).toBeLessThanOrEqual(4950 - 44);

    lockedScene.bossEntered = true;
    dataMap.set('bossArenaLeft', 5020);
    dataMap.set('bossArenaRight', 5900);
    lockedScene.machines = [{ x: 5100, y: GROUND_Y + 11, active: true, body: { width: 104, height: 48 } }];
    const inArena = findSafeRespawnPoint(lockedScene, 5025);
    expect(inArena.x).toBeGreaterThanOrEqual(5020 + 44);
    expect(inArena.x).toBeLessThanOrEqual(5900 - 44);
  });

  it('resolveSolidOverlap ejects embedded player out of containers without pushing off train car cliffs', () => {
    const scene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, 1345, GROUND_Y + 95, { ground: true }),
              makeStaticBody(1190, GROUND_Y - 10, 1338, GROUND_Y + 35),
            ],
          },
        },
      },
      traversal: { oneWayGroup: { getChildren: () => [] } },
    };

    // Embedded near right edge of container bordering chasm at x=1345 (must NOT push right into void!)
    const actor = makeFakeActor(1315, GROUND_Y + 4, 24, 56);
    const moved = resolveSolidOverlap(actor, scene);
    expect(moved).toBe(true);
    // Should lift cleanly onto container top rather than pushing into 1345..1430 pit
    expect(actor.body.bottom).toBeLessThanOrEqual(GROUND_Y - 10);
    expect(actor.x).toBeLessThan(1345);
  });

  it('resolveSolidOverlap escapes corner traps bounded by adjacent solids', () => {
    const solids = [
      makeStaticBody(800, GROUND_Y - 120, 910, GROUND_Y + 35),
      makeStaticBody(910, GROUND_Y - 50, 1020, GROUND_Y + 35),
      makeStaticBody(1020, GROUND_Y - 90, 1140, GROUND_Y + 35),
    ];
    const scene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true }),
              ...solids,
            ],
          },
        },
      },
      traversal: { oneWayGroup: { getChildren: () => [] } },
    };
    // Trapped in center block: left & right are blocked by taller walls, must lift onto center block top
    const actor = makeFakeActor(965, GROUND_Y - 5, 24, 56);
    const moved = resolveSolidOverlap(actor, scene);
    expect(moved).toBe(true);
    expect(actor.body.bottom).toBeLessThanOrEqual(GROUND_Y - 50);

    // Trapped in corner between center and right step without left blocker: zero overlap with any solid
    const openLeftScene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true }),
              solids[1],
              solids[2],
            ],
          },
        },
      },
      traversal: { oneWayGroup: { getChildren: () => [] } },
    };
    const actor2 = makeFakeActor(960, GROUND_Y - 5, 24, 56);
    expect(resolveSolidOverlap(actor2, openLeftScene)).toBe(true);
    for (const s of [solids[1], solids[2]]) {
      const overlapX = Math.min(actor2.body.right, s.right) - Math.max(actor2.body.left, s.left);
      const overlapY = Math.min(actor2.body.bottom, s.bottom) - Math.max(actor2.body.top, s.top);
      expect(overlapX <= 0 || overlapY <= 0).toBe(true);
    }
  });

  it('findClearGroundX keeps vehicles out of obstacles, jump pads, and neighboring vehicles', () => {
    const scene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true }),
              makeStaticBody(2515, GROUND_Y - 20, 2838, GROUND_Y + 35),
            ],
          },
        },
      },
      traversal: {
        oneWayGroup: { getChildren: () => [] },
        padEntries: [{ x: 3000, topY: GROUND_Y + 35, w: 46 }],
      },
      machines: [{ x: 2420, y: GROUND_Y + 11, active: true, body: { width: 104, height: 48 } }],
      turrets: [],
      props: { group: { getChildren: () => [] } },
      tankSys: { tank: null },
    };

    const apcX = findClearGroundX(scene, 2600, 54, GROUND_Y + 35, {
      objectHeight: 50,
      padding: 10,
      avoidPads: true,
      includeMachines: true,
      includeProps: true,
      includeTurrets: true,
    });
    expect(apcX + 64 <= 2515 || apcX - 64 >= 2838).toBe(true);
    expect(Math.abs(apcX - 2420)).toBeGreaterThanOrEqual(90);

    const tankX = findClearGroundX(scene, 3000, 38, GROUND_Y + 35, {
      objectHeight: 46,
      padding: 10,
      avoidPads: true,
      includeMachines: true,
      includeProps: true,
      includeTurrets: true,
    });
    expect(Math.abs(tankX - 3000)).toBeGreaterThanOrEqual(60);
  });

  it('resolveSolidOverlap ignores oneWayDecks so passing through crane booms never triggers false rescue', () => {
    const boomObj = { tag: 'boom' };
    const boomBody = { ...makeStaticBody(500, GROUND_Y - 128, 860, GROUND_Y - 114), gameObject: boomObj };
    const scene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true }),
              boomBody,
            ],
          },
        },
      },
      traversal: {
        oneWayDecks: { children: true, getChildren: () => [boomObj] },
      },
    };
    const jumpingHero = makeFakeActor(650, GROUND_Y - 122, 24, 56);
    expect(resolveSolidOverlap(jumpingHero, scene)).toBe(false);
    expect(jumpingHero.y).toBe(GROUND_Y - 122);
  });

  it('findClearGroundX and findSafeRespawnPoint avoid machineGrp turrets and stage heaters/terminals/anchors', () => {
    const turret = { name: 'turret', x: 2200, y: GROUND_Y + 11, active: true, body: { width: 42, height: 34 } };
    const heater = { x: 2834, y: GROUND_Y + 4, active: true, body: { width: 44, height: 62 } };
    const scene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true }),
            ],
          },
        },
      },
      traversal: { oneWayDecks: { children: true, getChildren: () => [] }, padEntries: [] },
      machineGrp: { children: true, getChildren: () => [turret] },
      heaters: { children: true, getChildren: () => [heater] },
      machines: [],
      props: { group: { children: true, getChildren: () => [] } },
      tankSys: { tank: null },
    };

    const barrelX = findClearGroundX(scene, 2830, 14, GROUND_Y + 35, {
      objectHeight: 38,
      includeProps: true,
      includeMachines: true,
      includeTurrets: true,
      avoidPads: true,
    });
    expect(Math.abs(barrelX - 2834)).toBeGreaterThanOrEqual(40);

    const respawnX = findSafeRespawnPoint(scene, 2200);
    expect(Math.abs(respawnX.x - 2200)).toBeGreaterThan(36);
  });

  it('lockBossArena clears pre-boss enemy APCs and turrets inside arena while preserving player tank', () => {
    const destroyed: string[] = [];
    const makeObj = (id: string, x: number) => ({
      id,
      x,
      active: true,
      destroy() {
        this.active = false;
        destroyed.push(id);
      },
    });
    const earlyApc = makeObj('earlyApc', 2240);
    const lateApc = makeObj('lateApc', 4720);
    const lateTurret = makeObj('lateTurret', 4870);
    const playerTank = makeObj('playerTank', 4920);
    const boss: any = { x: 5380, active: true };
    const player = makeFakeActor(4950, GROUND_Y - 20);
    const dataMap = new Map<string, any>();
    const scene: any = {
      cameras: {
        main: {
          scrollY: 0,
          stopFollow() {},
          setBounds() {},
          setScroll() {},
        },
      },
      data: {
        get: (k: string) => dataMap.get(k),
        set: (k: string, v: any) => dataMap.set(k, v),
      },
      enemies: { getChildren: () => [] },
      machineGrp: { getChildren: () => [earlyApc, lateApc, lateTurret] },
      machines: [earlyApc, lateApc],
      turrets: [lateTurret],
      tankSys: { tank: playerTank },
      weapons: { enemyBullets: { clear() {} } },
    };

    lockBossArena(scene, player, boss);

    expect(destroyed).toContain('lateApc');
    expect(destroyed).toContain('lateTurret');
    expect(destroyed).not.toContain('earlyApc');
    expect(destroyed).not.toContain('playerTank');
    expect(playerTank.active).toBe(true);
    expect(scene.machines).toEqual([earlyApc]);
    expect(scene.turrets).toEqual([]);
  });

  it('releaseZip syncs stale body bounds before resolveSolidOverlap ejects the hero', () => {
    const hero = makeFakeActor(4260, GROUND_Y - 12, 24, 56);
    // Simulate stale pre-step body coordinates from an earlier zipline position
    hero.body.left = 3980;
    hero.body.right = 4004;
    hero.body.top = GROUND_Y - 160;
    hero.body.bottom = GROUND_Y - 104;
    hero.body.setAllowGravity = () => {};
    hero.zipState = {
      x0: 3980,
      y0: GROUND_Y - 128,
      x1: 4260,
      y1: GROUND_Y - 144,
      t: 1,
      speed: 440,
      resetX: 3980,
      resetY: GROUND_Y - 128,
    };

    const containerWall = makeStaticBody(4152, GROUND_Y - 41, 4448, GROUND_Y + 35);
    const scene: any = {
      physics: {
        world: {
          staticBodies: {
            entries: [
              makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true }),
              containerWall,
            ],
          },
        },
      },
      traversal: { oneWayDecks: { children: true, getChildren: () => [] } },
    };

    StageTraversal.prototype.releaseZip.call({ scene }, hero, 2000, 220, -140);

    expect(hero.zipState).toBeUndefined();
    expect(hero.body.bottom).toBeLessThanOrEqual(containerWall.top);
  });

  it('discrete Euler jump rise clears >= 65px obstacles by >= 20px at both 60fps and 30fps', () => {
    const eulerRise = (v0: number, dt: number) => {
      let y = 0;
      let vy = -Math.abs(v0);
      let minY = 0;
      for (let i = 0; i < 120; i++) {
        vy += GRAVITY * dt;
        y += vy * dt;
        if (y < minY) minY = y;
        if (vy > 0 && y >= 0) break;
      }
      return -minY;
    };

    const rise60 = eulerRise(JUMP_VELOCITY, 1 / 60);
    const rise30 = eulerRise(JUMP_VELOCITY, 1 / 30);

    expect(MAX_JUMP_RISE).toBeCloseTo((JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY), 5);
    expect(rise60 - 65).toBeGreaterThanOrEqual(25);
    expect(rise30 - 65).toBeGreaterThanOrEqual(20);
    expect(rise30 - 70).toBeGreaterThanOrEqual(18);
  });

  it('keeps all chapter and boss ziplines downhill/level across all 6 episodes', () => {
    const files = [
      'src/game/level.ts',
      'src/game/train.ts',
      'src/game/jungle.ts',
      'src/game/facility.ts',
      'src/game/bastion.ts',
      'src/game/beacon.ts',
    ];
    const evalExpr = (expr: string) => {
      const normalized = expr.replace(/GROUND_Y/g, String(GROUND_Y));
      expect(normalized).toMatch(/^[\d\s+\-*/().]+$/);
      return Function(`"use strict"; return (${normalized});`)() as number;
    };

    let count = 0;
    for (const rel of files) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
      for (const m of src.matchAll(/addZipLine\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/g)) {
        const y0 = evalExpr(m[2]);
        const y1 = evalExpr(m[4]);
        expect(y1, `${rel} zipline ${m[0]} must not go uphill`).toBeGreaterThanOrEqual(y0);
        count++;
      }
    }
    expect(count).toBe(12);
  });

  it('Player.respawn clears inTank and rolling flags and TankSystem.update dismounts cleanly on player death/respawn', () => {
    const fakePlayer: any = {
      dead: true,
      inTank: true,
      rolling: true,
      charId: 'kael',
      hitboxOffsetX: 15,
      hitboxOffsetY: 20,
      scene: {
        physics: { world: { staticBodies: { entries: [makeStaticBody(0, GROUND_Y + 35, WORLD_W, GROUND_Y + 95, { ground: true })] } } },
      },
      body: {
        left: 90,
        right: 108,
        top: 660,
        bottom: 696,
        velocity: { x: 0, y: 0 },
        setAllowGravity: () => {},
        setSize() { return this; },
        setOffset() { return this; },
        reset(nx: number, ny: number) {
          this.left = nx - 9;
          this.right = nx + 9;
          this.top = ny - 8;
          this.bottom = ny + 28;
        },
        setVelocity(vx: number, vy: number) {
          this.velocity.x = vx;
          this.velocity.y = vy;
        },
      },
      setVisible() { return this; },
      setPosition(nx: number, ny: number) {
        this.x = nx;
        this.y = ny;
        return this;
      },
      setAngle() { return this; },
    };

    Player.prototype.respawn.call(fakePlayer, 400, 1234, GROUND_Y - 24);
    expect(fakePlayer.dead).toBe(false);
    expect(fakePlayer.inTank).toBe(false);
    expect(fakePlayer.rolling).toBe(false);

    let mountedState = true;
    let promptVisible = false;
    let velX = 120;
    const tankObj: any = {
      x: 1920,
      y: GROUND_Y + 80,
      flipX: false,
      body: {
        bottom: GROUND_Y + 90,
        velocity: { x: velX, y: 200 },
        blocked: { down: true },
        setVelocityX(v: number) { velX = v; this.velocity.x = v; },
        setVelocityY(v: number) { this.velocity.y = v; },
        updateFromGameObject() { this.bottom = tankObj.y + 18; },
      },
      setData(_k: string, v: boolean) { mountedState = v; },
    };
    const tankSys: any = {
      scene: { enemies: { children: { each: () => {} } }, fx: {} },
      tank: tankObj,
      active: true,
      hp: 10,
      hpMax: 12,
      treadDustAt: 0,
      lastCannon: 0,
      prompt: { active: true, setVisible(v: boolean) { promptVisible = v; return this; }, setPosition() { return this; } },
      hpBg: { setVisible() { return this; }, setPosition() { return this; } },
      hpBar: { setVisible() { return this; }, setPosition() { return this; }, setDisplaySize() { return this; }, setFillStyle() { return this; } },
      hpText: { setVisible() { return this; }, setPosition() { return this; }, setText() { return this; }, setColor() { return this; } },
      criticalCue: { setVisible() { return this; }, setPosition() { return this; } },
    };

    TankSystem.prototype.update.call(tankSys, 2000, fakePlayer, { left: false, right: false, up: false, fire: false, jump: false });
    expect(tankSys.active).toBe(false);
    expect(mountedState).toBe(false);
    expect(promptVisible).toBe(false);
    fakePlayer.x = 1880;
    TankSystem.prototype.update.call(tankSys, 2016, fakePlayer, { left: false, right: false, up: false, fire: false, jump: false });
    expect(promptVisible).toBe(true);
    expect(velX).toBe(0);
    expect(tankObj.body.bottom).toBeLessThanOrEqual(GROUND_Y + 35);
    expect(fakePlayer.x).toBe(1880);
  });

  it('WeaponsSystem.explode does not throw when player.inTank is true on a scene without tankSys', () => {
    const sfxSpy = vi.spyOn(SFX, 'play').mockImplementation(() => {});
    const scene: any = {
      fx: {},
      player: { x: 500, y: GROUND_Y, inTank: true },
      enemies: { getChildren: () => [] },
    };
    try {
      expect(() => WeaponsSystem.prototype.explode.call({ scene }, 500, GROUND_Y, 90, 5, true)).not.toThrow();
    } finally {
      sfxSpy.mockRestore();
    }
  });

  it('TankSystem syncs player body gravity/position while mounted and restores gravity on eject', () => {
    const sfxSpy = vi.spyOn(SFX, 'play').mockImplementation(() => {});
    let allowGravity = true;
    let jumpVelY = 0;
    const fakePlayer: any = {
      x: 1920,
      y: GROUND_Y + 7,
      inTank: false,
      dead: false,
      invulnUntil: 0,
      visible: true,
      body: {
        left: 1911,
        right: 1929,
        top: 469,
        bottom: 505,
        velocity: { x: 0, y: 420 },
        setAllowGravity(v: boolean) { allowGravity = v; },
        setVelocity(vx: number, vy: number) { this.velocity.x = vx; this.velocity.y = vy; },
        reset(nx: number, ny: number) {
          this.left = nx - 9;
          this.right = nx + 9;
          this.top = ny - 8;
          this.bottom = ny + 28;
        },
      },
      setVisible(v: boolean) { this.visible = v; return this; },
      setPosition(nx: number, ny: number) { this.x = nx; this.y = ny; return this; },
    };
    const tankObj: any = {
      x: 1940,
      y: 478,
      flipX: false,
      setFlipX(v: boolean) { this.flipX = v; return this; },
      setImmovable() { return this; },
      body: {
        bottom: 505,
        velocity: { x: 0, y: 0 },
        blocked: { down: true },
        setVelocityX(v: number) { this.velocity.x = v; },
        setVelocityY(v: number) { jumpVelY = v; this.velocity.y = v; },
        updateFromGameObject() {},
      },
      setData() {},
    };
    const tankSys: any = {
      scene: {
        time: { now: 1000 },
        enemies: { children: { each: () => {} } },
        physics: { world: { staticBodies: { entries: [] } } },
        hud: { flashWeapon: () => {} },
        radio: { say: () => {} },
        fx: {},
      },
      tank: tankObj,
      active: false,
      hp: 16,
      hpMax: 16,
      treadDustAt: 0,
      lastCannon: 0,
      prompt: { active: true, setVisible() { return this; }, setPosition() { return this; } },
      hpBg: { setVisible() { return this; }, setPosition() { return this; } },
      hpBar: { setVisible() { return this; }, setPosition() { return this; }, setDisplaySize() { return this; }, setFillStyle() { return this; } },
      hpText: { setVisible() { return this; }, setPosition() { return this; }, setText() { return this; }, setColor() { return this; } },
      criticalCue: { setVisible() { return this; }, setPosition() { return this; } },
    };

    try {
      expect(TankSystem.prototype.board.call(tankSys, fakePlayer)).toBe(true);
      expect(allowGravity).toBe(false);
      expect(fakePlayer.body.velocity.y).toBe(0);
      expect(fakePlayer.body.bottom).toBe(tankObj.y + 28);

      tankObj.x = 2050;
      fakePlayer.body.velocity.y = 300;
      TankSystem.prototype.update.call(tankSys, 1100, fakePlayer, { left: false, right: true, up: false, fire: false, jump: true });
      expect(allowGravity).toBe(false);
      expect(fakePlayer.x).toBe(2050);
      expect(fakePlayer.y).toBe(478);
      expect(fakePlayer.body.velocity.y).toBe(0);
      expect(jumpVelY).toBeLessThanOrEqual(-590);

      TankSystem.prototype.eject.call(tankSys, fakePlayer);
      expect(allowGravity).toBe(true);
      expect(fakePlayer.inTank).toBe(false);
      expect(fakePlayer.visible).toBe(true);
    } finally {
      sfxSpy.mockRestore();
    }
  });
});
