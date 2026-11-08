# Zombie wonder weapons

## Practice compatibility

The Pressure Cannon uses a Zombies-only cone-damage handler; its visible
projectiles deal no damage. Practice excludes it from player and bot loadouts,
random bot selection, and the item spawner. The server also rejects direct spawn
requests for both the base gun and its Mk II version. Old saved loadouts fall
back to the normal Practice defaults.

The Ray Gun, Tesla Rifle and Gravegun retain their existing Practice selections
and normal damage paths. PPSh-41, MP40, FN FAL, RPD, Winchester 1887 and PKP also
remain available, using Practice's native magazines and reload timers.



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
  220 within 8 units to 90 at maximum range. Up to 24 walkers can be hit. Walls
  and closed gates block the blast. Surviving targets are stunned briefly and
  pushed up to 5 units, with body collision checks and a stop before native
  stairs. Targets on another floor and human players receive no cone damage.
- **Tesla Rifle:** a 180-damage bolt chains to at most five additional enemies
  within 7 units of the previous hit. Arcs require line of sight and compatible
  floors, skip already-hit targets, and use the existing short stun and immunity
  rules. The beam does not create additional damaging projectiles per hop.
- **Gravegun:** 16 pellets at 18 base damage each, for a maximum of 288 before
  shotgun spread and range falloff. One trigger pull empties the chamber; the
  reload replaces its shell.

Damage stays fixed as rounds advance, matching the Ray Gun's progression:
stronger zombies require more hits rather than receiving an automatic weapon
damage increase. The values below exclude Double Tap; Gravegun totals assume
every pellet hits before range falloff:

| Weapon | Base damage | Mk II damage |
|---|---:|---:|
| Ray Gun | 180 direct, 45–90 nearby splash | No upgrade |
| Pressure Cannon | 220 close / 90 at maximum range | 297 / 121.5 |
| Tesla Rifle | 180 per target, up to 6 targets | 243 per target |
| Gravegun | 18 × 16 pellets = 288 maximum | 24.3 × 16 = 388.8 maximum |

The new guns use existing ammunition inventories and Max Ammo behavior. Max
Ammo fills reserves without changing loaded magazines. All three are excluded
from the weapon shop and ignore the Endless Ammo perk.

## Pack-a-Punch

The new weapons have Mk II variants through the existing workbench. They keep
the same combat roles and receive the existing 1.35× damage and 1.5× magazine
multipliers (rounded up): Pressure Cannon holds 3 shots, Tesla Rifle 5, Gravegun
2. The Ray Gun's existing upgrade rule is unchanged. No acid conversion is
included in this first weapon set.

## Names and reload sounds

Base names live in the `name` fields of the wonder-weapon definitions in
`shared/defs/gameObjects/gunDefs.ts`. Mk II names live in
`ZombiePackAPunchNames` in `shared/defs/maps/zombiePackAPunch.ts`. The HUD,
interaction prompts and other weapon labels use the defined name when no
localized `game-<weapon>` entry exists. Existing translated names still win.

Each new weapon has its own reload recording:

- Pressure Cannon: valve release, two canister insertions, and a pressure lock.
- Tesla Rifle: cell removal and insertion, latch clicks, and a coil charge.
- Gravegun: break-action opening, cartridge loading, and a heavy breech closure.

The WAV files are in `client/public/audio/guns/*_reload_01.wav`. Their playback
follows the actual reload timer, including Speed Cola. The sound's authored
length is stored as `sound.reloadDuration`; update that field if the audio file
length changes. Base and Mk II variants use the same weapon-specific recording.

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

The weapon tests exercise actual base and Mk II firing, Double Tap damage,
bounded Tesla chains, wall and floor isolation, safe knockback and stair stops,
duplicate pickup/roll checks, Pack-a-Punch ownership, reserve refills, and
Gravegun reloads. Inspect the held sprites, loot icons, effects and sounds
in-game before changing their scales.
The initial damage, ammo and drop rates need longer cooperative balance testing.
