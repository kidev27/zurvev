# Development roadmap

Tracker for Zombies, Practice and shared-infrastructure work. Fireteam gameplay is owned by another
developer: shared changes go through a pull request for review before merge.

Statuses: Not Started, Investigating, Ready, In Progress, Needs Playtesting, Completed, Blocked.
A task is Completed only after its pull request is merged and its acceptance criteria pass.

Last updated: 2026-11-11 (base `5c48da6`).

## Phase 1: Critical fixes

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| BUG-001 | Active-player health over 250 disconnects spectators | Shared (net) | P0 | Needs Playtesting | None | `shared/net/updateMsg.ts`, `shared/net/net.ts`, `shared/gameConfig.ts` | `activePlayerHealth.test.ts` (3) passes; cross-mode suites unchanged | Review and merge of `fix/active-player-health-range` |
| BUG-003 | Enemy dots missing from the map | Shared (Zombies and Fireteam) | P0 | Ready | Review of the design | `server/src/game/gameModeManager.ts`, `server/src/game/client.ts`, `client/src/game.ts`, `client/src/objects/player.ts`, `client/src/ui/ui.ts` | Not started | Restores Fireteam enemy dots too, so it needs Fireteam review |
| BUG-002 | Enemies invisible but attacking in late Fireteam rounds | Shared (net) | P0 | Investigating | BUG-001 merged, to rule it out | `server/src/game/client.ts`, `server/src/game/objects/gameObject.ts`, `client/src/objects/objectPool.ts` | Long-run simulation with client decode planned | No reproduction yet |
| BUG-004 | Missing drop animations | Unknown | P1 | Blocked | None | Unknown | None | Needs a description: which item, which mode |

### Notes

- **BUG-001.** Root cause: active-player health was written as 0-250 in 8 bits. Spec Ops enemies, and
  zombies from about round 49 on Regular, sit at 280 (`SpecOpsEnemyMaxHealth`). A dead player spectating
  one triggered the `writeFloat` assert. Production runs the server from source, so the assert is live
  and the spectator was disconnected. The fix sends 0-500 in 9 bits (same step size) and bumps the
  protocol to 1037. Known follow-up: the HUD reads `280 / 200` while spectating an enemy, because the
  client assumes operator max health.
- **BUG-003.** Root cause: PR #38 limited Spec Ops player status to teammates (`gameModeManager.ts`)
  and the client stopped treating Spec Ops status as all-player (`client/src/game.ts`). The map draws red
  enemy dots from that status list (`client/src/ui/ui.ts`), so the dots disappeared in every Spec Ops
  mode.
- **BUG-002.** Leading hypothesis: under socket backpressure, thin sync skips full re-sends for objects
  already visible (`server/src/game/client.ts`, `thinSync`). A missed layer or appearance change can
  leave an enemy drawn wrongly or not at all. Object ID reuse is the second suspect. Not yet reproduced.

## Phase 2: Zombies balancing

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| ZOM-001 | Zombie speed by difficulty | Zombies | P1 | Ready | None | `server/src/game/zombieMode.ts`, `server/src/game/specOpsManager.ts` | Not started | Speed values per difficulty need approval |
| ZOM-003 | Pack-a-Punch timer by difficulty | Zombies | P1 | Blocked | None | `shared/defs/maps/zombiePackAPunch.ts`, `server/src/game/specOpsManager.ts` | Not started | Which timer: `upgradeTime` (3 s) or `claimTime` (15 s)? |
| ZOM-002 | Ammunition scarcity | Zombies | P2 | Investigating | ZOM-004/005 ammo model | `server/src/game/zombieMode.ts`, `server/src/game/specOpsManager.ts`, `shared/defs/maps/zombiePowerUps.ts` | Not started | Economy survey, then design approval |

## Phase 3: Zombies content

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| ZOM-006 | Mystery Box weapon replacement | Zombies | P2 | Blocked | None | `server/src/game/objects/player.ts`, `server/src/game/specOpsManager.ts` | Not started | Intended replacement rule needs approval |
| ZOM-004 | Pressure Cannon special ammunition | Zombies | P2 | Blocked | Shared ammo design with ZOM-005 | `shared/defs/gameObjects/gunDefs.ts`, `shared/defs/maps/zombieWonderWeapons.ts` | Not started | Capacity, refill and drop rules need approval |
| ZOM-005 | Tesla Rifle special ammunition | Zombies | P2 | Blocked | Shared ammo design with ZOM-004 | Same as ZOM-004 | Not started | Same as ZOM-004 |
| ZOM-007 | Additional zombie types | Zombies | P3 | Investigating | ZOM-001 (per-class speed) | `server/src/game/zombieMode.ts`, `server/src/game/specOpsManager.ts` | Benchmark before raising counts | Design proposal for two variants first (see issue #19) |

### Notes

- Zombie speed today is one value, `speedMult: 0.53` on `zombie_walker`. `SpecOpsDifficultyMods` is
  shared with Fireteam, so zombie values go in a Zombies-only table.
- The Pressure Cannon, Tesla Rifle and Gravegun inherit `ammo: "50AE"` from the Ray Gun, the same pool
  as the Deagle.
- Box guns follow standard pickup rules: they replace the held gun slot and drop the old gun,
  Pack-a-Punched or not.

## Phase 4: Practice improvements

| ID | Title | Mode | Priority | Status | Depends on | Relevant files | Testing | Blockers |
|---|---|---|---|---|---|---|---|---|
| PRA-001 | Practice presets | Practice | P2 | Ready | None | `shared/practice.ts`, `client/src/ui/practiceMenu.ts` | Not started | Default preset list needs approval |
| PRA-002 | Saved loadouts | Practice | P2 | Ready | PRA-001 storage format | `shared/practice.ts`, `client/src/ui/practiceMenu.ts` | Not started | Persistence choice (recommended: browser storage, as settings already are) |
| PRA-003 | Quick Switch profiles | Practice | P3 | Blocked | None | `server/src/game/weaponManager.ts`, `shared/gameConfig.ts`, `shared/practice.ts` | Not started | Reliable timing references for each profile |

### Notes

- Practice already saves one settings blob in browser storage (`practiceMenu.ts`). Presets and loadouts
  can extend that format.
- The server already uses Survev switch rules: per-gun `switchDelay` plus a 1 s free-switch cooldown.
  Resurviv runs on the same Survev code. Timings for the other profiles are not yet sourced.

## Testing environment notes

- vitest could not be installed in the development sandbox. Suites run under a Bun shim; results must
  be confirmed by CI once it runs on `main` (issue #40).
- Pre-existing failures on `main`: 3 in `zombieWonderWeapons.test.ts` and about 16 in
  `specOps.test.ts`. The `specOps` suite is also nondeterministic (16 to 21 failures across identical
  runs).
