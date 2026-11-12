/**
 * Mobile touch controls: virtual joystick (left) + action buttons (right).
 * Rendered as DOM overlay above the Phaser canvas — pointer events are stopped
 * here so they never leak into the game scene. Only shown on touch devices.
 *
 * Exposes `TouchState` consumed by Player and LevelScene:
 *   left/right/up/down  — movement & aim (analog threshold ±0.35)
 *   jump/fire/grenade/roll/board — booleans; "justDown" edge flags auto-reset
 *                                   after being read once per frame.
 */

export interface TouchInput {
  left: boolean; right: boolean; up: boolean; down: boolean;
  jump: boolean; fire: boolean; grenade: boolean; roll: boolean; board: boolean;
  justJump: boolean; justGrenade: boolean; justRoll: boolean; justBoard: boolean;
}

export const touch: TouchInput = {
  left: false, right: false, up: false, down: false,
  jump: false, fire: false, grenade: false, roll: false, board: false,
  justJump: false, justGrenade: false, justRoll: false, justBoard: false,
};

/** Consume an edge flag (returns true exactly once per press). */
export function tapEdge(flag: 'justJump' | 'justGrenade' | 'justRoll' | 'justBoard'): boolean {
  if (touch[flag]) { touch[flag] = false; return true; }
  return false;
}

export function isTouchDevice(): boolean {
  try {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  } catch { return false; }
}

let installed = false;

interface BtnDef { id: keyof TouchInput; label: string; color: string; x: number; y: number; r: number; edge?: keyof TouchInput; }

export function installTouchControls(parentEl: HTMLElement) {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const root = document.createElement('div');
  root.id = 'rs-touch';
  root.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:none;user-select:none;-webkit-user-select:none;touch-action:none;display:none;';
  parentEl.appendChild(root);

  // The joystick must not intercept character-selection taps in the menu.
  let inLevel = false;
  const show = () => { root.style.display = inLevel && isTouchDevice() ? 'block' : 'none'; };
  window.addEventListener('rs:touch-controls', ((e: CustomEvent<boolean>) => {
    inLevel = !!e.detail;
    show();
  }) as EventListener);
  window.addEventListener('touchstart', show, { passive: true });

  // ---------- joystick (left half) ----------
  const stickZone = document.createElement('div');
  stickZone.style.cssText = 'position:absolute;left:0;top:0;width:46%;height:100%;pointer-events:auto;';
  root.appendChild(stickZone);

  const base = document.createElement('div');
  base.style.cssText = 'position:absolute;width:124px;height:124px;border-radius:50%;border:2px solid rgba(114,227,232,.34);background:radial-gradient(circle, rgba(16,26,38,.42) 0%, rgba(10,16,24,.72) 100%);box-shadow:inset 0 0 18px rgba(0,0,0,.65);display:none;';
  const knob = document.createElement('div');
  knob.style.cssText = 'position:absolute;width:54px;height:54px;border-radius:50%;background:radial-gradient(circle at 35% 35%, #ffe699, #d89b38);border:2px solid rgba(255,244,200,.72);box-shadow:0 4px 12px rgba(0,0,0,.6);display:none;';
  stickZone.appendChild(base); stickZone.appendChild(knob);

  let stickId = -1, cx = 0, cy = 0;
  const R = 52;
  const setStick = (dx: number, dy: number) => {
    touch.left = dx < -0.35; touch.right = dx > 0.35;
    touch.up = dy < -0.45; touch.down = dy > 0.5 && !touch.left && !touch.right;
  };
  stickZone.addEventListener('pointerdown', (e) => {
    if (stickId !== -1) return;
    stickId = e.pointerId; cx = e.clientX; cy = e.clientY;
    base.style.display = knob.style.display = 'block';
    base.style.left = `${cx - 60}px`; base.style.top = `${cy - 60}px`;
    knob.style.left = `${cx - 28}px`; knob.style.top = `${cy - 28}px`;
    setStick(0, 0);
    e.preventDefault();
  });
  stickZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.left = `${cx + dx - 28}px`; knob.style.top = `${cy + dy - 28}px`;
    setStick(dx / R, dy / R);
    e.preventDefault();
  });
  const stickRelease = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    base.style.display = knob.style.display = 'none';
    touch.left = touch.right = touch.up = touch.down = false;
  };
  stickZone.addEventListener('pointerup', stickRelease);
  stickZone.addEventListener('pointercancel', stickRelease);

  // ---------- action buttons (right side) ----------
  // Layout in % of viewport, tuned for landscape play.
  const defs: BtnDef[] = [
    { id: 'fire',    label: 'J', color: '#d8453a', x: 92, y: 62, r: 44 },
    { id: 'jump',    label: '⤒', color: '#7fd4e8', x: 80, y: 76, r: 40, edge: 'justJump' },
    { id: 'grenade', label: 'K', color: '#ffd24a', x: 68, y: 62, r: 34, edge: 'justGrenade' },
    { id: 'roll',    label: 'L', color: '#ff4fd8', x: 94, y: 30, r: 34, edge: 'justRoll' },
    { id: 'board',   label: 'E', color: '#8affc1', x: 80, y: 34, r: 32, edge: 'justBoard' },
  ];
  for (const b of defs) {
    const el = document.createElement('div');
    const size = b.r * 2;
    el.style.cssText = `position:absolute;left:${b.x}%;top:${b.y}%;width:${size}px;height:${size}px;margin-left:${-b.r}px;margin-top:${-b.r}px;`
      + `border-radius:50%;pointer-events:auto;display:flex;align-items:center;justify-content:center;`
      + `font:bold ${Math.round(size * 0.36)}px monospace;color:#f4f7fb;`
      + `background:radial-gradient(circle at 32% 30%, ${b.color}66, rgba(14,19,28,.82));`
      + `border:2.5px solid ${b.color};box-shadow:0 4px 12px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.22);`
      + `text-shadow:0 1px 2px #000;touch-action:none;transition:transform 60ms ease;`;
    el.textContent = b.label;
    const pidMap = new Map<number, boolean>();
    el.addEventListener('pointerdown', (e) => {
      pidMap.set(e.pointerId, true);
      (touch as any)[b.id] = true;
      if (b.edge) (touch as any)[b.edge] = true;
      el.style.filter = 'brightness(1.6)';
      e.preventDefault();
    });
    const up = (e: PointerEvent) => {
      if (!pidMap.delete(e.pointerId)) return;
      if (pidMap.size === 0) { (touch as any)[b.id] = false; el.style.filter = ''; }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    root.appendChild(el);
  }

  // pause button positioned cleanly below top-right HUD & back-site link
  const pb = document.createElement('div');
  pb.style.cssText = 'position:absolute;right:max(10px, env(safe-area-inset-right));top:calc(64px + env(safe-area-inset-top, 0px));width:44px;height:38px;pointer-events:auto;display:flex;align-items:center;justify-content:center;font:bold 14px monospace;color:#dfe7f0;background:rgba(14,19,27,.84);border:1.5px solid rgba(114,227,232,.48);border-radius:8px;box-shadow:0 4px 10px rgba(0,0,0,.45);';
  pb.textContent = 'II';
  pb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('rs:touch-pause'));
  });
  root.appendChild(pb);
}
