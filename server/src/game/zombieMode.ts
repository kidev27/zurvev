import { type SpecOpsDifficulty, specOpsDifficultyMods } from "../../../shared/defs/maps/specOpsShop.ts";
import { ZombiePackAPunchStats } from "../../../shared/defs/maps/zombiePackAPunch.ts";
import { ZombieWonderWeapons } from "../../../shared/defs/maps/zombieWonderWeapons.ts";

/**
 * Zombie Survival content lives separately from the legacy Spec Ops roster.
 * This first slice intentionally has one readable melee archetype.
 */
export type ZombieClass = "zombie_walker";

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
};

/** Zombie move speed (x base player speed) by difficulty, before kill-heat rush. */
export const ZombieSpeedByDifficulty: Record<SpecOpsDifficulty, number> = {
    recruit: 0.51,
    regular: 0.55,
    hardened: 0.59,
    veteran: 0.64,
};

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
    return kind === "zombie_walker";
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

export function composeZombieWave(
    wave: number,
    humans: number,
    difficulty: SpecOpsDifficulty = "regular",
): ZombieClass[] {
    return Array.from(
        { length: zombieWaveCount(wave, humans, difficulty) },
        () => "zombie_walker" as const,
    );
}

export function zombieEnemyHealth(
    wave: number,
    difficulty: SpecOpsDifficulty = "regular",
): number {
    const round = Math.max(1, Math.floor(wave));
    const base = 42 + Math.max(0, round - 1) * 5;
    return Math.min(
        300,
        Math.max(24, Math.round(base * specOpsDifficultyMods(difficulty).enemyHp)),
    );
}
