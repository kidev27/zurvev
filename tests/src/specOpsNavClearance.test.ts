import { expect, test } from "vitest";
import type { Game } from "../../server/src/game/game.ts";
import { lastCallWalkable } from "../../server/src/game/lastCallNav.ts";
import { MapNavGraph } from "../../server/src/game/specOpsNav.ts";
import { DeadAir } from "../../shared/defs/maps/survival/deadAir.ts";
import { buildingType } from "../../shared/defs/maps/survival/layout.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import type { Collider } from "../../shared/utils/coldet.ts";
import { collider } from "../../shared/utils/collider.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";

function fixture(
    goal: Vec2,
    collision: Collider = collider.createAabb(v2.create(95, 59.5), v2.create(105, 62.5)),
) {
    const solid = {
        __type: ObjectType.Obstacle, active: true, dead: false, destroyed: false,
        collidable: true, isDoor: false, layer: 0,
        collider: collision,
    };
    const game = {
        config: { mapName: DeadAir.mapName },
        map: { buildings: [], obstacles: [solid] },
        grid: {
            intersectCollider: () => [solid],
            intersectLineSegment: () => [solid],
        },
    } as unknown as Game;
    game.map.buildings.push({
        type: buildingType(DeadAir), pos: v2.create(110, 90), game,
    } as Game["map"]["buildings"][number]);
    const graph = new MapNavGraph();
    const edit = graph as unknown as {
        addNode: (pos: Vec2, layer: number, kind: "interior") => number;
        linkBoth: (a: number, b: number, cost: number) => void;
    };
    const from = v2.create(116, 66);
    const start = edit.addNode(from, 0, "interior");
    const end = edit.addNode(v2.create(110, 66), 0, "interior");
    edit.linkBoth(start, end, v2.distance(graph.nodes[start].pos, graph.nodes[end].pos));
    return { game, graph, from, goal, solid };
}

test.each([
    ["side", v2.create(106.001, 61)],
    ["corner", v2.create(105 + Math.SQRT1_2 * 1.001, 62.5 + Math.SQRT1_2 * 1.001)],
] as const)("a player touching a prop's %s remains a reachable route endpoint", (_name, goal) => {
    const { game, graph, from, solid } = fixture(goal);
    expect(collider.intersectCircle(solid.collider, goal, GameConfig.player.radius)).toBeNull();
    const path = graph.path(game, from, goal, 0, 0);
    expect(path).not.toBeNull();
    const legs = [from, ...path!, goal];
    for (let i = 1; i < legs.length; i++) {
        expect(lastCallWalkable(game, legs[i - 1], legs[i], GameConfig.player.radius, 0)).toBe(true);
    }
});

test("overlapping a solid is still rejected as a route endpoint", () => {
    const { game, graph, from, goal } = fixture(v2.create(104.99, 61));
    expect(graph.path(game, from, goal, 0, 0)).toBeNull();
});

test("body sweeps still reject solid crossings and corner clipping", () => {
    const { game } = fixture(v2.create(106.001, 61));
    expect(lastCallWalkable(game, v2.create(90, 61), v2.create(110, 61), 1, 0)).toBe(false);
    expect(lastCallWalkable(game, v2.create(104, 63.1), v2.create(105.6, 62.6), 1, 0)).toBe(false);
    expect(lastCallWalkable(game, v2.create(106.001, 55), v2.create(106.001, 70), 1, 0)).toBe(true);
});

test("body sweeps keep circular props solid without rejecting clear tangents", () => {
    const { game } = fixture(v2.create(103.001, 61), collider.createCircle(v2.create(100, 61), 2));
    expect(lastCallWalkable(game, v2.create(103.001, 55), v2.create(103.001, 70), 1, 0)).toBe(true);
    expect(lastCallWalkable(game, v2.create(102.999, 55), v2.create(102.999, 70), 1, 0)).toBe(false);
    expect(lastCallWalkable(game, v2.create(102.999, 61), v2.create(102.999, 61), 1, 0)).toBe(false);
});
