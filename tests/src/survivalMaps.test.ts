import { describe, expect, test } from "vitest";
import type { Game } from "../../server/src/game/game.ts";
import {
    lastCallNavPoints,
    lastCallOpenZones,
    lastCallPosReachable,
    lastCallWalkable,
} from "../../server/src/game/lastCallNav.ts";
import type { Player } from "../../server/src/game/objects/player.ts";
import { MapNavGraph } from "../../server/src/game/specOpsNav.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { ZombieMapPool } from "../../shared/defs/maps/specOpsDefs.ts";
import { SurvivalLayouts } from "../../shared/defs/maps/survival/index.ts";
import {
    buildingType,
    fromLocal,
    structureType,
    type SurvivalDoor,
    type SurvivalLayout,
    toLocal,
    zoneAt,
} from "../../shared/defs/maps/survival/layout.ts";
import { ZombiePackAPunchType } from "../../shared/defs/maps/zombiePackAPunch.ts";
import { MapObjectDefs } from "../../shared/defs/register.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { collider } from "../../shared/utils/collider.ts";
import { util } from "../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

function start(layout: SurvivalLayout) {
    const game = createGame(TeamMode.Solo, layout.mapName);
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const block = game.map.buildings.find((b) => b.type === buildingType(layout))!;
    const world = (p: Vec2) => v2.add(block.pos, toLocal(layout, p));
    const plan = (p: Vec2) => fromLocal(layout, v2.sub(p, block.pos));
    return { game, operator, block, world, plan };
}

function center(door: SurvivalDoor) {
    const o = door.opening;
    const mid = (o.a0 + o.a1) / 2;
    return o.axis === "h" ? v2.create(mid, o.at) : v2.create(o.at, mid);
}

function place(player: Player, pos: Vec2, layer: number) {
    v2.set(player.pos, pos);
    player.layer = layer;
    player.game.grid.updateObject(player);
}

function open(layout: SurvivalLayout) {
    const context = start(layout);
    const { game, operator, world } = context;
    operator.specOpsCash = 100000;
    for (const door of layout.doors.filter((d) => d.kind === "shutter")) {
        const layer = layout.zones.find((z) => z.id === door.zones[0])!.layer;
        const pos = world(center(door));
        const gate = game.map.obstacles.find((o) =>
            o.type.startsWith("zombie_buy_gate_") && o.layer === layer && v2.distance(o.pos, pos) < 0.5
        )!;
        expect(gate, door.id).toBeDefined();
        place(operator, gate.pos, layer);
        gate.interact(operator);
        expect(gate.dead || gate.destroyed, door.id).toBe(true);
    }
    const power = game.map.obstacles.find((o) => o.type === "zombie_power_switch")!;
    place(operator, power.pos, power.layer);
    power.interact(operator);
    expect(game.specOps!.zombiePowerOn).toBe(true);
    place(operator, world(layout.spawns[0]), 0);
    return context;
}

function clearRoute(game: Game, from: Vec2, to: Vec2, layer: number): boolean {
    const path = MapNavGraph.build(game).path(game, from, to, layer, layer);
    if (!path) return false;
    const legs = [from, ...path, to];
    return legs.slice(1).every((end, i) => lastCallWalkable(game, legs[i], end, 0.9, layer));
}

function move(player: Player, direction: Vec2, ticks: number) {
    player.touchMoveActive = true;
    player.touchMoveDir = v2.copy(direction);
    player.touchMoveLen = 255;
    player.dir = v2.copy(direction);
    player.dirNew = v2.copy(direction);
    const layers: number[] = [];
    for (let i = 0; i < ticks; i++) {
        player.game.update(0.05);
        layers.push(player.layer);
    }
    player.touchMoveActive = false;
    return layers;
}

for (const layout of SurvivalLayouts) {
    describe(layout.name, () => {
        test("is selectable as a zombie map with native underground geometry and independent roofs", () => {
            expect(ZombieMapPool).toContain(layout.mapName);
            expect(MapDefs[layout.mapName].gameMode.zombieMode).toBe(true);
            const { game, block } = start(layout);
            expect(block.layer).toBe(0);
            const underground = game.map.buildings.find((b) => b.type === `survival_${layout.key}_underground`)!;
            expect(underground.layer).toBe(1);
            const structure = game.map.structures.find((s) => s.type === structureType(layout))!;
            expect(structure.stairs.filter((s) => !s.lootOnly)).toHaveLength(2);
            expect(
                game.map.buildings.filter((b) =>
                    b.layer === 0 && MapObjectDefs.typeToDef(b.type, "building").ceiling.imgs.length > 0
                ).length,
            )
                .toBeGreaterThan(1);
        });

        test("unbought gates keep initial waves in the starting area", () => {
            const { game, operator, plan } = start(layout);
            expect([...lastCallOpenZones(game)]).toEqual([layout.startZone]);
            game.specOps!.startNextWave();
            game.specOps!.drainWaveSpawnQueuePublic();
            expect(game.specOps!.livingEnemies().length).toBeGreaterThan(0);
            for (let i = 0; i < 10; i++) {
                operator.health = operator.maxHealth;
                game.update(0.05);
            }
            for (const zombie of game.specOps!.livingEnemies()) {
                expect(zombie.layer).toBe(0);
                expect(zoneAt(layout, plan(zombie.pos), 0)?.id).toBe(layout.startZone);
            }
        });

        test("every entry has clear spawn space and a complete surface path when gates open", () => {
            const { game, world } = open(layout);
            const goal = world(layout.spawns[0]);
            for (const entry of layout.entries) {
                const point = world(entry.pos);
                const circle = collider.createCircle(point, 1.05);
                const solid = game.grid.intersectCollider(circle).some((o) =>
                    o.__type === ObjectType.Obstacle && o.layer === 0 && o.collidable && !o.dead
                    && collider.intersectCircle(o.collider, point, 1.05)
                );
                expect(solid, `${entry.zone} entry`).toBe(false);
                expect(clearRoute(game, point, goal, 0), `${entry.zone} complete entry route`).toBe(true);
            }
        });

        test("every opened doorway fits a zombie on both approaches on its own floor", () => {
            const { game, world } = open(layout);
            for (const door of layout.doors) {
                const c = center(door);
                const layer = layout.zones.find((z) => z.id === door.zones[0])!.layer;
                const [a, b] = door.opening.axis === "h"
                    ? [v2.create(c.x, c.y - 2.5), v2.create(c.x, c.y + 2.5)]
                    : [v2.create(c.x - 2.5, c.y), v2.create(c.x + 2.5, c.y)];
                expect(lastCallWalkable(game, world(a), world(b), 1.05, layer), door.id).toBe(true);
            }
        });

        test("power opens its gate and enables the upgrade machine on its real floor", () => {
            const { game, operator } = start(layout);
            const power = game.map.obstacles.find((o) => o.type === "zombie_power_switch")!;
            const gates = game.map.obstacles.filter((o) => o.type === "zombie_power_gate");
            const bench = game.map.obstacles.find((o) => o.type === ZombiePackAPunchType)!;
            expect(gates.length).toBeGreaterThan(0);
            expect(bench.layer).toBe(layout.zones.find((z) => z.id === layout.bench.zone)!.layer);
            expect(game.specOps!.zombiePowerOn).toBe(false);
            expect(bench.button?.canUse).toBe(false);
            place(operator, power.pos, power.layer);
            power.interact(operator);
            expect(game.specOps!.zombiePowerOn).toBe(true);
            expect(gates.every((gate) => gate.dead || gate.destroyed)).toBe(true);
            expect(bench.button?.canUse).toBe(true);
        });

        test("stations on each floor have a clear usable approach connected to that floor's landing", () => {
            const { game, world } = open(layout);
            const stair = game.map.structures.find((s) => s.type === structureType(layout))!.stairs[0];
            const starts = [world(layout.spawns[0]), v2.add(stair.center, v2.mul(stair.downDir, 8))];
            const stations = game.map.obstacles.filter((o) =>
                o.type.startsWith("zombie_perk_machine_") || o.type === "zombie_mystery_box"
                || o.type === "zombie_power_switch" || o.type === ZombiePackAPunchType
            );
            expect(stations).toHaveLength(8);
            for (const station of stations) {
                const box = collider.toAabb(station.collider);
                const approaches = [
                    v2.create(station.pos.x, box.min.y - 1.2),
                    v2.create(station.pos.x, box.max.y + 1.2),
                    v2.create(box.min.x - 1.2, station.pos.y),
                    v2.create(box.max.x + 1.2, station.pos.y),
                ];
                expect(
                    approaches.some((p) =>
                        lastCallWalkable(game, p, p, 1.05, station.layer)
                        && clearRoute(game, starts[station.layer], p, station.layer)
                    ),
                    `${station.type} layer ${station.layer}`,
                ).toBe(true);
            }
        });

        test("surface entries keep spawning reachable zombies while the squad is underground", () => {
            const { game, operator, world } = open(layout);
            const stair = game.map.structures.find(s => s.type === structureType(layout))!.stairs[0];
            place(operator, v2.add(stair.center, v2.mul(stair.downDir, 8)), 1);
            const graph = MapNavGraph.build(game);
            for (const entry of layout.entries) {
                expect(graph.path(game, world(entry.pos), operator.pos, 0, 1), entry.zone).not.toBeNull();
            }
            game.specOps!.startNextWave();
            game.specOps!.drainWaveSpawnQueuePublic();
            expect(game.specOps!.livingEnemies().length).toBeGreaterThan(0);
            expect(game.specOps!.livingEnemies().every(zombie => zombie.layer === 0)).toBe(true);
        });

        test.each([
            { fromLayer: 1, targetLayer: 0 },
            { fromLayer: 2, targetLayer: 0 },
            { fromLayer: 3, targetLayer: 0 },
            { fromLayer: 1, targetLayer: 1 },
        ])("recovery from layer $fromLayer reaches an operator on layer $targetLayer", ({ fromLayer, targetLayer }) => {
            const { game, operator } = open(layout);
            const ops = game.specOps!;
            const stair = game.map.structures.find(s => s.type === structureType(layout))!.stairs[0];
            const zombie = ops.spawnEnemyPublic("zombie_walker");
            const basement = lastCallNavPoints(game, 1).find(p => lastCallWalkable(game, p, p, zombie.rad, 1))!;
            expect(basement).toBeDefined();
            if (targetLayer === 1) place(operator, v2.add(stair.center, v2.mul(stair.downDir, 8)), 1);
            place(zombie, fromLayer === 1 ? basement : stair.center, fromLayer);
            const brain = ops.getBrainPublic(zombie)!;
            brain.stairTarget = stair;
            brain.detourPos = v2.copy(stair.center);

            ops.forceRelocateEnemyPublic(zombie);

            expect(zombie.layer).toBe(0);
            expect(lastCallWalkable(game, zombie.pos, zombie.pos, zombie.rad, zombie.layer)).toBe(true);
            expect(lastCallPosReachable(game, zombie.pos, undefined, zombie.layer)).toBe(true);
            expect(brain.stairTarget).toBeUndefined();
            const graph = ops.ensureNavGraph();
            expect(graph.path(game, zombie.pos, operator.pos, zombie.layer, targetLayer)).not.toBeNull();
            const recoveredAt = v2.copy(zombie.pos);
            for (let i = 0; i < 10; i++) game.update(0.05);
            expect(zombie.layer).toBe(0);
            expect(lastCallWalkable(game, zombie.pos, zombie.pos, zombie.rad, zombie.layer)).toBe(true);
            expect(v2.distance(zombie.pos, recoveredAt)).toBeGreaterThan(0.1);
        });

        test("the recovered last zombie can be shot on its real floor and the wave completes", () => {
            const { game, operator } = open(layout);
            const ops = game.specOps!;
            ops.startNextWave();
            ops.drainWaveSpawnQueuePublic();
            const [last, ...others] = ops.livingEnemies();
            expect(last).toBeDefined();
            for (const enemy of others) {
                enemy.damage({
                    amount: 9999,
                    damageType: GameConfig.DamageType.Player,
                    dir: v2.create(1, 0),
                    source: operator,
                });
            }
            expect(ops.livingEnemies()).toEqual([last]);
            const basement = lastCallNavPoints(game, 1).find(p => lastCallWalkable(game, p, p, last.rad, 1))!;
            place(last, basement, 1);
            ops.forceRelocateEnemyPublic(last);
            expect(last.layer).toBe(0);
            const approach = [v2.create(6, 0), v2.create(-6, 0), v2.create(0, 6), v2.create(0, -6)]
                .map(offset => v2.add(last.pos, offset))
                .find(pos => lastCallWalkable(game, pos, last.pos, operator.rad, 0));
            expect(approach).toBeDefined();
            place(operator, approach!, 0);
            operator.dir = v2.normalizeSafe(v2.sub(last.pos, operator.pos));
            operator.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "raygun", 20);
            operator.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary);
            operator.weaponManager.fireWeapon(false);
            for (let i = 0; i < 20 && !last.dead; i++) game.update(0.05);
            expect(last.dead).toBe(true);
            game.update(0.05);
            expect(ops.phase).toBe("intermission");
            game.step(8.1);
            expect(ops.wave).toBe(2);
            expect(ops.phase).toBe("combat");
        });

        test("a zombie cannot melee through the floor but can hurt an operator on its own floor", () => {
            const { game, operator } = open(layout);
            const stair = game.map.structures.find((s) => s.type === structureType(layout))!.stairs[0];
            const pos = v2.add(stair.center, v2.mul(stair.downDir, 12));
            const zombie = game.specOps!.spawnEnemyPublic("zombie_walker");
            place(operator, pos, 1);
            operator.specOpsImmunityTicker = 0;
            operator.specOpsArmor = 0;
            place(zombie, v2.add(pos, v2.create(1.8, 0)), 0);
            const health = operator.health;
            game.step(0.5);
            expect(operator.health).toBe(health);
            expect(zombie.layer).toBe(0);
            // Hold the combat fixture in swing range; movement and stair pursuit
            // have their own simulation test below. This isolates floor filtering.
            for (let i = 0; i < 40 && operator.health === health; i++) {
                place(zombie, v2.add(operator.pos, v2.create(1.8, 0)), 1);
                zombie.dir = v2.create(-1, 0);
                zombie.dirNew = v2.create(-1, 0);
                game.specOps!.getBrainPublic(zombie)!.aimDir = v2.create(-1, 0);
                game.update(0.05);
            }
            expect(util.sameLayer(zombie.layer, operator.layer)).toBe(true);
            expect(operator.health).toBeLessThan(health);
        });

        test("both native staircases let a player walk down and back up", () => {
            const { game, operator } = open(layout);
            const structure = game.map.structures.find((s) => s.type === structureType(layout))!;
            for (const stair of structure.stairs) {
                const approach = v2.add(stair.center, v2.mul(stair.downDir, -8));
                place(operator, approach, 0);
                const down = move(operator, stair.downDir, 44);
                expect(down.some((layer) => layer === 2 || layer === 3)).toBe(true);
                expect(operator.layer).toBe(1);
                const up = move(operator, v2.neg(stair.downDir), 44);
                expect(up.some((layer) => layer === 2 || layer === 3)).toBe(true);
                expect(operator.layer).toBe(0);
            }
        });

        test.each([0, 1])("a zombie physically follows the operator down and up stair %i", (stairIndex) => {
            const { game, operator } = open(layout);
            const structure = game.map.structures.find((s) => s.type === structureType(layout))!;
            const stair = structure.stairs[stairIndex];
            place(operator, v2.add(stair.center, v2.mul(stair.downDir, -8)), 0);
            const zombie = game.specOps!.spawnEnemyPublic("zombie_walker");
            place(zombie, v2.add(stair.center, v2.mul(stair.downDir, -14)), 0);
            move(operator, stair.downDir, 44);
            expect(operator.layer).toBe(1);
            const downstairs = v2.copy(operator.pos);
            let reachedBasement = false;
            for (let i = 0; i < 360; i++) {
                operator.health = operator.maxHealth;
                game.update(0.05);
                if (zombie.layer === 1 && v2.distance(zombie.pos, downstairs) < 5) {
                    reachedBasement = true;
                    break;
                }
            }
            expect(reachedBasement, `zombie remained at ${zombie.pos.x},${zombie.pos.y}, layer ${zombie.layer}`)
                .toBe(true);
            move(operator, v2.neg(stair.downDir), 44);
            expect(operator.layer).toBe(0);
            let returnedUpstairs = false;
            for (let i = 0; i < 360; i++) {
                operator.health = operator.maxHealth;
                game.update(0.05);
                if (zombie.layer === 0 && v2.distance(zombie.pos, operator.pos) < 5) {
                    returnedUpstairs = true;
                    break;
                }
            }
            expect(returnedUpstairs, `zombie remained at ${zombie.pos.x},${zombie.pos.y}, layer ${zombie.layer}`)
                .toBe(true);
        }, 15000);
    });
}
