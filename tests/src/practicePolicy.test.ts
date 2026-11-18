import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { PracticeObservationFields, PracticeObservationVersion } from "../../server/src/game/practiceObservation.ts";
import {
    practicePolicyFits,
    type PracticeSampleRow,
    practiceTacticLabel,
} from "../../server/src/game/practicePolicy.ts";
import { practiceExamples, practiceFit, practiceScore, practiceSplit } from "../../server/src/practiceTrain.ts";

const F = PracticeObservationFields;

/** A sample row with an enemy on screen at (dx, dy), the player moving `move`. */
function row(set: Record<string, number>, move: [number, number], ev: unknown[][] = []): PracticeSampleRow {
    const o = new Array(F.length).fill(0);
    for (const [name, value] of Object.entries({ enemy0_present: 1, enemy0_dx: 10, enemy0_dy: 0, ...set })) {
        o[F.indexOf(name)] = value;
    }
    return { o, a: { move, ev } };
}

describe("practice tactic labels", () => {
    test("movement against the nearest enemy, items and reloads", () => {
        expect(practiceTacticLabel(row({}, [1, 0]), F)).toBe("push");
        expect(practiceTacticLabel(row({}, [-1, 0]), F)).toBe("retreat");
        expect(practiceTacticLabel(row({}, [0, 1]), F)).toBe("hold");
        expect(practiceTacticLabel(row({}, [0, 0]), F)).toBe("hold");
        expect(practiceTacticLabel(row({}, [1, 0], [[20, "item", "bandage"]]), F)).toBe("heal");
        expect(practiceTacticLabel(row({}, [1, 0], [[20, "reload", 0]]), F)).toBe("reload");
        expect(practiceTacticLabel(row({ enemy0_present: 0 }, [1, 0]), F)).toBeUndefined();
    });
});

describe("practice trainer", () => {
    test("learns a separable rule from recordings and skips older versions", () => {
        const dir = mkdtempSync(join(tmpdir(), "practice-train-"));
        try {
            const hdr = { t: "hdr", v: 2, obsV: PracticeObservationVersion, fields: F };
            for (let g = 0; g < 6; g++) {
                const lines = [JSON.stringify(hdr)];
                for (let i = 0; i < 400; i++) {
                    // Push when the enemy is low, back off when you are, otherwise strafe.
                    const kind = i % 3;
                    const set = kind === 0
                        ? { self_health: 90, enemy0_health: 20 }
                        : kind === 1
                        ? { self_health: 20, enemy0_health: 90 }
                        : { self_health: 90, enemy0_health: 90 };
                    const move: [number, number] = kind === 0 ? [1, 0] : kind === 1 ? [-1, 0] : [0, 1];
                    lines.push(JSON.stringify({ t: "s", at: i / 10, p: 1, ...row(set, move) }));
                }
                writeFileSync(join(dir, `g${g}.jsonl.gz`), gzipSync(lines.join("\n")));
            }
            writeFileSync(
                join(dir, "old.jsonl.gz"),
                gzipSync(JSON.stringify({ t: "hdr", v: 1, obsV: 1, fields: ["x"] })),
            );

            const ex = practiceExamples(dir);
            expect(ex.skippedGames).toBe(1);
            expect(ex.games.length).toBe(6);
            const { train, val } = practiceSplit(ex);
            expect(val.length).toBeGreaterThan(0);
            expect(new Set(val.map((i) => ex.game[i]))).toEqual(new Set([4]));
            const model = practiceFit(ex, train);
            expect(practicePolicyFits(model)).toBe(true);
            expect(practiceScore(model, ex, val).balancedAccuracy).toBeGreaterThan(0.95);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
