import { expect, test } from "vitest";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { PracticeSettingsMsg } from "../../shared/net/practiceMsg.ts";
import { BitStream } from "../../shared/net/net.ts";
import {
    defaultPracticeBot,
    defaultPracticeSettings,
    practiceFireDelay,
    type PracticeQsProfile,
    PracticeQsProfiles,
    practiceSwitchDelay,
    sanitizePracticeSettings,
} from "../../shared/practice.ts";
import { createGame } from "./gameTestHelpers.ts";
import { duel } from "./practiceBotDuel.ts";

const dt = 0.01;

/** A Practice game where you hold a Mosin and an SV-98, under `qsProfile`. */
function practiceWith(qsProfile: PracticeQsProfile) {
    const game = createGame(TeamMode.Solo, "practice_arena", { endless: false });
    const player = game.playerBarn.addTestPlayer({ name: "Trainee" });
    game.update(0.1);
    game.specOps!.practice!.applySettings(
        player,
        sanitizePracticeSettings({
            ...defaultPracticeSettings(),
            primary: "mosin",
            secondary: "sv98",
            bots: [{ ...defaultPracticeBot(), shootsBack: false }],
            qsProfile,
        }),
    );
    for (let i = 0; i < 20; i++) game.update(0.1);
    player.weaponManager.setCurWeapIndex(0);
    for (let t = 0; t < 2; t += dt) game.update(dt);
    return { game, player };
}

/** Fire one shot with the gun in hand; return its cooldown right after. */
function shoot(game: ReturnType<typeof practiceWith>["game"], player: ReturnType<typeof practiceWith>["player"]) {
    const ammo = player.weapons[player.curWeapIdx].ammo;
    player.shootStart = player.shootHold = true;
    for (let t = 0; t < 1 && player.weapons[player.curWeapIdx].ammo === ammo; t += dt) game.update(dt);
    player.shootStart = player.shootHold = false;
    return player.weapons[player.curWeapIdx].cooldown;
}

test("three profiles; Survev is the default and anything unknown falls back to it", () => {
    expect([...PracticeQsProfiles]).toEqual(["survev", "resurviv", "nars"]);
    expect(defaultPracticeSettings().qsProfile).toBe("survev");
    expect(sanitizePracticeSettings({ qsProfile: "nope" } as never).qsProfile).toBe("survev");
    expect(sanitizePracticeSettings({ qsProfile: "nars" }).qsProfile).toBe("nars");
});

test("the profile survives the trip over the network", () => {
    for (const qsProfile of PracticeQsProfiles) {
        const msg = new PracticeSettingsMsg();
        msg.settings = sanitizePracticeSettings({ ...defaultPracticeSettings(), qsProfile });
        const stream = new BitStream(new ArrayBuffer(1024));
        msg.serialize(stream);
        stream.index = 0;
        const back = new PracticeSettingsMsg();
        back.deserialize(stream);
        expect(back.settings.qsProfile).toBe(qsProfile);
    }
});

test("timing tables: Nars changes 9 guns, Resurviv draws in a third and changes the SPAS-16", () => {
    expect(practiceFireDelay("mosin", "survev")).toBe(GunDefs.mosin.fireDelay);
    expect(practiceFireDelay("mosin", "nars")).toBe(0.9);
    expect(practiceFireDelay("sv98", "nars")).toBe(0.9);
    expect(practiceFireDelay("spas16", "resurviv")).toBe(0.29);
    expect(practiceFireDelay("ak47", "nars")).toBe(GunDefs.ak47.fireDelay);
    expect(practiceSwitchDelay("mosin", "survev")).toBe(1);
    expect(practiceSwitchDelay("mosin", "resurviv")).toBeCloseTo(0.33, 5);
    expect(practiceSwitchDelay("mosin", "nars")).toBe(1);
});

test("in a Practice game, the Mosin's time between shots follows the profile", () => {
    for (const [profile, expected] of [["survev", 1.75], ["resurviv", 1.75], ["nars", 0.9]] as const) {
        const { game, player } = practiceWith(profile);
        expect(shoot(game, player)).toBeCloseTo(expected, 1);
    }
});

test("Resurviv: a switch that is not free draws the gun in a third of its time", () => {
    for (const [profile, expected] of [["survev", 1], ["resurviv", 0.33]] as const) {
        const { game, player } = practiceWith(profile);
        // The first switch is free (0.25 s); the next one within a second is not.
        player.weaponManager.setCurWeapIndex(1);
        expect(player.weapons[1].cooldown).toBeCloseTo(GameConfig.player.baseSwitchDelay, 5);
        game.update(dt);
        player.weaponManager.setCurWeapIndex(0);
        expect(player.weapons[0].cooldown).toBeCloseTo(expected, 5);
    }
});

test("only Practice games change: other modes keep survev timing", () => {
    const game = createGame(TeamMode.Solo, "main", { endless: false });
    expect(game.gunTiming).toBeUndefined();
    const { game: practice } = practiceWith("survev");
    expect(practice.gunTiming).toBeUndefined();
    expect(practiceWith("nars").game.gunTiming?.fireDelays.mosin).toBe(0.9);
});

test("bots play by the same profile: a Nars Mosin bot fires every 0.9 s or so", () => {
    for (const [qsProfile, low, high] of [["survev", 0.95, 1.1], ["nars", 0.85, 1.05], ["resurviv", 0.3, 0.5]] as const) {
        const { bot, run } = duel("mosin", "", 30, { dt, qsProfile });
        bot.weapons[0].ammo = 5000;
        const times: number[] = [];
        let t = 0;
        let ammo = bot.weapons[0].ammo;
        run(6, true, () => {
            t += dt;
            if (bot.weapons[0].ammo < ammo) times.push(t);
            ammo = bot.weapons[0].ammo;
            return false;
        });
        const gaps = times.slice(1).map((x, i) => x - times[i]).sort((a, b) => a - b);
        const median = gaps[Math.floor(gaps.length / 2)];
        expect(median).toBeGreaterThanOrEqual(low);
        expect(median).toBeLessThanOrEqual(high);
    }
});

test("changing the profile mid-game applies at once, to you and the bots, and keeps the bots", () => {
    const { game, player } = practiceWith("survev");
    const practice = game.specOps!.practice!;
    const botsBefore = game.playerBarn.livingPlayers.filter((p) => p.specOpsAi);
    expect(botsBefore.length).toBeGreaterThan(0);
    for (const qsProfile of ["resurviv", "nars", "survev"] as const) {
        for (let t = 0; t < 0.5; t += dt) game.update(dt);
        const applied = practice.applySettings(player, { ...practice.settings, qsProfile });
        expect(applied).toBe(true);
        expect(game.gunTiming?.switchDelayMult ?? 1).toBe(qsProfile === "resurviv" ? 0.33 : 1);
        expect(game.gunTiming?.fireDelays.mosin).toBe(qsProfile === "nars" ? 0.9 : undefined);
    }
    // Only the timing changed: the same bots are still in the game.
    const botsAfter = game.playerBarn.livingPlayers.filter((p) => p.specOpsAi);
    expect(botsAfter).toEqual(botsBefore);
});
