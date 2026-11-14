import { BulletDefs } from "../../../shared/defs/gameObjects/bulletDefs.ts";
import { GunDefs } from "../../../shared/defs/gameObjects/gunDefs.ts";
import { MeleeDefs } from "../../../shared/defs/gameObjects/meleeDefs.ts";
import { ExplosionDefs } from "../../../shared/defs/gameObjects/explosionsDefs.ts";
import { GameObjectDefs, MapObjectDefs } from "../../../shared/defs/register.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import type { PracticeBotSettings } from "../../../shared/practice.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { math } from "../../../shared/utils/math.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import type { Obstacle } from "./objects/obstacle.ts";
import type { Player } from "./objects/player.ts";

/** Solve projectile interception, including the distance from body to muzzle. */
export function practiceInterceptPoint(
    origin: Vec2,
    target: Vec2,
    velocity: Vec2,
    speed: number,
    muzzle = 0,
    maxTime = 2,
): Vec2 {
    if (!(speed > 0) || !Number.isFinite(speed)) return v2.copy(target);
    const delta = v2.sub(target, origin);
    const a = v2.dot(velocity, velocity) - speed * speed;
    const b = 2 * (v2.dot(delta, velocity) - speed * muzzle);
    const c = v2.dot(delta, delta) - muzzle * muzzle;
    const roots: number[] = [];
    if (Math.abs(a) < 1e-6) {
        if (Math.abs(b) > 1e-6) roots.push(-c / b);
    } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const sqrt = Math.sqrt(disc);
            roots.push((-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a));
        }
    }
    const valid = roots.filter((t) => t >= 0 && Number.isFinite(t));
    const time = c <= 0 ? 0 : valid.length ? Math.min(...valid) : 0;
    return v2.add(target, v2.mul(velocity, math.clamp(time, 0, maxTime)));
}

/**
 * How a practice bot overclocks. After a shot the gun waits `fireDelay` before
 * the next one and the bot walks at half speed for that long. Swapping weapons
 * ends the slow walk at once, and a gun drawn again is ready after its
 * `switchDelay`, which for bolt rifles is shorter than `fireDelay`.
 *
 * - Other gun loaded and quicker to draw than waiting: swap to it and shoot.
 * - Otherwise: holster to melee and draw the same gun again on the next tick.
 *   Faster fire when `switchDelay < fireDelay` (Mosin 1.75 s to about 1.0 s).
 *   When it is not faster (SPAS-12, M870, Model 94), the bot still does it
 *   to keep full speed. `maxCancelCost` can cap what that may cost per shot.
 *
 * Only runs when the bot's Quick switch setting is on.
 */
export const PracticeBotOverclock = {
    /** Guns that fire faster than this never swap between shots. */
    minFireDelay: 0.45,
    /** Swap to end the slow walk even when it gains no fire rate. */
    cancelSlowdown: true,
    /** Most seconds a slow-walk swap may add to the wait for the next shot. Infinity: always swap. */
    maxCancelCost: Infinity,
    /** Seconds the gun stays holstered before the bot draws it again. 0: the next server tick. */
    holsterTime: 0,
    /** Shots ahead the bot plans its switches for. */
    lookahead: 3,
};

/**
 * Where a practice bot with two guns fights.
 *
 * - It moves to the distance of its shortest-range gun, so both guns work there.
 * - On the way in it shoots the gun that reaches and holsters it between shots.
 *   It does not draw a gun that cannot reach yet.
 */
export const PracticeBotRange = {
    /** Move to the shortest-range gun's distance. Off: the distance follows the gun in hand. */
    fightAtShortestGun: true,
    /** Walk in until the target is inside this share of that gun's fire range (shotguns 12.65 → 10.1). */
    closeTo: 0.8,
    /** Only draw a gun to shoot when the target is inside its fire range. */
    drawOnlyInRange: true,
};

/**
 * When a practice bot reloads. A reload only works on the gun in hand, and the
 * bot cannot shoot while it reloads, so each rule says when that trade is worth it.
 *
 * - Safe (it has not seen you for `safeDelay` s): fill both guns, empty ones first.
 * - Nothing loaded: reload whichever gun gets a round in soonest, then shoot.
 * - One gun empty, one loaded, and it sees you: keep fighting with the loaded gun,
 *   unless one of the three `when…` reasons below holds.
 */
export const PracticeBotReload = {
    /** Seconds without seeing you before the bot counts as safe. */
    safeDelay: 0.4,
    /** Reload the empty gun when the loaded gun cannot reach you (see `reachSlack`). */
    whenOutOfReach: true,
    /**
     * A gun "reaches" you up to this multiple of its fire range: close enough to
     * step in and shoot. Shotguns fire from 12.65 units, so they reach to 19.
     */
    reachSlack: 1.5,
    /** Reload the empty gun while you are reloading or using a heal/boost. */
    whenTargetBusy: true,
    /**
     * Reload the empty gun when the loaded gun is nearly empty, but only if the
     * empty gun gets a round in at least `lowQuickerBy` s sooner than the loaded
     * gun would once dry (otherwise: shoot the last round, then the "nothing
     * loaded" rule reloads the quicker gun).
     */
    whenLow: true,
    /** "Nearly empty": this many rounds or fewer, in magazines of `lowMinClip` or more. */
    lowRounds: 1,
    lowMinClip: 3,
    lowQuickerBy: 1,
    /** A reload with this many seconds or fewer left is finished even after its reason is gone. */
    finishIfLeft: 0.75,
};

/**
 * What a practice bot can see and shoot at.
 *
 * - It sees what a player with your scope sees: a screen `screenAspect` times
 *   wider than tall, with your scope's view radius up and down.
 * - It shoots a gun as far as the gun's bullets fly. Shotguns only up close
 *   (`shotgunRange`), where their pellets land.
 */
export const PracticeBotView = {
    screenAspect: 16 / 9,
    shotgunRange: 11 * 1.15,
};

/** Half-height of the screen a player with `viewer`'s scope sees. */
function viewRadius(viewer: Player): number {
    return GameConfig.scopeZoomRadius.desktop[viewer.scope] ?? GameConfig.scopeZoomRadius.desktop["1xscope"];
}

/** `pos` is on the screen of a player standing at `from` with `scopeOf`'s scope. */
export function practiceOnScreen(from: Vec2, pos: Vec2, scopeOf: Player): boolean {
    const radius = viewRadius(scopeOf);
    return Math.abs(pos.x - from.x) <= radius * PracticeBotView.screenAspect && Math.abs(pos.y - from.y) <= radius;
}

/** How far a practice bot will shoot this gun: its bullet distance, or `shotgunRange` for shotguns. */
export function practiceFireReach(gunType: string): number {
    const gun = GunDefs[gunType];
    if (!gun) return 0;
    const bullet = BulletDefs[gun.bulletType]?.distance ?? 0;
    return gun.bulletCount > 1 ? Math.min(PracticeBotView.shotgunRange, bullet) : bullet;
}

/**
 * What counts as cover for a practice bot: any solid obstacle that stops
 * bullets, including walls, doors and buildings. Never something that
 * explodes (barrels, stoves), and never a spot inside such a thing's blast.
 */
export const PracticeBotCover = {
    /** How far to look for explosives around a spot; at least the biggest blast radius. */
    explosiveSearch: 14,
};

/**
 * How a practice bot peeks from cover. It hides at the edge of cover that you
 * need `hideMin` units of sidestep to see past, and steps just past the edge
 * to see you. It waits there until its gun is ready, steps out, shoots
 * (one shot with a slow gun such as a bolt-action or pump, otherwise a
 * `burst`), and steps back.
 *
 * It does not peek while it pushes, heals or walks to heal cover, when you
 * are closer than `minDistance` (`shotgunMinDistance` for shotgun-only bots),
 * or with no gun that reaches you.
 * While hidden it aims where it last saw you.
 */
export const PracticeBotPeek = {
    enabled: true,
    /** Cover within this many units of the bot. */
    search: 16,
    /** You closer than this: no peeking, it fights in the open. */
    minDistance: 12,
    /** The same for a bot whose guns are all shotguns: it peeks corners up close. */
    shotgunMinDistance: 4,
    /**
     * A peek is planned: if you are within this many units of where it last saw
     * you when it steps out, it shoots without a fresh reaction delay, as a player
     * who pre-aimed a corner and adjusts would. Farther: normal reaction.
     * Infinity: never a reaction delay on its own peeks.
     */
    expectRadius: Infinity,
    /** The cover spot must make you walk this far sideways to see the bot (about 0.5 s). */
    hideMin: 6,
    /** Extra step past the first spot that sees you, so the shot is not clipped by the edge. */
    stepOut: 0.3,
    /**
     * The step-out spot needs a clear bullet line this wide on each side, so aim
     * error does not clip the cover's edge (metal edges would make it hold fire).
     */
    shotClearance: 0.5,
    /** Guns faster than a bolt-action: seconds out per peek once it sees you. */
    burst: 0.8,
    /** Back to cover after this long out without a shot. */
    maxOut: 1.5,
    /** At its step-out spot and still not seeing you after this many seconds: back to cover. */
    giveUp: 0.2,
    /** You moved this far since the peek was planned: plan again before stepping out. */
    replanMove: 1,
    /** A reload at cover is finished first when the gun has this many rounds or fewer. */
    waitReloadAt: 1,
};

/**
 * When a practice bot heals and uses adrenaline. Items work as they do for
 * every player: the bot walks at half speed while it uses one, and a shot or
 * a weapon swap cancels it.
 *
 * - It starts an item only if it can finish before you can shoot it. That time
 *   (the "window") is the longest of:
 *   - behind hard cover: how far you must walk sideways to see it, at your speed;
 *   - in the open: how far it is past the reach of your guns or your screen
 *     (`PracticeBotView.screenAspect` times your scope's view radius);
 *   plus what is left of your reload or item.
 * - You reloading or healing where it can shoot you: it shoots instead.
 * - It picks the item it wants; if that does not fit the window, a shorter one
 *   (bandage for a med kit, soda for pills). Nothing fits: no item.
 * - At `coverAt` health or less with nothing that fits, it walks to the nearest
 *   cover within `coverSearch` units that gives time for a bandage, then heals.
 *   If you are at `runFromAt` health or more it runs: cover within `runSearch`,
 *   and with none, it backs away from you until it is far enough to heal.
 * - Being hit stops the item, and it waits `hitDelay` before it tries again.
 * - Being in your sight and reach stops the item, unless `finishIfLeft` or less is left.
 * - It pushes (closes in, no item, no running for cover) when it is above
 *   `coverAt` health and you are at `pushTargetAt` or less, or you are using a
 *   heal or boost (`denyHeals`); or whenever it leads you by `pushLead` health.
 * - Order: reload if nothing is loaded, heal if at `urgentAt` or less,
 *   reload an empty gun, heal, top up clips, adrenaline.
 * - Health: it heals while at least one bandage's worth is missing, with a med
 *   kit when that is quicker than the bandages (more than 30 missing).
 *
 * A bot that does not shoot back (a target dummy) never uses items.
 */
export const PracticeBotHeal = {
    /** What every bot spawns with: a full level 3 pack. */
    kit: { bandage: 30, healthkit: 4, soda: 15, painkiller: 4 } as Record<PracticeBotItem, number>,
    backpack: "backpack03",
    /** Spare seconds the window must have on top of the item's use time. */
    margin: 0.3,
    /** Count the rest of your reload or item in the window. */
    whenTargetBusy: true,
    /** s after taking damage before the bot starts an item. */
    hitDelay: 1,
    /** Finish an item with this many seconds or fewer left, even when you can shoot it. */
    finishIfLeft: 0.5,
    /** Health at or below this: healing comes before reloading an empty gun. */
    urgentAt: 50,
    /** Health at or below this, with no time to heal where it stands: walk to cover first. */
    coverAt: 60,
    /** How far it looks for cover, in units. */
    coverSearch: 24,
    /** Your health at or above this while it is low: it runs, looking `runSearch` units for cover. */
    runFromAt: 70,
    runSearch: 40,
    /** Running with no cover found: it backs away from you this far at a time, until it can heal. */
    retreatStep: 8,
    /** Your health at or below this, with the bot above `coverAt`: it pushes. */
    pushTargetAt: 30,
    /** The bot this much health or more ahead of you: it pushes, as it expects to win the trade. */
    pushLead: 30,
    /** You using a heal or boost, with the bot above `coverAt`: it pushes to shoot you through it. */
    denyHeals: true,
    /** How hard it closes in then, 0 to 1 (the brain's push pressure). */
    pushPressure: 1,
    /** Adrenaline below this is topped up when safe. 50 is where the speed bonus starts. */
    boostBelow: 50,
    /** Adrenaline below this: pills (+50). Otherwise soda (+25). */
    pillsBelow: 25,
};
export type PracticeBotItem = "bandage" | "healthkit" | "soda" | "painkiller";

/**
 * How far `viewer` must walk sideways before it can see `hidden`: for each
 * bullet-stopping obstacle between them, the line has to clear the obstacle's
 * edge. The line pivots at `hidden`, so a shift at the obstacle grows by
 * (distance to hidden / obstacle to hidden) back at the viewer. 0 when nothing blocks.
 */
export function practicePeekDistance(viewer: Player, hidden: Player): number {
    if (!util.sameLayer(viewer.layer, hidden.layer)) return 0;
    return peekDistanceAt(viewer, hidden.pos, hidden.rad);
}

function blocksBullets(o: Obstacle, layer: number): boolean {
    return o.active && !o.dead && o.collidable && !o.isWindow && o.height >= 0.25 && !!util.sameLayer(o.layer, layer);
}

/** Blast radius of an obstacle that explodes when destroyed (barrels, stoves), else 0. */
function blastRadius(o: Obstacle): number {
    const def = MapObjectDefs.typeToDef(o.type, "obstacle");
    return def?.explosion ? ExplosionDefs[def.explosion]?.rad.max ?? 0 : 0;
}

/**
 * Cover the bot may hide behind: anything solid that stops bullets (walls, doors,
 * buildings, crates, rocks, trees), except things that explode.
 */
function isCover(o: Obstacle, layer: number): boolean {
    return blocksBullets(o, layer) && blastRadius(o) === 0;
}

/** A spot inside the blast radius of something explosive. */
function nearExplosive(player: Player, spot: Vec2): boolean {
    const reach = PracticeBotCover.explosiveSearch;
    return player.game.grid.intersectCollider(collider.createCircle(spot, reach)).some((obj) => {
        if (obj.__type !== ObjectType.Obstacle) return false;
        const o = obj as Obstacle;
        const blast = o.dead ? 0 : blastRadius(o);
        return blast > 0 && v2.distance(obstacleCenter(o), spot) < blast + player.rad;
    });
}

function obstacleCenter(o: Obstacle): Vec2 {
    const col = o.collider;
    return col.type === collider.Type.Circle ? col.pos : v2.mul(v2.add(col.min, col.max), 0.5);
}

/** Half the obstacle's width across `axis` (a unit vector). */
function obstacleHalfWidth(o: Obstacle, axis: Vec2): number {
    const col = o.collider;
    return col.type === collider.Type.Circle
        ? col.rad
        : Math.abs((col.max.x - col.min.x) / 2 * axis.x) + Math.abs((col.max.y - col.min.y) / 2 * axis.y);
}

function peekDistanceAt(viewer: Player, to: Vec2, rad: number): number {
    const from = viewer.pos;
    const length = v2.distance(from, to);
    if (length < 0.5) return 0;
    const dir = v2.div(v2.sub(to, from), length);
    const side = v2.perp(dir);
    let needed = 0;
    for (const obj of viewer.game.grid.intersectLineSegment(from, to)) {
        if (obj.__type !== ObjectType.Obstacle) continue;
        const o = obj as Obstacle;
        if (!blocksBullets(o, viewer.layer) || !collider.intersectSegment(o.collider, from, to)) continue;
        const center = obstacleCenter(o);
        const offset = v2.dot(v2.sub(center, from), side);
        const toHidden = Math.max(0.5, length - v2.dot(v2.sub(center, from), dir));
        const shiftAtObstacle = Math.max(0, obstacleHalfWidth(o, side) + rad - Math.abs(offset));
        needed = Math.max(needed, shiftAtObstacle * length / toHidden);
    }
    return needed;
}

/** A bullet line from `from` to `to`, and the lines `margin` to each side of it, all miss cover. */
function clearShot(player: Player, from: Vec2, to: Vec2, margin: number): boolean {
    const side = v2.mul(v2.perp(v2.normalizeSafe(v2.sub(to, from))), margin);
    for (const shift of [v2.create(0, 0), side, v2.neg(side)]) {
        const a = v2.add(from, shift);
        const b = v2.add(to, shift);
        for (const obj of player.game.grid.intersectLineSegment(a, b)) {
            if (obj.__type !== ObjectType.Obstacle) continue;
            const o = obj as Obstacle;
            if (blocksBullets(o, player.layer) && collider.intersectSegment(o.collider, a, b)) return false;
        }
    }
    return true;
}

function useTime(item: PracticeBotItem): number {
    return (GameObjectDefs.typeToDef(item, item === "bandage" || item === "healthkit" ? "heal" : "boost")).useTime;
}

function isReloadAction(action: number): boolean {
    return action === GameConfig.Action.Reload || action === GameConfig.Action.ReloadAlt;
}

/**
 * Practice-only combat. All switches, fire, reloads and melee use the normal engine.
 * This class only decides when to press what a player can press; it must not
 * change a gun's timers, ranges or damage.
 */
export class PracticeCombat {
    meleeEngaged = false;
    /** The gun the bot is reloading on purpose this tick; it holds fire for it. */
    reloadSlot?: number;
    private lastAmmo: number[];
    private returnSlot?: number;
    private returnWait = 0;
    private committedSlot?: number;
    private unseenFor = 0;
    /** Ammo in the gun when "finish this reload" began, so one finish covers one reload. */
    private finishAmmo?: number;
    private lastHealth: number;
    private sinceHit = Infinity;
    /** The target is low: the brain closes in and the bot does not heal. */
    pushing = false;
    /** How far the target must walk sideways to see the bot. Tests replace it. */
    peekDistance = (target: Player) => practicePeekDistance(target, this.player);
    /** Where the bot is walking to heal behind cover, if anywhere. The brain moves it there. */
    healCover?: Vec2;
    private coverTicker = 0;
    /** The current peek: where it hides and where it steps out to. */
    peek?: { cover: Vec2; out: Vec2; from: Vec2 };
    /** True while it steps out or stands out to shoot. */
    peekOut = false;
    private peekTicker = 0;
    private peekOutFor = 0;
    private peekSeenFor = 0;
    private peekBlindFor = 0;
    private peekStepTime = 0;

    /** Where the peek wants the bot to stand now. */
    get peekGoal(): Vec2 | undefined {
        return this.peek && (this.peekOut ? this.peek.out : this.peek.cover);
    }

    /**
     * @param fireRange how far the bot will shoot a given gun from (the brain's
     *   range for it). Past this the gun "cannot reach".
     */
    constructor(
        readonly player: Player,
        readonly settings: PracticeBotSettings,
        private readonly fireRange: (gun: string) => number = () => Infinity,
    ) {
        this.lastAmmo = player.weapons.slice(0, 2).map((w) => w.ammo);
        this.lastHealth = player.health;
    }

    /** Should the bot close in now: it is winning, you are low, or you are healing. */
    private wantsPush(target: Player): boolean {
        const H = PracticeBotHeal;
        const health = this.player.health;
        if (health - target.health >= H.pushLead) return true;
        if (health <= H.coverAt) return false;
        const healing = H.denyHeals && target.actionType === GameConfig.Action.UseItem;
        return target.health <= H.pushTargetAt || healing;
    }

    /** The bot is using a heal or boost item right now. */
    get usingItem(): boolean {
        return this.player.actionType === GameConfig.Action.UseItem;
    }

    /**
     * The item the bot would use if it were safe, most urgent first.
     *
     * Health: nothing while less than one bandage is missing. Otherwise the
     * quicker way back to full: a med kit when the bandages would take longer.
     */
    private wantedItem(): PracticeBotItem | undefined {
        const H = PracticeBotHeal;
        const p = this.player;
        const has = (item: PracticeBotItem) => p.invManager.get(item) > 0;
        const bandage = GameObjectDefs.typeToDef("bandage", "heal");
        const medkit = GameObjectDefs.typeToDef("healthkit", "heal");
        // The game refuses a heal item at or above its maxHeal (100).
        const missing = Math.min(p.maxHealth, bandage.maxHeal) - p.health;
        if (missing >= bandage.heal) {
            const bandageTime = Math.ceil(missing / bandage.heal) * bandage.useTime;
            if (has("healthkit") && (bandageTime > medkit.useTime || !has("bandage"))) return "healthkit";
            if (has("bandage")) return "bandage";
        }
        if (p.boost < H.boostBelow) {
            if (p.boost < H.pillsBelow && has("painkiller")) return "painkiller";
            if (has("soda")) return "soda";
            if (has("painkiller")) return "painkiller";
        }
        return undefined;
    }

    /**
     * Seconds before the target could shoot the bot, if the bot stayed where it is.
     * 0 means it can shoot now.
     */
    healWindow(target: Player, distance: number, canSee: boolean): number {
        const H = PracticeBotHeal;
        const speed = GameConfig.player.moveSpeed;
        const reach = Math.max(
            0,
            ...[0, 1].map((slot) => {
                const gun = GunDefs[target.weapons[slot]?.type];
                return gun ? BulletDefs[gun.bulletType]?.distance ?? 0 : 0;
            }),
        );
        const sees = viewRadius(target) * PracticeBotView.screenAspect;
        const far = Math.max(0, distance - Math.min(reach, sees)) / speed;
        const peek = canSee ? 0 : this.peekDistance(target) / speed;
        const busy = H.whenTargetBusy
                && (isReloadAction(target.actionType) || target.actionType === GameConfig.Action.UseItem)
            ? Math.max(0, target.action.duration - target.action.time)
            : 0;
        return Math.max(far, peek) + busy;
    }

    /** The item to use within `window` seconds: the wanted one, or a shorter one that does the same job. */
    private itemFor(window: number): PracticeBotItem | undefined {
        const wanted = this.wantedItem();
        if (!wanted) return undefined;
        const fallback: Record<PracticeBotItem, PracticeBotItem[]> = {
            healthkit: ["healthkit", "bandage"],
            bandage: ["bandage"],
            painkiller: ["painkiller", "soda"],
            soda: ["soda"],
        };
        return fallback[wanted].find((item) =>
            this.player.invManager.get(item) > 0
            && useTime(item) + PracticeBotHeal.margin <= window
        );
    }

    /**
     * The nearest spot behind cover where the target would need time for a
     * bandage to see the bot. Undefined when none is within `coverSearch`.
     */
    private findHealCover(target: Player, radius: number): Vec2 | undefined {
        const H = PracticeBotHeal;
        const p = this.player;
        const speed = GameConfig.player.moveSpeed;
        const need = (useTime("bandage") + H.margin) * speed;
        let best: Vec2 | undefined;
        let bestDist = Infinity;
        const near = p.game.grid.intersectCollider(collider.createCircle(p.pos, radius));
        for (const obj of near) {
            if (obj.__type !== ObjectType.Obstacle) continue;
            const o = obj as Obstacle;
            if (!isCover(o, p.layer)) continue;
            const center = obstacleCenter(o);
            const away = v2.normalizeSafe(v2.sub(center, target.pos), v2.create(1, 0));
            const spot = v2.add(center, v2.mul(away, obstacleHalfWidth(o, away) + p.rad + 0.5));
            const walk = v2.distance(p.pos, spot);
            if (walk >= bestDist || walk > radius || nearExplosive(p, spot)) continue;
            // Not inside something else, and really hidden from the target.
            const blocked = p.game.grid.intersectCollider(collider.createCircle(spot, p.rad)).some((other) =>
                other.__type === ObjectType.Obstacle
                && (other as Obstacle).collidable
                && !(other as Obstacle).dead
                && util.sameLayer((other as Obstacle).layer, p.layer)
                && !!collider.intersectCircle((other as Obstacle).collider, spot, p.rad)
            );
            if (blocked || peekDistanceAt(target, spot, p.rad) < need) continue;
            best = spot;
            bestDist = walk;
        }
        return best;
    }

    /** Decide where to walk to heal. Kept for half a second at a time. */
    private updateHealCover(dt: number, target: Player, window: number): void {
        const H = PracticeBotHeal;
        const p = this.player;
        const wanted = this.wantedItem();
        const needsCover = this.settings.shootsBack
            && !this.pushing
            && !this.usingItem
            && p.health <= H.coverAt
            && (wanted === "bandage" || wanted === "healthkit")
            && !this.itemFor(window);
        if (!needsCover) {
            this.healCover = undefined;
            return;
        }
        this.coverTicker -= dt;
        if (this.coverTicker > 0 && this.healCover) return;
        this.coverTicker = 0.5;
        // Against a healthy target it runs: farther for cover, and if there is none, away from you.
        const running = target.health >= H.runFromAt;
        this.healCover = this.findHealCover(target, running ? H.runSearch : H.coverSearch);
        if (!this.healCover && running) {
            // Straight away from you, or turned up to 90 degrees to keep out of a barrel's blast.
            const away = v2.normalizeSafe(v2.sub(p.pos, target.pos), v2.create(1, 0));
            for (const turn of [0, 45, -45, 90, -90]) {
                const back = v2.add(p.pos, v2.mul(v2.rotate(away, math.deg2rad(turn)), H.retreatStep));
                p.game.map.clampToMapBounds(back, 4);
                this.healCover ??= back;
                if (!nearExplosive(p, back)) {
                    this.healCover = back;
                    break;
                }
            }
        }
    }

    /** A spot of the bot's size here touches no solid obstacle. */
    private standable(spot: Vec2): boolean {
        const p = this.player;
        return !p.game.grid.intersectCollider(collider.createCircle(spot, p.rad)).some((other) =>
            other.__type === ObjectType.Obstacle
            && (other as Obstacle).collidable
            && !(other as Obstacle).dead
            && util.sameLayer((other as Obstacle).layer, p.layer)
            && !!collider.intersectCircle((other as Obstacle).collider, spot, p.rad)
        );
    }

    /**
     * The best place to peek from: a hidden spot at one edge of a cover, and the
     * shortest step past that edge that sees the target. Short steps make quick peeks.
     */
    private findPeek(target: Player, reach: number): { cover: Vec2; out: Vec2; from: Vec2 } | undefined {
        const P = PracticeBotPeek;
        const p = this.player;
        let best: { cover: Vec2; out: Vec2; from: Vec2 } | undefined;
        let bestScore = Infinity;
        for (const obj of p.game.grid.intersectCollider(collider.createCircle(p.pos, P.search))) {
            if (obj.__type !== ObjectType.Obstacle) continue;
            const o = obj as Obstacle;
            if (!isCover(o, p.layer)) continue;
            const center = obstacleCenter(o);
            const away = v2.normalizeSafe(v2.sub(center, target.pos), v2.create(1, 0));
            const side = v2.perp(away);
            const behind = v2.add(center, v2.mul(away, obstacleHalfWidth(o, away) + p.rad + 0.5));
            const halfSide = obstacleHalfWidth(o, side);
            for (const sign of [1, -1]) {
                // Hide just inside the edge, so one short step clears it.
                const inset = Math.max(0, halfSide - p.rad - 0.3);
                const cover = v2.add(behind, v2.mul(side, sign * inset));
                const walk = v2.distance(p.pos, cover);
                if (walk > P.search || walk >= bestScore || nearExplosive(p, cover)) continue;
                if (!this.standable(cover) || peekDistanceAt(target, cover, p.rad) < P.hideMin) continue;
                // Step out a little at a time until it sees the target.
                for (let step = 2 * p.rad; step <= halfSide + 2 * p.rad + 3; step += 0.5) {
                    const out = v2.add(cover, v2.mul(side, sign * step));
                    if (!this.standable(out) || peekDistanceAt(target, out, p.rad) > 0) continue;
                    if (!clearShot(p, out, target.pos, P.shotClearance)) continue;
                    const usable = v2.distance(out, target.pos) <= reach
                        && practiceOnScreen(out, target.pos, target)
                        && !nearExplosive(p, out);
                    if (usable) {
                        // A long step costs twice: out and back on every peek.
                        const score = walk + 2 * (step + P.stepOut);
                        if (score < bestScore) {
                            bestScore = score;
                            best = {
                                cover,
                                out: v2.add(cover, v2.mul(side, sign * (step + P.stepOut))),
                                from: v2.copy(target.pos),
                            };
                        }
                    }
                    break;
                }
            }
        }
        return best;
    }

    /** Run the hide, step out, shoot, step back cycle. */
    private updatePeek(dt: number, target: Player, distance: number, canSee: boolean, fired: boolean): void {
        const P = PracticeBotPeek;
        const p = this.player;
        const reach = Math.max(0, ...[0, 1].map((slot) => this.hasGun(slot) ? this.fireRange(p.weapons[slot].type) : 0));
        const wanted = P.enabled && this.settings.shootsBack && !this.pushing && !this.usingItem && !this.healCover
            && distance >= (reach <= PracticeBotView.shotgunRange ? P.shotgunMinDistance : P.minDistance)
            && reach >= distance;
        if (!wanted) {
            this.peek = undefined;
            this.peekOut = false;
            return;
        }
        this.peekTicker -= dt;
        // Cover left far behind (a long chase, a respawn): drop the peek and look again now.
        if (this.peek && v2.distance(p.pos, this.peek.cover) > P.search) {
            this.peekOut = false;
            this.peekTicker = 0;
        }
        if (!this.peekOut && (!this.peek || this.peekTicker <= 0)) {
            this.peekTicker = 0.5;
            // Keep the spot while it is still close, still hides the bot, and its step
            // out still sees you; otherwise look again. A spot planned before you or the
            // bot moved far away would hide it forever and walk it off across the map.
            const peek = this.peek;
            const keep = !!peek
                && v2.distance(p.pos, peek.cover) <= P.search
                && peekDistanceAt(target, peek.cover, p.rad) >= P.hideMin
                && peekDistanceAt(target, peek.out, p.rad) === 0
                && v2.distance(peek.out, target.pos) <= reach;
            if (!keep) this.peek = this.findPeek(target, reach);
        }
        if (!this.peek) {
            this.peekOut = false;
            return;
        }

        if (this.peekOut) {
            this.peekOutFor += dt;
            this.peekSeenFor = canSee ? this.peekSeenFor + dt : 0;
            // Slow guns (bolt-actions, pumps): one shot, then hide while the gun recovers.
            // Faster guns: a short burst.
            const gun = GunDefs[p.weapons[p.curWeapIdx]?.type];
            const slow = !!gun && this.fireDelayOf(p.weapons[p.curWeapIdx].type) >= PracticeBotOverclock.minFireDelay;
            const done = slow ? fired : this.peekSeenFor >= P.burst;
            // Out at its spot (or should be by now) and you are not there: no point
            // standing in the open.
            const arrived = this.peekOutFor >= this.peekStepTime || v2.distance(p.pos, this.peek.out) <= 0.3;
            this.peekBlindFor = arrived && !canSee ? this.peekBlindFor + dt : 0;
            const blind = this.peekBlindFor >= P.giveUp;
            if (done || blind || this.peekOutFor >= P.maxOut || !this.loaded(p.curWeapIdx)) {
                this.peekOut = false;
                // Plan again next tick: you moved, or the spot does not see you.
                if (blind) this.peekTicker = 0;
            }
            return;
        }

        // At cover: step out once the gun will be ready when the bot gets there.
        const atCover = v2.distance(p.pos, this.peek.cover) <= 0.5;
        if (!atCover) return;
        const active = p.curWeapIdx;
        if (active > 1 || !this.loaded(active)) return;
        const step = v2.distance(this.peek.cover, this.peek.out) / GameConfig.player.moveSpeed;
        const reloading = isReloadAction(p.actionType);
        if (reloading && p.weapons[active].ammo <= P.waitReloadAt) return;
        if (p.weapons[active].cooldown > step) return;
        // You moved since it planned this peek: check the step-out spot still sees you.
        if (v2.distance(this.peek.from, target.pos) > P.replanMove) {
            const next = this.findPeek(target, reach);
            if (!next) return;
            this.peek = next;
            if (v2.distance(p.pos, next.cover) > 0.5) return;
        }
        this.peekOut = true;
        this.peekOutFor = 0;
        this.peekSeenFor = 0;
        this.peekBlindFor = 0;
        this.peekStepTime = v2.distance(p.pos, this.peek.out) / GameConfig.player.moveSpeed;
    }

    /**
     * Start, keep or drop a heal or boost item.
     * @param reloadSlot the gun the reload rules want reloaded now, if any
     * @returns true while an item is in use; the bot then leaves its weapons alone
     */
    private updateItem(distance: number, target: Player, canSee: boolean, reloadSlot: number | undefined): boolean {
        const H = PracticeBotHeal;
        const p = this.player;
        if (!this.settings.shootsBack) return false;
        const window = this.healWindow(target, distance, canSee);

        if (this.usingItem) {
            const left = p.action.duration - p.action.time;
            const hit = this.sinceHit === 0;
            if (hit || this.pushing || (window <= 0 && left > H.finishIfLeft)) p.cancelAction();
            return this.usingItem;
        }
        if (this.pushing || this.sinceHit < H.hitDelay) return false;
        // You reloading or healing in its sight and reach: it punishes that instead.
        const targetBusy = isReloadAction(target.actionType) || target.actionType === GameConfig.Action.UseItem;
        const canShoot = [0, 1].some((slot) => this.loaded(slot) && distance <= this.fireRange(p.weapons[slot].type));
        if (canSee && targetBusy && canShoot) return false;
        const item = this.itemFor(window);
        if (!item) return false;

        const heal = item === "bandage" || item === "healthkit";
        const urgent = heal && p.health <= H.urgentAt;
        const noneLoaded = !this.loaded(0) && !this.loaded(1);
        const emptyReload = reloadSlot !== undefined && p.weapons[reloadSlot].ammo === 0;
        // A gun that can shoot comes before anything; adrenaline comes after every reload.
        if (noneLoaded && emptyReload) return false;
        if (emptyReload && !urgent) return false;
        // Just out of sight: unless it is urgent, give the reload rules their moment first.
        if (!urgent && !canSee && this.unseenFor < PracticeBotReload.safeDelay) return false;
        if (!heal && reloadSlot !== undefined) return false;

        if (heal) p.useHealingItem(item);
        else p.useBoostItem(item);
        return this.usingItem;
    }

    get meleeReach(): number {
        const def = MeleeDefs[this.player.weapons[GameConfig.WeaponSlot.Melee].type];
        return def ? v2.length(def.attack.offset) + def.attack.rad : 0;
    }

    /** Seconds between shots of this gun in this game (Practice timing profile applied). */
    private fireDelayOf(type: string): number {
        return this.player.game.gunTiming?.fireDelays[type] ?? GunDefs[type]?.fireDelay ?? 0;
    }

    /** Seconds to draw this gun on a switch that is not free, in this game. */
    private drawTime(type: string): number {
        return (GunDefs[type]?.switchDelay ?? 0) * (this.player.game.gunTiming?.switchDelayMult ?? 1);
    }

    private loaded(slot: number): boolean {
        const weapon = this.player.weapons[slot];
        return !!GunDefs[weapon.type] && weapon.ammo > 0;
    }

    private switchDelay(slot: number): number {
        const p = this.player;
        const next = GunDefs[p.weapons[slot].type];
        const current = GunDefs[p.weaponManager.activeWeapon];
        if (!next) return Infinity;
        if (current?.deployGroup && current.deployGroup === next.deployGroup) return next.switchDelay;
        return p.freeSwitchTimer < 0 ? GameConfig.player.baseSwitchDelay : this.drawTime(p.weapons[slot].type);
    }

    /** Close enough to shoot this gun, or to step in and shoot it. */
    private reaches(slot: number, distance: number): boolean {
        return distance <= this.fireRange(this.player.weapons[slot].type) * PracticeBotReload.reachSlack;
    }

    /** The target is inside this gun's fire range right now. */
    private inFireRange(slot: number, distance: number): boolean {
        return !PracticeBotRange.drawOnlyInRange || distance <= this.fireRange(this.player.weapons[slot].type);
    }

    private hasGun(slot: number): boolean {
        return !!GunDefs[this.player.weapons[slot].type];
    }

    private clip(slot: number): number {
        const type = this.player.weapons[slot].type;
        return this.player.weaponManager.getAmmoStats(GunDefs[type], type).maxClip;
    }

    /** Seconds of reloading until this gun has a round more than now. */
    private reloadTime(slot: number, asIfEmpty = false): number {
        const p = this.player;
        const weapon = p.weapons[slot];
        const gun = GunDefs[weapon.type];
        if (!asIfEmpty && slot === p.curWeapIdx && isReloadAction(p.actionType) && p.actionItem === weapon.type) {
            return Math.max(0, p.action.duration - p.action.time);
        }
        // Bots carry endless ammo, so an empty gun always gets its full-clip reload.
        return (asIfEmpty || weapon.ammo === 0) && gun.reloadTimeAlt ? gun.reloadTimeAlt : gun.reloadTime;
    }

    /** Seconds until this gun could have a fresh round in: draw it if needed, then reload. */
    private timeToRound(slot: number): number {
        return (slot === this.player.curWeapIdx ? 0 : this.switchDelay(slot)) + this.reloadTime(slot);
    }

    /** Which gun to reload right now, if any. See PracticeBotReload. */
    private planReload(distance: number, target: Player): number | undefined {
        const R = PracticeBotReload;
        const p = this.player;
        const active = p.curWeapIdx;
        const ammo = (slot: number) => p.weapons[slot].ammo;
        const guns = [0, 1].filter((slot) => this.hasGun(slot));
        const empty = guns.filter((slot) => ammo(slot) === 0);
        const quickest = (slots: number[]) =>
            slots.reduce((best, slot) => {
                const d = this.timeToRound(slot) - this.timeToRound(best);
                return d < 0 || (d === 0 && slot === active) ? slot : best;
            });

        let want: number | undefined;
        if (this.unseenFor >= R.safeDelay) {
            // Safe: empty guns first, then top up (the gun in hand first, to save a switch).
            const partial = guns.filter((slot) => ammo(slot) > 0 && ammo(slot) < this.clip(slot));
            if (empty.length) want = quickest(empty);
            else if (partial.length) want = partial.includes(active) ? active : partial[0];
        } else if (empty.length && empty.length === guns.length) {
            // Nothing loaded: get a round in as fast as possible.
            want = quickest(empty);
        } else if (empty.length === 1) {
            const e = empty[0];
            const l = guns.find((slot) => slot !== e)!;
            const outOfReach = R.whenOutOfReach && !this.reaches(l, distance);
            const targetBusy = R.whenTargetBusy
                && (isReloadAction(target.actionType) || target.actionType === GameConfig.Action.UseItem);
            const low = R.whenLow && this.clip(l) >= R.lowMinClip && ammo(l) <= R.lowRounds
                && this.timeToRound(e) + R.lowQuickerBy <= this.reloadTime(l, true);
            if (outOfReach || targetBusy || low) want = e;
        }

        if (want !== undefined) {
            this.finishAmmo = undefined;
            return want;
        }
        // The reason is gone. Still finish a reload that is nearly done.
        if (
            this.reloadSlot === active && active < 2 && isReloadAction(p.actionType)
            && this.reloadTime(active) <= R.finishIfLeft
            && (this.finishAmmo === undefined || this.finishAmmo === ammo(active))
        ) {
            this.finishAmmo = ammo(active);
            return active;
        }
        this.finishAmmo = undefined;
        return undefined;
    }

    /** Put the gun away and draw `slot` after `wait` seconds (at least one tick). Ends the slow walk after a shot. */
    private holster(slot: number, dt: number, wait = 0): void {
        this.player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
        this.returnSlot = slot;
        this.returnWait = Math.max(dt, PracticeBotOverclock.holsterTime, wait);
    }

    /**
     * Right after a shot with a slow gun: plan the switches that fire the next
     * `PracticeBotOverclock.lookahead` shots soonest, with the bot at full speed,
     * by the game's real switch rules:
     *
     * - Swap straight to the other gun: the free switch (0.25 s, once per 1 s)
     *   if it is ready, else the gun's draw time; between two guns of one
     *   switch group, always the full draw time.
     * - Holster to melee and draw a gun back, at once or the moment the free
     *   switch is ready. Holstering with the free switch ready spends it.
     *   Going through melee also avoids the switch-group rule.
     *
     * A switch sets the drawn gun's wait to the switch delay, so only the
     * gun drawn and the free-switch timer matter between shots. Waiting with
     * the gun in hand keeps the bot at half speed, so it is an option only with
     * `cancelSlowdown` off, or when every switch costs more than
     * `maxCancelCost` over waiting.
     * @returns true if it switched
     */
    private planSwitch(dt: number, distance: number): boolean {
        const O = PracticeBotOverclock;
        const p = this.player;
        const base = GameConfig.player.baseSwitchDelay;
        const cooldown = GameConfig.player.freeSwitchCooldown;
        const away = Math.max(dt, O.holsterTime);
        const guns = [0, 1].filter((slot) => this.loaded(slot) && this.inFireRange(slot, distance));
        const type = (slot: number) => p.weapons[slot].type;
        const preferred = this.preferredGun(distance);

        type Move = { at: number; slot: number; timer: number; back?: number };
        /** Ways to the next shot from a shot with `from`, the free-switch timer at `timer`. */
        const moves = (from: number, timer: number, wait: number): Move[] => {
            const out: Move[] = [];
            const fromDef = GunDefs[type(from)];
            for (const slot of guns) {
                const def = GunDefs[type(slot)];
                const draw = this.drawTime(type(slot));
                if (slot !== from) {
                    const sameGroup = !!fromDef?.deployGroup && fromDef.deployGroup === def.deployGroup;
                    const cost = sameGroup ? def.switchDelay : timer < 0 ? base : draw;
                    const after = timer < 0 ? cooldown : timer;
                    out.push({ at: cost + dt, slot, timer: after - cost - dt });
                }
                const held = timer < 0 ? cooldown : timer;
                for (const back of [away, Math.max(away, held + dt)]) {
                    const free = held - back < 0;
                    const cost = free ? base : draw;
                    const after = free ? cooldown : held - back;
                    out.push({ at: back + cost, slot, timer: after - cost, back });
                }
            }
            if (!O.cancelSlowdown) out.push({ at: wait, slot: from, timer: timer - wait });
            return out;
        };
        /** Least time to fire `shots` more shots. */
        const cost = (from: number, timer: number, shots: number): number => {
            if (shots === 0) return 0;
            let best = Infinity;
            for (const m of moves(from, timer, GunDefs[type(from)]?.fireDelay ?? 0)) {
                best = Math.min(best, m.at + cost(m.slot, m.timer, shots - 1));
            }
            return best;
        };

        const active = p.curWeapIdx;
        const stay = p.weapons[active].cooldown;
        const first = moves(active, p.freeSwitchTimer, stay)
            .filter((m) => m.back !== undefined || m.slot !== active || !O.cancelSlowdown)
            .filter((m) => m.at <= stay + O.maxCancelCost || !O.cancelSlowdown);
        if (!first.length) return false;
        // Soonest over the next shots; on a near tie, the gun that suits this distance.
        const score = (m: Move) =>
            m.at + cost(m.slot, m.timer, O.lookahead - 1) + (m.slot === preferred ? 0 : 0.02);
        const best = first.reduce((a, b) => score(b) < score(a) ? b : a);
        if (best.back === undefined && best.slot === active) return false;
        if (best.back === undefined) {
            p.weaponManager.setCurWeapIndex(best.slot);
            this.committedSlot = best.slot;
        } else {
            this.holster(best.slot, dt, best.back);
        }
        return true;
    }

    private preferredGun(distance: number): number {
        const loaded = [0, 1].filter((slot) => this.loaded(slot));
        if (!loaded.length) return this.player.curWeapIdx < 2 ? this.player.curWeapIdx : 0;
        const score = (slot: number) => {
            const gun = GunDefs[this.player.weapons[slot].type];
            if (gun.bulletCount > 1) return distance < 12 ? 3 : distance < 20 ? 1 : 0;
            if (this.fireDelayOf(this.player.weapons[slot].type) >= 0.5) return distance > 24 ? 3 : 1;
            return 2;
        };
        // A gun that reaches always beats one that does not.
        const rank = (slot: number) => score(slot) + (this.inFireRange(slot, distance) ? 10 : 0);
        return loaded.reduce((best, slot) => rank(slot) > rank(best) ? slot : best);
    }

    /**
     * @param canAttack the bot sees the target and may shoot now (reaction time is over)
     * @param canSee the bot has line of sight to the target
     */
    update(dt: number, target: Player, canAttack: boolean, canSee = canAttack): void {
        const p = this.player;
        this.unseenFor = canSee ? 0 : this.unseenFor + dt;
        this.sinceHit = p.health < this.lastHealth ? 0 : this.sinceHit + dt;
        this.lastHealth = p.health;
        this.pushing = this.settings.shootsBack && !target.dead && !target.downed && this.wantsPush(target);
        const active = p.curWeapIdx;
        const fired = active < 2 && p.weapons[active].ammo < this.lastAmmo[active];
        this.lastAmmo = p.weapons.slice(0, 2).map((w) => w.ammo);
        if (fired) this.committedSlot = undefined;
        if (!canAttack) this.committedSlot = undefined;

        const distance = v2.distance(p.pos, target.pos);
        const melee = MeleeDefs[p.weapons[GameConfig.WeaponSlot.Melee].type];
        const windup = melee?.attack.damageTimes[0] ?? 0;
        const futureSelf = v2.add(p.pos, v2.mul(p.moveVel, windup));
        const futureTarget = v2.add(target.pos, v2.mul(target.moveVel, windup));
        const reach = this.meleeReach + target.rad - 0.2;
        this.meleeEngaged = this.settings.autoMelee && canAttack && !!melee
            && distance <= reach + (this.meleeEngaged ? 0.5 : 0)
            && v2.distance(futureSelf, futureTarget) <= reach;
        // Do not cancel a swing before its scheduled damage has landed.
        if (active === GameConfig.WeaponSlot.Melee && p.weaponManager.meleeAttacks.length) return;
        if (this.meleeEngaged) {
            this.returnSlot = undefined;
            this.committedSlot = undefined;
            this.reloadSlot = undefined;
            p.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
            return;
        }

        if (this.returnSlot !== undefined) {
            this.returnWait -= dt;
            if (this.returnWait > 0) return;
            p.weaponManager.setCurWeapIndex(this.returnSlot);
            this.committedSlot = this.returnSlot;
            this.returnSlot = undefined;
            return;
        }

        const gun = GunDefs[p.weaponManager.activeWeapon];
        // A real shot leaves the gun on cooldown; a clip changed by hand does not.
        const slowShot = fired && p.weapons[active].cooldown > 0 && this.settings.quickSwitch
            && this.fireDelayOf(p.weaponManager.activeWeapon) >= PracticeBotOverclock.minFireDelay
            && gun.fireMode !== "burst";

        this.reloadSlot = this.planReload(distance, target);
        const using = this.updateItem(distance, target, canSee, this.reloadSlot);
        this.updateHealCover(dt, target, this.healWindow(target, distance, canSee));
        this.updatePeek(dt, target, distance, canSee, fired);
        // Out on a peek with a loaded gun: shoot now. The shot cancels any reload, as for a player.
        if (this.peekOut && active < 2 && this.loaded(active)) this.reloadSlot = undefined;
        if (using) {
            // Any swap or reload would cancel the item.
            this.reloadSlot = undefined;
            this.committedSlot = undefined;
            return;
        }
        if (this.reloadSlot !== undefined) {
            this.committedSlot = undefined;
            if (active !== this.reloadSlot) {
                p.weaponManager.setCurWeapIndex(this.reloadSlot);
            } else if (slowShot && PracticeBotOverclock.cancelSlowdown) {
                // Reloading the gun it just fired: shed the slow walk first.
                this.holster(active, dt);
            }
            return;
        }

        if (slowShot && canAttack && p.actionType === GameConfig.Action.None && this.planSwitch(dt, distance)) {
            return;
        }
        const usable = active < 2 && this.loaded(active) && this.inFireRange(active, distance);
        if (this.committedSlot === active && usable) return;
        // Out on a peek with a gun ready to fire: shoot it. A swap now would add a draw in the open.
        if (this.peekOut && usable && p.weapons[active].cooldown <= 0) return;
        if (p.actionType !== GameConfig.Action.None && active < 2 && this.loaded(active)) return;
        if (!usable || p.weapons[active].cooldown <= 0) {
            p.weaponManager.setCurWeapIndex(this.preferredGun(distance));
        }
    }

    aimPoint(target: Player): Vec2 {
        const p = this.player;
        if (this.meleeEngaged || p.curWeapIdx === GameConfig.WeaponSlot.Melee) {
            const melee = MeleeDefs[p.weapons[GameConfig.WeaponSlot.Melee].type];
            const windup = Math.max(0, p.weaponManager.meleeAttacks[0] ?? melee?.attack.damageTimes[0] ?? 0);
            return v2.add(target.pos, v2.mul(v2.sub(target.moveVel, p.moveVel), windup));
        }
        const gun = GunDefs[p.weaponManager.activeWeapon];
        const bullet = gun && BulletDefs[gun.bulletType];
        return bullet
            ? practiceInterceptPoint(
                p.pos,
                target.pos,
                target.moveVel,
                bullet.speed,
                gun.barrelLength,
                bullet.distance / bullet.speed,
            )
            : v2.copy(target.pos);
    }

    fire(ready: boolean): void {
        const p = this.player;
        p.shootHold = p.shootStart = false;
        if (this.returnSlot !== undefined) return;
        // A shot cancels a reload, so a loaded gun may fire mid-reload. Other actions are left alone.
        const reloadingGun = isReloadAction(p.actionType) && p.curWeapIdx < 2;
        if (p.actionType !== GameConfig.Action.None && !reloadingGun) return;
        if (p.curWeapIdx === GameConfig.WeaponSlot.Melee) {
            p.shootHold = p.shootStart = ready && this.meleeEngaged;
        } else if (p.curWeapIdx < 2) {
            if (this.reloadSlot === p.curWeapIdx || !this.loaded(p.curWeapIdx)) {
                p.weaponManager.tryReload();
                return;
            }
            p.shootHold = ready;
            p.shootStart = ready && GunDefs[p.weaponManager.activeWeapon]?.fireMode !== "auto";
        }
    }
}
