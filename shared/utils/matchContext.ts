import type { MapDef } from "../defs/mapDefs.ts";

export interface MatchContext {
    mapName: string;
    mode: "bot" | "zombies" | "fireteam" | "battle_royale";
}

/** Use map rules, not the shared map ID, to distinguish Practice from Fireteam. */
export function matchContextForMap(mapName: string, gameMode: MapDef["gameMode"]): MatchContext {
    const mode = gameMode.practiceMode || gameMode.specOpsBotArena
        ? "bot"
        : gameMode.zombieMode
        ? "zombies"
        : gameMode.specOpsMode
        ? "fireteam"
        : "battle_royale";
    return { mapName, mode };
}
