export interface CrouchSlicePlan {
  minY: number;
  maxY: number;
  bodyH: number;
  dropPx: number;
  upperSrcY: number;
  upperH: number;
  upperDstY: number;
  thighSrcY: number;
  thighH: number;
  thighDstY: number;
  bootSrcY: number;
  bootH: number;
  bootDstY: number;
  kneeShiftX: number;
}

export interface CrouchPoseOptions {
  dropRatio?: number;
  upperRatio?: number;
  bootRatio?: number;
  kneeShiftX?: number;
}

function isSubstantialRow(alphaRows: ArrayLike<number>, y: number, step: 1 | -1): boolean {
  const cur = alphaRows[y] ?? 0;
  if (cur < 2) return false;
  if (cur >= 4) return true;
  return (alphaRows[y + step] ?? 0) >= 3;
}

/**
 * Computes unscaled 1:1 crop & composite bands for a crouching soldier pose
 * so heads, helmets, torsos, and weapons stay at exact standing scale
 * instead of being shrunk or zoomed while crouched.
 */
export function computeCrouchSlices(
  alphaRows: ArrayLike<number>,
  height: number,
  opts: CrouchPoseOptions = {},
): CrouchSlicePlan | null {
  const len = Math.min(height, alphaRows.length);
  if (len <= 0) return null;

  let minY = -1;
  for (let y = 0; y < len; y++) {
    if (isSubstantialRow(alphaRows, y, 1)) {
      minY = y;
      break;
    }
  }
  if (minY < 0) {
    for (let y = 0; y < len; y++) {
      if ((alphaRows[y] ?? 0) > 0) {
        minY = y;
        break;
      }
    }
  }
  if (minY < 0) return null;

  let maxY = minY;
  for (let y = len - 1; y >= minY; y--) {
    if (isSubstantialRow(alphaRows, y, -1)) {
      maxY = y;
      break;
    }
  }

  const bodyH = Math.max(12, maxY - minY + 1);
  const dropRatio = opts.dropRatio ?? 0.28;
  const upperRatio = opts.upperRatio ?? 0.58;
  const bootRatio = opts.bootRatio ?? 0.22;

  const dropPx = Math.max(6, Math.min(Math.floor(bodyH * 0.36), Math.round(bodyH * dropRatio)));
  const upperH = Math.max(8, Math.round(bodyH * upperRatio));
  const bootH = Math.max(5, Math.round(bodyH * bootRatio));

  const bootSrcY = Math.max(minY + upperH - 2, maxY - bootH + 1);
  const actualBootH = maxY - bootSrcY + 1;
  const bootDstY = maxY - actualBootH + 1;

  const thighSrcY = Math.min(bootSrcY - 1, minY + upperH);
  const thighH = Math.max(4, bootSrcY - thighSrcY + 2);
  const upperDstY = minY + dropPx;
  const thighDstY = Math.max(upperDstY + upperH - thighH - 2, bootDstY - thighH + 4);

  return {
    minY,
    maxY,
    bodyH,
    dropPx,
    upperSrcY: minY,
    upperH,
    upperDstY,
    thighSrcY,
    thighH,
    thighDstY,
    bootSrcY,
    bootH: actualBootH,
    bootDstY,
    kneeShiftX: opts.kneeShiftX ?? 2,
  };
}

/**
 * Renders a 1:1 scale kneeling/crouching frame derived from a standing frame.
 * No vertical squashing or zoom scaling is applied to head, torso, or weapon.
 */
export function paintNaturalCrouchPose(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dstCtx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  opts: CrouchPoseOptions = {},
): CrouchSlicePlan | null {
  if (typeof document === 'undefined') {
    dstCtx.drawImage(source, sx, sy, sw, sh, dx, dy, sw, sh);
    return null;
  }

  const scratch = document.createElement('canvas');
  scratch.width = sw;
  scratch.height = sh;
  const sctx = scratch.getContext('2d');
  if (!sctx) {
    dstCtx.drawImage(source, sx, sy, sw, sh, dx, dy, sw, sh);
    return null;
  }

  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

  const img = sctx.getImageData(0, 0, sw, sh).data;
  const alphaRows = new Uint16Array(sh);
  for (let y = 0; y < sh; y++) {
    let count = 0;
    const rowBase = y * sw * 4;
    for (let x = 0; x < sw; x++) {
      if (img[rowBase + x * 4 + 3] > 24) count++;
    }
    alphaRows[y] = count;
  }

  const plan = computeCrouchSlices(alphaRows, sh, opts);
  if (!plan) {
    dstCtx.drawImage(scratch, 0, 0, sw, sh, dx, dy, sw, sh);
    return null;
  }

  const prevSmooth = dstCtx.imageSmoothingEnabled;
  dstCtx.imageSmoothingEnabled = false;

  // 1. Folded knees / thighs slightly forward so crouch silhouette reads cleanly.
  if (plan.thighH > 0) {
    dstCtx.drawImage(
      scratch,
      0, plan.thighSrcY, sw, plan.thighH,
      dx + plan.kneeShiftX, dy + plan.thighDstY, sw, plan.thighH,
    );
  }

  // 2. Grounded boots anchored firmly at the standing foot baseline (maxY).
  dstCtx.drawImage(
    scratch,
    0, plan.bootSrcY, sw, plan.bootH,
    dx, dy + plan.bootDstY, sw, plan.bootH,
  );

  // 3. Unscaled 1:1 head, helmet/bandana, torso, and weapon dropped over waist.
  dstCtx.drawImage(
    scratch,
    0, plan.upperSrcY, sw, plan.upperH,
    dx, dy + plan.upperDstY, sw, plan.upperH,
  );

  dstCtx.imageSmoothingEnabled = prevSmooth;
  return plan;
}
