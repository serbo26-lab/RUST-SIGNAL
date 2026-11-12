import Phaser from 'phaser';
import { addScaledScore, run, scorePopup, WeaponId } from './core';
import { SFX } from './audio';
import { findClearGroundX } from './world-rules';

export type PickupKind = 'mg' | 'shotgun' | 'laser' | 'life' | 'intel';
export type PickupDecision = 'ignore' | 'prompt' | 'auto' | 'equip';

export const WEAPON_LABELS: Record<'mg' | 'shotgun' | 'laser', string> = {
  mg: 'ПУЛЕМЁТ',
  shotgun: 'ДРОБОВИК',
  laser: 'ЛАЗЕР',
};

/**
 * Pure gating rule for weapon/life/intel pickups:
 * - Never triggers across different vertical tiers (e.g. ground vs catwalk overhead)
 * - Never triggers from afar (<= 28px horizontal proximity)
 * - Life, intel, and same-weapon ammo refill collect automatically on contact
 * - Switching to a *different* weapon requires explicit [E] / Touch Interact press
 */
export function evaluatePickupInteraction(opts: {
  heroX: number;
  heroFeetY: number;
  pickupX: number;
  pickupSurfaceY: number;
  reward: PickupKind;
  currentWeapon: WeaponId;
  interactPressed: boolean;
}): PickupDecision {
  const dx = Math.abs(opts.heroX - opts.pickupX);
  const dy = Math.abs(opts.heroFeetY - opts.pickupSurfaceY);
  if (dx > 28 || dy > 36) return 'ignore';

  if (opts.reward === 'life' || opts.reward === 'intel' || opts.reward === opts.currentWeapon) {
    return 'auto';
  }
  return opts.interactPressed ? 'equip' : 'prompt';
}

interface PickupEntry {
  sprite: Phaser.Physics.Arcade.Image;
  kind: PickupKind;
  surfaceY: number;
  bonusTag: boolean;
  prompt?: Phaser.GameObjects.Text;
}

/**
 * Shared pickup manager used across ground pickups and overhead traversal caches
 * so weapon swaps stay consistent and opt-in across all episodes.
 */
export class PickupManager {
  private entries: PickupEntry[] = [];

  constructor(private scene: Phaser.Scene) {}

  add(
    preferredX: number,
    surfaceY: number,
    kind: PickupKind,
    opts: { avoidSolids?: boolean; bonusTag?: boolean } = {},
  ): Phaser.Physics.Arcade.Image {
    const S = this.scene;
    const x = opts.avoidSolids !== false
      ? findClearGroundX(S, preferredX, 18, surfaceY, {
        objectHeight: 42,
        avoidPads: true,
        includeMachines: true,
        includeProps: true,
        includeTurrets: true,
      })
      : preferredX;

    const keyMap: Record<PickupKind, string> = {
      mg: 'crate_mg',
      shotgun: 'crate_shotgun',
      laser: 'crate_laser',
      life: 'crate_life',
      intel: 'crate_laser',
    };
    const texKey = S.textures.exists(keyMap[kind]) ? keyMap[kind] : 'crate_mg';
    const crate = S.physics.add.image(x, surfaceY - 16, texKey).setDepth(68);
    crate.setData('kind', kind);
    if (kind === 'intel') crate.setTint(0x64f0ff);

    const body = crate.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false).setImmovable(true).setSize(22, 18);

    S.tweens.add({
      targets: crate,
      y: surfaceY - 21,
      duration: 720,
      yoyo: true,
      repeat: -1,
    });

    const prompt = (kind === 'mg' || kind === 'shotgun' || kind === 'laser')
      ? S.add.text(x, surfaceY - 46, `[E] ВЗЯТЬ ${WEAPON_LABELS[kind]}`, {
          fontFamily: 'monospace',
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#fff1a8',
          stroke: '#0d141d',
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(104).setVisible(false)
      : undefined;

    crate.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (prompt?.active) prompt.destroy();
    });

    this.entries.push({
      sprite: crate,
      kind,
      surfaceY,
      bonusTag: !!opts.bonusTag,
      prompt,
    });
    return crate;
  }

  /** Evaluates pickups near the player once per frame; returns true if [E] consumed an equip. */
  update(hero: any, interactPressed: boolean): boolean {
    const entries = this.entries;
    if (!hero?.active || hero.dead) {
      for (const e of entries) e.prompt?.setVisible(false);
      return false;
    }

    const heroBody = hero.body as Phaser.Physics.Arcade.Body | undefined;
    const heroFeetY = heroBody?.bottom ?? (hero.y + 24);
    const currentWeapon: WeaponId = hero.weapon ?? 'pistol';
    let consumedInteract = false;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry.sprite.active) {
        entries.splice(i, 1);
        continue;
      }

      const decision = evaluatePickupInteraction({
        heroX: hero.x,
        heroFeetY,
        pickupX: entry.sprite.x,
        pickupSurfaceY: entry.surfaceY,
        reward: entry.kind,
        currentWeapon,
        interactPressed: interactPressed && !consumedInteract,
      });

      if (decision === 'ignore') {
        entry.prompt?.setVisible(false);
        continue;
      }

      if (decision === 'prompt') {
        entry.prompt
          ?.setPosition(entry.sprite.x, entry.sprite.y - 26)
          .setVisible(true);
        continue;
      }

      if (decision === 'equip') consumedInteract = true;
      this.collect(entry, hero, decision === 'auto');
      entries.splice(i, 1);
    }

    return consumedInteract;
  }

  private collect(entry: PickupEntry, hero: any, isAuto: boolean) {
    const S = this.scene as any;
    const x = entry.sprite.x;
    const y = entry.sprite.y;
    entry.sprite.destroy();
    SFX.play('pickup');
    S.fx?.boom?.(x, y, 0.7);

    if (entry.kind === 'life') {
      run.lives = Math.min(5, run.lives + 1);
      S.hud?.toast?.(entry.bonusTag ? 'ТРОФЕЙ НА ВЫСОТЕ: +1 ЖИЗНЬ' : '+1 ЖИЗНЬ');
      const pts = addScaledScore(S, entry.bonusTag ? 250 : 200);
      scorePopup(S, x, y - 16, `+${pts}`);
      return;
    }

    if (entry.kind === 'intel') {
      run.intel = (run.intel ?? 0) + 1;
      const pts = addScaledScore(S, 600);
      S.hud?.toast?.(`СЕКРЕТНЫЙ КОНТЕЙНЕР (+${pts})`);
      scorePopup(S, x, y - 16, `+${pts}`);
      return;
    }

    const wasSame = isAuto && hero.weapon === entry.kind;
    hero.giveWeapon?.(entry.kind);
    const pts = addScaledScore(S, entry.bonusTag ? 250 : 300);
    if (wasSame) {
      S.hud?.toast?.(`${WEAPON_LABELS[entry.kind]}: БОЕЗАПАС ПОПОЛНЕН`);
    }
    scorePopup(S, x, y - 16, `+${pts}`);
  }
}
