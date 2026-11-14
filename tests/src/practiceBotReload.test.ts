import { expect, test } from "vitest";
import type { Player } from "../../server/src/game/objects/player.ts";
import { PracticeBotReload } from "../../server/src/game/practiceCombat.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { duel } from "./practiceBotDuel.ts";

const Action = GameConfig.Action;
const dt = 0.02;

function reloading(bot: Player): boolean {
    return bot.actionType === Action.Reload || bot.actionType === Action.ReloadAlt;
}

test("in a fight, an empty gun is swapped for the loaded one, not reloaded", () => {
    const { bot, run, shots } = duel("mosin", "mp5", 20);
    bot.weapons[0].ammo = 0;
    run(1.5, true);
    expect(bot.curWeapIdx).toBe(1);
    expect(reloading(bot)).toBe(false);
    expect(shots[1]).toBeGreaterThan(3);
    expect(bot.weapons[0].ammo).toBe(0);
});

test("the reported bug: SPAS-12 + Mosin reloads the Mosin once it cannot see you", () => {
    const { bot, run, shots } = duel("spas12", "mosin", 10);
    bot.weapons[1].ammo = 0;
    run(2, true);
    expect(bot.curWeapIdx).toBe(0);
    expect(bot.weapons[1].ammo).toBe(0);
    expect(shots[0]).toBeGreaterThanOrEqual(2);

    // Out of sight: not before safeDelay, then the empty Mosin first, then the SPAS shells.
    run(PracticeBotReload.safeDelay - 2 * dt, false);
    expect(reloading(bot)).toBe(false);
    run(4 * dt, false);
    expect(bot.curWeapIdx).toBe(1);
    expect(bot.actionType).toBe(Action.ReloadAlt);
    run(GunDefs.mosin.reloadTimeAlt! + 0.2, false);
    expect(bot.weapons[1].ammo).toBe(GunDefs.mosin.maxClip);
    const missing = GunDefs.spas12.maxClip - bot.weapons[0].ammo;
    expect(missing).toBeGreaterThan(0);
    run(GunDefs.spas12.switchDelay + missing * (GunDefs.spas12.reloadTime + 2 * dt) + 0.5, false);
    expect(bot.weapons[0].ammo).toBe(GunDefs.spas12.maxClip);
    expect(bot.weapons[1].ammo).toBe(GunDefs.mosin.maxClip);
    run(0.5, false);
    expect(reloading(bot)).toBe(false);
});

test("seen in the middle of a safe reload: drops it for the loaded gun, unless it is nearly done", () => {
    for (const [reloadedFor, finishes] of [[1, false], [GunDefs.mosin.reloadTimeAlt! - 0.5, true]] as const) {
        const { bot, run, shots } = duel("spas12", "mosin", 10);
        bot.weapons[1].ammo = 0;
        run(PracticeBotReload.safeDelay + GunDefs.mosin.switchDelay, false, () => bot.actionType === Action.ReloadAlt);
        expect(bot.actionType).toBe(Action.ReloadAlt);
        run(reloadedFor, false);
        expect(bot.weapons[1].ammo).toBe(0);
        run(1.5, true);
        // Rounds now in the Mosin plus any it has since fired.
        expect(bot.weapons[1].ammo + shots[1], `reloaded for ${reloadedFor}s`)
            .toBe(finishes ? GunDefs.mosin.maxClip : 0);
        expect(shots[0] + shots[1]).toBeGreaterThan(0);
    }
});

test("loaded gun cannot reach: reloads the empty sniper in the open instead", () => {
    // Shotgun fire range is 11 * 1.15 = 12.65 units.
    const far = duel("spas12", "mosin", 30);
    far.bot.weapons[1].ammo = 0;
    far.run(GunDefs.mosin.reloadTimeAlt! + GunDefs.mosin.switchDelay + 0.3, true, () => far.bot.weapons[1].ammo > 0);
    expect(far.bot.weapons[1].ammo).toBe(GunDefs.mosin.maxClip);
    expect(far.shots[0]).toBe(0);
    far.run(1.5, true);
    expect(far.shots[1]).toBeGreaterThan(0);

    // 15 units is past shotgun fire range (12.65) but within a step of it (19): no reload.
    for (const distance of [10, 15]) {
        const near = duel("spas12", "mosin", distance);
        near.bot.weapons[1].ammo = 0;
        near.run(1, true);
        // On the shotgun, or holstered for a moment between its shots: never on the empty rifle.
        expect([0, GameConfig.WeaponSlot.Melee], `${distance} units`).toContain(near.bot.curWeapIdx);
        expect(near.bot.weapons[1].ammo).toBe(0);
        expect(reloading(near.bot)).toBe(false);
    }
});

test("while you reload or heal, the bot reloads its empty gun; when you stop, it fights again", () => {
    const { bot, player, run, shots } = duel("spas12", "mosin", 10);
    bot.weapons[1].ammo = 0;
    player.doAction("bandage", Action.UseItem, 30);
    run(1.2, true);
    expect(bot.curWeapIdx).toBe(1);
    expect(bot.actionType).toBe(Action.ReloadAlt);
    expect(shots[0]).toBe(0);

    // You stop healing with most of its reload still to go: back to the loaded SPAS.
    player.cancelAction();
    run(1.2, true);
    expect(bot.curWeapIdx).toBe(0);
    expect(shots[0]).toBeGreaterThan(0);
    expect(bot.weapons[1].ammo).toBe(0);

    // A full heal gives it time to finish.
    player.doAction("healthkit", Action.UseItem, 30);
    run(GunDefs.mosin.reloadTimeAlt! + GunDefs.mosin.switchDelay + 0.3, true, () => bot.weapons[1].ammo > 0);
    expect(bot.weapons[1].ammo).toBe(GunDefs.mosin.maxClip);
});

test("nearly empty: reloads the empty gun only when that gun is the quicker one", () => {
    // Mosin on its last round, SPAS empty: a SPAS shell (0.55 s) beats a Mosin clip (3 s).
    const a = duel("mosin", "spas12", 10);
    a.bot.weapons[0].ammo = 1;
    a.bot.weapons[1].ammo = 0;
    a.run(GunDefs.spas12.reloadTime + 0.4, true, () => a.bot.weapons[1].ammo > 0);
    expect(a.bot.weapons[1].ammo).toBe(1);
    expect(a.bot.weapons[0].ammo).toBe(1);
    expect(a.shots[0]).toBe(0);

    // Mosin on its last round, MP220 empty: the MP220's 2.7 s reload is no quicker than the
    // Mosin's own 3 s by the 1 s margin, so the round is fired, not hoarded.
    const hoard = duel("mosin", "mp220", 10);
    hoard.bot.weapons[0].ammo = 1;
    hoard.bot.weapons[1].ammo = 0;
    hoard.run(0.3, true);
    expect(hoard.shots[0]).toBe(1);

    // SPAS on its last shell, Mosin empty: it shoots the shell rather than start a 3 s reload.
    const b = duel("spas12", "mosin", 10);
    b.bot.weapons[0].ammo = 1;
    b.bot.weapons[1].ammo = 0;
    b.run(0.3, true);
    expect(b.shots[0]).toBe(1);
    expect(b.bot.curWeapIdx).toBe(0);

    // Two shells left is not "nearly empty".
    const c = duel("mosin", "spas12", 10);
    c.bot.weapons[0].ammo = PracticeBotReload.lowRounds + 1;
    c.bot.weapons[1].ammo = 0;
    c.run(0.3, true);
    expect(c.shots[0]).toBe(1);
});

test("nothing loaded: reloads the quickest gun and shoots as soon as a round is in", () => {
    const { bot, run, shots } = duel("mosin", "spas12", 10);
    bot.weapons[0].ammo = 0;
    bot.weapons[1].ammo = 0;
    const took = run(3, true, () => shots[1] > 0);
    expect(shots[1]).toBe(1);
    expect(shots[0]).toBe(0);
    // Free switch (0.25 s) + one shell (0.55 s) + a tick or two.
    expect(took).toBeLessThan(GameConfig.player.baseSwitchDelay + GunDefs.spas12.reloadTime + 0.2);
    expect(bot.weapons[0].ammo).toBe(0);

    // It keeps doing that rather than stand through the Mosin's 3 s reload.
    run(3, true);
    expect(shots[1]).toBeGreaterThanOrEqual(3);
    expect(bot.weapons[0].ammo).toBe(0);
});

test("a bot with one gun tops it up when safe and still reloads when empty", () => {
    const { bot, run, shots } = duel("mosin", "", 30);
    run(2.5, true);
    expect(shots[0]).toBeGreaterThanOrEqual(2);
    const left = bot.weapons[0].ammo;
    expect(left).toBeLessThan(GunDefs.mosin.maxClip);
    // In sight with rounds left: no reload.
    expect(reloading(bot)).toBe(false);
    run((GunDefs.mosin.maxClip - left) * (GunDefs.mosin.reloadTime + 3 * dt) + 1.5, false);
    expect(bot.weapons[0].ammo).toBe(GunDefs.mosin.maxClip);

    bot.weapons[0].ammo = 0;
    const took = run(5, true, () => bot.weapons[0].ammo > 0);
    expect(bot.weapons[0].ammo).toBe(GunDefs.mosin.maxClip);
    expect(took).toBeLessThan(GunDefs.mosin.reloadTimeAlt! + 0.1);
});

test("each in-the-open reason can be switched off", () => {
    const saved = { ...PracticeBotReload };
    try {
        Object.assign(PracticeBotReload, { whenOutOfReach: false, whenTargetBusy: false, whenLow: false });
        const far = duel("spas12", "mosin", 30);
        far.bot.weapons[1].ammo = 0;
        far.player.doAction("bandage", Action.UseItem, 30);
        far.run(1.5, true);
        expect(far.bot.weapons[1].ammo).toBe(0);
        expect(reloading(far.bot)).toBe(false);

        const low = duel("mosin", "spas12", 10);
        low.bot.weapons[0].ammo = 1;
        low.bot.weapons[1].ammo = 0;
        low.run(0.3, true);
        expect(low.shots[0]).toBe(1);
    } finally {
        Object.assign(PracticeBotReload, saved);
    }
});
