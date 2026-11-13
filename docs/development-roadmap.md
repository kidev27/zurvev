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
| PRA-001 | Practice presets | Practice | P2 | Needs Playtesting | None | `shared/practice.ts`, `client/src/ui/practiceMenu.ts` | `practice.test.ts` 53/53 (presets valid, fresh copies, server applies SPAS-12 + Mosin) | Menu not checked live in a browser |
| PRA-002 | Saved loadouts | Practice | P2 | Ready | PRA-001 storage format | `shared/practice.ts`, `client/src/ui/practiceMenu.ts` | Not started | Persistence choice (recommended: browser storage, as settings already are) |
| PRA-003 | Quick Switch profiles | Practice | P3 | Blocked | None | `server/src/game/weaponManager.ts`, `shared/gameConfig.ts`, `shared/practice.ts` | Not started | Reliable timing references for each profile |

### Notes

- Practice already saves one settings blob in browser storage (`practiceMenu.ts`). Presets and loadouts
  can extend that format.
- Presets (`PracticePresets` in `shared/practice.ts`): Default, Moving targets (4 bots, never shoot back,
  wiggle/strafe/turn/dodge 8, respawn 0.5 s) and SPAS-12 + Mosin (4x scope, level 2 armor; 1 bot with the
  same guns and armor). Picking one fills the menu; Start/Apply sends it. Saved loadouts (PRA-002) can reuse
  the `PracticePreset` shape.
- The server already uses Survev switch rules: per-gun `switchDelay` plus a 1 s free-switch cooldown.
  Resurviv runs on the same Survev code. Timings for the other profiles are not yet sourced.

## Testing environment notes

- vitest could not be installed in the development sandbox. Suites run under a Bun shim; results must
  be confirmed by CI once it runs on `main` (issue #40).
- Pre-existing failures on `main`: 3 in `zombieWonderWeapons.test.ts` and about 16 in
  `specOps.test.ts`. The `specOps` suite is also nondeterministic (16 to 21 failures across identical
  runs).
