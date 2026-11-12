/** Mystery-box chances are absolute; an ineligible result falls back to a normal gun. */
export const ZombieWonderWeapons = [
    { type: "raygun", chance: 0.03 },
    { type: "pressure_cannon", chance: 0.04 },
    { type: "tesla_rifle", chance: 0.04 },
    { type: "gravegun", chance: 0.03 },
] as const;

/**
 * Ammo only wonder weapons use (caps in ZombieAmmoBagSizes). Max Ammo refills it only for
 * players who own a gun that fires it; a Pack-a-Punched one comes back with a full stock.
 */
export const ZombieWonderAmmo: readonly string[] = ["pressure_charge", "tesla_cell"];

/**
 * Rare wonder-ammo drop from zombie kills, per ammo type. Rolls only while the killer owns
 * a gun that fires that ammo; anyone can pick it up. lifetime is in seconds.
 */
export const ZombieWonderAmmoDrops: Record<string, { killChance: number; count: number; lifetime: number }> = {
    pressure_charge: { killChance: 0.02, count: 1, lifetime: 20 },
    tesla_cell: { killChance: 0.015, count: 1, lifetime: 20 },
};

export const ZombiePressureBlast = {
    range: 20,
    nearRange: 8,
    halfAngle: Math.PI / 5,
    nearDamage: 220,
    farDamage: 90,
    push: 5,
    stun: 0.6,
    maxTargets: 24,
} as const;
