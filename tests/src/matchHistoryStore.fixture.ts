// Runs in Bun because the production store and VM helper use bun:sqlite.
import { Database } from "bun:sqlite";
import { readHistory, formatHistory } from "../../scripts/fireteam-history.mjs";
import { Config } from "../../server/src/config.ts";
import type { SaveGameBody } from "../../server/src/utils/types.ts";
import { matchContextForMap } from "../../shared/utils/matchContext.ts";

Config.database.enabled = false;
Config.database.sqlitePath = process.argv[2]!;
const stage = process.argv[3];
const { insertLocalMatchData } = await import("../../server/src/api/db/localMatchStore.ts");

function row(gameId: string, playerId = 1, mapId = 10): SaveGameBody["matchData"][number] {
    return {
        userId: "", region: "na", mapId, gameId, mapSeed: 1, username: "Operator",
        playerId, teamMode: 4, teamCount: 2, teamTotal: 1, teamId: 1,
        timeAlive: 300, rank: 1, died: false, kills: 10, downs: 0, revives: 0,
        teamKills: 0, damageDealt: 0, damageTaken: 0, killerId: 0, killedIds: [],
        role: "", wavesSurvived: 8, squadName: "Test", gameVersion: "1.7", difficulty: "regular",
        ip: "", findGameIp: "",
    };
}
const rules = { maxPlayers: 4, killLeaderEnabled: false, specOpsMode: true };
if (stage === "legacy") {
    insertLocalMatchData([row("legacy-zombies", 1, 11), row("legacy-fireteam-or-bot")]);
    const db = new Database(Config.database.sqlitePath);
    db.exec("DROP TABLE local_match_context");
    const saved = readHistory(db, 20);
    console.log("RESULT:" + JSON.stringify({
        rows: saved.length,
        text: formatHistory(saved),
        hasContextTable: !!db.query("SELECT 1 FROM sqlite_master WHERE name = ?").get("local_match_context"),
    }));
    db.close();
} else {
    // Reopening an existing database creates the new table without rewriting player history.
    const zombie = matchContextForMap("zombie_high_water", { ...rules, zombieMode: true });
    const bot = matchContextForMap("practice_woods", { ...rules, practiceMode: true });
    const fireteam = matchContextForMap("specops_cobalt", rules);
    insertLocalMatchData([row("new-zombies", 1, 11), { ...row("new-zombies", 2, 11), username: "Teammate", kills: 22 }], zombie);
    insertLocalMatchData([{ ...row("new-bot"), wavesSurvived: 0 }], bot);
    insertLocalMatchData([row("new-fireteam")], fireteam);
    // A duplicate upload from an older node must not erase already known context.
    insertLocalMatchData([row("new-zombies", 1, 11)]);

    const db = new Database(Config.database.sqlitePath);
    const contexts = db.query("SELECT * FROM local_match_context ORDER BY game_id").all();
    const preserved = db.query("SELECT * FROM local_match_data WHERE game_id = ?").get("legacy-zombies");
    db.query("UPDATE local_match_data SET created_at = ?").run("2026-11-09 13:00:00");
    const text = formatHistory(readHistory(db, 20));

    // The old LIMIT 2000 player-row query cut games in half.
    insertLocalMatchData(
        Array.from({ length: 2005 }, (_, i) => row("large-game", i + 1, 11)),
        matchContextForMap("specops_complex", { ...rules, zombieMode: true }),
    );
    db.query("UPDATE local_match_data SET created_at = ? WHERE game_id = ?").run("2026-11-10 13:00:00", "large-game");
    const readonly = new Database(Config.database.sqlitePath, { readonly: true });
    const recent = readHistory(readonly, 1) as { game_id: string; stored_map_name: string | null }[];
    readonly.close();
    console.log("RESULT:" + JSON.stringify({
        contexts, preserved, text,
        recentRows: recent.length,
        recentIds: [...new Set(recent.map((r) => r.game_id))],
        recentMap: recent[0]?.stored_map_name,
    }));
    db.close();
}
