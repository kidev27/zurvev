import { describe, expect, test } from "vitest";
import en from "../../client/src/en.json";
import type { Game } from "../../server/src/game/game.ts";
import { lastCallOpenZones, lastCallWalkable } from "../../server/src/game/lastCallNav.ts";
import type { Obstacle } from "../../server/src/game/objects/obstacle.ts";
import { MapNavGraph } from "../../server/src/game/specOpsNav.ts";
import {
    LastCallBenchPos,
    LastCallBoxSpots,
    LastCallBuildingType,
    LastCallDoors,
    LastCallEntries,
    lastCallFromLocal,
    LastCallPerkMachines,
    LastCallPlayerSpawns,
    LastCallPowerSwitchPos,
    LastCallProps,
    lastCallToLocal,
    lastCallWalls,
    lastCallZoneAt,
    type LastCallZoneId,
    LastCallZones,
} from "../../shared/defs/maps/lastCallLayout.ts";
import { ZombiePackAPunchType } from "../../shared/defs/maps/zombiePackAPunch.ts";
import { MapObjectDefs } from "../../shared/defs/register.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { collider } from "../../shared/utils/collider.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

const translations = en as Record<string, string>;

function startLastCall() {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const block = game.map.buildings.find((b) => b.type === LastCallBuildingType)!;
    const world = (p: Vec2) => v2.add(block.pos, lastCallToLocal(p.x, p.y));
    const plan = (p: Vec2) => lastCallFromLocal(v2.sub(p, block.pos));
    return { game, operator, world, plan };
}

function doorCenter(id: string): Vec2 {
    const o = LastCallDoors.find((d) => d.id === id)!.opening;
    const mid = (o.a0 + o.a1) / 2;
    return o.axis === "h" ? v2.create(mid, o.at) : v2.create(o.at, mid);
}

/** Buy a shutter the way a player does: stand in it and use it. */
function buy(game: Game, world: (p: Vec2) => Vec2, id: string): Obstacle {
    const center = world(doorCenter(id));
    const gate = game.map.obstacles.find(
        (o) => o.type.startsWith("zombie_buy_gate_") && v2.distance(o.pos, center) < 0.5,
    )!;
    const operator = game.playerBarn.livingPlayers.find((p) => !p.specOpsAi)!;
    const back = v2.copy(operator.pos);
    v2.set(operator.pos, center);
    game.grid.updateObject(operator);
    operator.specOpsCash = 99999;
    gate.interact(operator);
    v2.set(operator.pos, back);
    game.grid.updateObject(operator);
    return gate;
}

/** Exercise the real purchase and power interactions before sampling navigation. */
function openBlock() {
    const context = startLastCall();
    const { game, operator, world } = context;
    for (const door of LastCallDoors.filter((d) => d.kind === "shutter")) buy(game, world, door.id);
    const powerSwitch = game.map.obstacles.find((o) => o.type === "zombie_power_switch")!;
    const back = v2.copy(operator.pos);
    v2.set(operator.pos, powerSwitch.pos);
    game.grid.updateObject(operator);
    powerSwitch.interact(operator);
    v2.set(operator.pos, back);
    game.grid.updateObject(operator);
    expect(game.specOps!.zombiePowerOn).toBe(true);
    return context;
}

/** Include the final approach: a non-null path can still end across a wall. */
function expectRoute(game: Game, from: Vec2, goal: Vec2, label: string) {
    const path = game.specOps!.ensureNavGraph().path(game, from, goal, 0, 0);
    expect(path, label).not.toBeNull();
    const legs = [from, ...path!, goal];
    for (let i = 1; i < legs.length; i++) {
        expect(lastCallWalkable(game, legs[i - 1], legs[i], 0.9), `${label} leg ${i}`).toBe(true);
    }
}

function inZone(zone: LastCallZoneId, p: Vec2, inset: number): boolean {
    const r = LastCallZones.find((z) => z.id === zone)!.rect;
    return p.x >= r.x0 + inset && p.x <= r.x1 - inset && p.y >= r.y0 + inset && p.y <= r.y1 - inset;
}

describe("After Hours layout", () => {
    test("every doorway sits on the wall between its two zones", () => {
        for (const d of LastCallDoors) {
            if (d.kind === "room") continue;
            const o = d.opening;
            const mid = (o.a0 + o.a1) / 2;
            const [a, b] = o.axis === "h"
                ? [v2.create(mid, o.at - 1), v2.create(mid, o.at + 1)]
                : [v2.create(o.at - 1, mid), v2.create(o.at + 1, mid)];
            expect([lastCallZoneAt(a), lastCallZoneAt(b)].sort(), d.id).toEqual([...d.zones].sort());
        }
    });

    test("no wall runs through a doorway", () => {
        for (const d of LastCallDoors) {
            const o = d.opening;
            for (const w of lastCallWalls()) {
                if (w.axis !== o.axis || w.at !== o.at) continue;
                expect(Math.min(w.a1, o.a1) - Math.max(w.a0, o.a0), d.id).toBeLessThanOrEqual(0.01);
            }
        }
    });

    test("spawns, stations, box spots and props stay inside their rooms", () => {
        for (const machine of LastCallPerkMachines) {
            expect(inZone(machine.zone, machine.pos, 2), `perk machine ${machine.type}`).toBe(true);
        }
        for (const b of LastCallBoxSpots) expect(inZone(b.zone, b.pos, 2), "box spot").toBe(true);
        for (const e of LastCallEntries) expect(inZone(e.zone, e.pos, 1.5), "entry").toBe(true);
        for (const p of LastCallPlayerSpawns) expect(lastCallZoneAt(p, 1.5)).toBe("lobby");
        for (const p of LastCallProps) {
            expect(MapObjectDefs.typeExists(p.type), p.type).toBe(true);
            expect(lastCallZoneAt(p.pos), p.type).toBeDefined();
        }
    });

    test("every shutter price has a prompt", () => {
        for (const d of LastCallDoors.filter((door) => door.kind === "shutter")) {
            expect(translations[`game-zombie_buy_gate_${d.cost}`]).toContain(String(d.cost));
        }
    });

    test("the generated block has solid walls where the art draws them", () => {
        const { game, world } = startLastCall();
        for (const w of lastCallWalls()) {
            const mid = (w.a0 + w.a1) / 2;
            const p = world(w.axis === "h" ? v2.create(mid, w.at) : v2.create(w.at, mid));
            const hits = game.grid.intersectCollider(collider.createCircle(p, 0.1));
            const solid = hits.some((o) => o.__type === ObjectType.Obstacle && o.type.startsWith("lastcall_wall_"));
            expect(solid, `wall ${w.axis}${w.at}`).toBe(true);
        }
        // nothing collidable overlaps a zombie entry point
        for (const e of LastCallEntries) {
            const circle = collider.createCircle(world(e.pos), 1);
            const blocked = game.grid.intersectCollider(circle).some((o) =>
                o.__type === ObjectType.Obstacle && o.collidable && !o.dead
                && collider.intersectCircle(o.collider, circle.pos, circle.rad)
            );
            expect(blocked, `entry ${e.pos.x},${e.pos.y}`).toBe(false);
        }
    });
});

describe("After Hours rooms", () => {
    test("only rooms behind bought shutters count as open", () => {
        const { game, world } = startLastCall();
        expect([...lastCallOpenZones(game)]).toEqual(["lobby"]);
        buy(game, world, "lobby_storage");
        // storage opens the free doorway into the alley as well
        expect([...lastCallOpenZones(game)].sort()).toEqual(["alley", "lobby", "storage"]);
    });

    test("zombies never appear in rooms the squad hasn't opened", () => {
        const { game, operator, plan } = startLastCall();
        for (let wave = 0; wave < 3; wave++) {
            game.specOps!.startNextWave();
            game.specOps!.drainWaveSpawnQueuePublic();
            for (let i = 0; i < 30; i++) {
                operator.health = operator.maxHealth;
                game.update(0.1);
            }
            for (const z of game.specOps!.livingEnemies()) {
                expect(lastCallZoneAt(plan(z.pos))).toBe("lobby");
            }
            for (const z of game.specOps!.livingEnemies()) {
                z.kill({ damageType: 1, dir: v2.create(1, 0) } as never);
            }
        }
    });

    test("all open doorways fit a zombie on both approaches", () => {
        const { game, world } = openBlock();
        for (const door of LastCallDoors) {
            const center = doorCenter(door.id);
            const [a, b] = door.opening.axis === "h"
                ? [v2.create(center.x, center.y - 2.5), v2.create(center.x, center.y + 2.5)]
                : [v2.create(center.x - 2.5, center.y), v2.create(center.x + 2.5, center.y)];
            expect(lastCallWalkable(game, world(a), world(b), 1.1), door.id).toBe(true);
        }
    });

    test("AI can path from the lobby to every room once everything is open", () => {
        const { game, world } = openBlock();
        const from = world(LastCallPlayerSpawns[0]);
        for (const zone of LastCallZones) {
            const r = zone.rect;
            const goal = [0.5, 0.3, 0.7]
                .map((t) => world(v2.create(r.x0 + (r.x1 - r.x0) * t, r.y0 + (r.y1 - r.y0) * t)))
                .find((p) => lastCallWalkable(game, p, p, 1.1));
            expect(goal, `${zone.id} has a clear fighting area`).toBeDefined();
            expectRoute(game, from, goal!, zone.id);
        }
    });

    test("every window and manhole has a complete route back to the squad", () => {
        const { game, world } = openBlock();
        const goal = world(LastCallPlayerSpawns[0]);
        for (const entry of LastCallEntries) {
            expectRoute(game, world(entry.pos), goal, `${entry.zone} entry ${entry.pos.x},${entry.pos.y}`);
        }
    });

    test("stations have a clear reachable interaction approach", () => {
        const { game, world } = openBlock();
        const from = world(LastCallPlayerSpawns[0]);
        const stations = game.map.obstacles.filter((o) =>
            o.type.startsWith("zombie_perk_machine_")
            || o.type === "zombie_mystery_box"
            || o.type === "zombie_power_switch"
            || o.type === ZombiePackAPunchType
        );
        expect(stations).toHaveLength(8);
        for (const station of stations) {
            const box = collider.toAabb(station.collider);
            const approach = [
                v2.create(station.pos.x, box.min.y - 1.2),
                v2.create(station.pos.x, box.max.y + 1.2),
                v2.create(box.min.x - 1.2, station.pos.y),
                v2.create(box.max.x + 1.2, station.pos.y),
            ].find((p) => {
                if (!lastCallWalkable(game, p, p, 1.1)) return false;
                // Each alternative is an independent route query: coarse cache cells
                // intentionally group nearby goals, including opposite sides of a machine.
                const path = MapNavGraph.build(game).path(game, from, p, 0, 0);
                if (!path) return false;
                const legs = [from, ...path, p];
                return legs.slice(1).every((end, i) => lastCallWalkable(game, legs[i], end, 0.9));
            });
            expect(approach, `${station.type} has a complete path to a usable side`).toBeDefined();
        }
        // All relocation spots need an accessible front, including currently empty spots.
        for (const spot of LastCallBoxSpots) {
            const approach = world(v2.create(spot.pos.x, spot.pos.y + 3.2));
            expect(lastCallWalkable(game, approach, approach, 1.1), `${spot.zone} box approach`).toBe(true);
            expectRoute(game, from, approach, `${spot.zone} box approach`);
        }
    });

    test("low cover stays clear of doors, windows, stations, box spots and spawns", () => {
        const cover = new Set([
            "lastcall_sandbags",
            "lastcall_jersey_barrier",
            "lastcall_bell_cart",
            "lastcall_vending",
        ]);
        const props = LastCallProps.filter((p) => cover.has(p.type));
        expect(props.length).toBeGreaterThanOrEqual(6);
        /** Distance from a point to the prop's footprint (plan units, y down). */
        const gap = (prop: (typeof props)[number], q: Vec2) => {
            const def = MapObjectDefs.typeToDef(prop.type, "obstacle");
            const e = collider.toAabb(def.collision).max;
            const [ex, ey] = (prop.ori ?? 0) % 2 ? [e.y, e.x] : [e.x, e.y];
            const dx = Math.max(Math.abs(q.x - prop.pos.x) - ex, 0);
            const dy = Math.max(Math.abs(q.y - prop.pos.y) - ey, 0);
            return Math.hypot(dx, dy);
        };
        const keepClear: Array<[string, Vec2, number]> = [
            ...LastCallDoors.map((d) => [`door ${d.id}`, doorCenter(d.id), 4] as [string, Vec2, number]),
            ...LastCallEntries.map((e) => [`entry ${e.zone}`, e.pos, 3] as [string, Vec2, number]),
            ...LastCallPerkMachines.map((m) => [m.type, m.pos, 4] as [string, Vec2, number]),
            ...LastCallBoxSpots.map((b) => [`box ${b.zone}`, b.pos, 6.5] as [string, Vec2, number]),
            ...LastCallPlayerSpawns.map((p) => ["spawn", p, 4] as [string, Vec2, number]),
            ["power switch", LastCallPowerSwitchPos, 4],
            ["upgrade bench", LastCallBenchPos, 5],
        ];
        for (const prop of props) {
            const def = MapObjectDefs.typeToDef(prop.type, "obstacle");
            // Real cover: solid and tall enough to stop bullets.
            expect(def.collidable, prop.type).toBe(true);
            expect(def.height, prop.type).toBeGreaterThanOrEqual(GameConfig.bullet.height);
            for (const [label, q, min] of keepClear) {
                const where = `${prop.type} at ${prop.pos.x},${prop.pos.y} vs ${label}`;
                expect(gap(prop, q), where).toBeGreaterThanOrEqual(min);
            }
        }
    });
});
