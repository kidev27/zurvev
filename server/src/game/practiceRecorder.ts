import { MeleeDefs } from "../../../shared/defs/gameObjects/meleeDefs.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import type { PracticeSettings } from "../../../shared/practice.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { v2 } from "../../../shared/utils/v2.ts";
import { Config } from "../config.ts";
import type { DamageParams } from "./objects/gameObject.ts";
import type { Obstacle } from "./objects/obstacle.ts";
import type { Player } from "./objects/player.ts";
import type { Projectile } from "./objects/projectile.ts";
import {
    obstacleBlastRadius,
    PracticeObservationFields,
    PracticeObservationVersion,
    practiceObserve,
} from "./practiceObservation.ts";
import { practiceOnScreen, practicePeekDistance } from "./practiceCombat.ts";

/**
 * Anonymous Practice recordings for training bots on how people play: movement, aim, shooting,
 * swaps, reloads, heals, grenades, cover, barrels and doors. Off unless `practiceRecording.enabled`.
 *
 * Each game writes one gzip'd JSON-lines file (docs/practice-recordings.md). The header holds the
 * map; every sample row holds the raw world (you, every bot, grenades, bullets, map changes), a
 * ready-made feature vector, your input and what happened. Rows hold no names, account ids or
 * IPs: players are numbered 1, 2, ... within the game.
 *
 * Bump PracticeRecordVersion whenever a row's layout changes.
 */
export const PracticeRecordVersion = 2;

export const PracticeRecordTuning = {
    /** Seconds between sample rows per player (10 per second). */
    interval: 0.1,
    /** Rows buffered before they are handed to the file writer. */
    flushRows: 600,
    /** A game stops recording after this many sample rows (6 hours at 10 per second). */
    maxRows: 216_000,
    /** Decimals kept in numbers. */
    decimals: 3,
    /** Bullets in the raw world: only those within this many units of you... */
    bulletRange: 40,
    /** ...and at most this many, nearest first. */
    maxBullets: 40,
};

const R = PracticeRecordTuning;

/** Column names of the raw arrays, written into the header so training code needn't hard-code them. */
export const PracticeRecordLayouts = {
    obstacle: "type, layer, shape (0 circle: x, y, r | 1 box: minX, minY, maxX, maxY), height, collidable, "
        + "destructible, blast radius, flags (1 door, 2 window, 4 wall, 8 tree, 16 bush)",
    building: ["type", "x", "y", "ori", "layer"],
    bot: [
        "id",
        "x",
        "y",
        "vel_x",
        "vel_y",
        "dir_x",
        "dir_y",
        "health",
        "boost",
        "layer",
        "slot",
        "weapon",
        "ammo",
        "action",
        "on_screen",
        "clear_shot",
    ],
    projectile: ["type", "owner", "x", "y", "z", "vel_x", "vel_y", "fuse_left", "layer"],
    bullet: ["owner", "x", "y", "vel_x", "vel_y", "layer"],
    change: ["obstacle", "dead", "health", "door_open"],
    hit: ["ms", "hit_in | hit_out", "amount", "kind", "weapon", "map_source", "from | to"],
    cause: ["kind", "weapon", "map_source", "from"],
};

/** One chunk of a recording, in order. `final` is set on the last chunk of a game. */
export interface PracticeRecordChunk {
    id: string;
    lines: string[];
    final: boolean;
}

/** What the recorder needs from the game. */
interface RecordGame {
    readonly mapName: string;
    readonly map: {
        readonly width: number;
        readonly height: number;
        readonly obstacles: Obstacle[];
        readonly buildings: ReadonlyArray<{ type: string; pos: { x: number; y: number }; ori: number; layer: number }>;
        readonly riverDescs: unknown[];
    };
    readonly projectileBarn: { readonly projectiles: Projectile[] };
    readonly bulletBarn: {
        readonly bullets: ReadonlyArray<{
            alive: boolean;
            playerId: number;
            layer: number;
            pos: { x: number; y: number };
            dir: { x: number; y: number };
            speed: number;
        }>;
    };
    recordPractice(chunk: PracticeRecordChunk): void;
}

/** What the recorder needs from Practice. */
export interface PracticeRecordHost {
    readonly game: RecordGame;
    readonly settings: PracticeSettings;
    readonly started: boolean;
    /** Living bots the human fights. */
    enemiesOf(player: Player): Player[];
    /** Practice stats for the summary row. */
    statsSummary(player: Player): object;
}

/** The last damage someone took: [kind, weapon or source, map object, from]. */
type HitInfo = [string, string, string, string];

/** Per-player state between two sample rows. */
interface Track {
    id: number;
    nextSample: number;
    lastSampleAt: number;
    dead: boolean;
    slot: number;
    action: number;
    item: string;
    scope: string;
    anim: number;
    /** [ms since the last row, kind, ...values] */
    events: Array<Array<string | number>>;
    shots: number;
    dealt: number;
    taken: number;
    kills: number;
    lastHit?: HitInfo;
}

const round = (v: number) => {
    const f = 10 ** R.decimals;
    return Math.round(v * f) / f;
};
const r2 = (p: { x: number; y: number }) => [round(p.x), round(p.y)];

function randomId(): string {
    let s = "";
    for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
}

/** Movement keys (or the touch stick) as a vector; y is up, as in the game. */
function moveInput(p: Player): [number, number] {
    if (p.touchMoveActive && p.touchMoveLen) return [p.touchMoveDir.x, p.touchMoveDir.y];
    let x = 0;
    let y = 0;
    if (p.moveUp) y++;
    if (p.moveDown) y--;
    if (p.moveLeft) x--;
    if (p.moveRight) x++;
    if (x && y) {
        x *= Math.SQRT1_2;
        y *= Math.SQRT1_2;
    }
    return [x, y];
}

/** What kind of damage this was. */
function damageKind(params: DamageParams): string {
    if (params.isExplosion) return "explosion";
    switch (params.damageType) {
        case GameConfig.DamageType.Player:
            return params.gameSourceType && MeleeDefs[params.gameSourceType] ? "melee" : "bullet";
        case GameConfig.DamageType.Bleeding:
            return "bleeding";
        case GameConfig.DamageType.Gas:
            return "gas";
        default:
            return "other";
    }
}

/**
 * The map, once per file. Obstacle i in later rows is index i here.
 * Obstacle: [type, layer, shape, ...collider, height, collidable, destructible, blast, flags]
 * where shape 0 is a circle (x, y, r) and 1 a box (minX, minY, maxX, maxY), and flags are
 * 1 door, 2 window, 4 wall, 8 tree, 16 bush.
 */
function mapSnapshot(game: RecordGame): object {
    const obstacles = game.map.obstacles.map((o) => {
        const c = o.collider;
        const shape = c.type === collider.Type.Circle
            ? [0, ...r2(c.pos), round(c.rad)]
            : [1, ...r2(c.min), ...r2(c.max)];
        const flags = (o.isDoor ? 1 : 0) | (o.isWindow ? 2 : 0) | (o.isWall ? 4 : 0) | (o.isTree ? 8 : 0)
            | (/bush/.test(o.type) ? 16 : 0);
        return [
            o.type,
            o.layer,
            ...shape,
            round(o.height),
            o.collidable ? 1 : 0,
            o.destructible ? 1 : 0,
            round(obstacleBlastRadius(o)),
            flags,
        ];
    });
    return {
        width: game.map.width,
        height: game.map.height,
        obstacles,
        buildings: game.map.buildings.map((b) => [b.type, ...r2(b.pos), b.ori, b.layer]),
        rivers: game.map.riverDescs,
    };
}

export class PracticeRecorder {
    /** A recorder for this game, or undefined when recording is off or this game was not sampled. */
    static create(host: PracticeRecordHost): PracticeRecorder | undefined {
        const cfg = Config.practiceRecording;
        if (!cfg?.enabled) return undefined;
        if (Math.random() >= (cfg.sampleRate ?? 1)) return undefined;
        return new PracticeRecorder(host);
    }

    readonly id = randomId();
    private readonly tracks = new Map<Player, Track>();
    /** Bots get numbers in the order they first appear. */
    private readonly botIds = new Map<Player, number>();
    private readonly botLastHit = new Map<Player, HitInfo>();
    /** Projectiles already seen (to catch throws as they leave the hand). */
    private readonly seenProjectiles = new WeakSet<Projectile>();
    /** Obstacle state at the last row: dead, health, door open. */
    private obstacleState: Array<[number, number, number]> = [];
    private lines: string[] = [];
    private clock = 0;
    private rows = 0;
    private headerWritten = false;
    private finished = false;

    constructor(readonly host: PracticeRecordHost) {}

    get stopped(): boolean {
        return this.finished || this.rows >= R.maxRows;
    }

    private push(row: object): void {
        if (!this.headerWritten) {
            this.headerWritten = true;
            this.lines.push(JSON.stringify({
                t: "hdr",
                v: PracticeRecordVersion,
                obsV: PracticeObservationVersion,
                fields: PracticeObservationFields,
                map: this.host.game.mapName,
                protocol: GameConfig.protocolVersion,
                interval: R.interval,
                day: new Date().toISOString().slice(0, 10),
                layouts: PracticeRecordLayouts,
                world: mapSnapshot(this.host.game),
            }));
            this.obstacleState = this.host.game.map.obstacles.map((o) => this.stateOf(o));
        }
        this.lines.push(JSON.stringify(row));
        if (this.lines.length >= R.flushRows) this.flush(false);
    }

    private flush(final: boolean): void {
        if (!this.lines.length && !final) return;
        const lines = this.lines;
        this.lines = [];
        this.host.game.recordPractice({ id: this.id, lines, final });
    }

    private track(player: Player): Track {
        let t = this.tracks.get(player);
        if (!t) {
            t = {
                id: this.tracks.size + 1,
                nextSample: this.clock,
                lastSampleAt: this.clock,
                dead: player.dead,
                slot: player.curWeapIdx,
                action: player.actionType,
                item: player.actionItem,
                scope: player.scope,
                anim: player.animType,
                events: [],
                shots: 0,
                dealt: 0,
                taken: 0,
                kills: 0,
            };
            this.tracks.set(player, t);
        }
        return t;
    }

    private botId(bot: Player): number {
        let id = this.botIds.get(bot);
        if (id === undefined) {
            id = this.botIds.size + 1;
            this.botIds.set(bot, id);
        }
        return id;
    }

    private event(t: Track, kind: string, ...values: Array<string | number>): void {
        t.events.push([Math.round((this.clock - t.lastSampleAt) * 1000), kind, ...values]);
    }

    /** The player sent a new setup: bots and their guns, your kit, quick-switch mode, respawns. */
    onSettings(player: Player): void {
        if (this.stopped) return;
        this.push({ t: "set", at: round(this.clock), p: this.track(player).id, settings: this.host.settings });
    }

    onShot(player: Player): void {
        if (!this.stopped) this.track(player).shots++;
    }

    /**
     * Every damage event in the game. Recorded when a human takes it (from anything: bots,
     * barrels, their own grenade) or causes it to a bot (bullets, grenades, a barrel they shot).
     */
    onDamage(target: Player, params: DamageParams, amount: number): void {
        if (this.stopped || amount <= 0) return;
        const source = params.source?.__type === ObjectType.Player ? (params.source as Player) : undefined;
        const credit = params.killCreditSource ?? source;
        const kind = damageKind(params);
        const weapon = params.gameSourceType ?? params.weaponSourceType ?? "";
        const mapSource = params.mapSourceType ?? "";

        if (!target.specOpsAi) {
            const t = this.track(target);
            let from = "player";
            if (!credit) from = "none";
            else if (credit === target) from = "self";
            else if (credit.specOpsAi) from = `bot${this.botId(credit)}`;
            t.taken += amount;
            t.lastHit = [kind, weapon, mapSource, from];
            this.event(t, "hit_in", round(amount), kind, weapon, mapSource, from);
            return;
        }

        const bot = `bot${this.botId(target)}`;
        this.botLastHit.set(target, [kind, weapon, mapSource, credit && !credit.specOpsAi ? "player" : "none"]);
        if (credit && !credit.specOpsAi) {
            const t = this.track(credit);
            t.dealt += amount;
            this.event(t, "hit_out", round(amount), kind, weapon, mapSource, bot);
        }
    }

    onKill(human: Player): void {
        if (!this.stopped) this.track(human).kills++;
    }

    /** A bot died (any cause); written as an event on every human's next row. */
    onBotDied(bot: Player): void {
        if (this.stopped) return;
        const hit = this.botLastHit.get(bot) ?? ["other", "", "", "none"];
        for (const t of this.tracks.values()) this.event(t, "bot_died", `bot${this.botId(bot)}`, ...hit);
        this.botLastHit.delete(bot);
    }

    /**
     * Called every game tick with the humans in the game. Events (swaps, reloads, items, scope,
     * throws, melee) are caught every tick so a quick switch between two rows is not lost; rows
     * are written every `interval` seconds.
     */
    update(dt: number, humans: readonly Player[]): void {
        this.clock += dt;
        if (this.stopped || !this.host.started) return;
        this.catchThrows(humans);
        for (const p of humans) {
            const t = this.track(p);
            if (p.dead) {
                if (!t.dead) {
                    t.dead = true;
                    // The events and damage since the last row (the fatal hit, a last throw) go here.
                    const cause = t.lastHit ?? ["other", "", "", "none"];
                    this.push({
                        t: "ep",
                        at: round(this.clock),
                        p: t.id,
                        kind: "death",
                        cause,
                        ev: t.events,
                        r: { dealt: round(t.dealt), taken: round(t.taken), kills: t.kills },
                    });
                    this.resetSince(t);
                }
                continue;
            }
            if (t.dead) {
                t.dead = false;
                t.nextSample = this.clock;
                this.resetSince(t);
                t.lastHit = undefined;
                // Respawning re-equips you: take the new state as the baseline, not as swaps.
                t.slot = p.curWeapIdx;
                t.action = p.actionType;
                t.item = p.actionItem;
                t.anim = p.animType;
                t.scope = p.scope;
                this.push({ t: "ep", at: round(this.clock), p: t.id, kind: "spawn" });
            }
            this.catchEvents(p, t);
            if (this.clock + 1e-9 >= t.nextSample) this.sample(p, t);
        }
    }

    /** New grenades (and other thrown things) leaving a human's hand. */
    private catchThrows(humans: readonly Player[]): void {
        for (const proj of this.host.game.projectileBarn.projectiles) {
            if (this.seenProjectiles.has(proj)) continue;
            this.seenProjectiles.add(proj);
            const thrower = humans.find((h) => h.__id === proj.playerId);
            if (!thrower) continue;
            const t = this.track(thrower);
            this.event(t, "throw", proj.type, round(proj.vel.x), round(proj.vel.y), round(proj.fuseTime));
        }
    }

    private catchEvents(p: Player, t: Track): void {
        if (p.curWeapIdx !== t.slot) {
            t.slot = p.curWeapIdx;
            this.event(t, "swap", t.slot);
        }
        if (p.actionType !== t.action || (p.actionType === GameConfig.Action.UseItem && p.actionItem !== t.item)) {
            t.action = p.actionType;
            t.item = p.actionItem;
            if (p.actionType === GameConfig.Action.Reload || p.actionType === GameConfig.Action.ReloadAlt) {
                this.event(t, "reload", p.curWeapIdx);
            } else if (p.actionType === GameConfig.Action.UseItem) {
                this.event(t, "item", p.actionItem);
            } else if (p.actionType === GameConfig.Action.None) {
                this.event(t, "action_end", 0);
            }
        }
        if (p.animType !== t.anim) {
            t.anim = p.animType;
            if (p.animType === GameConfig.Anim.Melee) this.event(t, "melee", p.activeWeapon);
            else if (p.animType === GameConfig.Anim.Cook) this.event(t, "cook", p.activeWeapon);
        }
        if (p.scope !== t.scope) {
            t.scope = p.scope;
            this.event(t, "scope", t.scope);
        }
    }

    private stateOf(o: Obstacle): [number, number, number] {
        return [o.dead ? 1 : 0, round(o.healthT), o.door?.open ? 1 : 0];
    }

    /** Obstacles that broke, took damage or opened/closed since the last row: [index, dead, health, open]. */
    private obstacleChanges(): number[][] {
        const out: number[][] = [];
        const obstacles = this.host.game.map.obstacles;
        for (let i = 0; i < obstacles.length; i++) {
            const now = this.stateOf(obstacles[i]);
            const was = this.obstacleState[i];
            if (was && was[0] === now[0] && was[1] === now[1] && was[2] === now[2]) continue;
            this.obstacleState[i] = now;
            out.push([i, ...now]);
        }
        return out;
    }

    /** Everything around the player, raw, for training code to turn into its own features. */
    private world(p: Player): object {
        const weapons = p.weapons.map((w) => [w.type, w.ammo]);
        const inv: Record<string, number> = {};
        for (const [item, n] of Object.entries(p.invManager.items)) if (n) inv[item] = n;
        const bots = this.host.enemiesOf(p).map((b) => {
            const peek = practicePeekDistance(p, b);
            return [
                this.botId(b),
                ...r2(b.pos),
                ...r2(b.moveVel),
                ...r2(b.dir),
                round(b.health),
                round(b.boost),
                b.layer,
                b.curWeapIdx,
                b.activeWeapon,
                b.weapons[b.curWeapIdx]?.ammo ?? 0,
                b.actionType,
                practiceOnScreen(p.pos, b.pos, p) ? 1 : 0,
                peek === 0 ? 1 : 0,
            ];
        });
        const projectiles = this.host.game.projectileBarn.projectiles.filter((q) => !q.destroyed).map((q) => [
            q.type,
            q.playerId === p.__id ? "self" : this.botFromId(q.playerId),
            ...r2(q.pos),
            round(q.posZ),
            ...r2(q.vel),
            round(q.fuseTime),
            q.layer,
        ]);
        const bullets: Array<[number, Array<string | number>]> = [];
        for (const b of this.host.game.bulletBarn.bullets) {
            if (!b.alive) continue;
            const dist = v2.distance(b.pos, p.pos);
            if (dist > R.bulletRange) continue;
            bullets.push([dist, [
                b.playerId === p.__id ? "self" : this.botFromId(b.playerId),
                ...r2(b.pos),
                round(b.dir.x * b.speed),
                round(b.dir.y * b.speed),
                b.layer,
            ]]);
        }
        bullets.sort((a, b) => a[0] - b[0]);
        return {
            self: {
                pos: r2(p.pos),
                vel: r2(p.moveVel),
                dir: r2(p.dir),
                health: round(p.health),
                boost: round(p.boost),
                layer: p.layer,
                indoors: p.indoors ? 1 : 0,
                slot: p.curWeapIdx,
                weapons,
                inv,
                action: [p.actionType, p.actionItem, round(Math.max(0, p.action.duration - p.action.time))],
                cook: p.weaponManager.cookingThrowable ? round(p.weaponManager.cookTicker) : 0,
                scope: p.scope,
                gear: [p.helmet, p.chest, p.backpack],
            },
            bots,
            projectiles,
            bullets: bullets.slice(0, R.maxBullets).map((b) => b[1]),
            changes: this.obstacleChanges(),
        };
    }

    private botFromId(id: number): string {
        for (const [bot, n] of this.botIds) if (bot.__id === id) return `bot${n}`;
        return "other";
    }

    /** Start collecting events and outcomes for the next row. */
    private resetSince(t: Track): void {
        t.events = [];
        t.shots = 0;
        t.dealt = 0;
        t.taken = 0;
        t.kills = 0;
        t.lastSampleAt = this.clock;
    }

    private sample(p: Player, t: Track): void {
        const [mx, my] = moveInput(p);
        this.push({
            t: "s",
            at: round(this.clock),
            p: t.id,
            o: practiceObserve(p, this.host.enemiesOf(p)).map(round),
            w: this.world(p),
            a: {
                move: [round(mx), round(my)],
                aim: [round(p.dirNew.x), round(p.dirNew.y)],
                aimLen: round(p.toMouseLen),
                fire: p.shootHold ? 1 : 0,
                shots: t.shots,
                ev: t.events,
            },
            r: { dealt: round(t.dealt), taken: round(t.taken), kills: t.kills },
        });
        this.rows++;
        this.resetSince(t);
        t.nextSample += R.interval;
        // After a stall, don't write a burst of rows to catch up.
        if (t.nextSample < this.clock) t.nextSample = this.clock + R.interval;
    }

    /** Game over: write a summary row per player and close the file. */
    finish(): void {
        if (this.finished) return;
        if (this.headerWritten) {
            for (const [player, t] of this.tracks) {
                this.lines.push(
                    JSON.stringify({ t: "end", at: round(this.clock), p: t.id, stats: this.host.statsSummary(player) }),
                );
            }
        }
        this.finished = true;
        if (this.headerWritten) this.flush(true);
    }
}
