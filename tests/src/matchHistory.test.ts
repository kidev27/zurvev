import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { PracticeMapPool } from "../../shared/defs/maps/practiceDefs.ts";
import { FireteamMapPool, ZombieMapPool } from "../../shared/defs/maps/specOpsDefs.ts";
import { matchContextForMap } from "../../shared/utils/matchContext.ts";

test("map rules identify Practice, Zombies and Fireteam without relying on the shared map ID", () => {
    for (const { key } of PracticeMapPool) {
        expect(matchContextForMap(key, MapDefs[key].gameMode)).toEqual({ mapName: key, mode: "bot" });
    }
    for (const key of ZombieMapPool) {
        expect(matchContextForMap(key, MapDefs[key].gameMode)).toEqual({ mapName: key, mode: "zombies" });
    }
    for (const key of FireteamMapPool) {
        expect(matchContextForMap(key, MapDefs[key].gameMode)).toEqual({ mapName: key, mode: "fireteam" });
    }
    expect(matchContextForMap("main", MapDefs.main.gameMode).mode).toBe("battle_royale");
});

test("the VM history wrapper is valid Bash", () => {
    execFileSync("bash", ["-n", path.resolve(import.meta.dirname, "../../scripts/fireteam-history")]);
});

test("local history upgrades old databases, preserves context and fetches complete games", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zurvev-history-"));
    const root = path.resolve(import.meta.dirname, "../..");
    const database = path.join(dir, "history.db");
    try {
        const run = (stage: string) => {
            const output = execFileSync("bun", ["tests/src/matchHistoryStore.fixture.ts", database, stage], {
                cwd: root, encoding: "utf8",
            });
            return JSON.parse(output.split("RESULT:")[1]!);
        };
        const legacy = run("legacy");
        expect(legacy.rows).toBe(2);
        expect(legacy.hasContextTable).toBe(false);
        expect(legacy.text).toContain("mode zombies | map not recorded");
        expect(legacy.text).toContain("mode fireteam/bot (not recorded)");

        const modern = run("modern");
        expect(modern.contexts).toEqual([
            { game_id: "new-bot", map_name: "practice_woods", game_mode: "bot" },
            { game_id: "new-fireteam", map_name: "specops_cobalt", game_mode: "fireteam" },
            { game_id: "new-zombies", map_name: "zombie_high_water", game_mode: "zombies" },
        ]);
        expect(modern.preserved.game_id).toBe("legacy-zombies");
        expect(modern.preserved.kills).toBe(10);
        expect(modern.text).toContain("mode zombies | map High Water | squad | regular | wave 8 | 5 min");
        expect(modern.text).toContain("mode bot (Practice) | map Woods | squad | no waves | 5 min");
        expect(modern.text).toContain("mode fireteam | map Cobalt");
        expect(modern.text).toContain("11/9/2026, 8:00:00 AM");
        expect(modern.text).toContain("Teammate");
        expect(modern.recentRows).toBe(2005);
        expect(modern.recentIds).toEqual(["large-game"]);
        expect(modern.recentMap).toBe("specops_complex");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
