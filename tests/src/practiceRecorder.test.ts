import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, expect, test } from "vitest";
import { Config } from "../../server/src/config.ts";
import type { Game } from "../../server/src/game/game.ts";
import type { Obstacle } from "../../server/src/game/objects/obstacle.ts";
import { PracticeObservationFields, practiceObserve } from "../../server/src/game/practiceObservation.ts";
import { type PracticeRecordChunk, PracticeRecordTuning } from "../../server/src/game/practiceRecorder.ts";
import { appendPracticeRecord } from "../../server/src/utils/practiceRecordStore.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { InputMsg } from "../../shared/net/inputMsg.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { defaultPracticeBot, defaultPracticeSettings, sanitizePracticeSettings } from "../../shared/practice.ts";
import { collider } from "../../shared/utils/collider.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
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

/** All events of one kind across sample rows. */
const eventsOf = (all: any[], kind: string) =>
    all.flatMap((r) => (r.t === "s" ? r.a.ev : r.t === "ep" ? r.ev ?? [] : [])).filter((e: unknown[]) => e[1] === kind);

test("a barrel the player shoots: seen in the features, marked broken, and the bot it kills is put down to it", () => {
    const { game, player, practice, chunks } = startPractice(true);
    const bot = practice.enemiesOf(player)[0];
    // A barrel with open ground on one side: the bot stands next to it, the player 10 units away.
    const clear = (pos: Vec2, self?: Obstacle) =>
        !game.grid.intersectCollider(collider.createCircle(pos, 1.6)).some((o) =>
            o.__type === ObjectType.Obstacle && o !== self && (o as Obstacle).collidable
        );
    let barrel: Obstacle | undefined;
    let side = v2.create(1, 0);
    for (const o of game.map.obstacles) {
        if (o.type !== "barrel_01" || o.dead) continue;
        for (const d of [v2.create(1, 0), v2.create(-1, 0), v2.create(0, 1), v2.create(0, -1)]) {
            if ([3, 6.5, 10].every((k) => clear(v2.add(o.pos, v2.mul(d, k)), o))) {
                barrel = o;
                side = d;
                break;
            }
        }
        if (barrel) break;
    }
    expect(barrel).toBeDefined();
    const index = game.map.obstacles.indexOf(barrel!);
    const place = () => {
        bot.pos = v2.add(barrel!.pos, v2.mul(side, 3));
        player.pos = v2.add(barrel!.pos, v2.mul(side, 10));
        game.grid.updateObject(bot);
        game.grid.updateObject(player);
    };
    for (let i = 0; i < 30; i++) {
        place();
        game.update(0.01);
    }
    // The blast finishes it.
    bot.health = 1;
    barrel!.damage({
        amount: 9999,
        damageType: GameConfig.DamageType.Player,
        source: player,
        gameSourceType: "hk416",
        dir: v2.create(1, 0),
    });
    place();
    game.update(0.01);
    // The blast reaching the bot, as the barrel's explosion deals it (shrapnel and falloff vary).
    bot.damage({
        amount: 50,
        damageType: GameConfig.DamageType.Player,
        source: player,
        gameSourceType: "",
        mapSourceType: "barrel_01",
        isExplosion: true,
        dir: v2.create(1, 0),
    });
    for (let i = 0; i < 40; i++) game.update(0.01);
    game.stop();

    const all = rows(chunks);
    const hdr = all[0];
    expect(hdr.world.obstacles[index][0]).toBe("barrel_01");
    expect(hdr.world.obstacles[index].at(-2)).toBeGreaterThan(0);

    const field = (name: string) => hdr.fields.indexOf(name);
    const samples = all.filter((r) => r.t === "s");
    const broke = samples.findIndex((r) => r.w.changes.some((c: number[]) => c[0] === index && c[1] === 1));
    expect(broke).toBeGreaterThan(0);
    // The row before it broke: the barrel is the nearest explosive, with the bot in its blast.
    const before = samples[broke - 1];
    expect(before.o[field("explosive0_present")]).toBe(1);
    expect(before.o[field("explosive0_enemy_in_blast")]).toBe(1);

    const hit = eventsOf(all, "hit_out").find((e: unknown[]) => e[3] === "explosion");
    expect(hit?.[5]).toBe("barrel_01");
    expect(hit?.[6]).toBe("bot1");
    const died = eventsOf(all, "bot_died")[0];
    expect(died?.slice(3)).toEqual(["explosion", "", "barrel_01", "player"]);
});

test("a grenade at your feet: the throw, the grenade near you and your own grenade as the cause of death", () => {
    Config.practiceRecording = { ...saved, enabled: true, sampleRate: 1 };
    const game = createGame(TeamMode.Solo, "practice_arena", { endless: false });
    const chunks = capture(game);
    const player = game.playerBarn.addTestPlayer({ name: "Trainee" });
    game.update(0.1);
    const settings = defaultPracticeSettings();
    game.specOps!.practice!.applySettings(
        player,
        sanitizePracticeSettings({
            ...settings,
            kit: { ...settings.kit, counts: { ...settings.kit.counts, frag: 1 } },
            bots: [{ ...defaultPracticeBot(), shootsBack: false }],
        }),
    );
    for (let i = 0; i < 10; i++) game.update(0.1);
    player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Throwable);
    for (let i = 0; i < 30; i++) game.update(0.01);
    // Cook for a second, drop it at your feet and stand on it.
    for (let t = 0; t < 1.2; t += 0.01) {
        const msg = new InputMsg();
        msg.toMouseDir = v2.create(1, 0);
        msg.toMouseLen = 1;
        msg.shootStart = t < 0.02;
        msg.shootHold = t < 1;
        player.handleInput(msg);
        game.update(0.01);
    }
    player.health = 40;
    for (let i = 0; i < 400; i++) game.update(0.01);
    game.stop();

    const all = rows(chunks);
    expect(eventsOf(all, "cook").length).toBeGreaterThan(0);
    const thrown = eventsOf(all, "throw")[0];
    expect(thrown?.[2]).toBe("frag");
    const field = (name: string) => all[0].fields.indexOf(name);
    const withNade = all.filter((r) => r.t === "s" && r.o[field("proj0_present")] === 1);
    expect(withNade.length).toBeGreaterThan(0);
    expect(withNade[0].o[field("proj0_mine")]).toBe(1);
    expect(withNade[0].w.projectiles[0][1]).toBe("self");
    const hitIn = eventsOf(all, "hit_in").find((e: unknown[]) => e[3] === "explosion");
    expect(hitIn?.[6]).toBe("self");
    const death = all.find((r) => r.t === "ep" && r.kind === "death");
    expect(death?.cause[0]).toBe("explosion");
    expect(death?.cause[3]).toBe("self");
});

test("every row carries your exact guns and every bot's exact gun", () => {
    const { game, player, chunks } = startPractice(true);
    for (let i = 0; i < 10; i++) game.update(0.1);
    game.stop();
    const all = rows(chunks);
    const weapon = all[0].layouts.bot.indexOf("weapon");
    const last = all.filter((r) => r.t === "s").at(-1);
    expect(last.w.self.weapons[0][0]).toBe("hk416");
    expect(last.w.self.weapons[1][0]).toBe("m870");
    expect(last.w.bots).toHaveLength(1);
    expect(last.w.bots[0]).toHaveLength(all[0].layouts.bot.length);
    expect(last.w.bots[0][weapon]).toBe(all.find((r) => r.t === "set").settings.bots[0].gun);
    expect(player.weapons[0].type).toBe("hk416");
});
