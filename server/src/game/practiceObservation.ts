import { BulletDefs } from "../../../shared/defs/gameObjects/bulletDefs.ts";
import { ExplosionDefs } from "../../../shared/defs/gameObjects/explosionsDefs.ts";
import { GunDefs } from "../../../shared/defs/gameObjects/gunDefs.ts";
import { ThrowableDefs } from "../../../shared/defs/gameObjects/throwableDefs.ts";
import { MapObjectDefs } from "../../../shared/defs/register.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { practiceGunGroup, PracticeGunGroups } from "../../../shared/practice.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { collisionHelpers } from "../../../shared/utils/collisionHelpers.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import type { Obstacle } from "./objects/obstacle.ts";
import type { Player } from "./objects/player.ts";
import type { Projectile } from "./objects/projectile.ts";
import { practiceOnScreen, practicePeekDistance } from "./practiceCombat.ts";

/**
 * What one Practice player can see, as a flat list of numbers. The Practice recorder writes it for
 * human players; a learned bot will read the same vector, so both must come from this function.
 * Only what a player could know: enemies off screen are reported as absent.
 *
 * Bump PracticeObservationVersion whenever a field is added, removed or changes meaning.
 */
export const PracticeObservationVersion = 2;

export const PracticeObservationTuning = {
    /** Enemies described, nearest first; missing ones are all zeros. */
    maxEnemies: 4,
    /** Wall rays around the player, evenly spaced from east, counter-clockwise. */
    rays: 16,
    /** Rays stop here (units). */
    rayRange: 30,
    /** Enemy bullets described, soonest first. */
    maxBullets: 3,
    /** A bullet counts when it will pass within this many units of you. */
    bulletMissRange: 3,
    /** ...within this many seconds. */
    bulletHorizon: 1,
    /** Things that explode when shot (barrels, stoves), nearest first. */
    maxExplosives: 2,
    /** Look this far for them (units). */
    explosiveSearch: 20,
    /** Grenades and other thrown things in the air or on the ground, nearest first. */
    maxProjectiles: 2,
    /** Look this far for them (units). */
    projectileSearch: 25,
};

const T = PracticeObservationTuning;

/** Field names, in vector order. Written into every recording header. */
export const PracticeObservationFields: string[] = (() => {
    const f: string[] = [];
    const gun = (p: string) => [
        `${p}_present`,
        ...PracticeGunGroups.map((g) => `${p}_${g}`),
        `${p}_ammo`,
        `${p}_clip`,
        `${p}_cooldown`,
    ];
    f.push(
        "self_health",
        "self_boost",
        "self_vel_x",
        "self_vel_y",
        "self_dir_x",
        "self_dir_y",
        "self_slot",
        "self_reloading",
        "self_using_item",
        "self_action_left",
        "self_indoors",
        "self_layer",
        "self_view_radius",
        "self_bandage",
        "self_healthkit",
        "self_soda",
        "self_painkiller",
        "self_frag",
        "self_smoke",
        "self_mirv",
        "self_cooking",
        ...gun("gun0"),
        ...gun("gun1"),
    );
    for (let i = 0; i < T.maxEnemies; i++) {
        const p = `enemy${i}`;
        f.push(
            `${p}_present`,
            `${p}_dx`,
            `${p}_dy`,
            `${p}_dist`,
            `${p}_vel_x`,
            `${p}_vel_y`,
            `${p}_health`,
            `${p}_boost`,
            `${p}_clear_shot`,
            `${p}_peek_dist`,
            `${p}_aim_at_me`,
            `${p}_reloading`,
            `${p}_using_item`,
            `${p}_slot`,
            `${p}_ammo`,
            ...PracticeGunGroups.map((g) => `${p}_${g}`),
        );
    }
    for (let i = 0; i < T.rays; i++) f.push(`ray${i}_move`, `ray${i}_cover`);
    for (let i = 0; i < T.maxBullets; i++) {
        const p = `bullet${i}`;
        f.push(`${p}_present`, `${p}_dx`, `${p}_dy`, `${p}_vel_x`, `${p}_vel_y`, `${p}_miss`, `${p}_time`);
    }
    for (let i = 0; i < T.maxExplosives; i++) {
        const p = `explosive${i}`;
        f.push(`${p}_present`, `${p}_dx`, `${p}_dy`, `${p}_blast`, `${p}_health`, `${p}_enemy_in_blast`);
    }
    for (let i = 0; i < T.maxProjectiles; i++) {
        const p = `proj${i}`;
        f.push(
            `${p}_present`,
            `${p}_dx`,
            `${p}_dy`,
            `${p}_vel_x`,
            `${p}_vel_y`,
            `${p}_height`,
            `${p}_fuse_left`,
            `${p}_blast`,
            `${p}_mine`,
        );
    }
    return f;
})();

function gunFeatures(out: number[], player: Player, slot: number): void {
    const w = player.weapons[slot];
    const def = w?.type ? GunDefs[w.type] : undefined;
    if (!def) {
        for (let i = 0; i < 4 + PracticeGunGroups.length; i++) out.push(0);
        return;
    }
    const group = practiceGunGroup(w.type);
    out.push(1, ...PracticeGunGroups.map((g) => (g === group ? 1 : 0)), w.ammo, def.maxClip, Math.max(0, w.cooldown));
}

function actionLeft(player: Player): number {
    if (player.actionType === GameConfig.Action.None) return 0;
    return Math.max(0, player.action.duration - player.action.time);
}

const isReload = (p: Player) =>
    p.actionType === GameConfig.Action.Reload || p.actionType === GameConfig.Action.ReloadAlt;

function viewRadius(player: Player): number {
    return GameConfig.scopeZoomRadius.desktop[player.scope] ?? GameConfig.scopeZoomRadius.desktop["1xscope"];
}

function obstaclesOn(player: Player, from: Vec2, to: Vec2): Obstacle[] {
    const out: Obstacle[] = [];
    for (const obj of player.game.grid.intersectLineSegment(from, to)) {
        if (obj.__type === ObjectType.Obstacle) out.push(obj as Obstacle);
    }
    return out;
}

/**
 * Distance to the nearest thing that blocks walking (`move`, any solid obstacle) and the nearest
 * thing that stops bullets (`cover`, solid and at least waist high), for each ray.
 */
function rayFeatures(out: number[], player: Player): void {
    for (let i = 0; i < T.rays; i++) {
        const angle = (i / T.rays) * Math.PI * 2;
        const dir = v2.create(Math.cos(angle), Math.sin(angle));
        const end = v2.add(player.pos, v2.mul(dir, T.rayRange));
        const obstacles = obstaclesOn(player, player.pos, end);
        out.push(
            collisionHelpers.intersectSegmentDist(obstacles, player.pos, dir, T.rayRange, 0, player.layer, false),
            collisionHelpers.intersectSegmentDist(obstacles, player.pos, dir, T.rayRange, 0.25, player.layer, false),
        );
    }
}

/** Enemy bullets that will pass close to you soon, soonest first. */
function bulletFeatures(out: number[], player: Player, enemyIds: Set<number>): void {
    const near: number[][] = [];
    for (const b of player.game.bulletBarn.bullets) {
        if (!b.alive || !enemyIds.has(b.playerId) || !util.sameLayer(b.layer, player.layer)) continue;
        const speed = b.speed ?? BulletDefs[b.bulletType]?.speed ?? 0;
        if (!(speed > 0)) continue;
        const rel = v2.sub(b.pos, player.pos);
        const vel = v2.mul(b.dir, speed);
        const time = -v2.dot(rel, vel) / (speed * speed);
        const left = (b.distance - b.distanceTraveled) / speed;
        if (time < 0 || time > T.bulletHorizon || time > left) continue;
        const miss = v2.length(v2.add(rel, v2.mul(vel, time)));
        if (miss > T.bulletMissRange) continue;
        near.push([1, rel.x, rel.y, vel.x, vel.y, miss, time]);
    }
    near.sort((a, b) => a[6] - b[6]);
    for (let i = 0; i < T.maxBullets; i++) out.push(...(near[i] ?? [0, 0, 0, 0, 0, 0, 0]));
}

function enemyFeatures(out: number[], self: Player, enemy: Player | undefined): void {
    const per = 15 + PracticeGunGroups.length;
    if (!enemy) {
        for (let i = 0; i < per; i++) out.push(0);
        return;
    }
    const d = v2.sub(enemy.pos, self.pos);
    const dist = v2.length(d);
    const toMe = v2.normalizeSafe(v2.neg(d));
    const gun = enemy.weapons[enemy.curWeapIdx];
    const group = gun?.type && GunDefs[gun.type] ? practiceGunGroup(gun.type) : undefined;
    const peek = practicePeekDistance(self, enemy);
    out.push(
        1,
        d.x,
        d.y,
        dist,
        enemy.moveVel.x,
        enemy.moveVel.y,
        enemy.health,
        enemy.boost,
        peek === 0 ? 1 : 0,
        peek,
        v2.dot(enemy.dir, toMe),
        isReload(enemy) ? 1 : 0,
        enemy.actionType === GameConfig.Action.UseItem ? 1 : 0,
        enemy.curWeapIdx,
        gun?.ammo ?? 0,
        ...PracticeGunGroups.map((g) => (g === group ? 1 : 0)),
    );
}

/** Blast radius of an obstacle that explodes when destroyed (barrels, stoves), else 0. */
export function obstacleBlastRadius(o: Obstacle): number {
    const def = MapObjectDefs.typeToDef(o.type, "obstacle");
    return def?.explosion ? ExplosionDefs[def.explosion]?.rad.max ?? 0 : 0;
}

/** Blast radius of a thrown thing (0 for smoke and other non-damaging ones). */
export function projectileBlastRadius(p: Projectile): number {
    const def = ThrowableDefs[p.type];
    const exp = def?.explosionType ? ExplosionDefs[def.explosionType] : undefined;
    return exp && exp.rad.max > 0 && (exp.damage ?? 0) > 0 ? exp.rad.max : 0;
}

export function obstacleCenter(o: Obstacle): Vec2 {
    const col = o.collider;
    return col.type === collider.Type.Circle ? col.pos : v2.mul(v2.add(col.min, col.max), 0.5);
}

/** Barrels and stoves near you, nearest first, and whether a seen enemy stands in the blast. */
function explosiveFeatures(out: number[], self: Player, seen: readonly Player[]): void {
    const found: Array<[number, Obstacle, number]> = [];
    const near = self.game.grid.intersectCollider(collider.createCircle(self.pos, T.explosiveSearch));
    for (const obj of near) {
        if (obj.__type !== ObjectType.Obstacle) continue;
        const o = obj as Obstacle;
        if (o.dead || !util.sameLayer(o.layer, self.layer)) continue;
        const blast = obstacleBlastRadius(o);
        if (blast <= 0) continue;
        found.push([v2.distance(obstacleCenter(o), self.pos), o, blast]);
    }
    found.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < T.maxExplosives; i++) {
        const f = found[i];
        if (!f) {
            out.push(0, 0, 0, 0, 0, 0);
            continue;
        }
        const [, o, blast] = f;
        const c = obstacleCenter(o);
        const d = v2.sub(c, self.pos);
        const enemyIn = seen.some((e) => v2.distance(e.pos, c) < blast + e.rad);
        out.push(1, d.x, d.y, blast, o.healthT, enemyIn ? 1 : 0);
    }
}

/** Grenades and other thrown things near you, nearest first. */
function projectileFeatures(out: number[], self: Player, onScreen: (pos: Vec2) => boolean): void {
    const found: Array<[number, Projectile]> = [];
    for (const p of self.game.projectileBarn.projectiles) {
        if (p.destroyed || !util.sameLayer(p.layer, self.layer)) continue;
        const dist = v2.distance(p.pos, self.pos);
        if (dist > T.projectileSearch || (p.playerId !== self.__id && !onScreen(p.pos))) continue;
        found.push([dist, p]);
    }
    found.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < T.maxProjectiles; i++) {
        const p = found[i]?.[1];
        if (!p) {
            out.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
            continue;
        }
        const d = v2.sub(p.pos, self.pos);
        const mine = p.playerId === self.__id ? 1 : 0;
        out.push(1, d.x, d.y, p.vel.x, p.vel.y, p.posZ, p.fuseTime, projectileBlastRadius(p), mine);
    }
}

/** Feature vector for `self`, given the players it fights. Length = PracticeObservationFields.length. */
export function practiceObserve(self: Player, enemies: readonly Player[]): number[] {
    const out: number[] = [];
    const inv = self.invManager;
    out.push(
        self.health,
        self.boost,
        self.moveVel.x,
        self.moveVel.y,
        self.dir.x,
        self.dir.y,
        self.curWeapIdx,
        isReload(self) ? 1 : 0,
        self.actionType === GameConfig.Action.UseItem ? 1 : 0,
        actionLeft(self),
        self.indoors ? 1 : 0,
        self.layer,
        viewRadius(self),
        inv.get("bandage"),
        inv.get("healthkit"),
        inv.get("soda"),
        inv.get("painkiller"),
        inv.get("frag"),
        inv.get("smoke"),
        inv.get("mirv"),
        self.weaponManager.cookingThrowable ? self.weaponManager.cookTicker : 0,
    );
    gunFeatures(out, self, GameConfig.WeaponSlot.Primary);
    gunFeatures(out, self, GameConfig.WeaponSlot.Secondary);

    const seen = enemies
        .filter((e) => !e.dead && util.sameLayer(e.layer, self.layer) && practiceOnScreen(self.pos, e.pos, self))
        .sort((a, b) => v2.distance(a.pos, self.pos) - v2.distance(b.pos, self.pos));
    for (let i = 0; i < T.maxEnemies; i++) enemyFeatures(out, self, seen[i]);

    rayFeatures(out, self);
    bulletFeatures(out, self, new Set(enemies.map((e) => e.__id)));
    explosiveFeatures(out, self, seen);
    projectileFeatures(out, self, (pos) => practiceOnScreen(self.pos, pos, self));
    return out;
}
