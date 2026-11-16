# Practice recordings

Anonymous recordings of Practice games, used to train bots on how people play: movement, aim and
shooting, swaps and quick switches, reloads, heals, grenades, cover, peeks and pushes, barrels and
doors. Only Practice is recorded. Other modes never record, even with recording on.

## Turning it on

Recording is off by default. Before turning it on, tell players that Practice games may be
recorded anonymously to improve the bots (for example, a line in the Practice menu or on the site).

```hjson
practiceRecording: {
  enabled: true
  dir: "/data/practice"  // absolute, or relative to the server's working folder
  sampleRate: 1          // share of Practice games recorded, 0 to 1
  minFreeDiskMb: 2048    // stop writing below this much free disk
}
```

With Docker, `dir` must be on a volume (prod: `/data`, the `fireteam-data` volume), or the files are
lost when the container is rebuilt. Rows are written every minute of play and when the game closes
(90 s after the last player leaves). A game's last chunk is lost if the server restarts mid-game.

## Files

One file per game: `<dir>/<day>/<random id>.jsonl.gz`. It is gzip'd JSON lines, written in
chunks; `gunzip -c`, Python's `gzip.open` and Node's `gunzipSync` read it as one stream.
About 6-8 MB per hour of play with 3 bots.

Nothing names a player: no names, account ids, IPs or chat. Players are numbered 1, 2, ... within
a game (`p`), bots `bot1`, `bot2`, ... in the order they appear, and the file id is random.

## Rows

Every row has `t` (its type) and `at` (seconds since the game started, where it has one).

| `t` | When | Fields |
| --- | --- | --- |
| `hdr` | First line | `v` row version, `obsV` observation version, `fields` observation names, `layouts` (column names of the raw arrays below), `map`, `protocol`, `interval` (s between samples), `day`, `world` (the map, below) |
| `set` | The player applies a setup | `p`, `settings`: the full Practice setup: your guns and kit, quick-switch mode, adrenaline mode, respawn mode, and every bot with its guns, melee, accuracy, reaction, movement, health, armor and whether it shoots back |
| `s` | Every `interval` (0.1 s) while the player is alive | `p`, `o`, `w`, `a`, `r` (below) |
| `ep` | Death and respawn | `p`, `kind` (`death` or `spawn`); a death also has `cause` (the hit that killed you: kind, weapon, map object, from), `ev` and `r` (what happened since the last row) |
| `end` | Game over | `p`, `stats` (kills, deaths, shots, hits, damage, time to kill) |

### The map (`hdr.world`)

`width`, `height`, `rivers`, `buildings` (type, x, y, ori, layer), and `obstacles`: every
obstacle as `type, layer, shape, ..., height, collidable, destructible, blast radius, flags`.
Shape 0 is a circle (x, y, r) and 1 a box (minX, minY, maxX, maxY). Flags: 1 door, 2 window,
4 wall, 8 tree, 16 bush. A blast radius above 0 means it explodes when destroyed (barrels, stoves).
Obstacle *i* in later rows is index *i* in this list.

### Sample rows

- `o`: a ready-made feature vector, in the order of the header's `fields`. What the player could
  see: their health, adrenaline, movement, aim, guns, ammo, cooldowns, heals, grenades and cooking;
  up to 4 bots on their screen, nearest first (offset, speed, health, gun group, reloading or
  healing, whether a bullet line is clear, how far you'd step to see them, whether they aim at you);
  16 rays to the nearest wall and the nearest bullet-stopping cover; up to 3 bot bullets about to
  pass close; the 2 nearest barrels/stoves (offset, blast radius, health, whether a bot stands in
  the blast); the 2 nearest grenades (offset, speed, height, time left, blast radius, yours or not).
  Built by `practiceObserve` in `server/src/game/practiceObservation.ts`; a learned bot reads the
  same vector.
- `w`: the raw world, for training code that wants to build its own features:
  - `self`: position, velocity, aim, health, adrenaline, layer, indoors, current slot, every weapon
    with its ammo (`weapons`: `[type, ammo]` per slot), inventory (`inv`), current action
    (`[type, item, seconds left]`), grenade cooking time, scope, gear (helmet, vest, backpack).
  - `bots`: every living bot, columns in `layouts.bot` (position, velocity, aim, health,
    adrenaline, layer, slot, exact weapon, ammo, action, on your screen, clear shot).
  - `projectiles`: every grenade or thrown thing, columns in `layouts.projectile`.
  - `bullets`: the 40 nearest bullets within 40 units, columns in `layouts.bullet`.
  - `changes`: obstacles that broke, took damage, or opened/closed since the last row
    (`[obstacle, dead, health, door open]`).
- `a`: what the player did. `move` (x, y; y is up), `aim` (unit vector), `aimLen` (mouse distance),
  `fire` (trigger held), `shots` (shots fired since the last row), and `ev`: events since the last
  row, each `[ms after the last row, kind, ...]`:
  - `swap` (slot), `reload` (slot), `item` (bandage, healthkit, soda, painkiller), `action_end`,
    `scope` (scope), `melee` (weapon), `cook` (grenade);
  - `throw` (type, vel_x, vel_y, fuse left);
  - `hit_in` (amount, kind, weapon, map object, from: `bot<n>`, `self` or `none`): damage you took,
    from anything: a bot, a barrel, your own grenade;
  - `hit_out` (amount, kind, weapon, map object, `bot<n>`): damage you caused, including a barrel
    you shot or a grenade you threw;
  - `bot_died` (`bot<n>`, kind, weapon, map object, `player` or `none`): any bot death and its cause.

  Damage kinds: `bullet`, `melee`, `explosion`, `bleeding`, `gas`, `other`. Events are caught every
  tick, so a quick switch or a throw between two rows is kept.
- `r`: since the last row: `dealt` and `taken` damage (all sources) and `kills`.

The action for row *n* is the input held at that moment; the aim a learned model should predict is
the next row's `self_dir`.

## Versions

Bump `PracticeObservationVersion` when an observation field changes, and `PracticeRecordVersion`
when a row's layout changes. Training code should read `fields` and `layouts` from the header,
not assume an order. Version 1 files (before grenades, barrels and the raw world) have no `w`,
fewer `o` fields, and count only damage from bots.

## Tuning

`PracticeRecordTuning` (`server/src/game/practiceRecorder.ts`) and `PracticeObservationTuning`
(`server/src/game/practiceObservation.ts`).
