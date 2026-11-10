// Kept separate so the VM wrapper can pass this source to Bun inside the container.
export function readHistory(db, limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new Error("Choose a match count between 1 and 500.");
    }
    const hasContext = !!db.query("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?")
        .get("table", "local_match_context");
    const contextColumns = hasContext
        ? "c.map_name AS stored_map_name, c.game_mode AS stored_game_mode"
        : "NULL AS stored_map_name, NULL AS stored_game_mode";
    const contextJoin = hasContext
        ? "LEFT JOIN local_match_context c ON c.game_id = p.game_id"
        : "";
    // Limit games before fetching players, so a large match is never cut in half.
    return db.query(`WITH recent AS (
        SELECT game_id, MAX(created_at) AS ended_at
        FROM local_match_data
        GROUP BY game_id
        ORDER BY ended_at DESC, game_id ASC
        LIMIT ?
    )
    SELECT p.*, recent.ended_at, ${contextColumns}
    FROM recent
    JOIN local_match_data p ON p.game_id = recent.game_id
    ${contextJoin}
    ORDER BY recent.ended_at DESC, recent.game_id ASC, p.kills DESC, p.player_id ASC`).all(limit);
}

function clean(value) {
    return String(value ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

export function mapLabel(mapName) {
    if (!mapName) return "not recorded";
    const names = {
        specops_complex: "After Hours",
        zombie_high_water: "High Water",
        zombie_dead_air: "Dead Air",
        specops_outdoor: "Main",
        practice_arena: "1v1 Arena",
        practice_specops: "Main",
        test_specops_bots: "Bot Arena",
    };
    if (Object.hasOwn(names, mapName)) return names[mapName];
    return clean(mapName).replace(/^(?:specops_|practice_)/, "")
        .split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function modeLabel(row) {
    const modes = {
        bot: "bot (Practice)",
        zombies: "zombies",
        fireteam: "fireteam",
        battle_royale: "battle royale",
    };
    if (Object.hasOwn(modes, row.stored_game_mode)) return modes[row.stored_game_mode];
    if (Number(row.map_id) === 11) return "zombies";
    // Practice and Fireteam both use map_id 10, including zero-wave Fireteam runs.
    if (Number(row.map_id) === 10) return "fireteam/bot (not recorded)";
    return "not recorded";
}

export function formatHistory(rows) {
    const games = new Map();
    for (const row of rows) {
        if (!games.has(row.game_id)) games.set(row.game_id, []);
        games.get(row.game_id).push(row);
    }
    if (!games.size) return "No finished matches saved yet.";
    const output = [];
    const teams = { 1: "solo", 2: "duo", 4: "squad" };
    for (const [id, players] of games) {
        const game = players[0];
        const stamp = String(game.ended_at ?? game.created_at).replace(" ", "T");
        const when = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(stamp) ? stamp : stamp + "Z");
        const ended = Number.isNaN(when.getTime())
            ? "not recorded"
            : when.toLocaleString("en-US", { timeZone: "America/New_York" });
        const duration = Math.round(Math.max(...players.map((p) => Number(p.time_alive) || 0)) / 60);
        const wave = Math.max(...players.map((p) => Number(p.waves_survived) || 0));
        const bot = game.stored_game_mode === "bot";
        const parts = [
            `game #${clean(id).slice(0, 4)}`,
            `ended ${ended}`,
            `mode ${modeLabel(game)}`,
            `map ${mapLabel(game.stored_map_name)}`,
            teams[game.team_mode] ?? clean(game.team_mode),
        ];
        if (!bot) parts.push(clean(game.difficulty) || "?", `wave ${wave}`);
        else parts.push("no waves");
        parts.push(`${duration} min`);
        output.push(parts.join(" | "));
        for (const player of players) {
            const stats = `${String(player.kills).padStart(3)} kills  ${player.died ? "died" : "survived"}`;
            output.push(`    ${clean(player.username).padEnd(20)} ${stats}`);
        }
    }
    return output.join("\n");
}

export async function runHistory() {
    const { Database } = await import("bun:sqlite");
    const limit = Number(process.env.N || 20);
    const db = new Database("/data/specops-local.db", { readonly: true });
    try {
        db.exec("PRAGMA busy_timeout = 5000");
        const rows = db.transaction(() => readHistory(db, limit))();
        console.log(formatHistory(rows));
    } finally {
        db.close();
    }
}
