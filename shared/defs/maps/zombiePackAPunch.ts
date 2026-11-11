import type { SpecOpsDifficulty } from "./specOpsShop.ts";

/**
 * Zombies: Pack-a-Punch.
 *
 * Every gun listed in `ZombiePackAPunchNames` gets an upgraded twin gun type,
 * `<gun>_pap` (e.g. `ak47_pap`), generated in gunDefs.ts. The upgraded type
 * copies the original gun and adds the Pack-a-Punch damage, magazine and look.
 */

/**
 * UPGRADED GUN NAMES. Edit these to rename upgraded guns.
 * Key: original gun type. Value: name shown in the HUD, kill feed and pickups.
 * To make another gun upgradable, add it here.
 */
export const ZombiePackAPunchNames: Record<string, string> = {
    pressure_cannon: "Pressure Cannon Mk II",
    tesla_rifle: "Tesla Rifle Mk II",
    gravegun: "Gravegun Mk II",
    ppsh41: "PPSh-41 Mk II",
    mp40: "MP40 Mk II",
    fal: "FN FAL Mk II",
    rpd: "RPD Mk II",
    winchester1887: "Winchester 1887 Mk II",
    pkp: "PKP Pecheneg Mk II",
    m9: "Nine Lives",
    mp5: "MP115 Kollider",
    mac10: "Mac Attack",
    ump9: "UMPocalypse",
    vector: "Velocity Vector",
    famas: "Faux Mas",
    hk416: "HK416 Mark II",
    m4a1: "M4A1-S Mark II",
    ak47: "AK-47 Mark II",
    scar: "Legendary Scar",
    an94: "Actuated Neutralizer 94000",
    m870: "One Pump",
    m1100: "Turkey Trotter",
    saiga: "Saga 12",
    spas12: "Heart SPAS-m",
    m1014: "Supernova 9000",
    deagle: "Deserted Eagle",
    m39: "M39 M.A.L.I.C.E",
    sv98: "Sovereign Verdict 98",
    awc: "Intervention",
    dp28: "Death Per Minute",
    m249: "M249 Chainsaw",
    qbb97: "Quantum Bullet Barrage",
};

/**
 * PACK-A-PUNCH SPECIALS. A few guns get a signature upgrade on top of the normal
 * Mark II bonus. To give a gun a special, move one, or remove one, edit this table:
 * the key is the original gun type, the value one of the kinds below. Guns not
 * listed stay stats-only. `label` is shown once when the Mark II gun is picked up.
 *
 * - burstToAuto: a burst gun becomes full-auto at `fireDelay` seconds per shot.
 * - variableFireRate: after each reload, the first `fastShots` shots fire at
 *   `fastFireDelay`, then the delay eases back to the gun's normal rate over
 *   `rampShots` more shots (HAMR style).
 * - pierce: a bullet hits up to `maxTargets` zombies in a line, losing
 *   `damageFalloff` of its damage at each one.
 * - chain: a hit arcs from zombie to zombie up to `maxJumps` times (each jump to
 *   the nearest unhit zombie within `range`), dealing `damageMult` of the hit.
 *   `arcLife`: seconds each lightning arc stays on screen (visual only).
 *   Optional `chainEvery`: only every Nth hit of one continuous trigger hold
 *   arcs (default 1 = every hit). Optional `stun`: the hit zombie and every
 *   zombie it arcs to freeze for that many seconds. Optional `stunEvery`: only
 *   every Nth hit of one hold stuns (default 1 = every hit); a stunning hit
 *   always arcs. For both counts, releasing the trigger (tap firing) or going
 *   ZombiePackAPunchStunStreakReset seconds without a hit restarts the count.
 *   A zombie can't be re-stunned until
 *   ZombiePackAPunchStunImmunity seconds after its last stun wore off.
 */
export type ZombiePackAPunchSpecial =
    | { kind: "burstToAuto"; label: string; fireDelay: number }
    | {
        kind: "variableFireRate";
        label: string;
        fastFireDelay: number;
        fastShots: number;
        rampShots: number;
    }
    | { kind: "pierce"; label: string; maxTargets: number; damageFalloff: number }
    | {
        kind: "chain";
        label: string;
        maxJumps: number;
        range: number;
        damageMult: number;
        arcLife: number;
        chainEvery?: number;
        stun?: number;
        stunEvery?: number;
    };

export const ZombiePackAPunchSpecials: Record<string, ZombiePackAPunchSpecial> = {
    famas: { kind: "burstToAuto", label: "Full-auto: burst fire becomes automatic", fireDelay: 0.08 },
    ump9: { kind: "burstToAuto", label: "Full-auto: burst fire becomes automatic", fireDelay: 0.09 },
    m249: {
        kind: "variableFireRate",
        label: "Overdrive: first shots of every mag fire twice as fast",
        fastFireDelay: 0.04,
        fastShots: 15,
        rampShots: 10,
    },
    sv98: { kind: "pierce", label: "Piercing: hits up to 4 zombies in a line", maxTargets: 4, damageFalloff: 0.15 },
    deagle: { kind: "pierce", label: "Piercing: hits up to 2 zombies in a line", maxTargets: 2, damageFalloff: 0.2 },
    awc: {
        kind: "chain",
        label: "Chain lightning: arcs to 3 more zombies and stuns them",
        maxJumps: 3,
        range: 6,
        damageMult: 0.4,
        arcLife: 0.7,
        stun: 0.5,
    },
    vector: {
        kind: "chain",
        label: "Chain lightning: arcs to 1 more zombie, every 10th hit stuns",
        maxJumps: 1,
        range: 5,
        damageMult: 0.39,
        arcLife: 0.3,
        chainEvery: 4,
        stun: 0.3,
        stunEvery: 10,
    },
};

/**
 * Seconds after a chain-lightning stun wears off before that zombie can be
 * stunned again, so fast guns can't keep a zombie frozen.
 */
export const ZombiePackAPunchStunImmunity = 0.75;

/**
 * For `stunEvery` guns: going this many seconds without landing a hit resets
 * the hit count, even while the trigger is held (releasing it always resets).
 */
export const ZombiePackAPunchStunStreakReset = 0.75;

/** Template for the visual-only bullet sent per chain-lightning hop. */
export const ZombiePackAPunchArcBullet = "bullet_pap_arc";

/** Per-gun chain arc bullet (carries that gun's `arcLife` to clients). */
export function packAPunchArcBulletType(gun: string): string {
    return `${ZombiePackAPunchArcBullet}_${gun}`;
}

/** Special for a Mark II gun type; undefined for normal guns and stats-only Mark IIs. */
export function packAPunchSpecialFor(gunType: string): ZombiePackAPunchSpecial | undefined {
    return isPackAPunchType(gunType) ? ZombiePackAPunchSpecials[packAPunchBaseType(gunType)] : undefined;
}

/** Upgrade stats (unchanged from the old workbench). */
export const ZombiePackAPunchStats = {
    cost: 5000,
    damageMult: 1.35,
    magazineMult: 1.5,
    /** Seconds the owner has to take the upgraded gun before it is lost. Same on every difficulty. */
    claimTime: 12,
} as const;

/** Seconds the machine works on the gun, by difficulty: 2 s longer per step above Recruit. */
export const ZombiePackAPunchUpgradeTime: Record<SpecOpsDifficulty, number> = {
    recruit: 3,
    regular: 5,
    hardened: 7,
    veteran: 9,
};

export function packAPunchUpgradeTime(difficulty: SpecOpsDifficulty): number {
    return ZombiePackAPunchUpgradeTime[difficulty] ?? ZombiePackAPunchUpgradeTime.regular;
}

/** Upgraded guns' floor/HUD glow, camo and tracer colors (client only). */
export const ZombiePackAPunchColors = {
    glow: 0x9b6bff,
    camoA: 0x8a5cff,
    camoB: 0x4fe3ff,
    /** Cyan-white "plasma core" inside a Mark II tracer (the trail is GameConfig.tracerColors.pap). */
    tracerCore: 0xd9faff,
} as const;

/**
 * Mark II tracers (client only; damage, speed and range match the original bullet).
 * Shotgun pellets get the color and thickness but no plasma core or spark trail.
 */
export const ZombiePackAPunchTracer = {
    widthMult: 1.2,
    /** Plasma core width as a fraction of the (already 1.2x) trail width. */
    coreWidthMult: 0.38,
} as const;

/** Map object type of the machine (Last Call). */
export const ZombiePackAPunchType = "zombie_pack_a_punch";

/**
 * Machine sprite geometry. The art is 640x620 px (map-zombie-pap*.svg), packed at
 * `atlasScale` and drawn at `spriteScale`; 16 atlas px = 1 world unit.
 */
export const ZombiePackAPunchSprite = {
    atlasScale: 0.36,
    spriteScale: 0.62,
    /** Core center and intake slot, in art pixels from the image center (+y = down). */
    core: { x: 0, y: -14 },
    slot: { x: 0, y: 165 },
} as const;

const ArtPxToWorld = (ZombiePackAPunchSprite.atlasScale * ZombiePackAPunchSprite.spriteScale) / 16;

/** World offset from the machine center to a point in the art (world +y is up). */
export function packAPunchArtOffset(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x * ArtPxToWorld, y: -p.y * ArtPxToWorld };
}

const Suffix = "_pap";

/**
 * Mark II copy of a bullet type, e.g. `bullet_ak47` -> `bullet_ak47_pap`. Guns with a
 * piercing / chain special get their own copy: `bullet_awc` + `awc` -> `bullet_awc_pap_awc`.
 */
export function packAPunchBulletType(bulletType: string, specialGun?: string): string {
    return specialGun ? `${bulletType}${Suffix}_${specialGun}` : `${bulletType}${Suffix}`;
}

export function packAPunchType(base: string): string {
    return `${base}${Suffix}`;
}

export function isPackAPunchType(type: string): boolean {
    return type.endsWith(Suffix) && type.slice(0, -Suffix.length) in ZombiePackAPunchNames;
}

/** Original gun type for an upgraded gun; other types are returned unchanged. */
export function packAPunchBaseType(type: string): string {
    return isPackAPunchType(type) ? type.slice(0, -Suffix.length) : type;
}

/** Upgraded type for a gun, or undefined if that gun can't be Pack-a-Punched. */
export function packAPunchUpgradeFor(type: string): string | undefined {
    return type in ZombiePackAPunchNames ? packAPunchType(type) : undefined;
}
