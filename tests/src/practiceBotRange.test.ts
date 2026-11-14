import { afterEach, expect, test } from "vitest";
import { PracticeBotRange } from "../../server/src/game/practiceCombat.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { duel, match } from "./practiceBotDuel.ts";

const Melee = GameConfig.WeaponSlot.Melee;
const dt = 0.01;
const defaults = { ...PracticeBotRange };

afterEach(() => {
    Object.assign(PracticeBotRange, defaults);
});

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
    // A match is random: cover can hide the target for the whole walk in. One good match in three is enough;
    // the tests above pin the rules themselves.
    const shotgunRange = 12.65;
    let good = false;
    for (let attempt = 0; attempt < 3 && !good; attempt++) {
        const { game, bot, distance } = match("mosin", "spas12", 45);
        let rifleShotsOnTheWay = 0;
        let closest = Infinity;
        for (let t = 0; t < 25 && !good; t += dt) {
            bot.health = 100;
            const before = bot.weapons[0].ammo;
            game.update(dt);
            closest = Math.min(closest, distance());
            if (bot.weapons[0].ammo < before && distance() > shotgunRange + 1) rifleShotsOnTheWay++;
            good = rifleShotsOnTheWay >= 1 && closest < shotgunRange;
        }
    }
    // Before this, the bot drew the shotgun far away and walked in for about 5 s without a shot.
    expect(good).toBe(true);
});
