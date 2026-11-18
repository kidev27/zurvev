import { PracticeObservationFields, PracticeObservationVersion } from "./practiceObservation.ts";

/**
 * The tactical choices a learned Practice bot makes. Aim, movement and pathing stay scripted;
 * the model only picks which of these to do with an enemy on screen.
 */
export const PracticeTactics = ["hold", "push", "retreat", "heal", "reload"] as const;
export type PracticeTactic = (typeof PracticeTactics)[number];

/** How recorded player input becomes a tactic label. */
export const PracticeLabelTuning = {
    /**
     * Moving with at least this cosine toward the nearest enemy on screen counts as a push;
     * at or below minus it, a retreat.
     */
    pushCos: 0.5,
};

/** A trained softmax model over the observation vector. Written by `server/src/practiceTrain.ts`. */
export interface PracticePolicyModel {
    obsV: number;
    fields: string[];
    tactics: string[];
    /** Per-feature mean and spread used to scale inputs. */
    mean: number[];
    std: number[];
    /** One row of weights per tactic, and its bias. */
    w: number[][];
    b: number[];
}

/** One recorded sample row (`t: "s"`), as far as labels need it. */
export interface PracticeSampleRow {
    o: number[];
    a: { move: [number, number]; ev?: unknown[][] };
}

/**
 * What the player chose in this sample, or undefined when there is no enemy on screen to
 * decide about. Starting a heal or boost item or a reload wins over movement.
 */
export function practiceTacticLabel(row: PracticeSampleRow, fields: readonly string[]): PracticeTactic | undefined {
    const at = (name: string) => row.o[fields.indexOf(name)];
    if (at("enemy0_present") !== 1) return undefined;
    const ev = row.a.ev ?? [];
    if (ev.some((e) => e[1] === "item")) return "heal";
    if (ev.some((e) => e[1] === "reload")) return "reload";
    const [mx, my] = row.a.move;
    const dx = at("enemy0_dx");
    const dy = at("enemy0_dy");
    const lens = Math.hypot(mx, my) * Math.hypot(dx, dy);
    if (lens === 0) return "hold";
    const cos = (mx * dx + my * dy) / lens;
    if (cos >= PracticeLabelTuning.pushCos) return "push";
    if (cos <= -PracticeLabelTuning.pushCos) return "retreat";
    return "hold";
}

/** Tactic probabilities for an observation, in `model.tactics` order. */
export function practicePolicyProbs(model: PracticePolicyModel, obs: readonly number[]): number[] {
    const logits = model.w.map((row, k) => {
        let z = model.b[k];
        for (let i = 0; i < row.length; i++) z += row[i] * ((obs[i] - model.mean[i]) / model.std[i]);
        return z;
    });
    const top = Math.max(...logits);
    const exp = logits.map((z) => Math.exp(z - top));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map((e) => e / sum);
}

/** True when the model was trained on the observation the server builds today. */
export function practicePolicyFits(model: PracticePolicyModel): boolean {
    return model.obsV === PracticeObservationVersion
        && model.fields.length === PracticeObservationFields.length
        && model.fields.every((f, i) => f === PracticeObservationFields[i]);
}
