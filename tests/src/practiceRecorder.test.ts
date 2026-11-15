import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, expect, test } from "vitest";
import { Config } from "../../server/src/config.ts";
import type { Game } from "../../server/src/game/game.ts";
import { PracticeObservationFields, practiceObserve } from "../../server/src/game/practiceObservation.ts";
import { type PracticeRecordChunk, PracticeRecordTuning } from "../../server/src/game/practiceRecorder.ts";
import { appendPracticeRecord } from "../../server/src/utils/practiceRecordStore.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { InputMsg } from "../../shared/net/inputMsg.ts";
import { defaultPracticeBot, defaultPracticeSettings, sanitizePracticeSettings } from "../../shared/practice.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

const saved = { ...Config.practiceRecording! };

afterEach(() => {
    Config.practiceRecording = { ...saved };
});

/** Capture what the game would write. */
function capture(game: Game): PracticeRecordChunk[] {
    const chunks: PracticeRecordChunk[] = [];
    game.recordPractice = (chunk) => chunks.push(chunk);
    return chunks;
}

const rows = (chunks: PracticeRecordChunk[]) => chunks.flatMap((c) => c.lines).map((l) => JSON.parse(l));

function startPractice(record: boolean) {
    Config.practiceRecording = { ...saved, enabled: record, sampleRate: 1 };
    const game = createGame(TeamMode.Solo, "practice_arena", { endless: false });
    const chunks = capture(game);
    const player = game.playerBarn.addTestPlayer({ name: "Trainee" });
    game.update(0.1);
    const practice = game.specOps!.practice!;
    const settings = defaultPracticeSettings();
    practice.applySettings(
        player,
        sanitizePracticeSettings({
            ...settings,
            primary: "hk416",
            secondary: "m870",
            kit: { ...settings.kit, counts: { ...settings.kit.counts, bandage: 5 } },
            bots: [{ ...defaultPracticeBot(), shootsBack: false }],
        }),
    );
    for (let i = 0; i < 20; i++) game.update(0.1);
    return { game, player, practice, chunks };
}

test("recording is off by default and when the config turns it off", () => {
    expect(saved.enabled).toBe(false);
    const { game, practice, chunks } = startPractice(false);
    expect(practice.recorder).toBeUndefined();
    game.stop();
    expect(chunks).toHaveLength(0);
});

test("a sample rate of 0 records no game", () => {
    Config.practiceRecording = { ...saved, enabled: true, sampleRate: 0 };
    const game = createGame(TeamMode.Solo, "practice_arena", { endless: false });
    expect(game.specOps!.practice!.recorder).toBeUndefined();
});

test("other modes never record, even with recording on", () => {
    Config.practiceRecording = { ...saved, enabled: true, sampleRate: 1 };
    const game = createGame(TeamMode.Solo, "specops");
    const chunks = capture(game);
    game.playerBarn.addTestPlayer({ name: "Trainee" });
    for (let i = 0; i < 30; i++) game.update(0.1);
    game.stop();
    expect(game.specOps?.practice).toBeUndefined();
    expect(chunks).toHaveLength(0);
});

test("a recorded game: header, 10 rows a second, events, outcomes and a summary, all anonymous", () => {
    const { game, player, practice, chunks } = startPractice(true);
    expect(practice.recorder).toBeDefined();
    const bot = practice.enemiesOf(player)[0];
    expect(bot).toBeDefined();

    const input = (fire: boolean) => {
        const msg = new InputMsg();
        msg.moveRight = true;
        msg.toMouseDir = v2.normalizeSafe(v2.sub(bot.pos, player.pos));
        msg.toMouseLen = 20;
        msg.shootHold = fire;
        msg.shootStart = fire;
        player.handleInput(msg);
    };

    const dt = 0.01;
    for (let t = 0; t < 1; t += dt) {
        input(true);
        game.update(dt);
    }
    // Swap, reload the first gun, then bandage.
    input(false);
    player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Secondary);
    for (let t = 0; t < 1; t += dt) game.update(dt);
    player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary);
    player.weapons[GameConfig.WeaponSlot.Primary].ammo = 1;
    player.weaponManager.tryReload();
    for (let t = 0; t < 3; t += dt) game.update(dt);
    player.health = 50;
    player.useHealingItem("bandage");
    for (let t = 0; t < 1; t += dt) game.update(dt);
    game.stop();

    const all = rows(chunks);
    expect(chunks.at(-1)!.final).toBe(true);
    // Nothing that names the player.
    for (const line of chunks.flatMap((c) => c.lines)) expect(line).not.toContain("Trainee");

    const [hdr, ...rest] = all;
    expect(hdr.t).toBe("hdr");
    expect(hdr.fields).toEqual(PracticeObservationFields);
    expect(hdr.protocol).toBe(GameConfig.protocolVersion);
    expect(hdr.map).toBe("practice_arena");

    const set = rest.find((r) => r.t === "set");
    expect(set.settings.secondary).toBe("m870");

    const samples = rest.filter((r) => r.t === "s");
    // 2 s of setup plus 6 s of play, at 10 rows a second.
    expect(samples.length).toBeGreaterThanOrEqual(78);
    expect(samples.length).toBeLessThanOrEqual(82);
    for (const s of samples) {
        expect(s.p).toBe(1);
        expect(s.o).toHaveLength(PracticeObservationFields.length);
    }
    // The first second of play: moving right and firing at the bot.
    const firing = samples.slice(21, 29);
    expect(firing.every((s) => s.a.move[0] === 1 && s.a.fire === 1)).toBe(true);
    expect(firing.reduce((n, s) => n + s.a.shots, 0)).toBeGreaterThan(2);
    expect(samples.reduce((n, s) => n + s.r.dealt, 0)).toBeGreaterThan(0);

    const events = samples.flatMap((s) => s.a.ev.map((e: [number, string, unknown]) => e[1]));
    expect(events).toContain("swap");
    expect(events).toContain("reload");
    expect(events).toContain("item");
    const item = samples.flatMap((s) => s.a.ev).find((e: [number, string, unknown]) => e[1] === "item");
    expect(item[2]).toBe("bandage");
    expect(item[0]).toBeGreaterThanOrEqual(0);
    expect(item[0]).toBeLessThan(PracticeRecordTuning.interval * 1000 + 1);

    const end = all.at(-1);
    expect(end.t).toBe("end");
    expect(end.stats.shotsFired).toBeGreaterThan(2);
});

test("death and respawn are marked", () => {
    const { game, player, chunks } = startPractice(true);
    player.damage({ amount: 9999, damageType: GameConfig.DamageType.Player, dir: v2.create(1, 0) });
    for (let i = 0; i < 60; i++) game.update(0.1);
    game.stop();
    const kinds = rows(chunks).filter((r) => r.t === "ep").map((r) => r.kind);
    expect(kinds).toEqual(["death", "spawn"]);
});

test("an observation is cheap", () => {
    const { game, player, practice } = startPractice(true);
    const enemies = practice.enemiesOf(player);
    const start = performance.now();
    for (let i = 0; i < 2000; i++) practiceObserve(player, enemies);
    const ms = (performance.now() - start) / 2000;
    // At 10 rows a second this is far below a 10 ms tick.
    expect(ms).toBeLessThan(0.5);
    game.stop();
});

test("the store writes gzip chunks that read back as one stream, in order", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "practice-rec-"));
    try {
        Config.practiceRecording = { ...saved, enabled: true, dir, minFreeDiskMb: 0 };
        await appendPracticeRecord({ id: "abc", lines: ["{\"n\":1}", "{\"n\":2}"], final: false });
        await appendPracticeRecord({ id: "abc", lines: ["{\"n\":3}"], final: true });
        const [day] = readdirSync(dir);
        const text = gunzipSync(readFileSync(path.join(dir, day, "abc.jsonl.gz"))).toString("utf8");
        expect(text.trim().split("\n").map((l) => JSON.parse(l).n)).toEqual([1, 2, 3]);

        // Not enough free disk: nothing is written.
        Config.practiceRecording = { ...saved, enabled: true, dir, minFreeDiskMb: Number.MAX_SAFE_INTEGER };
        await appendPracticeRecord({ id: "full", lines: ["{}"], final: true });
        expect(readdirSync(path.join(dir, day))).toEqual(["abc.jsonl.gz"]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
