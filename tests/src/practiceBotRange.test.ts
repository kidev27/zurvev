import { afterEach, expect, test } from "vitest";
import { PracticeBotRange } from "../../server/src/game/practiceCombat.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { defaultPracticeBot, defaultPracticeSettings, sanitizePracticeSettings } from "../../shared/practice.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";
import { duel } from "./practiceBotDuel.ts";

const Melee = GameConfig.WeaponSlot.Melee;
const dt = 0.01;
const defaults = { ...PracticeBotRange };

afterEach(() => {
    Object.assign(PracticeBotRange, defaults);
});

/** A whole Practice match with one bot, its brain running, `start` units from a player who cannot die. */
function match(gun: string, secondary: string, start: number) {
    const game = createGame(TeamMode.Solo, "practice_arena", { endless: false });
    const player = game.playerBarn.addTestPlayer({ name: "Trainee" });
    player.debug.godMode = true;
    game.update(0.1);
    game.specOps!.practice!.applySettings(
        player,
        sanitizePracticeSettings({
            ...defaultPracticeSettings(),
            bots: [{ ...defaultPracticeBot(), gun, secondary, quickSwitch: true }],
        }),
    );
    for (let i = 0; i < 20; i++) game.update(0.1);
    const bot = game.playerBarn.livingPlayers.find((p) => p.specOpsAi)!;
    const away = v2.normalizeSafe(v2.sub(bot.pos, player.pos), v2.create(1, 0));
    v2.set(bot.pos, v2.add(player.pos, v2.mul(away, start)));
    game.grid.updateObject(bot);
    const brain = game.specOps!.getBrainPublic(bot)! as unknown as {
        practiceMove?: { range: number; holdRange: number; closeTo: number };
    };
    const distance = () => v2.distance(bot.pos, player.pos);
    return { game, player, bot, brain, distance };
}

test("a rifle and shotgun bot shoots the rifle on the way in and never draws the shotgun early", () => {
    const { bot, run, shots } = duel("mosin", "spas12", 30, { dt });
    let drewShotgun = false;
    let holstered = false;
    run(4.5, true, () => {
        if (bot.curWeapIdx === 1) drewShotgun = true;
        if (bot.curWeapIdx === Melee) holstered = true;
        return false;
    });
    expect(drewShotgun).toBe(false);
    expect(holstered).toBe(true);
    expect(shots[0]).toBeGreaterThanOrEqual(4);
    expect(shots[1]).toBe(0);
});

test("a shotgun in hand out of range is swapped for the rifle that reaches", () => {
    const { bot, run, shots } = duel("mosin", "spas12", 30, { dt });
    bot.weaponManager.setCurWeapIndex(1);
    run(2, true);
    expect(shots[0]).toBeGreaterThanOrEqual(1);
    expect(shots[1]).toBe(0);
});

test("inside shotgun range both guns are used", () => {
    const { run, shots } = duel("mosin", "spas12", 9, { dt });
    run(6, true);
    expect(shots[0]).toBeGreaterThanOrEqual(2);
    expect(shots[1]).toBeGreaterThanOrEqual(2);
});

test("drawOnlyInRange off restores the swap to a gun that cannot reach", () => {
    PracticeBotRange.drawOnlyInRange = false;
    const { bot, run } = duel("mosin", "spas12", 30, { dt });
    let drewShotgun = false;
    run(3, true, () => {
        if (bot.curWeapIdx === 1) drewShotgun = true;
        return drewShotgun;
    });
    expect(drewShotgun).toBe(true);
});

test("only two guns of different reach change where the bot fights", () => {
    const mixed = match("mosin", "spas12", 30).brain.practiceMove;
    expect(mixed?.range).toBe(11);
    expect(mixed?.closeTo).toBe(PracticeBotRange.closeTo);
    expect(match("spas12", "mosin", 30).brain.practiceMove?.range).toBe(11);
    expect(match("mosin", "mp5", 30).brain.practiceMove?.range).toBe(26);
    expect(match("spas12", "", 30).brain.practiceMove).toBeUndefined();
    expect(match("mosin", "", 30).brain.practiceMove).toBeUndefined();
    expect(match("mosin", "sv98", 30).brain.practiceMove).toBeUndefined();
    expect(match("m870", "spas12", 30).brain.practiceMove).toBeUndefined();
});

test("fightAtShortestGun off leaves the distance to the gun in hand", () => {
    PracticeBotRange.fightAtShortestGun = false;
    expect(match("mosin", "spas12", 30).brain.practiceMove).toBeUndefined();
});

test("in a match, a rifle and shotgun bot snipes while it closes to shotgun range", () => {
    const { game, bot, distance } = match("mosin", "spas12", 45);
    let farShots = 0;
    let closest = Infinity;
    // Cover on the way can hold the bot up, so allow plenty of time and stop once both happened.
    for (let t = 0; t < 25 && !(farShots >= 1 && closest < 13); t += dt) {
        bot.health = 100;
        const before = bot.weapons[0].ammo;
        game.update(dt);
        closest = Math.min(closest, distance());
        if (bot.weapons[0].ammo < before && distance() > 20) farShots++;
    }
    // Before this, the bot drew the shotgun and walked in for about 5 s without a shot.
    expect(farShots).toBeGreaterThanOrEqual(1);
    expect(closest).toBeLessThan(13);
});
