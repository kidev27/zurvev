# Zombie wonder weapons

The mystery box can roll three additional weapons alongside the Ray Gun. Each
has original top-down, floor and HUD sprites and an original firing sound.

| Weapon | Role | Loaded shots | Starting reserve | Ammo | Box chance |
|---|---|---:|---:|---|---:|
| Ray Gun | Explosive bolts | 20 | 60 | .50 AE | 4% |
| Pressure Cannon | Close-range crowd clearing | 2 | 8 | .50 AE | 2% |
| Tesla Rifle | Chained electrical damage | 3 | 12 | .50 AE | 2% |
| Gravegun | Heavy shotgun blast | 1 | 24 | 12 gauge | 2% |

The remaining 90% of rolls use the existing ordinary weapon pool. An ineligible
wonder-weapon result falls back to an ordinary weapon; its probability is not
redistributed to another wonder weapon. Teammates can roll their own copies.
Holding a base or upgraded copy, leaving a dropped copy on the floor, or having
one in Pack-a-Punch prevents that owner from rolling another of the same type.
The normal mystery-box reveal and pickup ownership checks still apply.

## Combat

- **Pressure Cannon:** one cone damage pass per shot, with 13 visual pressure
  trails. Range is 20 units and the cone is 72 degrees wide. Damage falls from
  500 within 8 units to 120 at maximum range. Up to 24 walkers can be hit. Walls
  and closed gates block the blast. Surviving targets are stunned briefly and
  pushed up to 5 units, with body collision checks and a stop before native
  stairs. Targets on another floor and human players receive no cone damage.
- **Tesla Rifle:** a 450-damage bolt chains to at most five additional enemies
  within 7 units of the previous hit. Arcs require line of sight and compatible
  floors, skip already-hit targets, and use the existing short stun and immunity
  rules. The beam does not create additional damaging projectiles per hop.
- **Gravegun:** 16 pellets at 28 base damage each, with shotgun spread and range
  falloff. One trigger pull empties the chamber; the reload replaces its shell.

The new guns use existing ammunition inventories and Max Ammo behavior. Max
Ammo fills reserves without changing loaded magazines. All three are excluded
from the weapon shop and ignore the Endless Ammo perk.

## Pack-a-Punch

The new weapons have Mk II variants through the existing workbench. They keep
the same combat roles and receive the existing 1.35× damage and 1.5× magazine
multipliers (rounded up): Pressure Cannon holds 3 shots, Tesla Rifle 5, Gravegun
2. The Ray Gun's existing upgrade rule is unchanged. No acid conversion is
included in this first weapon set.

## Editing and verification

- Box odds and cone tuning: `shared/defs/maps/zombieWonderWeapons.ts`.
- Guns and bolts: `shared/defs/gameObjects/gunDefs.ts` and `bulletDefs.ts`.
- Upgrade names: `shared/defs/maps/zombiePackAPunch.ts`.
- Cone damage and safe displacement: `server/src/game/specOpsManager.ts`.
- Original art: `client/public/img/guns/gun-*-top.svg` and the matching
  `client/public/img/loot/loot-weapon-*.svg` files.
- Original firing sounds: `client/public/audio/guns/*_01.wav`.

Run from the repository root:

```sh
cd tests
bun run test --run zombieWonderWeapons zombieMode lastCall survivalMaps
```

The weapon tests exercise actual firing, bounded Tesla chains, wall and floor
isolation, safe knockback and stair stops, duplicate pickup/roll checks,
Pack-a-Punch ownership, reserve refills, and Gravegun reloads. Inspect the held
sprites, loot icons, effects and sounds in-game before changing their scales.
The initial damage, ammo and drop rates need longer cooperative balance testing.
