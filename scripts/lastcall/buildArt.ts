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
// Dusk + neon, Zombs Royale style: saturated floors, chunky dark outlines, warm lamp pools.
const C = {
    street: "#3a2f5c",
    sidewalk: "#6b5b94",
    curb: "#a493d1",
    wall: "#f4e2bd",
    wallTop: "#fff4dc",
    edge: "#2a1d38",
    amber: "#ffb547",
    yellow: "#ffd23f",
    red: "#ff5a5f",
    pink: "#ff4fd8",
    cyan: "#3ef0ff",
    ink: "#1d1429",
    paper: "#fff1d6",
    wood: "#d08b4c",
};
const palette: Record<LastCallZoneId, [string, string]> = {
    lobby: ["#e9a47a", "#d88f62"],
    storage: ["#c99a63", "#b3844f"],
    courtyard: ["#4d4b8a", "#5a58a0"],
    diner: ["#e4544f", "#f7e6c4"],
    alley: ["#433f78", "#4f4b8c"],
    wing: ["#2fa39e", "#27908b"],
    club: ["#5fae96", "#4f9a84"],
    office: ["#d08b4c", "#b8743a"],
    garage: ["#8890c4", "#7a82b6"],
};
/** Guest-room carpets, alternating. */
const roomCarpet = ["#4f7fd6", "#8a64d6"];
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
    }) rotate(${rotation})" fill="none" stroke="${C.paper}" stroke-width=".5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`;
}

function floorSvg(): string {
    const A = LastCallApron;
    const W = LastCallWidth;
    const H = LastCallHeight;
    const defs = [
        `<radialGradient id="lamp"><stop stop-color="${C.amber}" stop-opacity=".32"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient>`,
        `<radialGradient id="neonPink"><stop stop-color="${C.pink}" stop-opacity=".45"/><stop offset="1" stop-color="${C.pink}" stop-opacity="0"/></radialGradient>`,
        `<radialGradient id="neonCyan"><stop stop-color="${C.cyan}" stop-opacity=".35"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient>`,
        `<pattern id="carpet" width="3" height="3" patternUnits="userSpaceOnUse">${
            rect(0, 0, 3, 3, palette.wing[0])
        }<path d="M0 1.5h3M1.5 0v3" stroke="${palette.wing[1]}" stroke-width=".25"/>${
            circle(1.5, 1.5, .35, "#7fe0d6")
        }</pattern>`,
        `<pattern id="dinerTiles" width="6" height="6" patternUnits="userSpaceOnUse">${
            rect(0, 0, 6, 6, palette.diner[0])
        }${rect(0, 0, 3, 3, palette.diner[1])}${rect(3, 3, 3, 3, palette.diner[1])}</pattern>`,
        `<pattern id="officeWood" width="2.8" height="12" patternUnits="userSpaceOnUse">${
            rect(0, 0, 2.8, 12, palette.office[0])
        }${line(.1, 0, .1, 12, palette.office[1])}${line(0, 7, 2.8, 7, "#a8642c", .14)}</pattern>`,
    ];
    defs.push(...LastCallDetailDefs);
    const s = [rect(-A, -A, W + 2 * A, H + 2 * A, C.street)];
    // Dusk street and a chunky lilac sidewalk that follows the building footprint.
    for (const z of LastCallZones) s.push(rr(inset(z.rect, -3), C.curb));
    for (const z of LastCallZones) s.push(rr(inset(z.rect, -2.6), C.sidewalk));
    s.push(line(-A + 2, H + 6.5, W + A - 2, H + 6.5, C.yellow, .45, `stroke-dasharray="4 5" opacity=".85"`));
    for (const z of LastCallZones) {
        const r = z.rect;
        const [base, seam] = palette[z.id];
        defs.push(`<clipPath id="zone-${z.id}">${rr(inset(r, .6), "white")}</clipPath>`);
        s.push(
            rr(
                r,
                z.id === "diner"
                    ? "url(#dinerTiles)"
                    : z.id === "office"
                    ? "url(#officeWood)"
                    : z.id === "wing"
                    ? "url(#carpet)"
                    : base,
            ),
        );
        if (!["wing", "office", "diner"].includes(z.id)) {
            s.push(grid(r, z.id === "lobby" ? 4 : z.id === "storage" ? 3 : 12, seam, z.id === "lobby" ? .16 : .22));
        }
        // Stable sparse wear. Low contrast and no noise filters: players remain easy to see.
        let seed = z.id.split("").reduce((a, b) => a + b.charCodeAt(0), 17);
        const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        let marks = "";
        for (let i = 0; i < 18; i++) {
            const x = r.x0 + random() * (r.x1 - r.x0);
            const y = r.y0 + random() * (r.y1 - r.y0);
            marks += line(x, y, x + 1 + random() * 2, y + random() * .5, C.edge, .1, `opacity=".12"`);
        }
        s.push(`<g clip-path="url(#zone-${z.id})">${marks}</g>`);
    }

    const lobby = zone("lobby");
    const rug = centered(lobby, (lobby.x1 - lobby.x0) * .6, (lobby.y1 - lobby.y0) * .26);
    s.push(rr(rug, "#c2385c"), rr(inset(rug, .55), "none", `stroke="${C.yellow}" stroke-width=".3"`));
    s.push(text(lobby.x0 + 3, lobby.y0 + 4, "RECEPTION", 1.6, C.paper, `letter-spacing=".25" opacity=".9"`));
    s.push(
        text(
            (rug.x0 + rug.x1) / 2,
            (rug.y0 + rug.y1) / 2 + .5,
            "WELCOME",
            1.4,
            C.yellow,
            `text-anchor="middle" opacity=".9"`,
        ),
    );

    const court = zone("courtyard");
    // Side parking bays leave a continuous lane around the central sign island.
    for (let y = court.y0 + 8; y < court.y1 - 6; y += 13) {
        s.push(line(court.x0 + 3, y, court.x0 + 19, y, C.yellow, .45, `opacity=".9"`));
        s.push(line(court.x1 - 19, y, court.x1 - 3, y, C.yellow, .45, `opacity=".9"`));
    }
    s.push(arrow((court.x0 + court.x1) / 2, court.y0 + 8, 90));
    s.push(arrow((court.x0 + court.x1) / 2, court.y1 - 8, -90));

    const diner = zone("diner");
    s.push(rect(diner.x0 + 1, diner.y0 + 1, (diner.x1 - diner.x0) * .43, 9, "#9fd8e8"));
    s.push(grid({ x0: diner.x0 + 1, y0: diner.y0 + 1, x1: diner.x0 + 1 + (diner.x1 - diner.x0) * .43, y1: diner.y0 + 10 }, 1.5, "#7fbfd2", .12));
    s.push(
        text(
            diner.x1 - 4,
            diner.y1 - 3,
            "NIGHT OWL DINER",
            2,
            C.cyan,
            `text-anchor="end" letter-spacing=".1" stroke="${C.edge}" stroke-width=".15" paint-order="stroke"`,
        ),
    );
    const storage = zone("storage");
    s.push(text(storage.x0 + 2, storage.y0 + 3, "LINEN / STOCK", 1.1, C.paper, `opacity=".85"`));
    const alley = zone("alley");
    s.push(line(alley.x0 + 1.7, alley.y0 + 2, alley.x0 + 1.7, alley.y1 - 2, C.yellow, .4, `opacity=".9"`));
    s.push(line(alley.x1 - 1.7, alley.y0 + 2, alley.x1 - 1.7, alley.y1 - 2, C.yellow, .4, `opacity=".9"`));
    s.push(text(alley.x0 + 3, alley.y1 - 4, "KEEP CLEAR", 1.1, C.yellow, `opacity=".9"`));
    for (const r of LastCallMotelRooms) {
        const i = LastCallMotelRooms.indexOf(r);
        s.push(rr(inset(r, .65), roomCarpet[i % 2]));
        s.push(rr(inset(r, 2), "none", `stroke="#ffffff" stroke-width=".25" opacity=".35"`));
        s.push(rect(r.x0 + 1, r.y1 - 6, 5, 5, "#bfe6f2", `stroke="${C.edge}" stroke-width=".2"`));
        s.push(text(r.x1 - 2.2, r.y1 - 2.2, `${101 + i}`, 1.6, C.yellow, `text-anchor="end"`));
    }
    const wing = zone("wing");
    const hallX = LastCallMotelRooms[0]?.x1 ?? wing.x0;
    s.push(line(hallX + 2.5, wing.y0 + 1, hallX + 2.5, wing.y1 - 1, C.yellow, .3, `opacity=".6"`));
    s.push(text(hallX + 4, wing.y0 + 4, "GUEST ROOMS", 1.4, C.paper, `opacity=".95"`));

    const service = zone("club");
    for (const [i, r] of LastCallInteriorRooms.slice(LastCallMotelRooms.length).entries()) {
        s.push(rr(inset(r, .6), i === 0 ? "#e0b45e" : "#a9e3f0"));
        s.push(grid(inset(r, .6), 3, i === 0 ? "#c99c48" : "#86cadb", .16));
        s.push(text(r.x0 + 2, r.y1 - 2.5, i === 0 ? "PARTS STORE" : "LAUNDRY", 1.2, C.edge, `opacity=".85"`));
    }
    s.push(text(service.x0 + 4, service.y1 - 4, "MAINTENANCE", 1.8, C.paper, `letter-spacing=".15" opacity=".95"`));
    s.push(text(service.x0 + 4, service.y1 - 2.2, "EMPLOYEES ONLY", .85, C.yellow, `letter-spacing=".1"`));
    const office = zone("office");
    s.push(text(office.x0 + 2.5, office.y1 - 3, "MANAGER", 1.4, C.paper, `opacity=".95"`));
    const garage = zone("garage");
    for (let y = garage.y0 + 9; y < garage.y1 - 6; y += 14) {
        s.push(line(garage.x1 - 13, y, garage.x1 - 1, y, C.yellow, .45, `opacity=".9"`));
    }
    for (let y = garage.y0 + 13; y < garage.y1 - 6; y += 30) s.push(arrow(garage.x0 + 8, y));
    s.push(text(garage.x0 + 3, garage.y1 - 4, "SERVICE GARAGE", 1.6, C.paper, `opacity=".95"`));

    // Wear, story decals and baked lamp light (scripts/lastcall/detail.ts).
    s.push(lastCallFloorDetail());

    // Subtle, flat evidence of abandonment, placed relative to the authored props.
    for (const p of LastCallProps) {
        if (p.type === "zombie_garage_car") {
            s.push(
                `<ellipse cx="${n(p.pos.x + 1.2)}" cy="${
                    n(p.pos.y + 5.5)
                }" rx="2.3" ry="1.2" fill="${C.ink}" opacity=".35"/>`,
            );
            s.push(line(p.pos.x - 2.3, p.pos.y + 6, p.pos.x - 2.3, p.pos.y + 10, C.ink, .35, `opacity=".25"`));
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
            }l1 1.6 -.5 1.1 1 2.2" stroke="#b8223a" stroke-width=".5" stroke-linecap="round" fill="none" opacity=".6"/>`,
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
        let body = rect(x + .3, y + .4, w, h, C.ink, `opacity=".4" rx=".3"`)
            + rect(x, y, w, h, C.wood, `rx=".3" stroke="${C.edge}" stroke-width=".35"`)
            + rect(x + .35, y + .35, w - .7, h - .7, "none", `rx=".2" stroke="#f2b878" stroke-width=".2"`);
        if (p.type.includes("sign")) {
            body = `<ellipse cx="0" cy="0" rx="${n(w * .85)}" ry="${n(h * 1.3)}" fill="url(#neonPink)"/>`
                + rect(x + .3, y + .4, w, h, C.ink, `opacity=".45" rx=".6"`)
                + rect(x, y, w, h, "#2b2050", `rx=".6" stroke="${C.edge}" stroke-width=".4"`)
                + rect(x + .8, y + .8, w - 1.6, h - 1.6, "none", `rx=".4" stroke="${C.cyan}" stroke-width=".3"`)
                + text(
                    0,
                    -.2,
                    "AFTER HOURS",
                    Math.min(2.8, w / 8),
                    C.pink,
                    `text-anchor="middle" font-style="italic" letter-spacing=".16" stroke="#ffd0f4" stroke-width=".08"`,
                )
                + text(0, 2.1, "M O T E L", 1.2, C.cyan, `text-anchor="middle"`)
                + circle(x + 1.2, y + h / 2, .55, C.yellow, `stroke="${C.edge}" stroke-width=".15"`)
                + circle(x + w - 1.2, y + h / 2, .55, C.yellow, `stroke="${C.edge}" stroke-width=".15"`);
        } else if (p.type === "lastcall_planter") {
            body = rect(x + .2, y + .3, w, h, C.ink, `opacity=".4" rx=".4"`)
                + rect(x, y, w, h, "#d9774b", `rx=".4" stroke="${C.edge}" stroke-width=".3"`)
                + circle(0, 0, Math.min(w, h) * .42, "#4cc35a", `stroke="${C.edge}" stroke-width=".22"`)
                + circle(-.4, -.4, Math.min(w, h) * .2, "#8ef07e");
        } else if (p.type === "lastcall_pallet") {
            body = rect(x + .25, y + .35, w, h, C.ink, `opacity=".4"`)
                + rect(x, y, w, h, "#c98f52", `stroke="${C.edge}" stroke-width=".3"`);
            for (let a = x + .5; a < x + w - .1; a += .8) body += line(a, y + .15, a, y + h - .15, "#e8b273", .4);
            body += rect(x + .5, y + .5, w * .55, h * .6, "#5aa0e0", `rx=".2" stroke="${C.edge}" stroke-width=".25"`)
                + line(x + .7, y + h * .45, x + w * .6, y + h * .45, "#a8d4ff", .3);
        } else if (p.type.includes("laundry")) {
            body = rect(x, y, w, h, "#f6f3ea", `rx=".3" stroke="${C.edge}" stroke-width=".3"`)
                + circle(0, .1, w * .32, "#3b5aa8", `stroke="${C.edge}" stroke-width=".2"`)
                + circle(0, .1, w * .2, "#7fd3ff")
                + rect(x + .3, y + .2, w - .6, .3, "#ff8a5c");
        } else if (p.type.includes("parts_rack")) {
            body = rect(x + .25, y + .35, w, h, C.ink, `opacity=".4"`)
                + rect(x, y, w, h, "#3d6fc4", `stroke="${C.edge}" stroke-width=".3"`);
            for (let shelfY = y + .4; shelfY < y + h - .5; shelfY += 3.2) {
                body += rect(x + .3, shelfY, w - .6, 2.7, "#ff9f45", `rx=".2" stroke="${C.edge}" stroke-width=".18"`);
                body += line(x + w * .45, shelfY, x + w * .45, shelfY + 2.7, "#c96f22", .2);
            }
        } else if (p.type.includes("ice_machine")) {
            body = rect(x, y, w, h, "#f6f3ea", `rx=".3" stroke="${C.edge}" stroke-width=".3"`)
                + rect(x + .35, y + .35, w - .7, h - .7, "#5fd0f0", `rx=".2"`)
                + text(0, .45, "ICE", .95, C.edge, `text-anchor="middle"`);
        } else if (p.type === "lastcall_sandbags") {
            // Two staggered rows of bags filling the collision box.
            body = "";
            const bagW = w / 5.5;
            for (let i = 0; i < 5; i++) {
                const bx = x + i * bagW * 1.1;
                body += rect(bx, y + h * .42, bagW, h * .56, "#d9b878", `rx=".45" stroke="${C.edge}" stroke-width=".2"`);
            }
            for (let i = 0; i < 4; i++) {
                const bx = x + bagW * .55 + i * bagW * 1.1;
                body += rect(bx, y + .02, bagW, h * .5, "#ecd08f", `rx=".45" stroke="${C.edge}" stroke-width=".2"`);
            }
        } else if (p.type === "lastcall_jersey_barrier") {
            body = rect(x + .25, y + .35, w, h, C.ink, `opacity=".4"`)
                + rect(x, y, w, h, "#f2f0ea", `rx=".2" stroke="${C.edge}" stroke-width=".25"`)
                + line(x + .3, 0, x + w - .3, 0, "#d4d0c6", .32);
            for (let a = x + 1.4; a < x + w - .8; a += 2) body += line(a, y + .1, a + .9, y + h - .1, C.red, .38);
        } else if (p.type === "lastcall_bell_cart") {
            // A luggage cart tipped on its side.
            body = rect(x + .25, y + .35, w, h, C.ink, `opacity=".4"`)
                + rect(x, y, w, h, "#f2b63a", `rx=".3" stroke="${C.edge}" stroke-width=".25"`);
            for (let k = 1; k <= 3; k++) {
                const ry = y + (h * k) / 4;
                body += line(x + .4, ry, x + w - .4, ry, "#b9801a", .22);
            }
            body += circle(x + .6, y + h - .1, .5, C.edge) + circle(x + w - .6, y + h - .1, .5, C.edge);
        } else if (p.type === "lastcall_vending") {
            body = `<ellipse cx="0" cy="0" rx="${n(w)}" ry="${n(h)}" fill="url(#neonPink)"/>`
                + rect(x + .25, y + .35, w, h, C.ink, `opacity=".4"`)
                + rect(x, y, w, h, "#e8335f", `rx=".25" stroke="${C.edge}" stroke-width=".25"`)
                + rect(x + .35, y + .35, w * .58, h - .7, "#bff6ff", `opacity=".85"`)
                + rect(x + w * .72, y + .4, w * .16, h - .8, C.edge);
        } else if (p.type.includes("luggage")) {
            body = rect(x, y, w, h, "#2fb7a8", `rx=".3" stroke="${C.edge}" stroke-width=".25"`)
                + line(-w * .2, y, -w * .2, y + h, "#ffd23f", .25)
                + line(w * .2, y, w * .2, y + h, "#ffd23f", .25);
        } else {
            body += line(x + .4, y + h * .67, x + w - .4, y + h * .67, "#9a5a26", .18);
            body += rect(x + .6, y + .4, Math.min(1.8, w * .25), Math.min(.9, h * .4), C.paper, `opacity=".9"`);
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
                `rx=".5" stroke="${C.cyan}" stroke-width=".3" stroke-dasharray="1 .65" opacity=".8"`,
            ),
        );
    }
    for (const e of LastCallEntries) {
        if (!e.manhole) continue;
        s.push(circle(e.pos.x, e.pos.y, 1.6, "#3b335e", `stroke="${C.edge}" stroke-width=".3"`));
        s.push(circle(e.pos.x, e.pos.y, 1.2, "none", `stroke="#8d80c4" stroke-width=".18"`));
        for (let k = -1; k <= 1; k++) {
            s.push(line(e.pos.x - .8, e.pos.y + k * .45, e.pos.x + .8, e.pos.y + k * .45, "#8d80c4", .18));
        }
    }
    for (const d of LastCallDoors) {
        const o = d.opening;
        const mid = (o.a0 + o.a1) / 2;
        const len = o.a1 - o.a0;
        const x = o.axis === "h" ? mid : o.at;
        const y = o.axis === "h" ? o.at : mid;
        let body = rect(-len / 2, -.5, len, 1, "#9a8fbf");
        if (d.kind === "shutter" || d.kind === "power") {
            const color = d.kind === "power" ? C.red : C.yellow;
            body += rect(-len / 2, -1.5, len, .5, color, `opacity=".95"`)
                + rect(-len / 2, 1, len, .5, color, `opacity=".95"`);
            body += text(0, -2.3, d.cost ? `$${d.cost}` : "POWER", 1.25, color, `text-anchor="middle" stroke="${C.edge}" stroke-width=".18" paint-order="stroke"`);
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
        s.push(rect(r.x0 + .45, r.y0 + .6, r.x1 - r.x0, r.y1 - r.y0, C.ink, `opacity=".45"`));
        s.push(rr(r, C.wall, `stroke="${C.edge}" stroke-width=".3"`));
        s.push(rr(inset(r, .3), C.wallTop));
    }
    for (const e of LastCallEntries) {
        if (!e.window) continue;
        const o = e.window;
        const mid = (o.a0 + o.a1) / 2;
        const len = o.a1 - o.a0;
        let body = rect(-len / 2, -.4, len, .8, "#7fe0ff", `stroke="${C.edge}" stroke-width=".25"`);
        for (let i = 0; i < Math.ceil(len / 1.5); i++) {
            const a = -len / 2 + .5 + i * 1.4;
            body += line(a - .3, -.7, a + .3, .7, "#c98a4b", .55, `stroke-linecap="square"`);
            body += line(a - .3, -.7, a + .3, .7, C.edge, .12);
        }
        s.push(
            `<g data-window="${e.zone}" transform="translate(${n(o.axis === "h" ? mid : o.at)} ${
                n(o.axis === "h" ? o.at : mid)
            }) rotate(${o.axis === "h" ? 0 : -90})">${body}</g>`,
        );
        s.push(circle(e.pos.x, e.pos.y, 5, "url(#lamp)", `opacity=".45"`));
    }
    s.push(circle(LastCallPowerSwitchPos.x, LastCallPowerSwitchPos.y, 4, "url(#lamp)"));
    s.push(text(LastCallPowerSwitchPos.x - 2.2, LastCallPowerSwitchPos.y - 2, "POWER", 1.1, C.yellow));
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
    let body = rect(.05, .05, 5.9, 1.1, "#5b6bb0", `rx=".1" stroke="${C.edge}" stroke-width=".1"`);
    for (let x = .25; x < 5.8; x += .33) body += line(x, .15, x, 1.05, "#8796d6", .1);
    body += rect(.1, .12, .5, .96, color, `stroke="${C.edge}" stroke-width=".05"`)
        + rect(5.4, .12, .5, .96, color, `stroke="${C.edge}" stroke-width=".05"`);
    body += rect(2.45, .12, 1.1, .96, C.edge, `rx=".1"`);
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
        rect(.06, .06, 2.38, 2.38, "#ff9f45", `rx=".2" stroke="${C.edge}" stroke-width=".12"`)
            + rect(.3, .3, 1.9, 1.9, "#ffc178", `rx=".15"`) + rect(.06, 1.85, 2.38, .55, C.yellow)
            + line(.3, 2.35, .7, 1.9, C.edge, .2) + line(1.1, 2.35, 1.5, 1.9, C.edge, .2)
            + line(1.9, 2.35, 2.3, 1.9, C.edge, .2),
    ),
    "map-lastcall-car.svg": sprite(
        5,
        8.5,
        rect(.15, .15, 4.7, 8.2, "#2fb7a8", `rx="1.1" stroke="${C.edge}" stroke-width=".3"`)
            + rect(.55, .5, 3.9, 1.5, "#5fe0cf", `rx=".4"`) + rect(.7, 2.15, 3.6, 1.6, "#2a3a6e", `rx=".35"`)
            + rect(.75, 3.95, 3.5, 1.7, "#f6f0dc", `rx=".25" stroke="${C.edge}" stroke-width=".12"`)
            + rect(.7, 5.9, 3.6, 1.1, "#2a3a6e", `rx=".3"`)
            + rect(.7, .25, .9, .32, "#fff3a8") + rect(3.4, .25, .9, .32, "#fff3a8")
            + rect(.7, 7.92, .8, .28, C.red) + rect(3.5, 7.92, .8, .28, C.red)
            + `<path d="M3.1 2.3L2.5 2.9L3.4 3.6M2.5 2.9L1.5 2.5" fill="none" stroke="#9fb8ff" stroke-width=".1"/>`
            + line(.25, 4.1, .55, 4.1, C.edge, .2) + line(4.45, 4.1, 4.75, 4.1, C.edge, .2),
    ),
    "map-lastcall-dumpster.svg": sprite(
        5.5,
        3,
        rect(.1, .1, 5.3, 2.8, "#35a35a", `rx=".25" stroke="${C.edge}" stroke-width=".2"`)
            + rect(.35, .35, 2.3, 2.3, "#4cc46e", `rx=".15"`) + rect(2.85, .35, 2.3, 2.3, "#43b965", `rx=".15"`)
            + line(.5, 1.5, 5, 1.5, "#23733e", .18) + rect(2.3, 1.1, .9, .6, C.yellow, `rx=".1"`),
    ),
    // Survev furniture redrawn for After Hours (LastCallRestyledProps). Same footprint as the survev art.
    "map-lastcall-chair.svg": sprite(
        3,
        3,
        rect(.35, .12, 2.3, 2, "#ff5a7a", `rx=".4" stroke="${C.edge}" stroke-width=".16"`)
            + rect(.65, .38, 1.7, 1.2, "#ff8fa6", `rx=".3"`)
            + rect(.75, 2.08, .3, .3, "#9aa6d6") + rect(1.95, 2.08, .3, .3, "#9aa6d6")
            + rect(.15, 2.3, 2.7, .58, "#d7defa", `rx=".28" stroke="${C.edge}" stroke-width=".16"`),
    ),
    "map-lastcall-table.svg": sprite(
        5,
        4,
        rect(.12, .12, 4.76, 3.76, "#d7defa", `rx=".55" stroke="${C.edge}" stroke-width=".22"`)
            + rect(.4, .4, 4.2, 3.2, "#6fd9c6", `rx=".4"`)
            + `<path d="M.9 1.2l.5-.3.4.3M3.3 3l.5-.3.4.3M2.3 2.3l.4-.25.35.25" fill="none" stroke="#3fae9f" stroke-width=".12"/>`
            + circle(1.5, 1.4, .6, "#fff7e6", `stroke="${C.edge}" stroke-width=".1"`)
            + circle(1.5, 1.4, .3, C.amber)
            + circle(3.55, 2.55, .45, C.pink, `stroke="${C.edge}" stroke-width=".1"`)
            + circle(3.55, 2.55, .22, "#ffd1f3") + line(3.55, 2.55, 3.95, 2.0, C.red, .1),
    ),
    "map-lastcall-stove.svg": sprite(
        7,
        5.5,
        rect(.5, .5, 6, 4.5, "#c7cfe8", `rx=".3" stroke="${C.edge}" stroke-width=".24"`)
            + rect(.62, .62, 5.76, .75, "#ff9f45", `rx=".15"`)
            + [[1.9, 2.35], [5.1, 2.35], [1.9, 3.95], [5.1, 3.95]].map(([x, y]) =>
                circle(x, y, .62, "#3b3350", `stroke="${C.edge}" stroke-width=".1"`)
                + circle(x, y, .38, "none", `stroke="#ff7a3d" stroke-width=".14"`)
            ).join("")
            + rect(2.95, 1.65, 1.1, 2.95, "#5a5470", `rx=".12" stroke="${C.edge}" stroke-width=".08"`)
            + [1.6, 2.6, 4.4, 5.4].map((x) => circle(x, 4.72, .14, C.yellow)).join("")
            + rect(2.6, 5, 1.8, .32, "#d7defa", `rx=".14" stroke="${C.edge}" stroke-width=".1"`),
    ),
    "map-lastcall-refrigerator.svg": sprite(
        3.375,
        2.94,
        rect(.12, .12, 3.13, 2.38, "#6fd9c6", `rx=".3" stroke="${C.edge}" stroke-width=".16"`)
            + rect(.35, .3, 2.68, .5, "#a8f0e3", `rx=".15"`) + line(.2, 1.9, 3.17, 1.9, "#3fae9f", .1)
            + circle(.7, 1.3, .14, C.pink) + circle(1.05, 1.15, .12, C.yellow)
            + rect(1.29, 2.42, .8, .36, "#d7defa", `rx=".12" stroke="${C.edge}" stroke-width=".1"`),
    ),
    "map-lastcall-barrel.svg": sprite(
        3.6,
        3.6,
        circle(1.8, 1.8, 1.68, "#ff5a5f", `stroke="${C.edge}" stroke-width=".2"`)
            + circle(1.8, 1.8, 1.2, "#ff7d72", `stroke="#c43a45" stroke-width=".14"`)
            + circle(.92, 1.55, .24, "#c43a45", `stroke="${C.edge}" stroke-width=".08"`)
            + `<path d="M1.95 1.1L2.65 2.35H1.25Z" fill="${C.yellow}" stroke="${C.edge}" stroke-width=".1" stroke-linejoin="round"/>`
            + rect(1.88, 1.5, .14, .45, C.edge) + circle(1.95, 2.13, .08, C.edge),
    ),
    "map-lastcall-bed.svg": sprite(
        3,
        6.75,
        rect(.1, .1, 2.8, 6.55, C.wood, `rx=".3" stroke="${C.edge}" stroke-width=".16"`)
            + rect(.3, .3, 2.4, 6.15, C.paper, `rx=".25"`)
            + rect(.5, .48, 2, 1.1, "#ffffff", `rx=".4" stroke="#cdb9a0" stroke-width=".08"`)
            + rect(.3, 2, 2.4, 4.45, "#ff6fae", `rx=".2"`)
            + rect(.3, 2, 2.4, .5, "#ffc2dc")
            + [3.1, 4.1, 5.1].map((y) => line(.3, y, 2.7, y, C.yellow, .14)).join(""),
    ),
};
for (const [name, svg] of Object.entries(sprites)) {
    fs.writeFileSync(path.join(outDir, name), svg);
    console.log(`wrote ${name} (${(svg.length / 1024).toFixed(1)} KB)`);
}
