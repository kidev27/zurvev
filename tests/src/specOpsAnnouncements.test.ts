import { expect, test } from "vitest";
import {
    formatSpecOpsCountdownAnnouncement,
    formatSpecOpsWaveAnnouncement,
} from "../../client/src/ui/specOpsAnnouncements.ts";
import type { MapDef } from "../../shared/defs/mapDefs.ts";
import { specOpsEventBossForWave } from "../../shared/defs/maps/specOpsShop.ts";

const fireteam: MapDef["gameMode"] = { maxPlayers: 4, killLeaderEnabled: false, specOpsMode: true };
const zombies: MapDef["gameMode"] = { ...fireteam, zombieMode: true };
const practice: MapDef["gameMode"] = { ...fireteam, practiceMode: true };
const translate = (key: string) => key;

test.each([2, 4, 6, 7, 10, 20, 29, 30, 31, 40])(
    "Zombies round %s keeps the round number without Fireteam unlocks or enemy warnings",
    (wave) => {
        expect(formatSpecOpsWaveAnnouncement(wave, zombies, translate)).toBe(`game-specops-wave ${wave}`);
    },
);

test.each([
    [2, "gear"],
    [4, "armor"],
    [6, "perk"],
] as const)("Fireteam wave %s retains its %s station announcement", (wave, station) => {
    expect(formatSpecOpsWaveAnnouncement(wave, fireteam, translate))
        .toBe(`game-specops-wave ${wave} — game-specops-unlock-${station}`);
});

test.each([
    [7, "miniboss-warn"],
    [10, "boss-warn"],
    [29, "glory-horde"],
    [30, "glory-truce"],
    [31, "veteran-forces"],
    [40, "cobalt-boss-warn"],
] as const)("Fireteam wave %s retains its %s warning", (wave, warning) => {
    expect(formatSpecOpsWaveAnnouncement(wave, fireteam, translate)).toContain(`game-specops-${warning}`);
});

test("Fireteam event-boss and explosive-vest warnings are preserved", () => {
    const message = formatSpecOpsWaveAnnouncement(10, fireteam, translate);
    expect(message).toContain(`game-specops-event-${specOpsEventBossForWave(10)}`);
    expect(message).toContain("game-specops-vest-warn");
});

test("an untranslated Fireteam event boss falls back to its identifier", () => {
    const eventBoss = specOpsEventBossForWave(10)!;
    const message = formatSpecOpsWaveAnnouncement(
        10,
        fireteam,
        (key) => key.startsWith("game-specops-event-") ? "" : key,
    );
    expect(message).toContain(` — ${eventBoss}`);
});

test.each([0, -1])("wave %s does not produce a round announcement", (wave) => {
    expect(formatSpecOpsWaveAnnouncement(wave, zombies, translate)).toBe("");
});

test("Zombies opening prep still explains its available early-start action", () => {
    expect(formatSpecOpsCountdownAnnouncement(30, zombies, false, false, translate))
        .toBe("game-specops-next-wave 30 game-seconds — game-zombie-start-early");
    expect(formatSpecOpsCountdownAnnouncement(0, zombies, false, false, translate))
        .toBe("game-specops-press-e");
});

test.each([true, false])("Zombies intermissions have no skip, bonus or vote hint (break flag %s)", (onBreak) => {
    expect(formatSpecOpsCountdownAnnouncement(8.9, zombies, true, onBreak, translate))
        .toBe("game-specops-next-wave 8 game-seconds");
    for (const time of [0, -1]) {
        expect(formatSpecOpsCountdownAnnouncement(time, zombies, true, onBreak, translate)).toBe("");
    }
});

test("Fireteam retains normal early-start, break-vote and expired-countdown hints", () => {
    expect(formatSpecOpsCountdownAnnouncement(8, fireteam, true, false, translate))
        .toBe("game-specops-next-wave 8 game-seconds — game-specops-start-early");
    expect(formatSpecOpsCountdownAnnouncement(120, fireteam, true, true, translate))
        .toBe("game-specops-next-wave 120 game-seconds — game-specops-break-vote");
    expect(formatSpecOpsCountdownAnnouncement(0, fireteam, true, false, translate))
        .toBe("game-specops-press-e");
});

test("Practice suppresses round and countdown announcements", () => {
    for (const wave of [0, 2, 4, 6, 10]) {
        expect(formatSpecOpsWaveAnnouncement(wave, practice, translate)).toBe("");
    }
    for (const time of [-1, 0, 8, 30]) {
        expect(formatSpecOpsCountdownAnnouncement(time, practice, true, false, translate)).toBe("");
    }
});
