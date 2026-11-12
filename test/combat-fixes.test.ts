import { describe, it, expect } from 'vitest';
import { evaluateObstacleAhead, type ObstacleBox } from '../src/game/enemies';
import { resolvePlayerAim } from '../src/game/player';
import { computeCrouchSlices } from '../src/game/crouch-pose';
import { evaluatePickupInteraction } from '../src/game/pickups';
import { resolveClearX } from '../src/game/world-rules';
import { computeTankMuzzlePoint } from '../src/game/boss';

describe('enemy crouch & obstacle traversal', () => {
  const standH = 35;
  const crouchH = 18;

  it('crouches when approaching a floating low-clearance container', () => {
    const actor: ObstacleBox = { left: 716, right: 740, top: 470, bottom: 505 };
    const lowClearanceContainer: ObstacleBox = { left: 750, right: 860, top: 420, bottom: 473 };
    // Clearance = 505 - 473 = 32px (< standH 35, >= crouchH 18)
    const res = evaluateObstacleAhead(actor, standH, crouchH, 1, [lowClearanceContainer], true);
    expect(res.crouch).toBe(true);
    expect(res.jump).toBe(false);
    expect(res.ceilingOverhead).toBe(false);
  });

  it('keeps crouching while directly beneath an overhead obstacle', () => {
    const actor: ObstacleBox = { left: 780, right: 804, top: 487, bottom: 505 };
    const overheadContainer: ObstacleBox = { left: 750, right: 860, top: 420, bottom: 473 };
    const res = evaluateObstacleAhead(actor, standH, crouchH, 1, [overheadContainer], true);
    expect(res.ceilingOverhead).toBe(true);
    expect(res.crouch).toBe(true);
  });

  it('jumps over a floor-flush low obstacle that cannot be crouched under', () => {
    const actor: ObstacleBox = { left: 700, right: 724, top: 470, bottom: 505 };
    const floorCrate: ObstacleBox = { left: 734, right: 784, top: 455, bottom: 505 };
    const res = evaluateObstacleAhead(actor, standH, crouchH, 1, [floorCrate], true);
    expect(res.crouch).toBe(false);
    expect(res.jump).toBe(true);
  });

  it('does not crouch or jump when path is clear', () => {
    const actor: ObstacleBox = { left: 400, right: 424, top: 470, bottom: 505 };
    const farCrate: ObstacleBox = { left: 900, right: 960, top: 455, bottom: 505 };
    const res = evaluateObstacleAhead(actor, standH, crouchH, 1, [farCrate], true);
    expect(res.crouch).toBe(false);
    expect(res.jump).toBe(false);
    expect(res.ceilingOverhead).toBe(false);
  });
});

describe('player downward aim without breaking grounded crouch', () => {
  it('keeps S on flat ground as crouch without aiming down', () => {
    const res = resolvePlayerAim({
      upHeld: false,
      downHeld: true,
      aimDownKey: false,
      mv: 0,
      onGround: true,
      crouching: true,
      elevated: false,
    });
    expect(res.aimDown).toBe(false);
    expect(res.aimDiagDown).toBe(false);
  });

  it('aims straight down from elevated decks or diagonally down on flat ground with Q/Shift', () => {
    const elevatedStraight = resolvePlayerAim({
      upHeld: false,
      downHeld: false,
      aimDownKey: true,
      mv: 0,
      onGround: true,
      crouching: false,
      elevated: true,
    });
    expect(elevatedStraight).toEqual({
      aimUp: false,
      aimDiagUp: false,
      aimDown: true,
      aimDiagDown: false,
    });

    const groundDiag = resolvePlayerAim({
      upHeld: false,
      downHeld: false,
      aimDownKey: true,
      mv: 0,
      onGround: true,
      crouching: false,
      elevated: false,
    });
    expect(groundDiag).toEqual({
      aimUp: false,
      aimDiagUp: false,
      aimDown: false,
      aimDiagDown: true,
    });

    const diagMoving = resolvePlayerAim({
      upHeld: false,
      downHeld: false,
      aimDownKey: true,
      mv: 1,
      onGround: true,
      crouching: false,
      elevated: true,
    });
    expect(diagMoving).toEqual({
      aimUp: false,
      aimDiagUp: false,
      aimDown: false,
      aimDiagDown: true,
    });
  });

  it('allows S/Down to aim down in mid-air or diagonally down while walking on elevated structures', () => {
    const airDown = resolvePlayerAim({
      upHeld: false,
      downHeld: true,
      aimDownKey: false,
      mv: 0,
      onGround: false,
      crouching: false,
      elevated: true,
    });
    expect(airDown.aimDown).toBe(true);

    const elevatedDiagDown = resolvePlayerAim({
      upHeld: false,
      downHeld: true,
      aimDownKey: false,
      mv: -1,
      onGround: true,
      crouching: true,
      elevated: true,
    });
    expect(elevatedDiagDown.aimDiagDown).toBe(true);
  });
});

describe('bugs 1-7: natural 1:1 crouch, clear placement, barrel muzzle, and E-gated pickups', () => {
  it('computes 1:1 unscaled crouch slices ignoring stray top speckle and preserving boots on ground', () => {
    const alphaRows = new Array(56).fill(18);
    // Simulate Volt single-pixel stray dot at y=0 followed by blank row y=1
    alphaRows[0] = 1;
    alphaRows[1] = 0;
    const plan = computeCrouchSlices(alphaRows, 56);
    expect(plan).not.toBeNull();
    expect(plan!.minY).toBe(2);
    expect(plan!.maxY).toBe(55);
    expect(plan!.upperDstY - plan!.upperSrcY).toBe(plan!.dropPx);
    // Upper band (head+torso+gun) retains exact 1:1 pixel height
    expect(plan!.upperH).toBeGreaterThanOrEqual(28);
    // Boots bottom stays pinned to standing baseline maxY
    expect(plan!.bootDstY + plan!.bootH - 1).toBe(plan!.maxY);
  });

  it('requires same-tier proximity and [E] confirmation to switch weapons while auto-collecting life/refill', () => {
    // Carrying MG walking past shotgun on the SAME tier -> shows [E] prompt, never auto-swaps
    expect(evaluatePickupInteraction({
      heroX: 500, heroFeetY: 505, pickupX: 510, pickupSurfaceY: 505,
      reward: 'shotgun', currentWeapon: 'mg', interactPressed: false,
    })).toBe('prompt');

    // Explicit [E] equips shotgun
    expect(evaluatePickupInteraction({
      heroX: 500, heroFeetY: 505, pickupX: 510, pickupSurfaceY: 505,
      reward: 'shotgun', currentWeapon: 'mg', interactPressed: true,
    })).toBe('equip');

    // Passing under an elevated shotgun crate on catwalk overhead -> ignored cleanly
    expect(evaluatePickupInteraction({
      heroX: 500, heroFeetY: 505, pickupX: 500, pickupSurfaceY: 342,
      reward: 'shotgun', currentWeapon: 'mg', interactPressed: true,
    })).toBe('ignore');

    // Same weapon crate refills ammo automatically; life crate collects automatically
    expect(evaluatePickupInteraction({
      heroX: 500, heroFeetY: 505, pickupX: 508, pickupSurfaceY: 505,
      reward: 'mg', currentWeapon: 'mg', interactPressed: false,
    })).toBe('auto');
    expect(evaluatePickupInteraction({
      heroX: 500, heroFeetY: 505, pickupX: 508, pickupSurfaceY: 505,
      reward: 'life', currentWeapon: 'mg', interactPressed: false,
    })).toBe('auto');
  });

  it('nudges turrets/crates clear of overlapping solid covers while ignoring floor/high bridges', () => {
    const obstacles = [
      { left: 0, right: 6200, top: 505, bottom: 565 }, // floor deck
      { left: 2395, right: 2505, top: 428, bottom: 470 }, // raised container blocking turret at 2490
      { left: 2400, right: 2700, top: 320, bottom: 334 }, // high overhead catwalk
    ];
    const clearTurretX = resolveClearX(2490, 34, obstacles, { surfaceY: 505, objectHeight: 54 });
    expect(clearTurretX < 2395 - 34 || clearTurretX > 2505 + 34).toBe(true);

    // Overhead bridge shouldn't displace ground crate underneath
    const underBridgeX = resolveClearX(2600, 18, [obstacles[0], obstacles[2]], { surfaceY: 505, objectHeight: 42 });
    expect(underBridgeX).toBe(2600);
  });

  it('spawns tank cannon rockets from turret barrel nozzle rather than lower treads', () => {
    const flatRight = computeTankMuzzlePoint(1000, 460, 1, 0);
    expect(flatRight.muzX).toBe(1036);
    expect(flatRight.muzY).toBe(451); // turret barrel row (t.y - 9), well above tracks (t.y + 8)
    const elevated = computeTankMuzzlePoint(1000, 460, 0.7, -0.71);
    expect(elevated.muzY).toBeLessThan(flatRight.muzY);
  });
});

