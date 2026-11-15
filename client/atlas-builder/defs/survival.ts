import { SurvivalLayouts } from "../../../shared/defs/maps/survival/index.ts";
import type { AtlasDef } from "../atlasDefs.ts";

// Each map loads only its own environment art, with the shared interactive station sprites.
const stations = [
    "map/map-lastcall-shutter.svg",
    "map/map-lastcall-gate.svg",
    "map/map-zombie-perk-juggernog.svg",
    "map/map-zombie-perk-speed-cola.svg",
    "map/map-zombie-perk-quick-revive.svg",
    "map/map-zombie-perk-quick-revive-off.svg",
    "map/map-zombie-perk-stamin-up.svg",
    "map/map-zombie-perk-double-tap.svg",
    "map/map-zombie-pap.svg",
    "map/map-zombie-pap-on.svg",
    "map/map-zombie-pap-gear.svg",
];
export const SurvivalAtlases = Object.fromEntries(SurvivalLayouts.map(layout => [layout.key, {
    compress: true,
    images: [
        ...stations,
        `map/map-survival-${layout.key}-floor-0.svg`,
        `map/map-survival-${layout.key}-floor-1.svg`,
        ...layout.zones.filter(zone => zone.roof && zone.layer === 0).map(zone =>
            `map/map-survival-${layout.key}-roof-${zone.id}.svg`
        ),
    ],
}])) as Record<"highwater" | "deadair", AtlasDef>;
