import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { BossShieldNodes, triggerArenaElevationSweep, launchBossInterruptTarget } from '../src/game/boss-mechanics';

describe('Interactive multi-stage boss mechanics', () => {
  it('exports reusable BossShieldNodes, triggerArenaElevationSweep, and launchBossInterruptTarget', () => {
    expect(typeof BossShieldNodes).toBe('function');
    expect(typeof triggerArenaElevationSweep).toBe('function');
    expect(typeof launchBossInterruptTarget).toBe('function');
  });

  it('all 6 boss modules implement overdrive stages and interactive arena mechanics', () => {
    for (const file of ['boss.ts', 'train-boss.ts', 'jungle-boss.ts', 'facility-boss.ts', 'bastion-boss.ts', 'beacon-boss.ts']) {
      const src = fs.readFileSync(new URL(`../src/game/${file}`, import.meta.url), 'utf8');
      expect(src).toMatch(/overdrive/);
      expect(src).toMatch(/exposedUntil/);
      expect(src).toMatch(/initArena\(/);
    }
    const harborBoss = fs.readFileSync(new URL('../src/game/boss.ts', import.meta.url), 'utf8');
    expect(harborBoss).toMatch(/launchChargeDrum/);
    expect(harborBoss).toMatch(/triggerDeckShock/);

    const trainBoss = fs.readFileSync(new URL('../src/game/train-boss.ts', import.meta.url), 'utf8');
    expect(trainBoss).toMatch(/ramCharge/);
    expect(trainBoss).toMatch(/launchMineCart/);

    const jungleBoss = fs.readFileSync(new URL('../src/game/jungle-boss.ts', import.meta.url), 'utf8');
    expect(jungleBoss).toMatch(/BossShieldNodes/);

    const facilityBoss = fs.readFileSync(new URL('../src/game/facility-boss.ts', import.meta.url), 'utf8');
    expect(facilityBoss).toMatch(/BossShieldNodes/);
    expect(facilityBoss).toMatch(/triggerArenaElevationSweep/);
  });

  it('BossShieldNodes updates active orbital counts and respawns cleanly', () => {
    const fakeScene: any = {
      time: { now: 1000 },
      weapons: {},
      physics: {
        add: {
          group: () => ({
            create: (x: number, y: number) => ({
              x, y, active: true,
              setDisplaySize() { return this; },
              setVisible() { return this; },
              setPosition(nx: number, ny: number) { this.x = nx; this.y = ny; return this; },
              destroy() { this.active = false; },
              body: { setAllowGravity() { return this; }, setImmovable() { return this; }, updateFromGameObject() {} },
            }),
          }),
        },
      },
      add: {
        circle: () => {
          const obj: any = { active: true, setStrokeStyle: () => obj, setDepth: () => obj, setPosition: () => obj, setScale: () => obj, setFillStyle: () => obj, destroy() {} };
          return obj;
        },
        line: () => {
          const obj: any = { active: true, setLineWidth: () => obj, setOrigin: () => obj, setDepth: () => obj, setBlendMode: () => obj, setTo: () => obj, destroy() {} };
          return obj;
        },
        rectangle: () => {
          const obj: any = { active: true, setDepth: () => obj, setOrigin: () => obj, setPosition: () => obj, setDisplaySize: () => obj, destroy() {} };
          return obj;
        },
        text: () => {
          const obj: any = { setDepth: () => obj, setOrigin: () => obj, destroy() {} };
          return obj;
        },
      },
    };
    const fakeBoss = { x: 5800, y: 400 };
    const nodes = new BossShieldNodes(fakeScene, fakeBoss);
    nodes.spawnWave([
      { offsetX: -40, offsetY: -20, orbitRadius: 80, orbitSpeed: 1.5, orbitPhase: 0, hp: 3, color: 0x114466, trimColor: 0x44eeff, label: 'TEST' },
      { offsetX: -40, offsetY: -20, orbitRadius: 80, orbitSpeed: 1.5, orbitPhase: Math.PI, hp: 3, color: 0x114466, trimColor: 0x44eeff, label: 'TEST' },
    ]);
    expect(nodes.activeCount).toBe(2);
    nodes.update(2500);
    expect(nodes.activeCount).toBe(2);
    nodes.clearNodes();
    expect(nodes.activeCount).toBe(0);
  });
});
