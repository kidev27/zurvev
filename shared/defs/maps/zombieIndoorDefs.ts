import { GameConfig } from "../../gameConfig.ts";
import { util } from "../../utils/util.ts";
import { v2 } from "../../utils/v2.ts";
import type { MapDef } from "../mapDefs.ts";
import type { PartialMapDef } from "./baseDefs.ts";
import { LastCallDisplayName } from "./lastCallLayout.ts";
import { SpecOps } from "./specOpsDefs.ts";

/** Zombies reserve caps before `ZombieAmmoCapMult`, one per shared ammo type. */
export const ZombieAmmoBaseCaps: Record<string, number> = {
    "9mm": 300,
    "762mm": 270,
    "556mm": 270,
    "45acp": 270,
    "12gauge": 40,
    "50AE": 84,
    "308sub": 36,
    tesla_cell: 36,
};

/**
 * All gun ammo except Pressure Charges and Rockets carries this much more in Zombies:
 * +20% in issue #74, then +20% again.
 */
export const ZombieAmmoCapMult = 1.2 * 1.2;

/** Zombies caps are rounded to the nearest multiple of this. */
export const ZombieAmmoCapStep = 5;

/** Nearest multiple of ZombieAmmoCapStep. */
export function zombieAmmoCapRound(amount: number): number {
    return Math.round(amount / ZombieAmmoCapStep) * ZombieAmmoCapStep;
}

/** Pressure Charges have their own cap, for the Cannon and its Mk II alike: 64 x 1.2 = 76.8. */
export const ZombiePressureChargeCap = zombieAmmoCapRound(64 * 1.2);

/** Rockets have their own cap, for the Rocket Launcher and its Mk II alike: 12 x 1.2 = 14.4. */
export const ZombieRocketCap = zombieAmmoCapRound(12 * 1.2);

/**
 * Zombies ammo caps (players always carry a level-1 bag here). Max Ammo fills to these and
 * box/Pack-a-Punch reserve is capped by them. Fireteam keeps `SpecOpsBagSizes`.
 * Each cap is base x ZombieAmmoCapMult rounded to the nearest multiple of 5 (zombieAmmoCapRound):
 * 9mm 430 (432), 7.62/5.56/.45 390 (388.8), 12 gauge 60 (57.6), .50 AE 120 (121), .308 and
 * Tesla 50 (51.8), Pressure Charges 75 (76.8), Rockets 15 (14.4).
 */
export const ZombieAmmoBagSizes: Record<string, number[]> = {
    ...Object.fromEntries(
        Object.entries(ZombieAmmoBaseCaps).map(([ammo, base]) => {
            const cap = zombieAmmoCapRound(base * ZombieAmmoCapMult);
            return [ammo, [cap, cap, cap, cap, cap]];
        }),
    ),
    pressure_charge: Array(5).fill(ZombiePressureChargeCap),
    rocket: Array(5).fill(ZombieRocketCap),
};

/**
 * Shared settings for indoor Zombie Survival maps: zombie rules, a small dark
 * map with no rivers, and one building placed in the middle.
 */
const zombieIndoorBase = util.mergeDeep(
    {},
    SpecOps,
    {
        gameMode: {
            indoorMode: true,
            specOpsMode: true,
            zombieMode: true,
            maxPlayers: 4,
            killLeaderEnabled: true,
        },
        gameConfig: {
            bagSizes: ZombieAmmoBagSizes,
        },
        biome: {
            colors: {
                background: 0x070812,
                water: 0x090b18,
                waterRipple: 0x17304c,
                beach: 0x0b0d1a,
                riverbank: 0x101326,
                grass: 0x0d1020,
                underground: 0x080811,
                playerSubmerge: 0x192947,
                playerGhillie: 0x15182d,
            },
            valueAdjust: 0.72,
        },
        mapGen: {
            map: {
                baseWidth: 128,
                baseHeight: 112,
                scale: { small: 1, large: 1 },
                extension: 0,
                shoreInset: 4,
                grassInset: 0,
                rivers: {
                    lakes: [],
                    weights: [{ weight: 1, widths: [] }],
                    spawnCabins: false,
                    masks: [],
                },
            },
            densitySpawns: [{}],
            fixedSpawns: [{}],
            randomSpawns: [],
            spawnReplacements: [{}],
        },
    } satisfies PartialMapDef,
) as MapDef;

/**
 * After Hours' roadside motel, maintenance hall and garage at night.
 * Layout: lastCallLayout.ts; art: scripts/lastcall/buildArt.ts.
 */
export const ZombieBranchingComplex = util.mergeDeep(
    {},
    zombieIndoorBase,
    {
        // Saved runs go to the Zombies leaderboard, not Fireteam's.
        mapId: GameConfig.MapId.Zombies,
        desc: {
            name: "Zombie Survival",
            buttonText: LastCallDisplayName,
            backgroundImg: "img/main_splash.png",
        },
        assets: {
            atlases: ["gradient", "loadout", "shared", "main", "lastcall"],
        },
        biome: {
            colors: {
                background: 0x0a0910,
                water: 0x0a0910,
                waterRipple: 0x1b1826,
                beach: 0x15131c,
                riverbank: 0x15131c,
                grass: 0x15131c,
                underground: 0x0a0910,
                playerSubmerge: 0x1b1826,
                playerGhillie: 0x15131c,
            },
            // The floor art is already painted at night; don't darken props further.
            valueAdjust: 1,
        },
        mapGen: {
            // Block is 217.5 × 172.5 plus a 10-unit street (lastCallLayout.ts, LastCallScale 1.5).
            map: {
                baseWidth: 256,
                baseHeight: 208,
            },
            places: [
                {
                    name: LastCallDisplayName,
                    pos: v2.create(0.5, 0.5),
                    dontSpawnObjects: true,
                },
            ],
            customSpawnRules: {
                locationSpawns: [
                    {
                        type: "zombie_branching_complex_01",
                        pos: v2.create(0.5, 0.5),
                        rad: 0,
                        retryOnFailure: true,
                    },
                ],
                placeSpawns: [],
            },
            importantSpawns: ["zombie_branching_complex_01"],
        },
    } satisfies PartialMapDef,
) as MapDef;
