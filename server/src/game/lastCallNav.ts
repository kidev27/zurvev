import {
    LastCallBuildingType,
    type LastCallDoor,
    LastCallDoors,
    lastCallFromLocal,
    LastCallMapName,
    lastCallToLocal,
    lastCallZoneAt,
    LastCallZones,
} from "../../../shared/defs/maps/lastCallLayout.ts";
import { survivalLayout } from "../../../shared/defs/maps/survival/index.ts";
import {
    bounds,
    buildingType,
    fromLocal,
    type SurvivalDoor,
    toLocal,
    zoneAt,
} from "../../../shared/defs/maps/survival/layout.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { coldet } from "../../../shared/utils/coldet.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import type { Game } from "./game.ts";
import type { Building } from "./objects/building.ts";
import type { Obstacle } from "./objects/obstacle.ts";

/** Authored survival-map routing. Keep the established helper names for After Hours compatibility. */
export function lastCallBlock(game: Game): Building | undefined {
    const layout = survivalLayout(game.config.mapName);
    const type = layout
        ? buildingType(layout)
        : game.config.mapName === LastCallMapName
        ? LastCallBuildingType
        : undefined;
    return type ? game.map.buildings.find((b) => b.type === type) : undefined;
}

function toWorld(block: Building, plan: Vec2): Vec2 {
    const layout = survivalLayout(block.game.config.mapName);
    return v2.add(block.pos, layout ? toLocal(layout, plan) : lastCallToLocal(plan.x, plan.y));
}

function toPlan(block: Building, world: Vec2): Vec2 {
    const layout = survivalLayout(block.game.config.mapName);
    const p = v2.sub(world, block.pos);
    return layout ? fromLocal(layout, p) : lastCallFromLocal(p);
}

function roomAt(block: Building, p: Vec2, layer = 0): string | undefined {
    const layout = survivalLayout(block.game.config.mapName);
    return layout
        ? zoneAt(layout, toPlan(block, p), util.toGroundLayer(layer))?.id
        : util.toGroundLayer(layer) === 0
        ? lastCallZoneAt(toPlan(block, p))
        : undefined;
}

function doorCenter(door: LastCallDoor | SurvivalDoor): Vec2 {
    const o = door.opening;
    const mid = (o.a0 + o.a1) / 2;
    return o.axis === "h" ? v2.create(mid, o.at) : v2.create(o.at, mid);
}

function doorPassable(block: Building, door: LastCallDoor | SurvivalDoor): boolean {
    if (door.kind === "open" || door.kind === "room") return true;
    const layout = survivalLayout(block.game.config.mapName);
    const layer = layout?.zones.find(z => z.id === door.zones[0])?.layer ?? 0;
    const center = toWorld(block, doorCenter(door));
    for (const obs of block.game.map.obstacles) {
        if (obs.dead || obs.destroyed || !util.sameLayer(obs.layer, layer)) continue;
        if (!obs.type.startsWith("zombie_buy_gate_") && obs.type !== "zombie_power_gate") continue;
        if (v2.distance(obs.pos, center) < 0.75) return false;
    }
    return true;
}

/** Physically connected rooms, following purchased doors and native staircase connections. */
export function lastCallOpenZones(game: Game, block = lastCallBlock(game)): Set<string> {
    const open = new Set<string>();
    if (!block) return open;
    const layout = survivalLayout(game.config.mapName);
    const queue: string[] = [];
    for (const p of game.playerBarn.livingPlayers) {
        if (p.specOpsAi) continue;
        const zone = roomAt(block, p.pos, p.layer);
        if (zone && !open.has(zone)) {
            open.add(zone);
            queue.push(zone);
        }
    }
    if (!queue.length) {
        const start = layout?.startZone ?? "lobby";
        open.add(start);
        queue.push(start);
    }
    const edges: Array<[string, string]> = (layout?.doors ?? LastCallDoors)
        .filter(d => d.zones[0] !== d.zones[1] && doorPassable(block, d))
        .map(d => d.zones);
    for (const stair of layout?.stairs ?? []) edges.push(stair.zones);
    while (queue.length) {
        const zone = queue.shift()!;
        for (const [a, b] of edges) {
            const other = a === zone ? b : b === zone ? a : undefined;
            if (other && !open.has(other)) {
                open.add(other);
                queue.push(other);
            }
        }
    }
    return open;
}

export function lastCallRoomKey(game: Game, a: Vec2, b: Vec2, fromLayer = 0, toLayer = 0): string {
    const block = lastCallBlock(game);
    if (!block) return "";
    return `|${fromLayer}:${roomAt(block, a, fromLayer) ?? "-"}|${toLayer}:${roomAt(block, b, toLayer) ?? "-"}`;
}

export function lastCallPosReachable(game: Game, pos: Vec2, open?: Set<string>, layer = 0): boolean {
    const block = lastCallBlock(game);
    if (!block) return true;
    const zone = roomAt(block, pos, layer);
    return !!zone && (open ?? lastCallOpenZones(game, block)).has(zone);
}

/** Polygon-aware fine sampling on either floor. Native stairs link the separate floor graphs. */
export function lastCallNavPoints(game: Game, layer = 0): Vec2[] {
    const block = lastCallBlock(game);
    if (!block) return [];
    const layout = survivalLayout(game.config.mapName);
    const out: Vec2[] = [];
    if (layout) {
        for (const zone of layout.zones.filter(z => z.layer === layer)) {
            const r = bounds(zone.polygon);
            for (let x = r.x0 + 2; x < r.x1 - 1; x += 4) {
                for (let y = r.y0 + 2; y < r.y1 - 1; y += 4) {
                    const p = v2.create(x, y);
                    if (zoneAt(layout, p, layer)?.id === zone.id) out.push(toWorld(block, p));
                }
            }
        }
    } else if (layer === 0) {
        for (const z of LastCallZones) {
            const r = z.rect;
            for (let x = r.x0 + 2.5; x <= r.x1 - 2.5; x += 6) {
                for (let y = r.y0 + 2.5; y <= r.y1 - 2.5; y += 6) out.push(toWorld(block, v2.create(x, y)));
            }
        }
    }
    return out;
}

export function lastCallNavPortals(game: Game, layer = 0): Array<[Vec2, Vec2]> {
    const block = lastCallBlock(game);
    if (!block) return [];
    const layout = survivalLayout(game.config.mapName);
    const out: Array<[Vec2, Vec2]> = [];
    for (const d of layout?.doors ?? LastCallDoors) {
        const doorLayer = layout?.zones.find(z => z.id === d.zones[0])?.layer ?? 0;
        if (doorLayer !== layer || !doorPassable(block, d)) continue;
        const c = doorCenter(d);
        const off = 2.5;
        const [a, b] = d.opening.axis === "h"
            ? [v2.create(c.x, c.y - off), v2.create(c.x, c.y + off)]
            : [v2.create(c.x - off, c.y), v2.create(c.x + off, c.y)];
        out.push([toWorld(block, a), toWorld(block, b)]);
    }
    return out;
}

/**
 * A body pressed against a prop or wall sits exactly one radius from it, so the
 * 1.05 clearance test rejects its own position and every route to or from it.
 * Use the nearest fully clear spot a short step away instead (same room, no
 * wall crossed). Returns the point itself when it is already clear.
 */
export function lastCallClearPoint(game: Game, p: Vec2, layer = 0, rad = 1.05): Vec2 | undefined {
    if (lastCallWalkable(game, p, p, rad, layer)) return p;
    for (const step of [0.2, 0.45, 0.75]) {
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const q = v2.add(p, v2.create(Math.cos(angle) * step, Math.sin(angle) * step));
            if (lastCallWalkable(game, q, q, rad, layer) && lastCallWalkable(game, p, q, 0.5, layer)) return q;
        }
    }
    return undefined;
}

/** Body-clear segment on its actual floor; no crossing polygon voids, walls or closed route gates. */
export function lastCallWalkable(game: Game, a: Vec2, b: Vec2, rad = 1.05, layer = 0): boolean {
    const bounds = collider.createAabb(
        v2.create(Math.min(a.x, b.x) - rad, Math.min(a.y, b.y) - rad),
        v2.create(Math.max(a.x, b.x) + rad, Math.max(a.y, b.y) + rad),
    );
    for (const obj of game.grid.intersectCollider(bounds)) {
        if (obj.__type !== ObjectType.Obstacle) continue;
        const obs = obj as Obstacle;
        if (obs.dead || obs.destroyed || !obs.collidable || !util.sameLayer(obs.layer, layer) || obs.isDoor) continue;
        const col = obs.collider;
        const grown = col.type === collider.Type.Circle
            ? collider.createCircle(col.pos, col.rad + rad)
            : collider.createAabb(
                v2.create(col.min.x - rad, col.min.y - rad),
                v2.create(col.max.x + rad, col.max.y + rad),
            );
        if (collider.intersectSegment(grown, a, b)) return false;
        if (coldet.test(collider.createCircle(a, rad), col) || coldet.test(collider.createCircle(b, rad), col)) {
            return false;
        }
    }
    const block = survivalLayout(game.config.mapName) ? lastCallBlock(game) : undefined;
    if (block) {
        const steps = Math.max(1, Math.ceil(v2.distance(a, b) / 1.5));
        for (let i = 0; i <= steps; i++) {
            if (!roomAt(block, v2.lerp(i / steps, a, b), layer)) return false;
        }
    }
    return true;
}
