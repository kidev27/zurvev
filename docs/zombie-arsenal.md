# Conventional Zombie arsenal

The regular mystery-box pool now also includes MP40, FN FAL, RPD, Winchester
1887 and the existing Survev PKP Pecheneg. Their base versions are available in
the weapon shop and Practice picker. Each has a Mk II upgrade using the existing
1.35× damage and 1.5× magazine rules. Wonder-weapon chances are unchanged.

| Gun | Role | Base damage | Magazine in Zombies | Shop cost |
|---|---|---:|---:|---:|
| MP40 | Controlled, economical SMG | 14 | 32 | 1,500 |
| FN FAL | Deliberate automatic battle rifle | 23 | 20 | 3,000 |
| RPD | Mobile belt-fed horde clearing | 14 | 100 | 3,600 |
| Winchester 1887 | Lever-action shotgun, shell loading | 14 × 8 pellets | 6 | 2,200 |
| PKP Pecheneg | Heavy sustained fire | 18 | 220 | 4,500 |

Damage is before falloff and perks. The PKP retains its existing Survev
definition, art, sounds and Fireteam magazine tuning: 220 rounds normally,
280 with Firepower. Mk II magazines are 330 and 420 respectively. The RPD's
box is painted into its new sprite, rather than inheriting the DP-28's pan.

The four new guns have separate top-down and shared loot/HUD SVGs. Their firing
and handling sounds edit existing firearm assets from this repository. Reloads
follow the approved [conventional gun audio direction](weapon-audio.md): dry
mechanical contact, compact transitions and actions appropriate to the firearm.
The Winchester loads shells individually and has its own lever-cycle recording.
The PKP keeps its native recording, with authored duration metadata so playback
follows the actual action timer and reload perks.

Reload source material includes M1A1, MP5, DP-28, PKP and M870 handling clips;
firing clips use M1A1, SCAR, DP-28 and M870 source recordings. New WAVs are mono
PCM16 at 48 kHz. Their authored lengths are recorded in `sound.reloadDuration`.
All base and Mk II versions retain ordinary ammo, pickup and Max Ammo behavior.

## Speed Cola and starting gear

Speed Cola multiplies reload time by **0.585**, down from 0.65: another **10%
shorter reload timer**, equivalent to a 41.5% reduction before the existing
operator reload modifier. It applies to both active and offhand reload paths.

Human players on Zombie maps start with at least a level 1 backpack. Configured
higher-level backpacks are retained. Fireteam, Practice and NPC starting gear
keep their existing rules.

`zombieArsenal.test.ts` covers regular rolls, shop/picker registration, firing,
base/Mk II magazine and shell loading, perk timing, actual Pack-a-Punch use,
and starting backpacks on all three Zombie maps. Browser checks verify new
art, HUD names, sound decoding, and reload timing including Speed Cola.
