import { GameConfig } from "../../../shared/gameConfig.ts";
import type { PracticeSettings } from "../../../shared/practice.ts";
import { Config } from "../config.ts";
import type { Player } from "./objects/player.ts";
import { PracticeObservationFields, PracticeObservationVersion, practiceObserve } from "./practiceObservation.ts";

/**
 * Anonymous Practice recordings for training bots on how people play: when they heal, reload,
 * swap, peek, push and dodge, and where they aim. Off unless `practiceRecording.enabled` is set.
 *
 * Each game writes one gzip'd JSON-lines file (see docs/practice-recordings.md). Rows hold no
 * names, account ids or IPs: players are numbered 1, 2, ... within the game.
 *
 * Bump PracticeRecordVersion whenever a row's layout changes.
 */
export const PracticeRecordVersion = 1;

export const PracticeRecordTuning = {
    /** Seconds between sample rows per player (10 per second). */
    interval: 0.1,
    /** Rows buffered before they are handed to the file writer. */
    flushRows: 600,
    /** A game stops recording after this many sample rows (6 hours at 10 per second). */
    maxRows: 216_000,
    /** Decimals kept in numbers. */
    decimals: 3,
};

/** One chunk of a recording, in order. `final` is set on the last chunk of a game. */
export interface PracticeRecordChunk {
    id: string;
    lines: string[];
    final: boolean;
}

/** What the recorder needs from Practice. */
export interface PracticeRecordHost {
    readonly game: {
        readonly mapName: string;
        recordPractice(chunk: PracticeRecordChunk): void;
    };
    readonly settings: PracticeSettings;
    readonly started: boolean;
    /** Living bots the human fights. */
    enemiesOf(player: Player): Player[];
    /** Practice stats for the summary row. */
    statsSummary(player: Player): object;
}

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
    /** [ms since the last row, kind, value] */
    events: Array<[number, string, string | number]>;
    shots: number;
    dealt: number;
    taken: number;
    kills: number;
}

const round = (v: number) => {
    const f = 10 ** PracticeRecordTuning.decimals;
    return Math.round(v * f) / f;
};

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
    private lines: string[] = [];
    private clock = 0;
    private rows = 0;
    private headerWritten = false;
    private finished = false;

    constructor(readonly host: PracticeRecordHost) {}

    get stopped(): boolean {
        return this.finished || this.rows >= PracticeRecordTuning.maxRows;
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
                interval: PracticeRecordTuning.interval,
                day: new Date().toISOString().slice(0, 10),
            }));
        }
        this.lines.push(JSON.stringify(row));
        if (this.lines.length >= PracticeRecordTuning.flushRows) this.flush(false);
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

    private event(t: Track, kind: string, value: string | number): void {
        t.events.push([Math.round((this.clock - t.lastSampleAt) * 1000), kind, value]);
    }

    /** The player sent a new setup: bots, kit and quick-switch profile. */
    onSettings(player: Player): void {
        if (this.stopped) return;
        this.push({ t: "set", at: round(this.clock), p: this.track(player).id, settings: this.host.settings });
    }

    onShot(player: Player): void {
        if (!this.stopped) this.track(player).shots++;
    }

    /** Damage that landed; `human` is the recorded player on either side. */
    onDamage(human: Player, amount: number, dealt: boolean): void {
        if (this.stopped) return;
        const t = this.track(human);
        if (dealt) t.dealt += amount;
        else t.taken += amount;
    }

    onKill(human: Player): void {
        if (!this.stopped) this.track(human).kills++;
    }

    /**
     * Called every game tick with the humans in the game. Events (swaps, reloads, items, scope)
     * are caught every tick so a quick switch between two rows is not lost; rows are written
     * every `interval` seconds.
     */
    update(dt: number, humans: readonly Player[]): void {
        this.clock += dt;
        if (this.stopped || !this.host.started) return;
        for (const p of humans) {
            const t = this.track(p);
            if (p.dead) {
                if (!t.dead) {
                    t.dead = true;
                    this.push({ t: "ep", at: round(this.clock), p: t.id, kind: "death" });
                }
                continue;
            }
            if (t.dead) {
                t.dead = false;
                t.nextSample = this.clock;
                t.lastSampleAt = this.clock;
                t.events = [];
                this.push({ t: "ep", at: round(this.clock), p: t.id, kind: "spawn" });
            }
            this.catchEvents(p, t);
            if (this.clock + 1e-9 >= t.nextSample) this.sample(p, t);
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
        if (p.scope !== t.scope) {
            t.scope = p.scope;
            this.event(t, "scope", t.scope);
        }
    }

    private sample(p: Player, t: Track): void {
        const [mx, my] = moveInput(p);
        this.push({
            t: "s",
            at: round(this.clock),
            p: t.id,
            o: practiceObserve(p, this.host.enemiesOf(p)).map(round),
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
        t.events = [];
        t.shots = 0;
        t.dealt = 0;
        t.taken = 0;
        t.kills = 0;
        t.lastSampleAt = this.clock;
        t.nextSample += PracticeRecordTuning.interval;
        // After a stall, don't write a burst of rows to catch up.
        if (t.nextSample < this.clock) t.nextSample = this.clock + PracticeRecordTuning.interval;
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
