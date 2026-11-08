# PPSh-41

An ordinary automatic SMG with a wooden stock, perforated barrel shroud and
71-round drum. It is in the regular Zombie mystery-box pool, the weapon shop
for 2,600 points before discounts, and the Practice gun picker. It does not
change wonder-weapon probabilities or use their legendary pickup treatment.

| Stat | Base | Mk II |
|---|---:|---:|
| Damage before range falloff and perks | 11 | 14.85 |
| Magazine | 71 | 107 |
| Firepower magazine | 95 | 143 |
| Firing interval | 0.067 seconds, approximately 896 RPM | Same |
| Reload definition | 3.5 seconds | Same |
| Zombie operator reload | 3.15 seconds | Same |
| With Speed Cola | 1.84275 seconds | Same |

It uses the existing 7.62 mm inventory pool and spawns with 213 reserve rounds.
Range is 86 units, with damage falling toward 70% at maximum range. Its spread
is wider than the MP5 and Vector, especially while moving. Max Ammo, Double Tap,
Endless Ammo, normal pickup behavior and existing upgrade rules apply.

The new art is `gun-ppsh41-top.svg` and `loot-weapon-ppsh41.svg`. The latter is
shared by floor loot and inventory/HUD rendering. Names are in `gunDefs.ts`
and `ZombiePackAPunchNames`; missing translations use the existing name fallback.

## Audio

The firing sound is an original synthesized single shot with a short bolt tail.
The game repeats that single sample at the weapon's firing interval.

The approved reload is preview revision 3: a tightly sequenced drum release,
removal, insertion, locking clank and charging-handle/bolt action. It rearranges
edited handling segments from the existing `dp28_reload_01.mp3`,
`m1a1_reload_01.mp3` and `pkp_reload_01.mp3` assets. The final recording is
`client/public/audio/guns/ppsh41_reload_01.wav`, with an authored length of
2.85 seconds. `sound.reloadDuration` records that length so playback follows the
actual action timer, including Speed Cola. The server controls reload duration.

Follow the [conventional weapon audio direction](weapon-audio.md) for future
ordinary gun reloads.

## Verification

`ppsh41.test.ts` exercises actual firing, sustained automatic fire, ordinary
box rolls, weapon-shop registration, timed base/Mk II reloads, Speed Cola,
Pack-a-Punch, Max Ammo and floor isolation on each Zombie map. The weapon-name
suite checks the base and upgraded HUD labels.

After changing an audio file, decode it in the browser and verify its playback
against the action timer. Use the actual decoded length for `reloadDuration`.
