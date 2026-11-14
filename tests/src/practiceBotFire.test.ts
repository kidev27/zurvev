import { expect, test } from "vitest";
import { practiceFireReach, practiceOnScreen } from "../../server/src/game/practiceCombat.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { match } from "./practiceBotDuel.ts";

/** Seconds until the bot's first shot, with you standing still and never shooting. -1: none. */
function firstShot(gun: string, offset: { x: number; y: number }, seconds = 3) {
    const { game, bot, player } = match(gun, "", 20);
    v2.set(bot.pos, v2.add(player.pos, v2.create(offset.x, offset.y)));
    game.grid.updateObject(bot);
    for (let t = 0; t < seconds; t += 0.01) {
        const ammo = bot.weapons[0].ammo;
        bot.health = 100;
        game.update(0.01);
        if (bot.weapons[0].ammo < ammo) return t;
    }
    return -1;
}

test("a bot shoots a gun as far as its bullets fly; a shotgun only up close", () => {
    expect(practiceFireReach("ak47")).toBe(200);
    expect(practiceFireReach("mosin")).toBe(500);
    expect(practiceFireReach("spas12")).toBeCloseTo(12.65, 5);
    expect(practiceFireReach("")).toBe(0);
});

test("a bot sees what your scope shows: a screen 16/9 wider than tall", () => {
    const { player } = match("ak47", "", 20);
    const radius = GameConfig.scopeZoomRadius.desktop[player.scope];
    const at = (x: number, y: number) => practiceOnScreen(player.pos, v2.add(player.pos, v2.create(x, y)), player);
    expect(at(radius * 16 / 9 - 1, 0)).toBe(true);
    expect(at(radius * 16 / 9 + 1, 0)).toBe(false);
    expect(at(0, radius - 1)).toBe(true);
    expect(at(0, radius + 1)).toBe(false);
});

test("an AK bot shoots you at 45 units on your screen without waiting for you to shoot it", () => {
    // Random match: cover can sit between you. The best of three runs must shoot within a second.
    const times = [0, 1, 2].map(() => firstShot("ak47", { x: 45, y: 0 }));
    expect(Math.min(...times.filter((t) => t >= 0))).toBeLessThan(1);
});

test("it holds fire when you are off its screen, even in bullet range", () => {
    const { player } = match("ak47", "", 20);
    const up = GameConfig.scopeZoomRadius.desktop[player.scope] + 15;
    // Straight above you, past the top of the screen: it walks closer before it shoots.
    for (const t of [0, 1, 2].map(() => firstShot("ak47", { x: 0, y: up }, 0.5))) expect(t).toBe(-1);
});
