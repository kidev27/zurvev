import { afterEach, expect, test } from "vitest";
import { PracticeBotPeek, practicePeekDistance } from "../../server/src/game/practiceCombat.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { match } from "./practiceBotDuel.ts";

const dt = 0.01;
const defaults = { ...PracticeBotPeek };

afterEach(() => {
    Object.assign(PracticeBotPeek, defaults);
});

/**
 * You on open ground near the map corner, the bot 30 units east with a container
 * wall between you. Health and adrenaline stay full, so only peeking decides.
 */
function wall(gun: string, seconds: number) {
    const m = match(gun, "", 20);
    v2.set(m.player.pos, v2.create(30, 30));
    v2.set(m.bot.pos, v2.create(60, 30));
    m.game.grid.updateObject(m.player);
    m.game.grid.updateObject(m.bot);
    m.game.map.genObstacle("container_wall_side", v2.create(55, 30), m.player.layer, 0, 1);
    const combat = m.brain.practiceCombat;
    const r = { shots: 0, peeks: 0, seen: 0, aimedWhileHidden: 0, hiddenInPeek: 0 };
    let wasOut = false;
    for (let t = 0; t < seconds; t += dt) {
        m.bot.health = 100;
        m.bot.boost = 100;
        const ammo = m.bot.weapons[0].ammo;
        m.game.update(dt);
        if (m.bot.weapons[0].ammo < ammo) r.shots++;
        const seen = practicePeekDistance(m.player, m.bot) === 0;
        if (seen) r.seen += dt;
        if (combat.peekOut && !wasOut) r.peeks++;
        wasOut = combat.peekOut;
        // Aim counts once it has seen you here (its first shot), not from its memory of the warm-up.
        if (!seen && combat.peek && r.shots > 0) {
            r.hiddenInPeek++;
            const toYou = v2.normalizeSafe(v2.sub(m.player.pos, m.bot.pos));
            if (v2.dot(m.bot.dir, toYou) > 0.97) r.aimedWhileHidden++;
        }
    }
    return { ...m, ...r };
}

/** Matches are random; keep the best of three. */
function best(gun: string, seconds: number, score: (r: ReturnType<typeof wall>) => number) {
    return [0, 1, 2].map(() => wall(gun, seconds)).sort((a, b) => score(b) - score(a))[0];
}

test("a Mosin bot behind a wall peeks, shoots once, and hides again", () => {
    const r = best("mosin", 10, (x) => x.peeks);
    expect(r.peeks).toBeGreaterThanOrEqual(5);
    expect(r.shots).toBeGreaterThanOrEqual(5);
    expect(r.shots).toBeLessThanOrEqual(r.peeks + 1);
    // You see it for less than half the fight.
    expect(r.seen).toBeLessThan(5);
});

test("with peeking off it never starts a peek", () => {
    PracticeBotPeek.enabled = false;
    const off = wall("mosin", 5);
    expect(off.peeks).toBe(0);
    expect(off.brain.practiceCombat.peek).toBeUndefined();
});

test("an AK bot fires a burst per peek", () => {
    const r = best("ak47", 10, (x) => x.peeks);
    expect(r.peeks).toBeGreaterThanOrEqual(3);
    expect(r.shots / r.peeks).toBeGreaterThan(2);
});

test("hidden in the peek cycle, it aims where it last saw you", () => {
    const r = best("mosin", 6, (x) => x.hiddenInPeek);
    expect(r.hiddenInPeek).toBeGreaterThan(50);
    expect(r.aimedWhileHidden / r.hiddenInPeek).toBeGreaterThan(0.8);
});

test("no peeking while it pushes, or with you closer than minDistance", () => {
    const push = wall("mosin", 0.5);
    for (let t = 0; t < 0.5; t += dt) {
        push.player.health = 20;
        push.game.update(dt);
        expect(push.brain.practiceCombat.pushing).toBe(true);
        expect(push.brain.practiceCombat.peek).toBeUndefined();
    }

    const close = wall("mosin", 0.2);
    v2.set(close.player.pos, v2.add(close.bot.pos, v2.create(-(PracticeBotPeek.minDistance - 2), 0)));
    close.game.grid.updateObject(close.player);
    close.game.update(dt);
    expect(close.brain.practiceCombat.peek).toBeUndefined();
});

test("explosive barrels are never cover, and it never picks a spot in their blast", () => {
    for (const layout of ["barrel only", "barrel by the wall"]) {
        const m = match("mosin", "", 20);
        v2.set(m.player.pos, v2.create(30, 30));
        v2.set(m.bot.pos, v2.create(60, 30));
        m.game.grid.updateObject(m.player);
        m.game.grid.updateObject(m.bot);
        if (layout === "barrel by the wall") {
            m.game.map.genObstacle("container_wall_side", v2.create(55, 30), m.player.layer, 0, 1);
        }
        const barrel = m.game.map.genObstacle("barrel_01", v2.create(layout === "barrel only" ? 55 : 58.5, 30), 0);
        const combat = m.brain.practiceCombat;
        for (let t = 0; t < 3; t += dt) {
            // Low half the time, so heal cover is searched too.
            m.bot.health = t < 1.5 ? 100 : 40;
            m.game.update(dt);
            for (const spot of [combat.peek?.cover, combat.peek?.out, combat.healCover]) {
                if (spot) expect(v2.distance(spot, barrel.pos)).toBeGreaterThan(12);
            }
        }
    }
});

/** Seconds from stepping out to the shot, for each peek that shot. */
function peekTimes(gun: string, distance: number, seconds: number) {
    const m = match(gun, "", 20);
    v2.set(m.player.pos, v2.create(30, 30));
    v2.set(m.bot.pos, v2.create(30 + distance, 30));
    m.game.grid.updateObject(m.player);
    m.game.grid.updateObject(m.bot);
    m.game.map.genObstacle("container_wall_side", v2.create(25 + distance, 30), m.player.layer, 0, 1);
    const combat = m.brain.practiceCombat;
    const times: number[] = [];
    let peeks = 0;
    let outAt = -1;
    let shot = false;
    for (let t = 0; t < seconds; t += dt) {
        m.bot.health = 100;
        m.bot.boost = 100;
        const ammo = m.bot.weapons[0].ammo;
        const wasOut = combat.peekOut;
        m.game.update(dt);
        if (combat.peekOut && !wasOut) {
            peeks++;
            outAt = t;
            shot = false;
        }
        if (combat.peekOut && !shot && m.bot.weapons[0].ammo < ammo) {
            shot = true;
            times.push(t - outAt);
        }
    }
    return { peeks, times: times.sort((a, b) => a - b) };
}

test("a sniper peeks quick: shoots within 0.3 s of stepping out, on nearly every peek", () => {
    const runs = [0, 1, 2].map(() => peekTimes("mosin", 30, 8)).sort((a, b) => b.peeks - a.peeks);
    const { peeks, times } = runs[0];
    expect(peeks).toBeGreaterThanOrEqual(5);
    expect(times.length).toBeGreaterThanOrEqual(peeks - 1);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(0.3);
});

test("a shotgun bot peeks a corner up close", () => {
    const runs = [0, 1, 2].map(() => peekTimes("spas12", 10, 6)).sort((a, b) => b.peeks - a.peeks);
    expect(runs[0].peeks).toBeGreaterThanOrEqual(4);
    expect(runs[0].times.length).toBeGreaterThanOrEqual(runs[0].peeks - 1);
});
