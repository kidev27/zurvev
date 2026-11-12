import { type SpecOpsDifficulty, specOpsDifficultyMods } from "../../../shared/defs/maps/specOpsShop.ts";
import { ZombiePackAPunchStats } from "../../../shared/defs/maps/zombiePackAPunch.ts";
import { ZombieWonderWeapons } from "../../../shared/defs/maps/zombieWonderWeapons.ts";

/**
 * Zombie Survival content lives separately from the legacy Spec Ops roster.
 * Walkers are the horde; Runners and Brutes mix in from later rounds (see ZombieVariants).
 */
export type ZombieClass = "zombie_walker" | "zombie_runner" | "zombie_brute";

export interface ZombieLoadout {
    name: string;
    gun: string;
    outfits: string[];
    outfit: string;
    chest: string;
    helmet: string;
    backpack: string;
    perks: string[];
    melee: string;
    range: number;
    holdRange: number;
    /** Fallback only: zombies move at `zombieSpeedMult(class, difficulty)`. Kept at the Regular speed. */
    speedMult: number;
    /** Speed relative to a walker on the same difficulty (default 1). For future zombie types. */
    speedScale?: number;
    turnRate: number;
    aimError: number;
    reaction: number;
    burst: number;
    burstPause: number;
}

export const ZombieLoadouts: Record<ZombieClass, ZombieLoadout> = {
    zombie_walker: {
        name: "Zombie",
        gun: "",
        // Three normal-zombie body variants so a horde doesn't look copy-pasted.
        outfits: ["outfitZombie01", "outfitZombie02", "outfitZombie03"],
        outfit: "outfitZombie01",
        chest: "",
        helmet: "",
        backpack: "backpack00",
        perks: [],
        melee: "fists",
        range: 3,
        holdRange: 2.2,
        speedMult: 0.55,
        turnRate: 150,
        aimError: 0,
        reaction: 0.18,
        burst: 0.2,
        burstPause: 0.42,
    },
    zombie_runner: {
        name: "Runner",
        gun: "",
        outfits: ["outfitZombieRunner"],
        outfit: "outfitZombieRunner",
        chest: "",
        helmet: "",
        backpack: "backpack00",
        perks: [],
        melee: "fists",
        range: 3,
        holdRange: 2.2,
        speedMult: 0.55,
        speedScale: 1.3,
        turnRate: 180,
        aimError: 0,
        reaction: 0.14,
        burst: 0.2,
        burstPause: 0.42,
    },
    zombie_brute: {
        name: "Brute",
        gun: "",
        outfits: ["outfitZombieBrute"],
        outfit: "outfitZombieBrute",
        chest: "",
        helmet: "",
        backpack: "backpack00",
        perks: [],
        melee: "fists",
        range: 3.4,
        holdRange: 2.6,
        speedMult: 0.55,
        speedScale: 0.8,
        turnRate: 120,
        aimError: 0,
        reaction: 0.22,
        burst: 0.2,
        burstPause: 0.5,
    },
};

/**
 * Zombie variants. Everything else about them (chase AI, entries, routes) is the walker's.
 * - runner: from `fromRound`, `shareStart` of each wave, growing by `sharePerRound` up to `shareMax`
 *   (at least one once unlocked). Dies to Insta-Kill and Nuke like a walker.
 * - brute: `count` per wave from `fromRound`, plus one more from `secondFromRound`; never more
 *   than `maxPerWave` (a wave ends only when all its zombies die, so that also caps Brutes alive).
 *   Resists Insta-Kill (double damage) and Nuke (loses a fraction of health).
 * healthMult scales the walker health for the round; the Brute's cap is `healthCap`.
 */
export const ZombieVariants = {
    runner: {
        fromRound: 4,
        shareStart: 0.05,
        sharePerRound: 0.05,
        shareMax: 0.2,
        healthMult: 0.7,
    },
    brute: {
        fromRound: 8,
        count: 1,
        secondFromRound: 12,
        maxPerWave: 2,
        healthMult: 4,
        healthCap: 1200,
        meleeDamageMult: 2,
        scale: 1.3,
        killCash: 200,
    },
};

/** Zombie move speed (x base player speed) by difficulty, before kill-heat rush. */
export const ZombieSpeedByDifficulty: Record<SpecOpsDifficulty, number> = {
    recruit: 0.51,
    regular: 0.55,
    hardened: 0.59,
    veteran: 0.64,
};

/**
 * Kill-heat rush in Zombies: at full push pressure zombies move this much faster
 * (Fireteam keeps its own +38%).
 */
export const ZombieRushSpeedBonus = 0.15;

/** Hard cap on a zombie's base speed so fast types stay within what navigation handles. */
export const ZombieMaxSpeedMult = 0.75;

export function zombieSpeedMult(kind: ZombieClass, difficulty: SpecOpsDifficulty = "regular"): number {
    const base = ZombieSpeedByDifficulty[difficulty] ?? ZombieSpeedByDifficulty.regular;
    return Math.min(ZombieMaxSpeedMult, base * (ZombieLoadouts[kind].speedScale ?? 1));
}

/**
 * Zombies economy (Black Ops style). Difficulty still scales starting cash.
 * - Every non-lethal hit pays `hitCash`, up to `maxHitCashPerZombie` per zombie.
 * - The killing blow pays `killCash`, plus `meleeKillBonus` for melee kills.
 * - No end-of-round bonus and no early-start cash.
 * Double Points doubles hit and kill cash.
 */
export const ZombieEconomy = {
    startingCash: 500,
    hitCash: 10,
    maxHitCashPerZombie: 100,
    killCash: 60,
    meleeKillBonus: 100,
};

export const ZombieKillBounty = ZombieEconomy.killCash;

export const ZombieMysteryBoxCost = 1000;
export const ZombieMysteryBoxRollDuration = 4;
export const ZombieMysteryBoxCycleInterval = 0.19;
export const ZombieMysteryBoxClaimDuration = 10;
export const ZombieMysteryBoxCooldown = 1.25;
export const ZombieMysteryBoxRelocateUses = 3;
// Pack-a-Punch numbers live in shared/defs/maps/zombiePackAPunch.ts.
export const ZombieUpgradeCost = ZombiePackAPunchStats.cost;
export const ZombieUpgradeDamageMult = ZombiePackAPunchStats.damageMult;
export const ZombieUpgradeMagazineMult = ZombiePackAPunchStats.magazineMult;

export const ZombieBuyGateCosts = {
    zombie_buy_gate_750: 750,
    zombie_buy_gate_1000: 1000,
    zombie_buy_gate_1250: 1250,
    zombie_buy_gate_1500: 1500,
    zombie_buy_gate_2000: 2000,
} as const;

export function zombieBuyGateCost(type: string): number | undefined {
    return ZombieBuyGateCosts[type as keyof typeof ZombieBuyGateCosts];
}

/** Guns with normal ammo and pickup behavior that work cleanly in the box. */
export const ZombieMysteryBoxWeapons = [
    "mp5",
    "ppsh41",
    "mp40",
    "mac10",
    "ump9",
    "vector",
    "famas",
    "hk416",
    "m4a1",
    "ak47",
    "scar",
    "fal",
    "an94",
    "m870",
    "winchester1887",
    "m1100",
    "saiga",
    "spas12",
    "m1014",
    "deagle",
    "m39",
    "sv98",
    "awc",
    "dp28",
    "rpd",
    "pkp",
    "m249",
    "qbb97",
] as const;

export type ZombieMysteryBoxWeapon = typeof ZombieMysteryBoxWeapons[number];

/** The only throwables Max Ammo refills in Zombies. Everything else is left as-is. */
export const ZombieMaxAmmoThrowables: readonly string[] = ["frag", "mirv"];

/**
 * Ray Gun (wonder weapon). The box rolls it at `boxChance`; the other box guns
 * split the rest evenly. A player can't roll it while holding one or while a
 * Ray Gun they dropped is still on the floor.
 */
export const ZombieRayGun = {
    type: "raygun",
    boxChance: ZombieWonderWeapons[0].chance,
    /** Splash (explosion_raygun) falls from damage at rad.min to this fraction at rad.max. */
    splashEdgeMult: 0.5,
    /** Flat damage to the shooter when caught in their own splash. */
    selfDamage: 10,
} as const;

export function isZombieClass(kind: string | undefined): kind is ZombieClass {
    return kind === "zombie_walker" || kind === "zombie_runner" || kind === "zombie_brute";
}

/** Walkers and Runners: Insta-Kill and Nuke kill them outright. */
export function isOrdinaryZombieClass(kind: string | undefined): boolean {
    return kind === "zombie_walker" || kind === "zombie_runner";
}

/** Round one starts small, then grows steadily with team size and difficulty. */
export function zombieWaveCount(
    wave: number,
    humans: number,
    difficulty: SpecOpsDifficulty = "regular",
): number {
    const round = Math.max(1, Math.floor(wave));
    const players = Math.max(1, Math.floor(humans));
    const soloCount = 4 + round * 2 + Math.floor(Math.max(0, round - 5) * 0.6);
    const teamScale = 1 + Math.max(0, players - 1) * 0.55;
    const difficultyScale = specOpsDifficultyMods(difficulty).roster;
    return Math.max(4, Math.min(48, Math.round(soloCount * teamScale * difficultyScale)));
}

export function zombieRunnerCount(wave: number, total: number): number {
    const { fromRound, shareStart, sharePerRound, shareMax } = ZombieVariants.runner;
    const round = Math.floor(wave);
    if (round < fromRound) return 0;
    const share = Math.min(shareMax, shareStart + (round - fromRound) * sharePerRound);
    return Math.max(1, Math.floor(total * share));
}

export function zombieBruteCount(wave: number): number {
    const { fromRound, count, secondFromRound, maxPerWave } = ZombieVariants.brute;
    const round = Math.floor(wave);
    if (round < fromRound) return 0;
    return Math.min(maxPerWave, count + (round >= secondFromRound ? 1 : 0));
}

/**
 * Walkers fill the wave; Runners are spread evenly through it; Brutes come last.
 * The total is unchanged by variants.
 */
export function composeZombieWave(
    wave: number,
    humans: number,
    difficulty: SpecOpsDifficulty = "regular",
): ZombieClass[] {
    const total = zombieWaveCount(wave, humans, difficulty);
    const roster: ZombieClass[] = Array.from({ length: total }, () => "zombie_walker" as const);
    const brutes = Math.min(zombieBruteCount(wave), total - 1);
    for (let i = 0; i < brutes; i++) roster[total - 1 - i] = "zombie_brute";
    const runners = Math.min(zombieRunnerCount(wave, total), total - brutes);
    const spread = (total - brutes) / Math.max(1, runners);
    for (let i = 0; i < runners; i++) roster[Math.floor((i + 0.5) * spread)] = "zombie_runner";
    return roster;
}

export function zombieEnemyHealth(
    wave: number,
    difficulty: SpecOpsDifficulty = "regular",
    kind: ZombieClass = "zombie_walker",
): number {
    const round = Math.max(1, Math.floor(wave));
    const base = 42 + Math.max(0, round - 1) * 5;
    const walker = Math.min(
        300,
        Math.max(24, Math.round(base * specOpsDifficultyMods(difficulty).enemyHp)),
    );
    if (kind === "zombie_runner") return Math.max(1, Math.round(walker * ZombieVariants.runner.healthMult));
    if (kind === "zombie_brute") {
        return Math.min(ZombieVariants.brute.healthCap, Math.round(walker * ZombieVariants.brute.healthMult));
    }
    return walker;
}
