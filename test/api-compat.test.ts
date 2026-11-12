import { describe, it, expect } from 'vitest';
import Phaser from 'phaser';

describe('Phaser 3.90 API compatibility', () => {
  it('arcade factory has NO staticRectangle (regression guard)', () => {
    // this was the crash: physics.add.staticRectangle is not a function
    const proto = (Phaser.Physics.Arcade.Factory as any).prototype;
    expect(typeof proto.staticRectangle).toBe('undefined');
    expect(typeof proto.staticImage).toBe('function');
  });

  it('level source uses only existing factory methods', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../src/game/level.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/physics\.add\.staticRectangle\(/);
    expect(src).toMatch(/physics\.add\.staticImage\(/);
    expect(src).toMatch(/__rect/);
  });
});
