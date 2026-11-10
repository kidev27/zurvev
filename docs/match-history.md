# VM match history

After updating the repository and rebuilding the game service, install the wrapper:

```bash
install -b -m 755 ~/fireteam/scripts/fireteam-history ~/bin/fireteam-history
fireteam-history
fireteam-history 50
```

The wrapper reads its JavaScript helper from `~/fireteam/scripts/fireteam-history.mjs`
and runs it with Bun inside the existing `fireteam` Compose service. It reads
`/data/specops-local.db` in read-only mode. The default is 20 finished games;
the maximum is 500. Override `FIRETEAM_REPO_DIR` or `FIRETEAM_COMPOSE_DIR` if
the checkout or Compose directory lives elsewhere.

Each game shows its saved time in America/New_York, game mode, map, solo/duo/squad,
difficulty and wave where applicable, longest player time, and the player rows.
The limit applies to complete games, not a fixed number of player records.
Practice is labelled `bot (Practice)` and has no wave counter.

New game processes save the resolved map name and mode in `local_match_context`.
The game node sends this optional context to the API as well, so SQLite-based API
hosts can retain it. The table is created automatically alongside the existing
local player history. Older nodes can still upload their original payloads.

Old records are preserved. They cannot be assigned an exact map after the fact.
Map ID 11 identifies Zombies; ID 10 is shared by Fireteam and Practice and cannot
reliably distinguish them, even for a zero-wave game. Missing details are shown
as `not recorded`, rather than inferred from the map seed or current server setting.

The existing `died` flag describes the player's final saved state. A `survived`
row does not identify whether the player quit, disconnected, or completed a run.
The displayed minutes use the longest saved player lifetime, as the old helper did.
