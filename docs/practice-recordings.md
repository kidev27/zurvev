# Practice recordings

Anonymous recordings of Practice games, used to train bots on how people play: when they heal and
reload, how they swap and peek, how they move and dodge, and where they aim. Only Practice is
recorded. Other modes never record, even with recording on.

## Turning it on

Recording is off by default. Before turning it on, tell players that Practice games may be
recorded anonymously to improve the bots (for example, a line in the Practice menu or on the site).

```hjson
practiceRecording: {
  enabled: true
  dir: "logs/practice"   // relative to the server's working folder
  sampleRate: 1          // share of Practice games recorded, 0 to 1
  minFreeDiskMb: 2048    // stop writing below this much free disk
}
```

With Docker, `dir` must sit on a mounted volume, or the files are lost when the container is rebuilt.
A game's last chunk (up to a minute) is lost if the server restarts mid-game.

## Files

One file per game: `<dir>/<day>/<random id>.jsonl.gz`. It is gzip'd JSON lines, written in
chunks; `gunzip -c`, Python's `gzip.open` and Node's `gunzipSync` read it as one stream.
About 2-4 MB per hour of play.

Nothing names a player: no names, account ids, IPs or chat. Players are numbered 1, 2, ... within
a game (`p`), and the file id is random.

## Rows

Every row has `t` (its type) and `at` (seconds since the game started, where it has one).

| `t` | When | Fields |
| --- | --- | --- |
| `hdr` | First line | `v` row version, `obsV` observation version, `fields` observation names, `map`, `protocol`, `interval` (s between samples), `day` |
| `set` | The player applies a setup | `p`, `settings` (the full Practice setup: guns, kit, bots, respawn, quick-switch profile) |
| `s` | Every `interval` (0.1 s) while the player is alive | `p`, `o`, `a`, `r` (below) |
| `ep` | Death and respawn | `p`, `kind`: `death` or `spawn` |
| `end` | Game over | `p`, `stats` (kills, deaths, shots, hits, damage, time to kill) |

Sample rows:

- `o`: the observation, numbers in the order of the header's `fields`. It is what the player could
  see at that moment: their health, adrenaline, movement, aim, guns, ammo, cooldowns and items; up
  to 4 bots on their screen, nearest first (offset, speed, health, gun, reloading or healing, whether
  a bullet line is clear, how far you'd step to see them, whether they aim at you); 16 rays to the
  nearest wall and nearest bullet-stopping cover; and up to 3 bot bullets that will pass close soon.
  Built by `practiceObserve` in `server/src/game/practiceObservation.ts`; a learned bot reads the same
  vector.
- `a`: what the player did. `move` (x, y; y is up), `aim` (unit vector), `aimLen` (mouse distance),
  `fire` (trigger held), `shots` (shots fired since the last row), and `ev`: events since the last
  row, each `[ms after the last row, kind, value]`, where kind is `swap` (slot), `reload` (slot),
  `item` (bandage, healthkit, soda, painkiller), `action_end` or `scope`. Events are caught every
  tick, so a quick switch between two rows is kept.
- `r`: what happened since the last row: `dealt` and `taken` damage, `kills`.

The action for row *n* is the input held at that moment; the aim a learned model should predict is
the next row's `self_dir`.

## Versions

Bump `PracticeObservationVersion` when an observation field changes, and `PracticeRecordVersion`
when a row's layout changes. Training code should read `fields` from the header, not assume an order.

## Tuning

`PracticeRecordTuning` (`server/src/game/practiceRecorder.ts`) and `PracticeObservationTuning`
(`server/src/game/practiceObservation.ts`).
