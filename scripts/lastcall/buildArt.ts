/**
 * After Hours art, generated from the shared plan and collision definitions.
 * Compatibility asset names remain map-lastcall-*. Re-run after layout edits:
 *   bun scripts/lastcall/buildArt.ts
 * Floors, walls, windows, thresholds and floor-painted fixtures use game units.
 * Fixture footprints are read from the same AABBs the game uses for collision.
 */
import fs from "node:fs";
import path from "node:path";
import { LastCallMapObjectDefs } from "../../shared/defs/lastCallObjectDefs.ts";
import {
    LastCallApron,
    LastCallBoxSpots,
    LastCallDoors,
    LastCallEntries,
    LastCallFloorPixelsPerUnit,
    LastCallHeight,
    LastCallInteriorRooms,
    LastCallMotelRooms,
    LastCallPowerSwitchPos,
    LastCallProps,
    type LastCallRect,
    lastCallWalls,
    LastCallWallThickness,
    LastCallWidth,
    type LastCallZoneId,
    LastCallZones,
} from "../../shared/defs/maps/lastCallLayout.ts";
import { LastCallDetailDefs, lastCallFloorDetail } from "./detail.ts";

const outDir = path.join(import.meta.dirname, "../../client/public/img/map");
const PX = LastCallFloorPixelsPerUnit;
const SPX = 32;
const C = {
    street: "#242b2b",
    sidewalk: "#53594f",
    wall: "#bdb9a7",
    edge: "#202825",
    amber: "#d9b777",
    yellow: "#c8ad66",
    red: "#aa5144",
    ink: "#212925",
    paper: "#ccc2a4",
    wood: "#786248",
};
const palette: Record<LastCallZoneId, [string, string]> = {
    lobby: ["#555b4f", "#5c6154"],
    storage: ["#424a43", "#474f47"],
    courtyard: ["#343d3a", "#3c4440"],
    diner: ["#625c4d", "#555448"],
    alley: ["#303936", "#37403a"],
    wing: ["#4b5148", "#50564b"],
    club: ["#4e554a", "#535a4e"],
    office: ["#635646", "#6b5d4b"],
    garage: ["#424b46", "#49514b"],
};
const n = (v: number) => Math.round(v * 1000) / 1000;
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const zone = (id: LastCallZoneId) => LastCallZones.find((z) => z.id === id)!.rect;
const rect = (x: number, y: number, w: number, h: number, fill: string, attrs = "") =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}" ${attrs}/>`;
const rr = (r: LastCallRect, fill: string, attrs = "") => rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, fill, attrs);
const circle = (x: number, y: number, r: number, fill: string, attrs = "") =>
    `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" ${attrs}/>`;
const line = (x0: number, y0: number, x1: number, y1: number, color: string, width = .2, attrs = "") =>
    `<path d="M${n(x0)} ${n(y0)}L${n(x1)} ${n(y1)}" fill="none" stroke="${color}" stroke-width="${width}" ${attrs}/>`;
const text = (x: number, y: number, value: string, size: number, fill = C.paper, attrs = "") =>
    `<text x="${n(x)}" y="${
        n(y)
    }" fill="${fill}" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="${size}" ${attrs}>${
        esc(value)
    }</text>`;
const inset = (r: LastCallRect, by: number): LastCallRect => ({
    x0: r.x0 + by,
    y0: r.y0 + by,
    x1: r.x1 - by,
    y1: r.y1 - by,
});
const centered = (r: LastCallRect, w: number, h: number): LastCallRect => {
    const x = (r.x0 + r.x1) / 2;
    const y = (r.y0 + r.y1) / 2;
    return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
};

function grid(r: LastCallRect, step: number, color: string, width = .12): string {
    let s = "";
    for (let x = r.x0 + step; x < r.x1; x += step) s += line(x, r.y0, x, r.y1, color, width);
    for (let y = r.y0 + step; y < r.y1; y += step) s += line(r.x0, y, r.x1, y, color, width);
    return s;
}

/** Flat road paint: decorative markings never add implied solid objects. */
function arrow(x: number, y: number, rotation = 0): string {
    return `<path d="M0 3V-3M-1.3 -1.5L0 -3L1.3 -1.5" transform="translate(${n(x)} ${
        n(y)
    }) rotate(${rotation})" fill="none" stroke="${C.paper}" stroke-width=".36" opacity=".38"/>`;
}

function floorSvg(): string {
    const A = LastCallApron;
    const W = LastCallWidth;
    const H = LastCallHeight;
    const defs = [
        `<radialGradient id="lamp"><stop stop-color="${C.amber}" stop-opacity=".18"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient>`,
        `<pattern id="dinerTiles" width="6" height="6" patternUnits="userSpaceOnUse">${
            rect(0, 0, 6, 6, palette.diner[0])
        }${rect(0, 0, 3, 3, palette.diner[1])}${rect(3, 3, 3, 3, palette.diner[1])}</pattern>`,
        `<pattern id="officeWood" width="2.8" height="12" patternUnits="userSpaceOnUse">${
            rect(0, 0, 2.8, 12, palette.office[0])
        }${line(.1, 0, .1, 12, palette.office[1])}${line(0, 7, 2.8, 7, "#574b3e", .1)}</pattern>`,
    ];
    defs.push(...LastCallDetailDefs);
    const s = [rect(-A, -A, W + 2 * A, H + 2 * A, C.street)];
    // The apron stays subtle. Curb slabs follow the actual irregular building footprint.
    for (const z of LastCallZones) {
        s.push(rr(inset(z.rect, -2.5), C.sidewalk));
        s.push(rr(inset(z.rect, -1.5), "none", `stroke="#696e60" stroke-width=".24"`));
    }
    s.push(line(-A + 2, H + 6.5, W + A - 2, H + 6.5, C.yellow, .25, `stroke-dasharray="4 5" opacity=".45"`));
    for (const z of LastCallZones) {
        const r = z.rect;
        const [base, seam] = palette[z.id];
        defs.push(`<clipPath id="zone-${z.id}">${rr(inset(r, .6), "white")}</clipPath>`);
        s.push(rr(r, z.id === "diner" ? "url(#dinerTiles)" : z.id === "office" ? "url(#officeWood)" : base));
        if (!["wing", "office", "diner"].includes(z.id)) s.push(grid(r, z.id === "lobby" ? 4 : 12, seam));
        // Stable sparse wear. Low contrast and no noise filters: players remain easy to see.
        let seed = z.id.split("").reduce((a, b) => a + b.charCodeAt(0), 17);
        const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        let marks = "";
        for (let i = 0; i < 18; i++) {
            const x = r.x0 + random() * (r.x1 - r.x0);
            const y = r.y0 + random() * (r.y1 - r.y0);
            marks += line(x, y, x + 1 + random() * 2, y + random() * .5, "#202923", .1, `opacity=".32"`);
        }
        s.push(`<g clip-path="url(#zone-${z.id})">${marks}</g>`);
    }

    const lobby = zone("lobby");
    const rug = centered(lobby, (lobby.x1 - lobby.x0) * .6, (lobby.y1 - lobby.y0) * .26);
    s.push(rr(rug, "#6a5946"), rr(inset(rug, .55), "none", `stroke="#8e7a57" stroke-width=".18"`));
    s.push(text(lobby.x0 + 3, lobby.y0 + 4, "RECEPTION", 1.35, C.paper, `letter-spacing=".25" opacity=".65"`));
    s.push(
        text(
            (rug.x0 + rug.x1) / 2,
            (rug.y0 + rug.y1) / 2 + .5,
            "WELCOME",
            1.2,
            C.paper,
            `text-anchor="middle" opacity=".45"`,
        ),
    );

    const court = zone("courtyard");
    // Side parking bays leave a continuous lane around the central sign island.
    for (let y = court.y0 + 8; y < court.y1 - 6; y += 13) {
        s.push(line(court.x0 + 3, y, court.x0 + 19, y, C.paper, .2, `opacity=".3"`));
        s.push(line(court.x1 - 19, y, court.x1 - 3, y, C.paper, .2, `opacity=".3"`));
    }
    s.push(arrow((court.x0 + court.x1) / 2, court.y0 + 8, 90));
    s.push(arrow((court.x0 + court.x1) / 2, court.y1 - 8, -90));

    const diner = zone("diner");
    s.push(rect(diner.x0 + 1, diner.y0 + 1, (diner.x1 - diner.x0) * .43, 9, "#777866"));
    s.push(
        text(
            diner.x1 - 4,
            diner.y1 - 3,
            "NIGHT OWL DINER",
            1.65,
            C.amber,
            `text-anchor="end" letter-spacing=".1" opacity=".8"`,
        ),
    );
    const storage = zone("storage");
    s.push(text(storage.x0 + 2, storage.y0 + 3, "LINEN / STOCK", 1, C.paper, `opacity=".45"`));
    const alley = zone("alley");
    s.push(line(alley.x0 + 1.7, alley.y0 + 2, alley.x0 + 1.7, alley.y1 - 2, C.yellow, .18, `opacity=".35"`));
    s.push(text(alley.x0 + 3, alley.y1 - 4, "KEEP CLEAR", .95, C.paper, `opacity=".45"`));
    for (const r of LastCallMotelRooms) {
        const i = LastCallMotelRooms.indexOf(r);
        s.push(rr(inset(r, .65), "#575448"));
        s.push(rr(inset(r, 2), "none", `stroke="#676250" stroke-width=".18"`));
        s.push(rect(r.x0 + 1, r.y1 - 6, 5, 5, "#696d5d"));
        s.push(text(r.x1 - 2.2, r.y1 - 2.2, `${101 + i}`, 1.4, C.paper, `text-anchor="end" opacity=".65"`));
    }
    const wing = zone("wing");
    const hallX = LastCallMotelRooms[0]?.x1 ?? wing.x0;
    s.push(line(hallX + 2.5, wing.y0 + 1, hallX + 2.5, wing.y1 - 1, "#727662", .3, `opacity=".5"`));
    s.push(text(hallX + 4, wing.y0 + 4, "GUEST ROOMS", 1.1, C.paper, `opacity=".6"`));

    const service = zone("club");
    for (const [i, r] of LastCallInteriorRooms.slice(LastCallMotelRooms.length).entries()) {
        s.push(rr(inset(r, .6), i === 0 ? "#535747" : "#656b5a"));
        if (i !== 0) s.push(grid(inset(r, .6), 3, "#717563"));
        s.push(text(r.x0 + 2, r.y1 - 2.5, i === 0 ? "PARTS STORE" : "LAUNDRY", 1, C.paper, `opacity=".55"`));
    }
    s.push(text(service.x0 + 4, service.y1 - 4, "MAINTENANCE", 1.6, C.paper, `letter-spacing=".15" opacity=".55"`));
    s.push(text(service.x0 + 4, service.y1 - 2.4, "EMPLOYEES ONLY", .72, C.amber, `letter-spacing=".1" opacity=".5"`));
    const office = zone("office");
    s.push(text(office.x0 + 2.5, office.y1 - 3, "MANAGER", 1.2, C.paper, `opacity=".5"`));
    const garage = zone("garage");
    for (let y = garage.y0 + 9; y < garage.y1 - 6; y += 14) {
        s.push(line(garage.x1 - 13, y, garage.x1 - 1, y, C.paper, .24, `opacity=".32"`));
    }
    for (let y = garage.y0 + 13; y < garage.y1 - 6; y += 30) s.push(arrow(garage.x0 + 10, y));
    s.push(text(garage.x0 + 3, garage.y1 - 4, "SERVICE GARAGE", 1.35, C.paper, `opacity=".55"`));

    // Wear, story decals and baked lamp light (scripts/lastcall/detail.ts).
    s.push(lastCallFloorDetail());

    // Subtle, flat evidence of abandonment, placed relative to the authored props.
    for (const p of LastCallProps) {
        if (p.type === "zombie_garage_car") {
            s.push(
                `<ellipse cx="${n(p.pos.x + 1.2)}" cy="${
                    n(p.pos.y + 5.5)
                }" rx="2.3" ry="1.2" fill="#202b27" opacity=".65"/>`,
            );
            s.push(line(p.pos.x - 2.3, p.pos.y + 6, p.pos.x - 2.3, p.pos.y + 10, "#202b27", .35, `opacity=".4"`));
        }
        if (p.type === "lastcall_pallet" || p.type.includes("luggage")) {
            s.push(
                rect(
                    p.pos.x + 3.4,
                    p.pos.y + 1.2,
                    .9,
                    .6,
                    C.paper,
                    `opacity=".45" transform="rotate(18 ${n(p.pos.x + 3.4)} ${n(p.pos.y + 1.2)})"`,
                ),
            );
        }
    }
    for (const [i, e] of LastCallEntries.entries()) {
        if (i % 4 !== 0) continue;
        s.push(
            `<path d="M${n(e.pos.x)} ${
                n(e.pos.y)
            }l1 1.6 -.5 1.1 1 2.2" stroke="#6e4035" stroke-width=".5" stroke-linecap="round" fill="none" opacity=".65"/>`,
        );
    }

    // Only paint solid fixtures when their shared obstacle definition has collision.
    for (const p of LastCallProps) {
        const def = LastCallMapObjectDefs[p.type];
        if (!def || def.type !== "obstacle" || def.img.sprite || !def.collision || def.collision.type !== 1) continue;
        const col = def.collision;
        const x = col.min.x;
        const y = -col.max.y;
        const w = col.max.x - col.min.x;
        const h = col.max.y - col.min.y;
        let body = rect(x + .22, y + .28, w, h, C.ink, `opacity=".6"`)
            + rect(x, y, w, h, C.wood, `stroke="${C.edge}" stroke-width=".24"`)
            + rect(x + .2, y + .2, w - .4, h - .4, "none", `stroke="#9a8460" stroke-width=".16"`);
        if (p.type.includes("sign")) {
            body = rect(x, y, w, h, "#777d66", `stroke="${C.edge}" stroke-width=".3"`)
                + rect(x + .4, y + .4, w - .8, h - .8, "#454e3a")
                + rect(x + 1.2, y + 1.2, w - 2.4, h - 2.4, "#2d3831", `rx=".4" stroke="${C.amber}" stroke-width=".16"`)
                + text(
                    0,
                    -.3,
                    "AFTER HOURS",
                    Math.min(2.5, w / 8.7),
                    C.amber,
                    `text-anchor="middle" font-style="italic" letter-spacing=".16"`,
                )
                + text(0, 1.9, "M O T E L", 1.1, C.paper, `text-anchor="middle"`)
                + circle(x + 1, y + h / 2, .5, "#727956") + circle(x + w - 1, y + h / 2, .5, "#727956");
        } else if (p.type === "lastcall_planter") {
            body = rect(x, y, w, h, "#777866", `stroke="${C.edge}" stroke-width=".2"`)
                + circle(0, 0, Math.min(w, h) * .4, "#495c3b")
                + circle(-.35, -.35, Math.min(w, h) * .2, "#63724a");
        } else if (p.type === "lastcall_pallet") {
            body = rect(x, y, w, h, "#6a5941", `stroke="${C.edge}" stroke-width=".25"`);
            for (let a = x + .5; a < x + w - .1; a += .8) body += line(a, y + .15, a, y + h - .15, "#9a8057", .4);
            body += rect(x + .5, y + .5, w * .55, h * .6, "#947b51", `stroke="#4b4534" stroke-width=".2"`)
                + line(x + .7, y + h * .45, x + w * .6, y + h * .45, "#b69d6e", .3);
        } else if (p.type.includes("laundry")) {
            body = rect(x, y, w, h, "#aaa995", `stroke="${C.edge}" stroke-width=".22"`)
                + circle(0, .1, w * .32, "#434f46", `stroke="#808775" stroke-width=".15"`)
                + circle(0, .1, w * .2, "#6c7a69")
                + rect(x + .3, y + .2, w - .6, .3, "#697463");
        } else if (p.type.includes("parts_rack")) {
            body = rect(x, y, w, h, "#5d6758", `stroke="${C.edge}" stroke-width=".24"`);
            for (let shelfY = y + .4; shelfY < y + h - .5; shelfY += 3.2) {
                body += rect(x + .3, shelfY, w - .6, 2.7, "#958165", `stroke="#3b4539" stroke-width=".15"`);
                body += line(x + w * .45, shelfY, x + w * .45, shelfY + 2.7, "#675c45", .15);
            }
        } else if (p.type.includes("ice_machine")) {
            body = rect(x, y, w, h, "#a3a697", `stroke="${C.edge}" stroke-width=".2"`)
                + rect(x + .3, y + .3, w - .6, h - .6, "#5e746e")
                + text(0, .4, "ICE", .8, C.paper, `text-anchor="middle"`);
        } else if (p.type === "lastcall_sandbags") {
            // Two staggered rows of bags filling the collision box.
            body = "";
            const bagW = w / 5.5;
            for (let i = 0; i < 5; i++) {
                const bx = x + i * bagW * 1.1;
                body += rect(bx, y + h * .42, bagW, h * .56, "#8b8059", `rx=".4" stroke="#3b3726" stroke-width=".14"`);
            }
            for (let i = 0; i < 4; i++) {
                const bx = x + bagW * .55 + i * bagW * 1.1;
                body += rect(bx, y + .02, bagW, h * .5, "#9a8f66", `rx=".4" stroke="#3b3726" stroke-width=".14"`);
            }
        } else if (p.type === "lastcall_jersey_barrier") {
            body = rect(x + .2, y + .26, w, h, C.ink, `opacity=".5"`)
                + rect(x, y, w, h, "#a7a596", `stroke="#3a3c35" stroke-width=".16"`)
                + line(x + .3, 0, x + w - .3, 0, "#8c8b7d", .32);
            for (let a = x + 1.4; a < x + w - .8; a += 2) body += line(a, y + .1, a + .9, y + h - .1, C.red, .38);
        } else if (p.type === "lastcall_bell_cart") {
            // A luggage cart tipped on its side.
            body = rect(x + .2, y + .26, w, h, C.ink, `opacity=".5"`)
                + rect(x, y, w, h, "#5b5f57", `rx=".3" stroke="${C.edge}" stroke-width=".18"`);
            for (let k = 1; k <= 3; k++) {
                const ry = y + (h * k) / 4;
                body += line(x + .4, ry, x + w - .4, ry, "#7c8178", .2);
            }
            body += circle(x + .6, y + h - .1, .5, C.edge) + circle(x + w - .6, y + h - .1, .5, C.edge);
        } else if (p.type === "lastcall_vending") {
            body = rect(x + .2, y + .26, w, h, C.ink, `opacity=".5"`)
                + rect(x, y, w, h, "#7d2e2a", `stroke="${C.edge}" stroke-width=".18"`)
                + rect(x + .35, y + .35, w * .58, h - .7, "#d9e6e2", `opacity=".5"`)
                + rect(x + w * .72, y + .4, w * .16, h - .8, "#2d2b28");
        } else if (p.type.includes("luggage")) {
            body = rect(x, y, w, h, "#8a6548", `rx=".2" stroke="${C.edge}" stroke-width=".2"`)
                + line(-w * .2, y, -w * .2, y + h, "#bba781", .15)
                + line(w * .2, y, w * .2, y + h, "#bba781", .15);
        } else {
            body += line(x + .3, y + h * .67, x + w - .3, y + h * .67, "#504735", .12);
            body += rect(x + .6, y + .4, Math.min(1.8, w * .25), Math.min(.9, h * .4), C.paper, `opacity=".7"`);
        }
        s.push(
            `<g data-fixture="${p.type}" transform="translate(${n(p.pos.x)} ${n(p.pos.y)}) rotate(${
                -90 * (p.ori ?? 0)
            })">${body}</g>`,
        );
    }

    for (const b of LastCallBoxSpots) {
        s.push(
            rect(
                b.pos.x - 4.9,
                b.pos.y - 2.35,
                9.8,
                4.7,
                "none",
                `rx=".35" stroke="#a28d5e" stroke-width=".2" stroke-dasharray="1 .65" opacity=".5"`,
            ),
        );
    }
    for (const e of LastCallEntries) {
        if (!e.manhole) continue;
        s.push(circle(e.pos.x, e.pos.y, 1.5, "#29342f", `stroke="#7e8675" stroke-width=".22"`));
        for (let k = -1; k <= 1; k++) {
            s.push(line(e.pos.x - .9, e.pos.y + k * .5, e.pos.x + .9, e.pos.y + k * .5, "#596456", .16));
        }
    }
    for (const d of LastCallDoors) {
        const o = d.opening;
        const mid = (o.a0 + o.a1) / 2;
        const len = o.a1 - o.a0;
        const x = o.axis === "h" ? mid : o.at;
        const y = o.axis === "h" ? o.at : mid;
        let body = rect(-len / 2, -.5, len, 1, "#747465");
        if (d.kind === "shutter" || d.kind === "power") {
            const color = d.kind === "power" ? C.red : C.yellow;
            body += rect(-len / 2, -1.4, len, .4, color, `opacity=".7"`)
                + rect(-len / 2, 1, len, .4, color, `opacity=".7"`);
            body += text(0, -2.2, d.cost ? `$${d.cost}` : "POWER", 1, color, `text-anchor="middle"`);
        }
        s.push(
            `<g data-door="${d.id}" transform="translate(${n(x)} ${n(y)}) rotate(${
                o.axis === "h" ? 0 : -90
            })">${body}</g>`,
        );
        if (d.kind !== "room") s.push(circle(x, y, 7, "url(#lamp)"));
    }
    const half = LastCallWallThickness / 2;
    for (const w of lastCallWalls()) {
        const r = w.axis === "h"
            ? { x0: w.a0, y0: w.at - half, x1: w.a1, y1: w.at + half }
            : { x0: w.at - half, y0: w.a0, x1: w.at + half, y1: w.a1 };
        s.push(rect(r.x0 + .4, r.y0 + .5, r.x1 - r.x0, r.y1 - r.y0, C.ink, `opacity=".5"`));
        s.push(rr(r, C.wall, `stroke="${C.edge}" stroke-width=".1"`));
        s.push(rr(inset(r, .12), "none", `stroke="#dbd2b7" stroke-width=".1"`));
    }
    for (const e of LastCallEntries) {
        if (!e.window) continue;
        const o = e.window;
        const mid = (o.a0 + o.a1) / 2;
        const len = o.a1 - o.a0;
        let body = rect(-len / 2, -.36, len, .72, "#283f38", `stroke="#9a9b80" stroke-width=".12"`);
        for (let i = 0; i < Math.ceil(len / 1.5); i++) {
            const a = -len / 2 + .5 + i * 1.4;
            body += line(a - .3, -.65, a + .3, .65, "#8e7350", .45, `stroke-linecap="square"`);
        }
        s.push(
            `<g data-window="${e.zone}" transform="translate(${n(o.axis === "h" ? mid : o.at)} ${
                n(o.axis === "h" ? o.at : mid)
            }) rotate(${o.axis === "h" ? 0 : -90})">${body}</g>`,
        );
        s.push(circle(e.pos.x, e.pos.y, 5, "url(#lamp)", `opacity=".45"`));
    }
    s.push(circle(LastCallPowerSwitchPos.x, LastCallPowerSwitchPos.y, 4, "url(#lamp)"));
    s.push(text(LastCallPowerSwitchPos.x - 2.2, LastCallPowerSwitchPos.y - 2, "POWER", .9, C.amber));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round((W + 2 * A) * PX)}" height="${
        Math.round((H + 2 * A) * PX)
    }" viewBox="${-A} ${-A} ${W + 2 * A} ${H + 2 * A}"><defs>${defs.join("")}</defs>${s.join("")}</svg>\n`;
}

function sprite(w: number, h: number, body: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SPX}" height="${
        h * SPX
    }" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
}
function shutter(power: boolean): string {
    const color = power ? C.red : C.yellow;
    let body = rect(.03, .03, 5.94, 1.14, "#46504a", `stroke="${C.edge}" stroke-width=".06"`);
    for (let x = .12; x < 6; x += .33) body += line(x, .12, x, 1.08, "#778071", .08);
    body += rect(.1, .12, .45, .96, color) + rect(5.45, .12, .45, .96, color);
    body += rect(2.5, .12, 1, .96, "#25312b", `rx=".08"`);
    body += power
        ? `<path d="M3.12 .21L2.73 .66H3.03L2.88 1L3.29 .5H3.03Z" fill="${color}"/>`
        : `<path d="M2.8 .61V.42a.2 .2 0 0 1 .4 0v.19" fill="none" stroke="${color}" stroke-width=".1"/>${
            rect(2.7, .57, .6, .37, color, `rx=".05"`)
        }`;
    return sprite(6, 1.2, body);
}
const sprites: Record<string, string> = {
    "map-lastcall-floor.svg": floorSvg(),
    "map-lastcall-shutter.svg": shutter(false),
    "map-lastcall-gate.svg": shutter(true),
    "map-lastcall-pillar.svg": sprite(
        2.5,
        2.5,
        rect(.04, .04, 2.42, 2.42, "#8b8f7a", `stroke="${C.edge}" stroke-width=".08"`)
            + rect(.25, .25, 2, 2, "#a5a68d") + rect(.04, 1.9, 2.42, .5, C.yellow)
            + line(.25, 2.35, .65, 1.9, C.ink, .2) + line(1.05, 2.35, 1.45, 1.9, C.ink, .2)
            + line(1.85, 2.35, 2.25, 1.9, C.ink, .2),
    ),
    "map-lastcall-car.svg": sprite(
        5,
        8.5,
        rect(.13, .14, 4.74, 8.22, "#737c69", `rx="1" stroke="#202b25" stroke-width=".2"`)
            + rect(.5, .45, 4, 1.5, "#87917a", `rx=".35"`) + rect(.7, 2.15, 3.6, 1.6, "#263a35", `rx=".3"`)
            + rect(.75, 3.95, 3.5, 1.7, "#8c947d", `rx=".15"`) + rect(.7, 5.9, 3.6, 1.1, "#263a35", `rx=".25"`)
            + rect(.7, .22, .9, .3, "#d1c095") + rect(3.4, .22, .9, .3, "#bbaa87")
            + rect(.7, 7.95, .8, .26, C.red) + rect(3.5, 7.95, .8, .26, "#5f3930")
            + `<path d="M3.1 2.2L2.5 2.8L3.4 3.6M2.5 2.8L1.5 2.45" fill="none" stroke="#8e9c89" stroke-width=".08"/>`
            + `<path d="M.55 6.1l.3 .3 -.2 .6M4.5 1l-.35 .3 .2 .7" fill="none" stroke="#a18b62" stroke-width=".2"/>`
            + line(.25, 4.1, .5, 4.1, C.ink, .16) + line(4.5, 4.1, 4.75, 4.1, C.ink, .16),
    ),
    "map-lastcall-dumpster.svg": sprite(
        5.5,
        3,
        rect(.08, .08, 5.34, 2.84, "#536147", `rx=".15" stroke="${C.edge}" stroke-width=".16"`)
            + rect(.3, .3, 2.35, 2.4, "#667456") + rect(2.85, .3, 2.35, 2.4, "#5c6b4d")
            + line(.5, 1.5, 5, 1.5, "#36442f", .15) + rect(2.3, 1.1, .9, .6, "#9f9270")
            + line(.4, 2.6, 1.2, 2.7, "#9b8054", .12),
    ),
};
for (const [name, svg] of Object.entries(sprites)) {
    fs.writeFileSync(path.join(outDir, name), svg);
    console.log(`wrote ${name} (${(svg.length / 1024).toFixed(1)} KB)`);
}
