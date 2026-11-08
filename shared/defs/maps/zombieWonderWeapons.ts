/** Mystery-box chances are absolute; an ineligible result falls back to a normal gun. */
export const ZombieWonderWeapons = [
    { type: "raygun", chance: 0.04 },
    { type: "pressure_cannon", chance: 0.02 },
    { type: "tesla_rifle", chance: 0.02 },
    { type: "gravegun", chance: 0.02 },
] as const;

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
