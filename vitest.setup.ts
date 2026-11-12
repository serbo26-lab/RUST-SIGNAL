// Заглушки браузерного окружения для Node (Phaser при импорте обращается к navigator/window)
if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { userAgent: 'node', maxTouchPoints: 0, language: 'ru', onLine: true, getGamepads: () => [] };
}
if (typeof globalThis.window === 'undefined') (globalThis as any).window = globalThis;
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    createElement: () => ({ style: {}, getContext: () => null, addEventListener(){}, removeEventListener(){} }),
    addEventListener(){}, removeEventListener(){}, documentElement: { style: {} }, body: { appendChild(){} },
  };
}
if (typeof (globalThis as any).Image === 'undefined') {
  (globalThis as any).Image = class { set src(_v: any) {} };
}
if (typeof (globalThis as any).XMLHttpRequest === 'undefined') {
  (globalThis as any).XMLHttpRequest = class { open(){} send(){} setRequestHeader(){} };
}
// Минимальный 2D-контекст-заглушка: Phaser при импорте проверяет фичи canvas через getContext()
const ctxStub = () => new Proxy({} as any, {
  get(t: any, p: string) {
    if (p === 'canvas') return { width: 1, height: 1 };
    if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (p === 'measureText') return () => ({ width: 0 });
    if (p in t) return t[p];
    return (..._a: any[]) => undefined;
  },
  set(t: any, p: string, v: any) { t[p] = v; return true; },
});
(globalThis as any).document.createElement = () => ({
  style: {}, width: 1, height: 1, getContext: ctxStub,
  addEventListener(){}, removeEventListener(){}, toDataURL: () => '', appendChild(){},
});
if (typeof (globalThis as any).HTMLCanvasElement === 'undefined') {
  (globalThis as any).HTMLCanvasElement = class {};
}
