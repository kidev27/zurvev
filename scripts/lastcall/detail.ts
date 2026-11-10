/**
 * After Hours floor detail: wear, story decals and baked lighting, painted into
 * the single floor texture so they cost nothing at runtime. Everything here is
 * flat and low contrast (no SVG filters) so players and zombies stay readable.
 *
 * Positions are authored in base-plan units (same as lastCallLayout.ts) and
 * scaled by LastCallScale. Randomness is seeded, so re-running buildArt.ts gives
 * the same image.
 */
import {
    LastCallScale as S,
    type LastCallRect,
    type LastCallZoneId,
    LastCallZones,
} from "../../shared/defs/maps/lastCallLayout.ts";

const n = (v: number) => Math.round(v * 1000) / 1000;
const P = (x: number, y: number) => [x * S, y * S] as const;

const C = {
    grime: "#1a201e",
    oil: "#0f1312",
    water: "#1c2a2d",
    blood: "#4a1512",
    bloodDrop: "#521713",
    tape: "#e2c23a",
    tapeInk: "#1b1a10",
    paper: "#c9ccc2",
    sodium: "#ffb84d",
    neon: "#ff4f6a",
    flare: "#ff3b2f",
    hazard: "#c8ad66",
};

/** Small seeded RNG, one stream per zone. */
function rng(key: string) {
    let seed = key.split("").reduce((a, b) => (a * 31 + b.charCodeAt(0)) >>> 0, 7);
    return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function zoneRect(id: LastCallZoneId): LastCallRect {
    return LastCallZones.find((z) => z.id === id)!.rect;
}

// ── Primitives (game units) ─────────────────────────────────────────────────

const path = (d: string, stroke: string, width: number, attrs = "", cap = "round") =>
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="${cap}" ${attrs}/>`;
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, attrs = "") =>
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${attrs}/>`;
const rot = (x: number, y: number, deg: number, body: string) =>
    `<g transform="rotate(${n(deg)} ${n(x)} ${n(y)})">${body}</g>`;
const box = (x: number, y: number, w: number, h: number, fill: string, attrs = "") =>
    `<rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" fill="${fill}" ${attrs}/>`;

function cracks(r: LastCallRect, count: number, rand: () => number): string {
    let s = "";
    for (let i = 0; i < count; i++) {
        let x = r.x0 + 2 + rand() * (r.x1 - r.x0 - 4);
        let y = r.y0 + 2 + rand() * (r.y1 - r.y0 - 4);
        let d = `M${n(x)} ${n(y)}`;
        const steps = 3 + Math.floor(rand() * 4);
        for (let k = 0; k < steps; k++) {
            x += (rand() - 0.5) * 4.4;
            y += (rand() - 0.5) * 3.2;
            d += ` L${n(x)} ${n(y)}`;
        }
        s += path(d, C.grime, 0.16, `opacity=".7"`);
    }
    return s;
}

function stains(r: LastCallRect, count: number, rand: () => number, color = C.oil, opacity = 0.45): string {
    let s = "";
    for (let i = 0; i < count; i++) {
        const x = r.x0 + 3 + rand() * (r.x1 - r.x0 - 6);
        const y = r.y0 + 3 + rand() * (r.y1 - r.y0 - 6);
        const rx = 0.8 + rand() * 1.8;
        s += ellipse(x, y, rx, rx * (0.5 + rand() * 0.3), color, `opacity="${opacity}"`);
        s += ellipse(x + rx * 0.6, y + 0.3, rx * 0.35, rx * 0.25, color, `opacity="${opacity * 0.8}"`);
    }
    return s;
}

function litter(r: LastCallRect, count: number, rand: () => number, colors: string[]): string {
    let s = "";
    for (let i = 0; i < count; i++) {
        const x = r.x0 + 1 + rand() * (r.x1 - r.x0 - 2);
        const y = r.y0 + 1 + rand() * (r.y1 - r.y0 - 2);
        const c = colors[Math.floor(rand() * colors.length)];
        s += rot(x, y, rand() * 180, box(x, y, 0.3 + rand() * 0.45, 0.2 + rand() * 0.3, c, `opacity=".7"`));
    }
    return s;
}

/** Puddle with a faint warm reflection of the nearest lamp. */
function puddle(x: number, y: number, rx: number, ry: number): string {
    return ellipse(x, y, rx, ry, C.water, `opacity=".85"`)
        + ellipse(x - rx * 0.3, y - ry * 0.25, rx * 0.45, ry * 0.3, "#e0a64c", `opacity=".16"`);
}

/** Two parallel tire marks along a cubic curve. */
function skid(d: string): string {
    return path(d, "#141917", 0.4, `opacity=".3"`)
        + `<g transform="translate(.8 1.4)">${path(d, "#141917", 0.4, `opacity=".3"`)}</g>`;
}

/** Dark, broken drag trail with a few drops along it. */
function bloodTrail(d: string, drops: Array<[number, number, number]>): string {
    let s = path(d, C.blood, 0.6, `opacity=".65" stroke-dasharray="1.6 1.1 .5 1.6 2.2 1.3"`);
    for (const [x, y, r] of drops) {
        s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${C.bloodDrop}" opacity=".7"/>`;
    }
    return s;
}

function bag(x: number, y: number, deg: number, color: string): string {
    return rot(
        x,
        y,
        deg,
        box(x, y, 2, 1.3, color, `rx=".2" stroke="#202825" stroke-width=".12"`)
            + box(x, y - 0.75, 0.7, 0.3, "#202825"),
    );
}

function tape(x0: number, y0: number, x1: number, y1: number): string {
    const d = `M${n(x0)} ${n(y0)} L${n(x1)} ${n(y1)}`;
    return path(d, C.tape, 0.5, `opacity=".9"`, "butt")
        + path(d, C.tapeInk, 0.5, `stroke-dasharray=".5 .7" opacity=".9"`, "butt");
}

function flare(x: number, y: number, deg: number): string {
    return `<circle cx="${n(x)}" cy="${n(y)}" r="5.5" fill="url(#detailFlare)"/>`
        + rot(x, y, deg, box(x, y, 1.2, 0.35, "#ff5a3c", `rx=".1"`));
}

function flashlight(x: number, y: number, deg: number): string {
    return rot(
        x,
        y,
        deg,
        `<polygon points="${n(x + 0.6)},${n(y)} ${n(x + 11)},${n(y - 3.6)} ${n(x + 11)},${n(y + 3.6)}" fill="url(#detailBeam)"/>`
            + box(x, y, 1.4, 0.7, "#2b2f2c", `rx=".2" stroke="#111" stroke-width=".08"`),
    );
}

function spray(x: number, y: number, value: string, size: number, deg = 0): string {
    return rot(
        x,
        y,
        deg,
        `<text x="${n(x)}" y="${n(y)}" fill="${C.paper}" opacity=".38" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="${
            n(size)
        }" text-anchor="middle" letter-spacing=".25">${value}</text>`,
    );
}

function papers(x: number, y: number, count: number, rand: () => number): string {
    let s = "";
    for (let i = 0; i < count; i++) {
        const px = x + (rand() - 0.5) * 5;
        const py = y + (rand() - 0.5) * 3.5;
        s += rot(px, py, rand() * 90 - 45, box(px, py, 0.9, 1.2, "#d6d0b8", `opacity=".55"`));
    }
    return s;
}

function footprints(x0: number, y0: number, x1: number, y1: number, steps: number, color: string): string {
    let s = "";
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const deg = (ang * 180) / Math.PI;
    const nx = -Math.sin(ang) * 0.35;
    const ny = Math.cos(ang) * 0.35;
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const side = i % 2 ? 1 : -1;
        const x = x0 + (x1 - x0) * t + nx * side;
        const y = y0 + (y1 - y0) * t + ny * side;
        s += rot(x, y, deg, ellipse(x, y, 0.38, 0.2, color, `opacity="${n(0.55 * (1 - t * 0.7))}"`));
    }
    return s;
}

function hazardStripe(x: number, y: number, w: number, h: number): string {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#detailHazard)" opacity=".38"/>`;
}

/** Warm sodium lamp: a soft pool plus the lamp head. Baked, no flicker. */
function lamp(x: number, y: number, radius = 13): string {
    return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="url(#detailSodium)"/>`
        + `<circle cx="${n(x)}" cy="${n(y)}" r=".9" fill="#3a3b35" stroke="#151715" stroke-width=".18"/>`
        + `<circle cx="${n(x)}" cy="${n(y)}" r=".4" fill="#ffd27a"/>`;
}

// ── Shared defs ─────────────────────────────────────────────────────────────

export const LastCallDetailDefs = [
    `<radialGradient id="detailSodium"><stop offset="0" stop-color="${C.sodium}" stop-opacity=".34"/><stop offset=".55" stop-color="#e09a3a" stop-opacity=".1"/><stop offset="1" stop-color="#e09a3a" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="detailNeon"><stop offset="0" stop-color="${C.neon}" stop-opacity=".4"/><stop offset="1" stop-color="${C.neon}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="detailFlare"><stop offset="0" stop-color="${C.flare}" stop-opacity=".6"/><stop offset=".4" stop-color="${C.flare}" stop-opacity=".18"/><stop offset="1" stop-color="${C.flare}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="detailBeam"><stop offset="0" stop-color="#fff3c4" stop-opacity=".38"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="detailSpill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2d48a" stop-opacity=".16"/><stop offset="1" stop-color="#f2d48a" stop-opacity="0"/></linearGradient>`,
    `<pattern id="detailHazard" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width=".8" height="1.6" fill="${C.hazard}"/><rect x=".8" width=".8" height="1.6" fill="#202825"/></pattern>`,
];

// ── Per-zone detail (drawn under props, doors and walls) ────────────────────

export function lastCallFloorDetail(): string {
    const s: string[] = [];
    const clip = (id: LastCallZoneId, body: string) => `<g clip-path="url(#zone-${id})">${body}</g>`;

    // Motor Court: the abandoned evacuation point.
    {
        const r = zoneRect("courtyard");
        const rand = rng("courtyard");
        let b = cracks(r, 10, rand) + stains(r, 4, rand);
        b += skid(`M${P(44, 79)} C ${P(53, 75)}, ${P(61, 69)}, ${P(69, 68.5)} C ${P(77, 68)}, ${P(84, 70.5)}, ${P(93, 65)}`);
        b += puddle(...P(67, 82.5), 4.2, 2.1) + puddle(...P(84, 60), 3.2, 1.6) + puddle(...P(49, 56), 2.4, 1.2);
        b += litter(r, 28, rand, ["#6d5a3a", "#5a4a30", "#8a8670", "#7a3f30"]);
        // Drag trail from the first car to the Reception shutter.
        b += bloodTrail(
            `M${P(52.6, 64.8)} C ${P(56, 69)}, ${P(61.3, 73.3)}, ${P(65.3, 78.7)} C ${P(67.3, 81.3)}, ${P(69, 84.7)}, ${
                P(70, 89.2)
            }`,
            [[...P(52.4, 64.5), 0.8], [...P(58.7, 71.3), 0.45], [...P(64.3, 77.7), 0.55], [...P(69.3, 86.7), 0.5]],
        );
        b += bag(...P(56.3, 61.7), 25, "#7c4b35");
        b += bag(...P(58.1, 63.1), -40, "#4f6070");
        b += bag(...P(80, 80.7), 70, "#6b6a40");
        b += tape(...P(40.5, 54.7), ...P(48, 52.3));
        b += flare(...P(77.3, 83.7), -20) + flashlight(...P(87.7, 81), 160);
        b += spray(...P(78, 86.2), "EVAC CLOSED", 2.3);
        s.push(clip("courtyard", b));
        s.push(lamp(...P(42, 52)) + lamp(...P(98, 52)) + lamp(...P(42, 88)) + lamp(...P(98, 88)));
        // VACANCY neon on the wall beside the Guest Rooms shutter.
        const [nx, ny] = P(40.4, 63.5);
        s.push(ellipse(nx + 1, ny, 4.5, 9, "url(#detailNeon)") + box(nx + 0.35, ny, 0.7, 7, C.neon, `opacity=".8"`));
    }

    // Reception: a hurried check-out.
    {
        const r = zoneRect("lobby");
        const rand = rng("lobby");
        let b = papers(...P(62, 97), 9, rand) + stains(r, 2, rand, "#3b2c22", 0.35);
        b += footprints(...P(68, 92), ...P(76, 100), 9, "#3a2a20");
        b += box(...P(73, 112), 1.1, 0.5, "#b8a46a", `opacity=".7"`); // dropped room key
        s.push(clip("lobby", b));
    }

    // Stockroom.
    {
        const r = zoneRect("storage");
        const rand = rng("storage");
        s.push(clip("storage", cracks(r, 3, rand) + litter(r, 10, rand, ["#8a7a58", "#6d5a3a"]) + stains(r, 2, rand)));
    }

    // Night Owl Diner: dinner rush that never finished.
    {
        const r = zoneRect("diner");
        const rand = rng("diner");
        let b = litter(r, 18, rand, ["#d6d0b8", "#c9c3ab", "#a7442f"]); // napkins, plate shards, sauce
        b += ellipse(...P(27, 104), 1.4, 0.8, "#3b2c22", `opacity=".5"`); // spilled coffee
        b += puddle(...P(16, 96.5), 1.8, 1); // mop water by the kitchen
        b += footprints(...P(30, 112), ...P(48, 104), 10, "#3a2a20");
        s.push(clip("diner", b));
    }

    // Service Alley: trash and run-off.
    {
        const r = zoneRect("alley");
        const rand = rng("alley");
        let b = cracks(r, 6, rand) + stains(r, 3, rand);
        b += puddle(...P(104, 84), 2.6, 1.4) + puddle(...P(108, 58), 2, 1.1);
        b += litter(r, 26, rand, ["#2b2f2c", "#3b3f3a", "#7a6a48", "#6d5a3a"]);
        // The garage shutter is in the alley's east wall.
        b += spray(...P(107, 82.5), "GARAGE →", 1.5);
        s.push(clip("alley", b));
        s.push(lamp(...P(107.5, 60), 10) + lamp(...P(107.5, 105), 10));
    }

    // Guest Rooms: someone barricaded in, someone didn't make it.
    {
        const r = zoneRect("wing");
        const rand = rng("wing");
        let b = litter(r, 14, rand, ["#d6d0b8", "#8a6548", "#6b6a40"]);
        b += footprints(...P(32, 86), ...P(32, 40), 16, "#3a2a20");
        b += bloodTrail(`M${P(20.5, 82)} C ${P(23, 81)}, ${P(26, 80)}, ${P(29, 78)}`, [[...P(29.5, 77.5), 0.5]]);
        b += box(...P(30, 60), 1.6, 1, "#d6d0b8", `opacity=".5"`); // room-service tray
        s.push(clip("wing", b));
    }

    // Maintenance Hall, parts store and laundry.
    {
        const r = zoneRect("club");
        const rand = rng("club");
        let b = cracks(r, 9, rand) + stains(r, 6, rand);
        b += skid(`M${P(66, 46)} C ${P(70, 40)}, ${P(72, 36)}, ${P(73, 33)}`);
        b += hazardStripe(...P(66, 10.5), 9 * S, 0.8);
        b += puddle(...P(96, 18), 2.4, 1.2); // laundry leak
        b += litter(r, 22, rand, ["#8a8670", "#5a4a30", "#9b9b8a"]);
        // Dropped wrench.
        b += rot(...P(80, 26), 30, box(...P(80, 26), 1.6, 0.35, "#8c8f86", `opacity=".8"`));
        s.push(clip("club", b));
    }

    // Manager's Office: shredded paperwork.
    {
        const rand = rng("office");
        let b = papers(...P(124, 10), 12, rand) + papers(...P(136, 16), 6, rand);
        b += stains(zoneRect("office"), 1, rand, "#3b2c22", 0.35);
        s.push(clip("office", b));
    }

    // Roadside Garage: oil, tire tracks and a last stand by the freight gate.
    {
        const r = zoneRect("garage");
        const rand = rng("garage");
        let b = cracks(r, 10, rand) + stains(r, 7, rand);
        b += skid(`M${P(118, 108)} C ${P(119, 90)}, ${P(118, 70)}, ${P(121, 52)}`);
        for (let y = 33; y <= 105; y += 20) b += hazardStripe(...P(127.4, y), 0.6 * S, 4 * S);
        b += puddle(...P(134, 56), 2.8, 1.4) + puddle(...P(123, 100), 2.2, 1.2);
        b += litter(r, 20, rand, ["#8a8670", "#5a4a30", "#2b2f2c"]);
        b += bloodTrail(`M${P(122, 40)} C ${P(124, 35)}, ${P(127, 30)}, ${P(130, 27)}`, [[...P(130, 26.8), 0.55]]);
        b += spray(...P(124.6, 55), "POWER → OFFICE", 1.5, -90);
        b += flare(...P(126, 30), 15);
        s.push(clip("garage", b));
    }

    // Window light spilling onto the street from the lit front rooms.
    for (const x of [19.5, 42.5, 62.5, 77.5]) {
        const [cx, cy] = P(x, 115);
        s.push(`<polygon points="${n(cx - 3)},${n(cy + 0.5)} ${n(cx + 3)},${n(cy + 0.5)} ${n(cx + 5)},${n(cy + 6)} ${n(cx - 5)},${
            n(cy + 6)
        }" fill="url(#detailSpill)"/>`);
    }
    return s.join("");
}
