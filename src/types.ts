/**
 * Shared scene typing for RUST SIGNAL.
 * All gameplay systems live on LevelScene; other modules receive `scene` and
 * access these members through GameScene (a structural superset of Phaser.Scene).
 */
import Phaser from 'phaser';
import type { Player } from './game/player';
import type { WeaponsSystem } from './game/weapons';
import type { FxSystem, PropsSystem, Machine } from './game/props';
import type { Enemy } from './game/enemies';
import type { Boss, TankSystem } from './game/boss';
import type { RadioSystem } from './game/radio';
import type { Hud } from './ui/hud';

export interface GameSystems {
  player: Player;
  weapons: WeaponsSystem;
  fx: FxSystem;
  props: PropsSystem;
  enemies: Phaser.Physics.Arcade.Group;
  enemyBullets: Phaser.Physics.Arcade.Group;
  machines: Machine[];
  machineGrp: Phaser.Physics.Arcade.Group;
  crates: Phaser.Physics.Arcade.Group;
  boss: Boss | null;
  tankSys: TankSystem;
  /** alias kept for older call-sites */
  tankSystem?: TankSystem;
  radio: RadioSystem;
  hud: Hud;
  paused: boolean;
  finished: boolean;
  onPlayerDown(): void;
}

/** Any scene that carries the level's systems (i.e. LevelScene at runtime). */
export type GameScene = Phaser.Scene & GameSystems;

export type GameEnemy = Enemy;
