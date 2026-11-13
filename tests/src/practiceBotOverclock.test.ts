import { afterEach, expect, test } from "vitest";
import { PracticeBotOverclock } from "../../server/src/game/practiceCombat.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { duel } from "./practiceBotDuel.ts";

const Action = GameConfig.Action;
const Melee = GameConfig.WeaponSlot.Melee;
const dt = 0.01;
const defaults = { ...PracticeBotOverclock };
/** The gun is ready this long after a shot at the latest: its draw time plus the holster. */
const slack = PracticeBotOverclock.holsterTime + 0.05;

afterEach(() => {
    Object.assign(PracticeBotOverclock, defaults);
});

/**
 * The bot shoots a target in the open for `seconds`. Clips are topped up once,
 * so the numbers show the shooting rhythm alone.
 */
function shoot(
    gun: string,
    secondary: string,
    distance: number,
    seconds: number,
    { quickSwitch = true, secondaryAmmo = 5000 } = {},
) {
    const { bot, run } = duel(gun, secondary, distance, { quickSwitch, dt });
    bot.weapons[0].ammo = 5000;
    if (secondary) bot.weapons[1].ammo = secondaryAmmo;
    const times: number[] = [];
    let ticks = 0;
    let slowed = 0;
    let holstered = 0;
    let reloaded = false;
    let ammo = bot.weapons[0].ammo + bot.weapons[1].ammo;
    run(seconds, true, () => {
        const now = bot.weapons[0].ammo + bot.weapons[1].ammo;
        if (now < ammo) times.push(ticks * dt);
        ammo = now;
        ticks++;
        if (bot.shotSlowdownTimer > 0) slowed++;
        if (bot.curWeapIdx === Melee) holstered++;
        if (bot.actionType === Action.Reload || bot.actionType === Action.ReloadAlt) reloaded = true;
        return false;
    });
    const gaps = times.slice(1).map((time, i) => time - times[i]).sort((a, b) => a - b);
    return {
        bot,
        shots: times.length,
        /** Median seconds between shots. */
        gap: gaps[Math.floor(gaps.length / 2)],
        /** Share of the time spent at half speed after a shot. */
        slowed: slowed / ticks,
        holstered: holstered / ticks,
        reloaded,
    };
}

test("a bolt rifle is holstered after each shot and fires at its draw time", () => {
    const { gap, slowed } = shoot("mosin", "", 30, 12);
    expect(GunDefs.mosin.fireDelay).toBeGreaterThan(GunDefs.mosin.switchDelay);
    expect(gap).toBeGreaterThanOrEqual(GunDefs.mosin.switchDelay);
    expect(gap).toBeLessThanOrEqual(GunDefs.mosin.switchDelay + slack);
    expect(slowed).toBeLessThan(0.05);
});

test.for(["spas12", "m870", "scout_elite", "model94", "blr", "winchester1887"])(
    "%s gains no fire rate from a swap, but the bot swaps to keep full speed",
    (gun: string) => {
        const def = GunDefs[gun];
        expect(def.switchDelay).toBeGreaterThanOrEqual(def.fireDelay);
        const { gap, slowed, holstered } = shoot(gun, "", def.bulletCount > 1 ? 10 : 20, 12);
        expect(slowed).toBeLessThan(0.05);
        expect(holstered).toBeGreaterThan(0);
        // The gun is ready again once it is drawn.
        expect(gap).toBeLessThanOrEqual(def.switchDelay + slack);
    },
);

test("maxCancelCost caps what a full-speed swap may cost in fire rate", () => {
    PracticeBotOverclock.maxCancelCost = 0.1;
    const def = GunDefs.model94;
    expect(def.switchDelay - def.fireDelay).toBeGreaterThan(PracticeBotOverclock.maxCancelCost);
    const { gap, holstered } = shoot("model94", "", 20, 8);
    expect(holstered).toBe(0);
    expect(gap).toBeCloseTo(def.fireDelay, 1);
    // A swap that costs 0.02 s still happens.
    expect(shoot("spas12", "", 10, 6).holstered).toBeGreaterThan(0);
});

test("cancelSlowdown off keeps the fire-rate swaps and drops the rest", () => {
    PracticeBotOverclock.cancelSlowdown = false;
    expect(shoot("spas12", "", 10, 6).holstered).toBe(0);
    expect(shoot("mosin", "", 30, 6).gap).toBeLessThanOrEqual(GunDefs.mosin.switchDelay + slack);
});

test("with Quick switch off the bot never swaps between shots", () => {
    const spas = shoot("spas12", "", 10, 6, { quickSwitch: false });
    expect(spas.holstered).toBe(0);
    expect(spas.slowed).toBeGreaterThan(0.9);
    const mosin = shoot("mosin", "", 30, 8, { quickSwitch: false });
    expect(mosin.gap).toBeCloseTo(GunDefs.mosin.fireDelay, 1);
});

test("with the other gun empty the bot overclocks the loaded one and does not reload", () => {
    const { bot, gap, slowed, reloaded, shots } = shoot("mosin", "spas12", 30, 8, { secondaryAmmo: 0 });
    expect(shots).toBeGreaterThanOrEqual(7);
    expect(gap).toBeLessThanOrEqual(GunDefs.mosin.switchDelay + slack);
    expect(slowed).toBeLessThan(0.05);
    expect(reloaded).toBe(false);
    expect(bot.weapons[1].ammo).toBe(0);
});

test("the same holds for a shotgun with an empty rifle behind it", () => {
    const { bot, gap, slowed, reloaded } = shoot("spas12", "mosin", 10, 8, { secondaryAmmo: 0 });
    expect(gap).toBeLessThanOrEqual(GunDefs.spas12.switchDelay + slack);
    expect(slowed).toBeLessThan(0.05);
    expect(reloaded).toBe(false);
    expect(bot.weapons[1].ammo).toBe(0);
});

test("two loaded guns: the bot swaps to the other gun and shoots it", () => {
    const { bot, run, shots } = duel("mosin", "sv98", 30, { dt });
    bot.weapons[0].ammo = 5000;
    bot.weapons[1].ammo = 5000;
    run(8, true);
    expect(shots[0]).toBeGreaterThanOrEqual(5);
    expect(shots[1]).toBeGreaterThanOrEqual(5);
});

test("a gun that runs dry is holstered once, then reloaded at full speed", () => {
    const { bot, run } = duel("spas12", "", 10, { dt });
    bot.weapons[0].ammo = 1;
    run(1, true, () => bot.weapons[0].ammo === 0);
    expect(bot.shotSlowdownTimer).toBeGreaterThan(0);
    run(PracticeBotOverclock.holsterTime + 4 * dt, true);
    expect(bot.shotSlowdownTimer).toBe(0);
    expect(bot.curWeapIdx).toBe(0);
    run(4 * dt, true);
    expect(bot.actionType === Action.Reload || bot.actionType === Action.ReloadAlt).toBe(true);
    // The next shell goes out as soon as the gun allows it.
    const waited = run(2, true, () => bot.weapons[0].ammo === 0 && bot.shotSlowdownTimer > 0);
    expect(waited).toBeLessThanOrEqual(GunDefs.spas12.switchDelay + slack);
});

test("the gun stays holstered for holsterTime, like two key presses", () => {
    const { bot, run } = duel("mosin", "", 30, { dt });
    bot.weapons[0].ammo = 5000;
    run(1, true, () => bot.curWeapIdx === Melee);
    expect(bot.curWeapIdx).toBe(Melee);
    const held = run(1, true, () => bot.curWeapIdx !== Melee);
    expect(held).toBeGreaterThanOrEqual(PracticeBotOverclock.holsterTime - dt);
    expect(held).toBeLessThanOrEqual(PracticeBotOverclock.holsterTime + 2 * dt);
});
