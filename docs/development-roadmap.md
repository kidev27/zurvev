# Development roadmap

Tracker for Zombies, Practice and shared-infrastructure work. Fireteam gameplay is owned by another
developer: shared changes go through a pull request for review before merge.

Statuses: Not Started, Investigating, Ready, In Progress, Needs Playtesting, Completed, Blocked.
A task is Completed only after its pull request is merged and its acceptance criteria pass.

Last updated: 2026-11-11 (base `d6dc806`).

## Phase 1: Critical fixes

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| BUG-001 | Active-player health over 250 disconnects spectators | Shared (net) | P2 | Completed | None | `shared/net/updateMsg.ts`, `shared/net/net.ts`, `shared/gameConfig.ts` | `activePlayerHealth.test.ts` (4) passes, including a Zombies duo; merged in PR #43 | None |
| BUG-003 | Enemy dots missing from the map | Shared (Zombies, Fireteam, Practice) | P0 | Completed | PR #43 | `shared/net/updateMsg.ts`, `server/src/game/gameModeManager.ts`, `server/src/game/client.ts`, `client/src/objects/enemyMarkers.ts`, `client/src/ui/ui.ts` | `specOpsEnemyMarkers.test.ts` (6) passes; merged in PR #45; browser check pending | None |
| BUG-002 | Enemies invisible but attacking in late Fireteam rounds | Shared (net) | P0 | Completed | None | `server/src/game/client.ts` | `netSyncBackpressure.test.ts` (4) passes; merged in PR #46; live check on a slow connection pending | None |

### Notes

- **BUG-001.** Root cause: active-player health was written as 0-250 in 8 bits. Spec Ops enemies, and
  full-health zombies from round 43 on Regular (37 Hardened, 34 Veteran), exceed 250. When the last
  living teammate dies, a dead player spectating them is moved to the killer two seconds later, which
  triggered the `writeFloat` assert. Production runs the server from source, so the assert is live and
  the spectator was disconnected. Impact is low: the match-over message arrives first and the client
  ignores the disconnect, so it shows up as an ERROR in logs. The fix sends 0-500 in 9 bits (same step
  size). Known follow-up: the HUD reads `280 / 200` while spectating an enemy, because the client
  assumes operator max health.
- **BUG-003.** Root cause: PR #38 limited Spec Ops player status to teammates (`gameModeManager.ts`)
  and the client stopped treating Spec Ops status as all-player (`client/src/game.ts`). The map draws red
  enemy dots from that status list (`client/src/ui/ui.ts`), so the dots disappeared in every Spec Ops
  mode. The fix (PR #45) sends hostiles as a separate list after team status, so team status stays
  team-only.
- **Protocol.** `main` is now at protocol 1038 (PRs #43 and #45). Players must refresh after the next deploy.
- **BUG-004** (missing drop animations) was dropped from the backlog on 2026-11-11.
- **BUG-002.** Root cause: for clients whose socket is backed up, the server dropped state changes for
  good. A backpressured sync sends nothing, the following thin sync sent only partial updates, and
  `objectRegister.flush()` clears dirty flags every sync. An enemy that changed floor in that window
  stayed drawn on its old floor: invisible but still shooting. Object ID recycling was ruled out (0
  missing, ghost or wrong-type objects in long runs with IDs exhausted). Fixed in PR #46 (merged): resend
  missed changes on the next update; +0.21% bytes under 10% simulated backpressure, identical output without it.

## Fireteam rollback review (PR #38 follow-up)

Reference: `37f180d` (last merge before PR #38). No Fireteam AI or gameplay code changed since then.

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| FT-001 | Kill feed shows blank names for enemies never seen | Shared (Fireteam, Zombies, Practice) | P1 | Needs Playtesting | None | `server/src/game/client.ts` | `specOpsSupportSync.test.ts`; mirror runs: 7/20 and 8/22 blank on `main`, 0 with the fix | Review of the rollback PR |
| FT-002 | Hired support units reported as misbehaving | Fireteam | P1 | Blocked | None | `server/src/game/specOpsManager.ts` (unchanged since `37f180d`) | ~5,000 metadata/status/HUD/shop-cap checks clean on both versions | Not reproduced; needs a concrete symptom |
| FT-003 | Tick-time WARNs around wave 30 | Shared | P1 | Investigating | None | `server/src/game/specOpsManager.ts` | Matched wave-30 benchmarks: no regression from #38, #43, #45 or #46; `planHouseAssault` scan skip -16% in Zombies After Hours | Check prod VM CPU credits; a Fireteam-wide speed-up (fewer wall-steering probes) changes AI movement and needs approval |

## Phase 2: Zombies balancing

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| ZOM-001 | Zombie speed by difficulty | Zombies | P1 | Needs Playtesting | None | `server/src/game/zombieMode.ts`, `server/src/game/specOpsManager.ts` | `zombieMode.test.ts`: table, cap, and spawned zombies per difficulty | In-game feel. Base speed 0.51 Recruit, 0.55 Regular, 0.59 Hardened, 0.64 Veteran; capped at 0.75; rush +15% |
| ZOM-003 | Pack-a-Punch timer by difficulty | Zombies | P1 | Needs Playtesting | None | `shared/defs/maps/zombiePackAPunch.ts`, `server/src/game/specOpsManager.ts` | `zombieMode.test.ts` covers every difficulty; Zombies suites unchanged | In-game feel. Claim window 12 s on every difficulty; upgrade 3 s Recruit, 5 s Regular, 7 s Hardened, 9 s Veteran |
| ZOM-002 | Ammunition scarcity | Zombies | P2 | Completed | None | `shared/defs/maps/zombieIndoorDefs.ts`, `shared/defs/maps/zombiePowerUps.ts`, `server/src/game/specOpsManager.ts` | `zombieMode.test.ts` (bags, Max Ammo fill, drop chance by round); 20-round solo sim: drops 33 to 23, Max Ammo 8 to 5 | In-game feel. Caps 300 9mm, 270 5.56/7.62/.45, 40 12ga, 84 .50 AE, 36 .308; drops 2000 x1.14 points, 2% per kill minus 0.05 points per round (1% floor) |

## Phase 3: Zombies content

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| ZOM-006 | Mystery Box weapon replacement | Zombies | P2 | Needs Playtesting | None | `server/src/game/objects/player.ts`, `server/src/game/objects/loot.ts`, `server/src/game/specOpsManager.ts` | `zombieMode.test.ts`: held gun replaced with no floor drop; with two guns, holding a grenade or melee blocks the take; ordinary pickups still drop | In-game feel. Old gun and its loaded rounds are gone; reserve ammo stays |
| ZOM-004 | Pressure Cannon special ammunition | Zombies | P2 | Needs Playtesting | None | `shared/defs/gameObjects/gearDefs.ts`, `shared/defs/maps/zombieWonderWeapons.ts`, `server/src/game/specOpsManager.ts`, `client/src/ui/ui2.ts` | `zombieWonderWeapons.test.ts` (charges, box, Max Ammo, drop, Mk II); PR #53 | Live check of HUD slot and drop art |
| ZOM-005 | Tesla Rifle special ammunition | Zombies | P2 | Needs Playtesting | None | Same as ZOM-004, plus `shared/practice.ts` | `zombieWonderWeapons.test.ts` 39/42 (Tesla cases + per-ammo drop rates; 3 failures pre-existing on `main`); `practice.test.ts` 49/49 | Live check of HUD slot and drop art |
| ZOM-007 | Zombie variants: Runner and Brute | Zombies | P2 | Needs Playtesting | None | `server/src/game/zombieMode.ts`, `server/src/game/specOpsManager.ts`, `server/src/game/objects/player.ts`, `shared/defs/gameObjects/outfitDefs.ts` | `zombieMode.test.ts` 81/81 (wave mix, stats, size, melee damage, power-ups); reach sim on High Water and Dead Air: Brute at 1.3x reaches as many spots as at 1.0x | In-game feel and readability; Charger (#19) not started |

### Notes

- Zombie speed lives in `ZombieSpeedByDifficulty` (`zombieMode.ts`), separate from Fireteam's
  `SpecOpsDifficultyMods`. Future types scale it with `speedScale`, capped by `ZombieMaxSpeedMult`
  (0.75). Kill-heat rush adds up to +15% on top in Zombies (`ZombieRushSpeedBonus`); Fireteam keeps +38%.
- The Pressure Cannon fires its own `pressure_charge` (cap 24 in Zombies, `ZombieAmmoBagSizes`). A box
  Cannon brings 4; Max Ammo and Pack-a-Punch fill to the cap; charges stay if the Cannon is replaced.
  Kills drop a charge rarely while the killer owns a Cannon (`ZombieWonderAmmoDrops`: 2%, 1 charge,
  20 s). The HUD slot shows only while carrying charges (`hideWhenEmpty`).
- The Tesla Rifle fires its own `tesla_cell` (cap 36 in Zombies). Same rules as Pressure Charges: a box
  Tesla brings 12, Max Ammo and Pack-a-Punch fill to the cap, cells stay if the Tesla is replaced. Kill
  drop 1.5%, 1 cell, 20 s. The Tesla is no longer offered in Practice (no wonder-ammo space there).
  The Gravegun still shares `12gauge`.
- Box guns: with two guns, the box gun replaces the held one instead of dropping it (PR #52).
- Zombie variants (`ZombieVariants` in `server/src/game/zombieMode.ts`). Runner from round 4: 1.3x walker
  speed (capped at 0.75), 70% health, 5% of the wave growing 5% a round to 20%; dies to Insta-Kill and
  Nuke. Brute from round 8 (two from round 12, never more than 2 a wave): 0.8x speed, 4x health (cap 1200),
  2x melee damage, 1.3x size, 200 kill cash; Insta-Kill doubles damage, Nuke takes a fraction. Brutes
  spawn last in a wave. Wave totals are unchanged.

## Phase 4: Practice improvements

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| PRA-001 | Practice presets | Practice | P2 | Needs Playtesting | None | `shared/practice.ts`, `client/src/ui/practiceLoadoutMenu.ts` | `practice.test.ts` (presets valid, fresh copies, server applies SPAS-12 + Mosin) | Live check in the game |
| PRA-002 | Saved loadouts | Practice | P2 | Needs Playtesting | None | `shared/practice.ts`, `client/src/ui/practiceLoadouts.ts`, `client/src/ui/practiceLoadoutMenu.ts`, `client/src/main.ts` | `practice.test.ts` (store sanitizing, Loadout N names, cap of 8); browser run of the loadout screen | Live check in the game |
| PRA-004 | Practice menu redesign and respawn when ready | Practice | P2 | Needs Playtesting | PRA-001 | `client/src/ui/practiceEditor.ts`, `client/src/ui/practiceMenu.ts`, `server/src/game/practiceController.ts`, `shared/net/practiceMsg.ts` | `practice.test.ts` 59/59 (bots freeze while dead, hold and Respawn now, bots restart); scripted browser run, 25 checks | Live check in the game |
| PRA-005 | Practice bots: reload and gun choice | Practice | P1 | Needs Playtesting | None | `server/src/game/practiceCombat.ts` | `practiceBotReload.test.ts` 9/9; `practice.test.ts` 59/59; full-game fights before/after (see notes) | In a nonstop close fight with no break the empty gun still waits (needs PRA-008) |
| PRA-006 | Practice bots: overclocking and gun swaps by range | Practice | P1 | Needs Playtesting | PRA-005 | `server/src/game/practiceCombat.ts`, `server/src/game/specOpsManager.ts` | `practiceBotOverclock.test.ts` 14/14; `practiceBotRange.test.ts` 7/7; `practice.test.ts` 59/59; full-game fights before/after (see notes) | In-game feel. Fast semi-autos (DMRs, pistols, M1014, M1100) still slow the bot while it shoots: needs a decision. The rifle is often empty by the time the bot is close (needs PRA-008) |
| PRA-007 | Practice bots: healing and adrenaline | Practice | P1 | Needs Playtesting | PRA-006 | `server/src/game/practiceCombat.ts`, `server/src/game/specOpsManager.ts`, `shared/practice.ts`, `shared/net/practiceMsg.ts`, `client/src/ui/practiceEditor.ts` | `practiceBotHeal.test.ts` 17/17; `practice.test.ts` 60/60; `net` 10/10; full-game checks (see notes) | In-game feel. Protocol 1043: players must refresh. In the open a bot is almost never out of your sight, so it rarely heals until it can take cover (PRA-008) |
| PRA-008 | Practice bots: cover, peek shooting, pushing a low player | Practice | P1 | Ready | None | `server/src/game/specOpsManager.ts` | Not started | Rules need approval; bot range follows the gun in hand today |
| PRA-009 | Practice bots: player move speed | Practice | P1 | Needs Playtesting | PRA-006 | `server/src/game/specOpsManager.ts`, `shared/practice.ts`, `client/src/ui/practiceEditor.ts` | `practice.test.ts` 60/60; `practiceBotOverclock.test.ts` 15/15 | In-game feel. Bots are faster than before at every Wiggle setting below 9 |
| PRA-003 | Quick Switch profiles | Practice | P3 | Blocked | None | `server/src/game/weaponManager.ts`, `shared/gameConfig.ts`, `shared/practice.ts` | Not started | Reliable timing references for each profile |

### Notes

- Practice already saves one settings blob in browser storage (`practiceMenu.ts`). Presets and loadouts
  can extend that format.
- Presets (`PracticePresets` in `shared/practice.ts`): Default, Moving targets (4 bots, never shoot back,
  wiggle/strafe/turn/dodge 8, respawn 0.5 s) and SPAS-12 + Mosin (4x scope, level 2 armor; 1 bot with the
  same guns and armor). They are templates: the loadout screen copies one into the open loadout.
- Saved loadouts: up to 8 on this device, named Loadout 1, 2… (rename any time). The home page shows a
  "Practice loadout" dropdown with Edit, or "No loadouts saved · click to create one". A match starts with
  the picked loadout right away; Apply in the match saves changes back to it. The old single settings blob
  becomes Loadout 1 on first run.
- Loadout screen (home): Presets / Guns / Gear & kit / Bots tabs in the Survivor Kit theme. Bot skill buttons:
  Easy 30% / 1.0 s / wiggle 3, Normal 50% / 0.5 s / 5, Hard 80% / 0.2 s / 8 (`PracticeBotSkills`).
- In the match, Tab opens a drawer on the right (Loadout / Bots / Tools) with Changed badges and an Apply bar.
- Rule for Practice bot AI: bot code must not change game mechanics. A bot plays like a top player with
  the inputs a player has (move, aim, weapon slot, trigger, reload, use item) and the same guns, timers
  and ranges. New bot behaviour is a decision about when to use a mechanic, never a new number on one.
- Bot reload rules (`PracticeBotReload` in `server/src/game/practiceCombat.ts`). A reload only works on the
  gun in hand and the bot cannot shoot meanwhile. Safe (has not seen you for 0.4 s): fill both guns, empty
  first. Nothing loaded: reload the gun that gets a round in soonest, then shoot. One gun empty and it sees
  you: fight with the loaded gun, unless that gun cannot reach you (past 1.5x its fire range), you are
  reloading or healing, or it is on its last round and the empty gun reloads at least 1 s quicker. A reload
  with 0.75 s or less left is finished. A loaded gun may fire mid-reload. Before this, the first gun to run
  dry was never reloaded (measured: Mosin empty for 55 of 60 s).
- Bot overclocking (`PracticeBotOverclock` in `server/src/game/practiceCombat.ts`). After a shot the bot
  walks at half speed for the gun's `fireDelay`; any weapon swap ends that. With Quick switch on, the bot
  holsters to melee for one tick after each shot of a slow gun (`fireDelay` 0.45 s or more, not burst) and
  draws it again. Bolt rifles also fire faster this way (Mosin 1.75 s to about 1.0 s). SPAS-12, M870 and
  Scout Elite lose 0.02 s per shot. Model 94, BLR 81, Winchester 1887 and Barrett lose more, because the
  gun is ready only after its draw time: Model 94 0.70 s to 1.02 s between shots, BLR 81 0.80 s to 1.02 s,
  Winchester 1887 0.80 s to 0.92 s. `maxCancelCost` (default: no limit) can cap that. A gun that runs dry
  is holstered once before its reload. Measured in 60 to 120 s full-game fights: time at half speed
  24-77% to 1%, movement 6-8.5 to 9.6 units/s; Model 94 shots per minute 55 to 43, BLR 81 50 to 37.
  Guns faster than 0.45 s (DMRs, pistols, M1014, M1100, autos) are not swapped and still slow the bot.
- Bot healing and adrenaline (`PracticeBotHeal` in `server/src/game/practiceCombat.ts`). Every bot that
  shoots back spawns with a level 3 pack: 30 bandages, 4 med kits, 15 sodas, 4 pills. Items work as for
  any player (bandage 3 s +15, med kit 6 s +100, soda 3 s +25 adrenaline, pills 5 s +50; half speed while
  using; a shot or swap cancels). The bot starts an item only when safe: it has not seen you for 0.4 s, or
  you are farther than 110 units, or you are reloading or using an item and none of its loaded guns
  reaches you. Taking damage stops the item and it waits 1 s; seeing you again stops it unless 0.5 s or
  less is left. When your health is 30 or less it does not heal and closes in instead. Order when safe:
  reload if nothing is loaded, heal if at 50 health or less, reload an empty gun, heal, top up clips,
  adrenaline. It heals while a bandage's worth (15) is missing and uses a med kit when the bandages would
  take longer (more than 30 missing). Adrenaline under 50 is topped up: pills under 25, else soda. New
  per-bot setting "Start with full adrenaline" (default off), so protocol is 1043. A bot's health now tops
  out at its Health setting; the game allowed enemy AI up to 280, which med kits and adrenaline would have
  reached. Measured: 20 s with you at 20 health, a Mosin bot's average distance goes 47.7 to 14.1, SPAS-12
  14.5 to 5.5. In the open against a player who never hides the bot was out of sight 1 to 4 s in 96 s and
  used 0.3 med kits; healing depends on cover (PRA-008).
- Heal only when it can finish (PRA-007, second pass). The bot starts an item only if it can finish before
  you could shoot it. That window is the longest of: behind cover, how far you must walk sideways to see
  it (from the obstacle's size and where you both stand) at player speed; in the open, how far it is past
  your guns' bullet reach or your screen (scope view radius x 16/9). Your remaining reload or item time is
  added. It uses the item it wants or a shorter one (bandage for med kit, soda for pills) that fits with
  0.3 s to spare. A tree from 15 units gives about 1 s, a container wall from 22 units about 3.4 s. At 60
  health or less with nothing that fits, it walks to the nearest cover within 24 units that fits a bandage,
  then heals there standing still. You reloading or healing where it can shoot you: it shoots. Fixes found
  on the way: a practice bot told to stand still kept walking (no movement input reset), and the brain's
  anti-stuck nudge moved a bot that was holding cover on purpose. Measured with you circling it at walking
  speed (16 fights of 45 s): items started 14 to 5, items you interrupted 13 to 2, finished 1 to 3.
- Bot fire range fix (`PracticeBotView` in `server/src/game/practiceCombat.ts`). Bots only fired inside a fixed
  brain range (autos 30 units, pistols 34.5, shotguns 12.65), so at 40 units an AK bot walked in for about 2 s
  without a shot, and only a separate return-fire rule made it answer once you shot it. A practice bot now
  shoots as far as its gun's bullets fly (AK 200, Mosin 500) at anything on the screen a player with your
  scope sees (view radius up and down, 16/9 of it sideways). Shotguns still only within 12.65. Movement
  distances are unchanged. Median first shot with you 40 to 48 units away on screen: about 2 s to 0.3 to 0.5 s.
- Bots move like a player (PRA-009). Move speed is 100% of player speed at every setting; it used to
  follow the Strafe setting (55% at 0, 80% at 5, 105% at 10), which no player has. The slider is now called
  "Strafe amount" and only changes how much the bot moves sideways. Weapon swap timing is unchanged: the
  bot presses as fast as the game allows (`PracticeBotOverclock.holsterTime` 0). Bots still have endless
  reserve ammo.
- Where a two-gun bot fights (`PracticeBotRange` in `server/src/game/practiceCombat.ts`). A bot whose guns
  differ in reach moves by the shorter gun: it walks in until you are inside 0.8x that gun's fire range
  (shotguns: 10.1 units), and shoots the longer gun on the way, holstering between shots. It draws a gun
  only when you are inside that gun's fire range. One-gun bots and pairs with the same reach are unchanged.
  Before, a Mosin and SPAS-12 bot drew the SPAS-12 at long range and walked in for about 5 s without a
  shot. Measured from 45 units, 40 fights of 12 s: first shot 5.2 s to 1.1 s, shots from beyond 20 units
  0.3 to 3.0. Over 60 s: average distance 22.7 to 14.4, shots 39 to 53, but Mosin shots 17 to 8, because
  the rifle is often empty when the bot arrives and is only reloaded by the rules above.
- Respawn when ready: while you are dead, bots freeze and dead bots wait. Touching the loadout pauses the
  3 s auto-respawn; Respawn (Space) brings you back and the bots start over. Auto-respawn can be turned off.
  Protocol 1042 (`PracticeRespawnMsg`).
- The server already uses Survev switch rules: per-gun `switchDelay` plus a 1 s free-switch cooldown.
  Resurviv runs on the same Survev code. Timings for the other profiles are not yet sourced.

## Testing environment notes

- vitest could not be installed in the development sandbox. Suites run under a Bun shim; results must
  be confirmed by CI once it runs on `main` (issue #40).
- Pre-existing failures on `main`: 3 in `zombieWonderWeapons.test.ts` and about 16 in
  `specOps.test.ts`. The `specOps` suite is also nondeterministic (16 to 21 failures across identical
  runs).
