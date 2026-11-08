import type { MapDef } from "../../../shared/defs/mapDefs.ts";
import {
    specOpsEventBossForWave,
    SpecOpsStationUnlockWave,
} from "../../../shared/defs/maps/specOpsShop.ts";

type Translate = (key: string) => string;

export function formatSpecOpsWaveAnnouncement(
    wave: number,
    gameMode: MapDef["gameMode"],
    translate: Translate,
): string {
    if (gameMode.practiceMode || wave <= 0) return "";
    let msg = `${translate("game-specops-wave")} ${wave}`;
    // Zombies is zombies only: no boss, mini-boss, glory, veteran or vest warnings.
    if (!gameMode.zombieMode) {
        if (wave === 29) {
            msg += ` — ${translate("game-specops-glory-horde")}`;
        }
        if (wave === 31) {
            msg += ` — ${translate("game-specops-veteran-forces")}`;
        }
        if (wave % 10 === 0) {
            if (wave === 30) {
                msg += ` — ${translate("game-specops-glory-truce")}`;
            } else if (wave > 30) {
                msg += ` — ${translate("game-specops-cobalt-boss-warn")}`;
            } else {
                msg += ` — ${translate("game-specops-boss-warn")}`;
            }
            const eventBoss = specOpsEventBossForWave(wave);
            if (eventBoss) {
                const key = `game-specops-event-${eventBoss}`;
                const label = translate(key) || eventBoss;
                msg += ` — ${label}`;
            }
        } else if (wave % 7 === 0) {
            msg += ` — ${translate("game-specops-miniboss-warn")}`;
        }
        if (wave % 5 === 0) {
            msg += ` — ${translate("game-specops-vest-warn")}`;
        }
        if (wave === SpecOpsStationUnlockWave.gear) {
            msg += ` — ${translate("game-specops-unlock-gear")}`;
        }
        if (wave === SpecOpsStationUnlockWave.armor) {
            msg += ` — ${translate("game-specops-unlock-armor")}`;
        }
        if (wave === SpecOpsStationUnlockWave.perk) {
            msg += ` — ${translate("game-specops-unlock-perk")}`;
        }
    }
    return msg;
}

export function formatSpecOpsCountdownAnnouncement(
    timeLeft: number,
    gameMode: MapDef["gameMode"],
    waveStarted: boolean,
    onBreak: boolean,
    translate: Translate,
): string {
    if (gameMode.practiceMode) return "";
    const zombies = !!gameMode.zombieMode;
    if (timeLeft <= 0) {
        return zombies && waveStarted ? "" : translate("game-specops-press-e");
    }
    let message = translate("game-specops-next-wave");
    message += ` ${Math.max(Math.floor(timeLeft), 0)} ${translate("game-seconds")}`;
    // Zombies can skip opening prep, but subsequent rounds start automatically.
    if (zombies && waveStarted) return message;
    const hint = zombies
        ? "game-zombie-start-early"
        : onBreak
        ? "game-specops-break-vote"
        : "game-specops-start-early";
    return `${message} — ${translate(hint)}`;
}
