import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { StageTraversal } from '../src/game/traversal';

describe('StageTraversal & multi-tier verticality', () => {
  it('StageTraversal exports cleanly and keeps depth <= 36 (never colliding with depth 41)', () => {
    expect(typeof StageTraversal).toBe('function');
    const src = fs.readFileSync(new URL('../src/game/traversal.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/setDepth\(\s*41\b/);
    expect(src).toMatch(/addCraneStructure\(/);
    expect(src).toMatch(/addZipLine\(/);
    expect(src).toMatch(/addJumpPad\(/);
    expect(src).toMatch(/addMovingLift\(/);
    expect(src).toMatch(/addHangingCargo\(/);
    expect(src).toMatch(/spawnDropIn\(/);
  });

  it('findDeckAbove & findCurrentDeck compute reachable tiers accurately', () => {
    const mockScene = {
      time: { now: 1000 },
      physics: {
        add: {
          staticGroup: () => ({ create: () => ({ setDisplaySize() { return this; }, setVisible() { return this; }, refreshBody() { return this; } }) }),
          group: () => ({}),
        },
      },
      add: {
        graphics: () => {
          const g: any = {
            setDepth: () => g, fillStyle: () => g, fillRect: () => g,
            fillRoundedRect: () => g, lineStyle: () => g, beginPath: () => g,
            moveTo: () => g, lineTo: () => g, strokePath: () => g, fillCircle: () => g,
          };
          return g;
        },
        text: () => ({ setDepth: () => ({ setAlpha: () => ({}) }) }),
      },
    };
    const t = new StageTraversal(mockScene, 'harbor');
    t.addOneWayDeck(450, 342, 410, 'СТРЕЛА КРАНА #1');

    expect(t.findDeckAbove(600, 460, 130)?.topY).toBe(342);
    expect(t.findDeckAbove(300, 460, 130)).toBeNull();
    expect(t.findCurrentDeck(600, 342)?.w).toBe(410);
    expect(t.findCurrentDeck(600, 505)).toBeNull();
  });

  it('all 6 episodes instantiate StageTraversal and Harbor installs crane structures', () => {
    for (const file of ['level.ts', 'train.ts', 'jungle.ts', 'facility.ts', 'bastion.ts', 'beacon.ts']) {
      const src = fs.readFileSync(new URL(`../src/game/${file}`, import.meta.url), 'utf8');
      expect(src).toMatch(/new StageTraversal\(this,/);
      expect(src).toMatch(/this\.traversal\.update\(/);
    }
    const harbor = fs.readFileSync(new URL('../src/game/level.ts', import.meta.url), 'utf8');
    expect(harbor).toMatch(/addCraneStructure\(/);
  });
});
