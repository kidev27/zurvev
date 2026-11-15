import { BulletDefs } from "../../../shared/defs/gameObjects/bulletDefs.ts";
import { GunDefs } from "../../../shared/defs/gameObjects/gunDefs.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { practiceGunGroup, PracticeGunGroups } from "../../../shared/practice.ts";
import { collisionHelpers } from "../../../shared/utils/collisionHelpers.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import type { Obstacle } from "./objects/obstacle.ts";
import type { Player } from "./objects/player.ts";
import { practiceOnScreen, practicePeekDistance } from "./practiceCombat.ts";

/**
 * What one Practice player can see, as a flat list of numbers. The Practice recorder writes it for
 * human players; a learned bot will read the same vector, so both must come from this function.
 * Only what a player could know: enemies off screen are reported as absent.
 *
 * Bump PracticeObservationVersion whenever a field is added, removed or changes meaning.
 */
export const PracticeObservationVersion = 1;

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
    );
    gunFeatures(out, self, GameConfig.WeaponSlot.Primary);
    gunFeatures(out, self, GameConfig.WeaponSlot.Secondary);

    const seen = enemies
        .filter((e) => !e.dead && util.sameLayer(e.layer, self.layer) && practiceOnScreen(self.pos, e.pos, self))
        .sort((a, b) => v2.distance(a.pos, self.pos) - v2.distance(b.pos, self.pos));
    for (let i = 0; i < T.maxEnemies; i++) enemyFeatures(out, self, seen[i]);

    rayFeatures(out, self);
    bulletFeatures(out, self, new Set(enemies.map((e) => e.__id)));
    return out;
}
