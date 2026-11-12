import Phaser from 'phaser';
import { GROUND_Y, WORLD_W, VIEW_W, VIEW_H, JUMP_VELOCITY, GRAVITY } from './core';

type CombatScene = Phaser.Scene & { player?: Phaser.Physics.Arcade.Sprite };

/**
 * All chapter cameras use Phaser's 960px *logical* viewport.
 * Browser CSS scaling must never influence world-spawn positions.
 */
export function isWithinCamera(scene: Phaser.Scene, x: number, margin = 24): boolean {
  const c = scene.cameras.main;
  return x >= c.scrollX + margin && x <= c.scrollX + c.width - margin;
}

/** Ensure combatants never materialize on the hero and never attack from
 * outside the currently visible viewport. Direction of scripted encounter
 * is respected when possible. */
export function safeEnemySpawnX(scene: CombatScene, requestedX: number, spawnY = GROUND_Y - 30): number {
  const camera = scene.cameras.main;
  const heroX = scene.player?.x ?? requestedX - 230;
  const left = Math.max(45, camera.scrollX + 95);
  const right = Math.min(WORLD_W - 55, camera.scrollX + camera.width - 85);
  const minDistance = 190;
  // A wave spawned beyond the screen previously collapsed ALL members onto
  // the same clamped X, causing overlapping invincible-looking enemy piles.
  const initial = Phaser.Math.Clamp(requestedX, left, right);
  const inward = requestedX >= heroX ? -1 : 1;
  const offsets = [0, 85, 170, 255, 340, -85, -170, -255, -340, 48, -48, 128, -128];
  const others: number[] = ((scene as any).enemies?.getChildren?.() ?? [])
    .filter((enemy: Phaser.GameObjects.GameObject) => enemy.active)
    .map((enemy: Phaser.GameObjects.GameObject) => (enemy as Phaser.GameObjects.Sprite).x);
  // Avoid spawning inside solid walls/containers (or letting ceiling drops fall straight into them).
  const checkBandTop = spawnY < GROUND_Y - 80 ? spawnY - 28 : GROUND_Y - 20;
  const checkBandBottom = spawnY < GROUND_Y - 80 ? spawnY + 26 : GROUND_Y + 33;
  const blockingWalls = collectSceneObstacles(scene).filter(
    (b) => b.right - b.left < 3000 && b.bottom > checkBandTop && b.top < checkBandBottom,
  );
  const clearOfWalls = (cx: number) =>
    !blockingWalls.some((b) => cx + 20 > b.left && cx - 20 < b.right);

  for (const shift of offsets) {
    const candidate = initial + shift * inward;
    if (candidate < left || candidate > right) continue;
    if (Math.abs(candidate - heroX) < minDistance) continue;
    if (others.some(x => Math.abs(x - candidate) < 66)) continue;
    if (!clearOfWalls(candidate)) continue;
    return candidate;
  }
  // If crowded, still prefer a spot outside solid obstacles before falling back to camera edges.
  for (let probe = left + 20; probe <= right - 20; probe += 44) {
    if (Math.abs(probe - heroX) >= minDistance - 30 && clearOfWalls(probe)) return probe;
  }
  // Last-resort edge fallback.
  return [left, right].sort((x, y) =>
    Math.abs(y - heroX) - Math.abs(x - heroX))[0];
}

/** Shared collider overlay. If a surface blocks or supports the hero it gets
 * a readable outline and a yellow load-bearing lip; background-only props
 * never receive this treatment. The coordinates match actual Arcade bodies. */
export function markSolidPlatform(scene: Phaser.Scene, x: number, y: number, w: number, h: number) {
  const k = scene.scene?.key;
  const platMap: Record<string, [string, number]> = {
    Beacon: ['ep6_platform', 0x5ef5eb],
    Bastion: ['ep5_platform', 0x9bd4f2],
    Facility: ['ep4_platform', 0x72ecf5],
    Jungle: ['ep3_platform', 0x6ce8ad],
    Train: ['ep2_platform', 0x9fc2dc],
  };
  const [platKey, rimCol] = platMap[k] ?? ['ep1_platform', 0xd9a262];
  if (scene.textures.exists(platKey)) {
    scene.add.tileSprite(x, y, w, Math.max(h, 16), platKey).setDepth(39);
    // Steel end-bracket stanchions framing the platform edges cleanly
    scene.add.rectangle(x - w / 2 + 3, y, 4, Math.max(h, 16), 0x16202c, 0.95).setDepth(40);
    scene.add.rectangle(x + w / 2 - 3, y, 4, Math.max(h, 16), 0x16202c, 0.95).setDepth(40);
    // Crisp thin specular bevel along top walking surface (also preserves ledge locator geometry)
    scene.add.rectangle(x, y - h / 2 + 3, w - 4, 2, rimCol, 0.55).setDepth(41);
  } else {
    scene.add.rectangle(x, y, w, h, 0x1c2636, 0.92).setStrokeStyle(2, rimCol, 0.6).setDepth(39);
    scene.add.rectangle(x, y - h / 2 + 3, w - 3, 3, rimCol, 0.7).setDepth(41);
  }
}

export function markGround(
  scene: Phaser.Scene,
  sections: Array<readonly [number, number]> = [[0, WORLD_W]],
) {
  const k = scene.scene?.key;
  const groundMap: Record<string, string> = {
    Beacon: 'ep6_ground',
    Bastion: 'ep5_ground',
    Facility: 'ep4_ground',
    Jungle: 'ep3_ground',
    Train: 'ep2_ground',
  };
  const deckKey = groundMap[k] ?? 'ep1_ground';
  const hasTex = scene.textures.exists(deckKey);
  // Floor deck follows *real* collision segments — armored steel/concrete/grating over chasms.
  for (const [start, end] of sections) {
    const len = end - start;
    if (hasTex) {
      addTileStrip(scene, start, GROUND_Y + 35, len, 68, deckKey, 38);
      // Riveted vertical edge bulkhead caps at segment breaks/chasms
      scene.add.rectangle(start + 2, GROUND_Y + 35 + 34, 4, 68, 0x0e141d, 0.95).setDepth(39);
      scene.add.rectangle(end - 2, GROUND_Y + 35 + 34, 4, 68, 0x0e141d, 0.95).setDepth(39);
    } else {
      addTileStrip(scene, start, GROUND_Y + 35, len, 4, '__rect', 38, 1, 0.9, 0x64788c);
    }
  }
}

/** Keep enemies fully standing on the playable collision top.
 * The original offsets used atlas source coordinates that put enemy legs
 * ~20-40 px below the floor, while bullets travelled above their hitboxes. */
export function alignActorFeet(sprite: Phaser.Physics.Arcade.Sprite, bodyW: number, bodyH: number, footInset = 3) {
  const frameW = sprite.frame.realWidth || sprite.width;
  const frameH = sprite.frame.realHeight || sprite.height;
  const bottomOffset = Math.max(0, frameH - bodyH - footInset);
  const leftOffset = Math.max(0, (frameW - bodyW) / 2);
  (sprite.body as Phaser.Physics.Arcade.Body).setSize(bodyW, bodyH)
    .setOffset(leftOffset, bottomOffset);
}

/** Raised collision surfaces are genuine cover against both teams' shots.
 * Bullets must not magically pass through the solid structures the player
 * sees, otherwise crouching/positioning provides no tactical advantage. */
export function makeBallisticCover(
  scene: Phaser.Scene,
  solids: Phaser.GameObjects.Group,
  playerShots: Phaser.Physics.Arcade.Group,
  enemyShots: Phaser.Physics.Arcade.Group,
) {
  const hit = (object: unknown) => {
    const shot = object as Phaser.Physics.Arcade.Image;
    if (!shot.active) return;
    const gameScene = scene as any;
    if ((shot as any).isRocket) gameScene.weapons?.explode?.(shot.x, shot.y, 86, 5, false);
    else gameScene.fx?.impact?.(shot.x, shot.y, (shot.body as Phaser.Physics.Arcade.Body).velocity.x >= 0 ? 1 : -1);
    shot.destroy();
  };
  scene.physics.add.collider(playerShots, solids, hit);
  scene.physics.add.collider(enemyShots, solids, hit);
}

/** A boss encounter uses one fixed, shared physical viewport. Camera-follow
 * previously scrolled bosses off the screen when the player moved, while
 * the first crane boss was itself clamped to the player's world X. */
export function lockBossArena(scene: Phaser.Scene, player: Phaser.Physics.Arcade.Sprite,
  boss: Phaser.Physics.Arcade.Sprite): void {
  const camera = scene.cameras.main;
  // Boss sits at about 75% of the viewport; hero starts well left of it.
  const desired = boss.x - VIEW_W * .73;
  const left = Phaser.Math.Clamp(desired, 0, WORLD_W - VIEW_W);
  camera.stopFollow();
  camera.setBounds(left, -60, VIEW_W, VIEW_H + 200);
  camera.setScroll(left, camera.scrollY);
  scene.data.set('bossArenaLeft', left);
  scene.data.set('bossArenaRight', left + VIEW_W);
  // Clear lingering pre-boss stage enemies and stray projectiles so stage stragglers
  // cannot trap or back-shoot the hero inside a locked boss duel.
  const enemies = (scene as any).enemies;
  if (enemies?.getChildren) {
    for (const enemy of [...enemies.getChildren()]) {
      if (enemy && enemy !== boss && enemy.active) enemy.destroy?.();
    }
  }
  const arenaMin = left - 40;
  const arenaMax = left + VIEW_W + 40;
  const playerTank = (scene as any).tankSys?.tank;
  const cleanupList = (list: any[]) => {
    for (const obj of [...list]) {
      if (!obj || obj === playerTank || obj === boss) continue;
      if (obj.active && typeof obj.x === 'number' && obj.x >= arenaMin && obj.x <= arenaMax) {
        obj.destroy?.();
      }
    }
  };
  const machineGrp = (scene as any).machineGrp;
  if (machineGrp?.getChildren) cleanupList(machineGrp.getChildren());
  if (Array.isArray((scene as any).machines)) {
    cleanupList((scene as any).machines);
    (scene as any).machines = (scene as any).machines.filter((m: any) => m?.active);
  }
  if (Array.isArray((scene as any).turrets)) {
    cleanupList((scene as any).turrets);
    (scene as any).turrets = (scene as any).turrets.filter((t: any) => t?.active);
  }
  (scene as any).weapons?.enemyBullets?.clear?.(true, true);
  // If the transition started at the extreme edge, bring the player back
  // inside the same arena before any physics or attack callbacks execute.
  confineHeroToArena(scene, player);
}

export function confineHeroToArena(scene: Phaser.Scene,
  player: Phaser.Physics.Arcade.Sprite): void {
  const left = scene.data.get('bossArenaLeft') as number | undefined;
  const right = scene.data.get('bossArenaRight') as number | undefined;
  if (left === undefined || right === undefined || !player.active) return;
  const x = Phaser.Math.Clamp(player.x, left + 48, right - 52);
  if (x !== player.x) {
    player.setX(x);
    (player.body as Phaser.Physics.Arcade.Body).setVelocityX(0);
  }
}

/** Physically guaranteed jump rise; platform top more than this above ground
 * needs at least one intermediate step on each approach side. */
export const MAX_JUMP_RISE = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

/** Split wide static TileSprite spans into <=1024px segments aligned to the
 *  pattern width so Canvas2D/SwiftShader never uploads >4096px wide canvases. */
export function addTileStrip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  key: string,
  depth: number,
  scrollFactorX = 1,
  alpha = 1,
  tint?: number,
) {
  const texW = Math.max(16, scene.textures.get(key)?.get()?.width || 64);
  const chunkW = Math.max(texW, Math.floor(960 / texW) * texW);
  for (let offset = 0; offset < width; offset += chunkW) {
    const w = Math.min(chunkW, width - offset);
    const ts = scene.add.tileSprite(x + offset, y, w, height, key)
      .setOrigin(0)
      .setScrollFactor(scrollFactorX, 1)
      .setDepth(depth)
      .setAlpha(alpha);
    if (tint !== undefined) ts.setTint(tint);
  }
}

/** Lightweight looping backdrop strip using cached Image sprites instead of per-frame
 *  TileSprite canvas repaints (keeps 2D Canvas & WebGL locked at steady 60fps). */
export class ParallaxStrip {
  private readonly tiles: Phaser.GameObjects.Image[] = [];
  private readonly tileW: number;
  private readonly tileH: number;
  private readonly cols: number;
  private readonly wrapY: boolean;
  private readonly baseY: number;

  constructor(
    scene: Phaser.Scene,
    key: string,
    y: number,
    depth: number,
    alpha = 1,
    wrap2D = false,
  ) {
    const tex = scene.textures.get(key);
    const frame = tex.get();
    this.tileW = Math.max(64, frame.width || VIEW_W);
    this.tileH = Math.max(64, frame.height || VIEW_H);
    this.baseY = y;
    this.wrapY = wrap2D;
    this.cols = Math.ceil(VIEW_W / this.tileW) + 1;
    const rows = wrap2D ? Math.ceil(VIEW_H / this.tileH) + 1 : 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const img = scene.add.image(c * this.tileW, y + r * this.tileH, key)
          .setOrigin(0, 0).setScrollFactor(0).setDepth(depth).setAlpha(alpha);
        this.tiles.push(img);
      }
    }
    this.setScroll(0, 0);
  }

  setScroll(offsetX: number, offsetY = 0) {
    const ox = -(((offsetX % this.tileW) + this.tileW) % this.tileW);
    const oy = this.wrapY
      ? -(((offsetY % this.tileH) + this.tileH) % this.tileH)
      : 0;
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (!t.active) continue;
      const c = i % this.cols;
      const r = this.wrapY ? Math.floor(i / this.cols) : 0;
      const tx = Math.round(ox + c * this.tileW);
      const ty = Math.round(this.baseY + oy + r * this.tileH);
      const vis = tx < VIEW_W && tx + this.tileW > 0 && ty < VIEW_H && ty + this.tileH > 0;
      t.setVisible(vis).setPosition(tx, ty);
    }
  }
}

export interface ObstacleRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Pure horizontal placement solver: nudges preferredX out of any AABB
 *  whose vertical span intersects [surfaceY - objectHeight, surfaceY]. */
export interface ClearXOptions {
  surfaceY?: number;
  objectHeight?: number;
  minX?: number;
  maxX?: number;
  padding?: number;
  preferBackward?: boolean;
  isAllowed?: (cx: number) => boolean;
}

export function resolveClearX(
  preferredX: number,
  halfWidth: number,
  obstacles: ReadonlyArray<ObstacleRect>,
  opts: ClearXOptions = {},
): number {
  const surfaceY = opts.surfaceY ?? GROUND_Y + 35;
  const objectHeight = opts.objectHeight ?? 58;
  const minX = opts.minX ?? 72;
  const maxX = opts.maxX ?? WORLD_W - 110;
  const pad = opts.padding ?? 8;
  const topEdge = surfaceY - objectHeight;

  const active = obstacles.filter(
    (b) => b.top < surfaceY - 2 && b.bottom > topEdge + 2 && b.right > b.left,
  );
  const clearAt = (cx: number) => {
    if (opts.isAllowed && !opts.isAllowed(cx)) return false;
    const l = cx - halfWidth - pad;
    const r = cx + halfWidth + pad;
    return !active.some((b) => r > b.left && l < b.right);
  };

  const base = Phaser.Math.Clamp(preferredX, minX, maxX);
  if (clearAt(base)) return base;

  const step = Math.max(18, Math.min(36, Math.round(halfWidth + pad + 4)));
  const dirs = opts.preferBackward ? ([-1, 1] as const) : ([1, -1] as const);
  for (let mult = 1; mult <= 48; mult++) {
    for (const dir of dirs) {
      const candidate = base + dir * step * mult;
      if (candidate < minX || candidate > maxX) continue;
      if (clearAt(candidate)) return candidate;
    }
  }
  return base;
}

function isGroundSlab(sb: { top: number; width: number; gameObject?: any }): boolean {
  if (sb.gameObject?.getData?.('ground')) return true;
  return sb.top >= GROUND_Y + 28 && sb.width >= 200;
}

/** Collects enabled static physics solids (excluding floor slabs and one-way decks by default). */
export function collectSceneObstacles(
  scene: Phaser.Scene,
  extras: ReadonlyArray<{ x: number; y: number; width?: number; height?: number; active?: boolean }> = [],
  opts: { includeOneWays?: boolean; includeGround?: boolean } = {},
): ObstacleRect[] {
  const out: ObstacleRect[] = [];
  const traversal = (scene as any)?.traversal;
  const oneWayDecks = traversal?.oneWayDecks?.children ? traversal.oneWayDecks.getChildren() : [];
  const oneWayGroup = traversal?.oneWayGroup?.children ? traversal.oneWayGroup.getChildren() : [];
  const oneWayObjs = new Set<any>([...oneWayDecks, ...oneWayGroup]);
  const statics = ((scene as any)?.physics?.world?.staticBodies?.entries ?? []) as Phaser.Physics.Arcade.StaticBody[];
  for (const sb of statics) {
    if (!sb?.enable) continue;
    if (!opts.includeOneWays && oneWayObjs.has(sb.gameObject)) continue;
    if (!opts.includeGround && isGroundSlab(sb)) continue;
    out.push({ left: sb.left, right: sb.right, top: sb.top, bottom: sb.bottom });
  }
  for (const ex of extras) {
    if (!ex || ex.active === false) continue;
    const hw = Math.max(10, (ex.width ?? 40) / 2);
    const hh = Math.max(10, (ex.height ?? 48) / 2);
    out.push({ left: ex.x - hw, right: ex.x + hw, top: ex.y - hh, bottom: ex.y + hh });
  }
  return out;
}

/** Collects solid walls (never one-way decks or floor slabs) across the scene. */
export function collectSolidWalls(
  scene: Phaser.Scene,
  extras: ReadonlyArray<{ x: number; y: number; width?: number; height?: number; active?: boolean }> = [],
): ObstacleRect[] {
  return collectSceneObstacles(scene, extras, { includeOneWays: false, includeGround: false });
}

export interface GroundSpan {
  left: number;
  right: number;
  top: number;
}

/** Returns walkable/drivable ground slabs (used to keep spawns/respawns out of inter-car chasms). */
export function collectGroundSpans(scene: Phaser.Scene): GroundSpan[] {
  const out: GroundSpan[] = [];
  const statics = ((scene as any)?.physics?.world?.staticBodies?.entries ?? []) as Phaser.Physics.Arcade.StaticBody[];
  for (const sb of statics) {
    if (!sb?.enable || !isGroundSlab(sb)) continue;
    out.push({ left: sb.left, right: sb.right, top: sb.top });
  }
  return out;
}

export function hasGroundAt(spans: ReadonlyArray<GroundSpan>, x: number, halfWidth = 14): boolean {
  if (spans.length === 0) return true;
  return spans.some((g) => x - halfWidth >= g.left + 4 && x + halfWidth <= g.right - 4);
}

/** Collects active props, vehicles, turrets, and jump pads as placement blockers. */
export function collectPlacementExtras(
  scene: any,
  opts: {
    exclude?: unknown;
    includeProps?: boolean;
    includeMachines?: boolean;
    includeTurrets?: boolean;
    avoidPads?: boolean;
    surfaceY?: number;
  } = {},
): Array<{ x: number; y: number; width?: number; height?: number; active?: boolean }> {
  const out: Array<{ x: number; y: number; width?: number; height?: number; active?: boolean }> = [];
  const seen = new Set<unknown>();
  const surfaceY = opts.surfaceY ?? GROUND_Y + 35;
  const pushItem = (item: any, defW: number, defH: number) => {
    if (!item || !item.active || item === opts.exclude || seen.has(item)) return;
    seen.add(item);
    out.push({
      x: item.x,
      y: item.y,
      width: item.body?.width || item.displayWidth || item.width || defW,
      height: item.body?.height || item.displayHeight || item.height || defH,
      active: true,
    });
  };
  const safeChildren = (grp: any): any[] => (grp?.children ? grp.getChildren() : (Array.isArray(grp) ? grp : []));

  if (opts.includeProps) {
    for (const p of safeChildren(scene?.props?.group)) pushItem(p, 36, 40);
    for (const grp of [scene?.heaters, scene?.terminals, scene?.growthPods, scene?.anchors]) {
      for (const item of safeChildren(grp)) pushItem(item, 48, 64);
    }
    for (const pk of safeChildren(scene?.pickupSys?.entries)) {
      if (pk?.sprite?.active && !pk.bonusTag) pushItem(pk.sprite, 28, 32);
    }
  }
  const machineGrpChildren = safeChildren(scene?.machineGrp);
  if (opts.includeMachines) {
    for (const m of scene?.machines ?? []) pushItem(m, 104, 48);
    for (const m of machineGrpChildren) {
      if (m?.name !== 'turret') pushItem(m, 104, 48);
    }
    const tank = scene?.tankSys?.tank;
    pushItem(tank, 72, 42);
  }
  if (opts.includeTurrets) {
    for (const t of scene?.turrets ?? []) pushItem(t, 44, 36);
    for (const t of machineGrpChildren) {
      if (t?.name === 'turret') pushItem(t, 44, 36);
    }
  }
  if (opts.avoidPads) {
    for (const p of scene?.traversal?.padEntries ?? []) {
      const py = p.topY ?? surfaceY;
      out.push({ x: p.x, y: py - 24, width: (p.w ?? 44) + 18, height: 52, active: true });
    }
  }
  return out;
}

export interface FindClearGroundOptions {
  objectHeight?: number;
  minX?: number;
  maxX?: number;
  padding?: number;
  extras?: ReadonlyArray<{ x: number; y: number; width?: number; height?: number; active?: boolean }>;
  includeProps?: boolean;
  includeMachines?: boolean;
  includeTurrets?: boolean;
  avoidPads?: boolean;
  requireGround?: boolean;
  preferBackward?: boolean;
  exclude?: unknown;
}

/** Finds an obstacle-free X on the given surface height. */
export function findClearGroundX(
  scene: Phaser.Scene,
  preferredX: number,
  halfWidth = 24,
  surfaceY = GROUND_Y + 35,
  opts: FindClearGroundOptions = {},
): number {
  const autoExtras = collectPlacementExtras(scene, {
    exclude: opts.exclude,
    includeProps: opts.includeProps,
    includeMachines: opts.includeMachines,
    includeTurrets: opts.includeTurrets,
    avoidPads: opts.avoidPads,
    surfaceY,
  });
  const obstacles = collectSolidWalls(scene, [...(opts.extras ?? []), ...autoExtras]);
  const spans = opts.requireGround !== false && surfaceY >= GROUND_Y + 20 ? collectGroundSpans(scene) : [];
  return resolveClearX(preferredX, halfWidth, obstacles, {
    surfaceY,
    objectHeight: opts.objectHeight,
    minX: opts.minX,
    maxX: opts.maxX,
    padding: opts.padding,
    preferBackward: opts.preferBackward,
    isAllowed: spans.length > 0 ? (cx) => hasGroundAt(spans, cx, Math.max(14, halfWidth - 4)) : undefined,
  });
}

/**
 * Resolves a safe respawn coordinate guaranteed clear of solid containers,
 * inter-car chasms, closed gates, boss arena locks, vehicles, and jump pads.
 */
export function findSafeRespawnPoint(
  scene: any,
  desiredX: number,
  opts: { minX?: number; maxX?: number } = {},
): { x: number; y: number } {
  let minX = opts.minX ?? 60;
  let maxX = opts.maxX ?? WORLD_W - 80;
  const arenaLeft = scene?.data?.get?.('bossArenaLeft') ?? scene?.bossArenaLeft;
  const arenaRight = scene?.data?.get?.('bossArenaRight') ?? scene?.bossArenaRight;
  if ((scene?.bossEntered || scene?.bossActive) && Number.isFinite(arenaLeft) && Number.isFinite(arenaRight)) {
    minX = Math.max(minX, arenaLeft + 44);
    maxX = Math.min(maxX, arenaRight - 44);
  }
  const gateBody = (scene?.gateBody?.body ?? scene?.gateBody) as Phaser.Physics.Arcade.StaticBody | undefined;
  if (gateBody?.enable) {
    if (desiredX <= (gateBody.left + gateBody.right) / 2) {
      maxX = Math.min(maxX, gateBody.left - 44);
    } else {
      minX = Math.max(minX, gateBody.right + 44);
    }
  }
  if (maxX < minX) maxX = minX;

  const extras = collectPlacementExtras(scene, {
    includeProps: true,
    includeMachines: true,
    includeTurrets: true,
    avoidPads: true,
    surfaceY: GROUND_Y + 35,
  });
  const solids = collectSolidWalls(scene, extras);
  const spans = collectGroundSpans(scene);
  const safeX = resolveClearX(desiredX, 16, solids, {
    surfaceY: GROUND_Y + 35,
    objectHeight: 74,
    minX,
    maxX,
    padding: 8,
    preferBackward: true,
    isAllowed: spans.length > 0 ? (cx) => hasGroundAt(spans, cx, 16) : undefined,
  });

  // Check if any solid platform still intersects standing column at safeX (fallback onto top of highest obstacle)
  const wallOnly = collectSolidWalls(scene);
  const colHit = wallOnly.filter((w) => safeX + 12 > w.left && safeX - 12 < w.right && GROUND_Y + 35 > w.top && GROUND_Y - 56 < w.bottom);
  if (colHit.length > 0) {
    const highestTop = Math.min(...colHit.map((w) => w.top));
    return { x: safeX, y: Math.max(80, highestTop - 32) };
  }
  return { x: safeX, y: GROUND_Y - 24 };
}

/**
 * Pushes an actor cleanly out of any non-ground solid wall if embedded by a teleport,
 * zipline release, tank exit, crouch release, or platform squeeze.
 */
export function resolveSolidOverlap(actor: any, scene: any): boolean {
  const body = actor?.body as Phaser.Physics.Arcade.Body | undefined;
  if (!body || !scene) return false;
  const solids = collectSolidWalls(scene);
  if (solids.length === 0) return false;
  const spans = collectGroundSpans(scene);
  const arenaLeft = scene?.data?.get?.('bossArenaLeft') ?? scene?.bossArenaLeft;
  const arenaRight = scene?.data?.get?.('bossArenaRight') ?? scene?.bossArenaRight;
  const arenaActive = Boolean(scene?.bossEntered || scene?.bossActive);
  const minX = (arenaActive && Number.isFinite(arenaLeft)) ? arenaLeft + 16 : 16;
  const maxX = (arenaActive && Number.isFinite(arenaRight)) ? arenaRight - 16 : WORLD_W - 16;

  let moved = false;
  for (let pass = 0; pass < 3; pass++) {
    const l = body.left;
    const r = body.right;
    const t = body.top;
    const b = body.bottom;
    const hit = solids.find((s) =>
      Math.min(r, s.right) - Math.max(l, s.left) > 1.5
      && Math.min(b, s.bottom) - Math.max(t, s.top) > 1.5,
    );
    if (!hit) break;

    const hw = Math.max(6, (r - l) / 2);
    const candidates: Array<{ dx: number; dy: number; dist: number; up: boolean }> = [];
    const testPos = (dx: number, dy: number, up: boolean) => {
      const nl = l + dx, nr = r + dx, nt = t + dy, nb = b + dy;
      const cx = (nl + nr) / 2;
      if (cx < minX || cx > maxX || nt < 20 || nb > GROUND_Y + 42) return;
      if (solids.some((s) => nr > s.left + 0.5 && nl < s.right - 0.5 && nb > s.top + 0.5 && nt < s.bottom - 0.5)) return;
      if (spans.length > 0 && !up && !hasGroundAt(spans, cx, hw * 0.6)) return;
      candidates.push({ dx, dy, dist: Math.hypot(dx, dy), up });
    };

    // Push up onto obstacle top, or left/right past its vertical face
    testPos(0, hit.top - b - 1, true);
    testPos(hit.left - r - 1.5, 0, false);
    testPos(hit.right - l + 1.5, 0, false);
    // Also push down slightly if caught in the underside of an overhead raised block
    if (hit.bottom <= GROUND_Y + 12) {
      testPos(0, hit.bottom - t + 1.5, false);
    }

    if (candidates.length === 0) {
      const colSolids = solids.filter((s) => r > s.left + 0.5 && l < s.right - 0.5);
      if (colSolids.length > 0) {
        const colTop = Math.min(...colSolids.map((s) => s.top));
        testPos(0, colTop - b - 1, true);
      }
    }

    if (candidates.length === 0) break;
    candidates.sort((a, z) => a.dist - z.dist);
    const pick = candidates[0];
    const nx = actor.x + pick.dx;
    const ny = actor.y + pick.dy;
    const vx = body.velocity.x;
    const vy = pick.up ? Math.min(0, body.velocity.y) : body.velocity.y;
    actor.setPosition(nx, ny);
    body.reset(nx, ny);
    body.setVelocity(vx, vy);
    moved = true;
  }
  return moved;
}

/** Highest supporting static solid top at worldX <= fallbackY (prevents falling drops clipping platforms). */
export function findSurfaceTopAtX(
  scene: Phaser.Scene,
  worldX: number,
  fallbackY = GROUND_Y + 35,
): number {
  let topY = fallbackY;
  const statics = ((scene as any)?.physics?.world?.staticBodies?.entries ?? []) as Phaser.Physics.Arcade.StaticBody[];
  for (const sb of statics) {
    if (!sb?.enable) continue;
    if (worldX >= sb.left - 18 && worldX <= sb.right + 18 && sb.top <= fallbackY) {
      if (sb.top < topY) topY = sb.top;
    }
  }
  return topY;
}

