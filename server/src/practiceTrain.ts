/**
 * Trains the Practice bot's tactic model from Practice recordings.
 *
 *   bun server/src/practiceTrain.ts <recordings dir> <model.json>
 *
 * Reads every `*.jsonl.gz` under the folder, keeps games whose observation matches the server's
 * (older recorder versions are skipped), labels what the player chose with a bot on screen
 * (`practiceTacticLabel`), and fits a softmax model. Validation uses games held out from training.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PracticeObservationFields, PracticeObservationVersion } from "./game/practiceObservation.ts";
import {
    type PracticePolicyModel,
    practicePolicyProbs,
    type PracticeSampleRow,
    type PracticeTactic,
    practiceTacticLabel,
    PracticeTactics,
} from "./game/practicePolicy.ts";

/** Trainer knobs. */
export const PracticeTrainTuning = {
    /** Keep one in this many hold/push/retreat samples (10 per second is far more than decisions change). */
    moveEvery: 5,
    /** Every this-many-th game is held out for validation; with fewer games, the last fifth of each game. */
    holdOutEvery: 5,
    epochs: 30,
    batch: 256,
    learningRate: 0.01,
    l2: 1e-4,
    seed: 1,
};

export interface PracticeExamples {
    /** Rows of PracticeObservationFields.length features, flattened. */
    x: Float32Array;
    y: Uint8Array;
    /** Index of the game each example came from. */
    game: Uint32Array;
    games: string[];
    skippedGames: number;
}

/** Labelled examples from a folder of recordings. */
export function practiceExamples(dir: string): PracticeExamples {
    const files = (readdirSync(dir, { recursive: true }) as string[])
        .filter((f) => f.endsWith(".jsonl.gz"))
        .sort();
    const n = PracticeObservationFields.length;
    const xs: number[][] = [];
    const ys: number[] = [];
    const gs: number[] = [];
    const games: string[] = [];
    let skippedGames = 0;
    for (const file of files) {
        const lines = gunzipSync(readFileSync(join(dir, file))).toString("utf8").split("\n");
        const hdr = JSON.parse(lines[0] || "{}");
        const fits = hdr.t === "hdr" && hdr.obsV === PracticeObservationVersion
            && hdr.fields?.length === n
            && hdr.fields.every((f: string, i: number) => f === PracticeObservationFields[i]);
        if (!fits) {
            skippedGames++;
            continue;
        }
        const g = games.push(file) - 1;
        let moves = 0;
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].startsWith("{\"t\":\"s\"")) continue;
            const row = JSON.parse(lines[i]) as PracticeSampleRow;
            const label = practiceTacticLabel(row, hdr.fields);
            if (!label) continue;
            const move = label === "hold" || label === "push" || label === "retreat";
            if (move && moves++ % PracticeTrainTuning.moveEvery !== 0) continue;
            xs.push(row.o);
            ys.push(PracticeTactics.indexOf(label));
            gs.push(g);
        }
    }
    const x = new Float32Array(xs.length * n);
    xs.forEach((row, i) => x.set(row, i * n));
    return { x, y: Uint8Array.from(ys), game: Uint32Array.from(gs), games, skippedGames };
}

function random(seed: number): () => number {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 4294967296;
    };
}

/** Which example indexes train and which validate. */
export function practiceSplit(ex: PracticeExamples): { train: number[]; val: number[] } {
    const every = PracticeTrainTuning.holdOutEvery;
    const train: number[] = [];
    const val: number[] = [];
    if (ex.games.length >= every) {
        for (let i = 0; i < ex.y.length; i++) (ex.game[i] % every === every - 1 ? val : train).push(i);
        return { train, val };
    }
    // Few games: hold out the last fifth of each one (rows are in time order).
    const count = new Map<number, number>();
    for (let i = 0; i < ex.y.length; i++) count.set(ex.game[i], (count.get(ex.game[i]) ?? 0) + 1);
    const seen = new Map<number, number>();
    for (let i = 0; i < ex.y.length; i++) {
        const k = (seen.get(ex.game[i]) ?? 0) + 1;
        seen.set(ex.game[i], k);
        (k > count.get(ex.game[i])! * (1 - 1 / every) ? val : train).push(i);
    }
    return { train, val };
}

/** Fits the softmax model on `train` (Adam, mini-batches, classes weighted by rarity). */
export function practiceFit(ex: PracticeExamples, train: number[]): PracticePolicyModel {
    const T = PracticeTrainTuning;
    const n = PracticeObservationFields.length;
    const k = PracticeTactics.length;
    const mean = new Array(n).fill(0);
    const std = new Array(n).fill(0);
    for (const i of train) for (let j = 0; j < n; j++) mean[j] += ex.x[i * n + j] / train.length;
    for (const i of train) for (let j = 0; j < n; j++) std[j] += (ex.x[i * n + j] - mean[j]) ** 2 / train.length;
    for (let j = 0; j < n; j++) std[j] = Math.sqrt(std[j]) || 1;

    const freq = new Array(k).fill(0);
    for (const i of train) freq[ex.y[i]]++;
    const present = freq.filter((f) => f > 0).length;
    const classWeight = freq.map((f) => (f ? train.length / (present * f) : 0));

    const w = Array.from({ length: k }, () => new Array(n).fill(0));
    const b = new Array(k).fill(0);
    const params = k * (n + 1);
    const m1 = new Float64Array(params);
    const m2 = new Float64Array(params);
    let step = 0;
    const rnd = random(T.seed);
    const order = train.slice();
    const model: PracticePolicyModel = {
        obsV: PracticeObservationVersion,
        fields: PracticeObservationFields,
        tactics: [...PracticeTactics],
        mean,
        std,
        w,
        b,
    };
    const xi = new Array(n);
    for (let epoch = 0; epoch < T.epochs; epoch++) {
        for (let i = order.length - 1; i > 0; i--) {
            const r = Math.floor(rnd() * (i + 1));
            [order[i], order[r]] = [order[r], order[i]];
        }
        for (let start = 0; start < order.length; start += T.batch) {
            const grad = new Float64Array(params);
            const batch = order.slice(start, start + T.batch);
            for (const i of batch) {
                for (let j = 0; j < n; j++) xi[j] = ex.x[i * n + j];
                const p = practicePolicyProbs(model, xi);
                const cw = classWeight[ex.y[i]] / batch.length;
                for (let c = 0; c < k; c++) {
                    const err = (p[c] - (c === ex.y[i] ? 1 : 0)) * cw;
                    for (let j = 0; j < n; j++) grad[c * (n + 1) + j] += err * ((xi[j] - mean[j]) / std[j]);
                    grad[c * (n + 1) + n] += err;
                }
            }
            step++;
            for (let c = 0; c < k; c++) {
                for (let j = 0; j <= n; j++) {
                    const idx = c * (n + 1) + j;
                    const value = j < n ? w[c][j] : b[c];
                    const g = grad[idx] + (j < n ? T.l2 * value : 0);
                    m1[idx] = 0.9 * m1[idx] + 0.1 * g;
                    m2[idx] = 0.999 * m2[idx] + 0.001 * g * g;
                    const update = T.learningRate * (m1[idx] / (1 - 0.9 ** step))
                        / (Math.sqrt(m2[idx] / (1 - 0.999 ** step)) + 1e-8);
                    if (j < n) w[c][j] -= update;
                    else b[c] -= update;
                }
            }
        }
    }
    return model;
}

export interface PracticeReport {
    examples: number;
    /** Examples per tactic, in PracticeTactics order. */
    counts: number[];
    accuracy: number;
    /** Mean recall over the tactics present: guessing the common tactic scores low here. */
    balancedAccuracy: number;
    recall: Record<string, number>;
}

/** How well `model` predicts the chosen tactic on `indexes`. */
export function practiceScore(model: PracticePolicyModel, ex: PracticeExamples, indexes: number[]): PracticeReport {
    const n = PracticeObservationFields.length;
    const k = PracticeTactics.length;
    const counts = new Array(k).fill(0);
    const right = new Array(k).fill(0);
    for (const i of indexes) {
        const p = practicePolicyProbs(model, Array.from(ex.x.subarray(i * n, (i + 1) * n)));
        const guess = p.indexOf(Math.max(...p));
        counts[ex.y[i]]++;
        if (guess === ex.y[i]) right[ex.y[i]]++;
    }
    const recall: Record<string, number> = {};
    PracticeTactics.forEach((t: PracticeTactic, c) => {
        if (counts[c]) recall[t] = right[c] / counts[c];
    });
    const recalls = Object.values(recall);
    return {
        examples: indexes.length,
        counts,
        accuracy: indexes.length ? right.reduce((a, b) => a + b, 0) / indexes.length : 0,
        balancedAccuracy: recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : 0,
        recall,
    };
}

if (import.meta.main) {
    const [dir, out] = process.argv.slice(2);
    if (!dir || !out) {
        console.error("usage: bun server/src/practiceTrain.ts <recordings dir> <model.json>");
        process.exit(2);
    }
    const ex = practiceExamples(dir);
    console.log(`games ${ex.games.length} (skipped ${ex.skippedGames} older), examples ${ex.y.length}`);
    const { train, val } = practiceSplit(ex);
    if (!train.length || !val.length) {
        console.error("not enough labelled examples to train and validate");
        process.exit(1);
    }
    const model = practiceFit(ex, train);
    const report = { train: practiceScore(model, ex, train), val: practiceScore(model, ex, val) };
    console.log(`tactics ${PracticeTactics.join(" / ")}`);
    for (const [name, r] of Object.entries(report)) {
        console.log(
            `${name}: ${r.examples} examples (${r.counts.join(" / ")}), accuracy ${r.accuracy.toFixed(3)}, `
                + `balanced ${r.balancedAccuracy.toFixed(3)}, recall ${JSON.stringify(r.recall)}`,
        );
    }
    writeFileSync(out, JSON.stringify({ ...model, report }));
    console.log(`wrote ${out}`);
}
