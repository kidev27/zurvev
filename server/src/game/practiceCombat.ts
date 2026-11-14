import { BulletDefs } from "../../../shared/defs/gameObjects/bulletDefs.ts";
import { GunDefs } from "../../../shared/defs/gameObjects/gunDefs.ts";
import { MeleeDefs } from "../../../shared/defs/gameObjects/meleeDefs.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import type { PracticeBotSettings } from "../../../shared/practice.ts";
import { math } from "../../../shared/utils/math.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import type { Player } from "./objects/player.ts";

/** Solve projectile interception, including the distance from body to muzzle. */
export function practiceInterceptPoint(
    origin: Vec2,
    target: Vec2,
    velocity: Vec2,
    speed: number,
    muzzle = 0,
    maxTime = 2,
): Vec2 {
    if (!(speed > 0) || !Number.isFinite(speed)) return v2.copy(target);
    const delta = v2.sub(target, origin);
    const a = v2.dot(velocity, velocity) - speed * speed;
    const b = 2 * (v2.dot(delta, velocity) - speed * muzzle);
    const c = v2.dot(delta, delta) - muzzle * muzzle;
    const roots: number[] = [];
    if (Math.abs(a) < 1e-6) {
        if (Math.abs(b) > 1e-6) roots.push(-c / b);
    } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const sqrt = Math.sqrt(disc);
            roots.push((-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a));
        }
    }
    const valid = roots.filter((t) => t >= 0 && Number.isFinite(t));
    const time = c <= 0 ? 0 : valid.length ? Math.min(...valid) : 0;
    return v2.add(target, v2.mul(velocity, math.clamp(time, 0, maxTime)));
}

/**
 * How a practice bot overclocks. After a shot the gun waits `fireDelay` before
 * the next one and the bot walks at half speed for that long. Swapping weapons
 * ends the slow walk at once, and a gun drawn again is ready after its
 * `switchDelay`, which for bolt rifles is shorter than `fireDelay`.
 *
 * - Other gun loaded and quicker to draw than waiting: swap to it and shoot.
 * - Otherwise: holster to melee and draw the same gun again on the next tick.
 *   Faster fire when `switchDelay < fireDelay` (Mosin 1.75 s to about 1.0 s).
 *   When it is not faster (SPAS-12, M870, Model 94), the bot still does it
 *   to keep full speed. `maxCancelCost` can cap what that may cost per shot.
 *
 * Only runs when the bot's Quick switch setting is on.
 */
export const PracticeBotOverclock = {
    /** Guns that fire faster than this never swap between shots. */
    minFireDelay: 0.45,
    /** Swap to end the slow walk even when it gains no fire rate. */
    cancelSlowdown: true,
    /** Most seconds a slow-walk swap may add to the wait for the next shot. Infinity: always swap. */
    maxCancelCost: Infinity,
    /** Seconds the gun stays holstered before the bot draws it again. 0: the next server tick. */
    holsterTime: 0,
};

/**
 * Where a practice bot with two guns fights.
 *
 * - It moves to the distance of its shortest-range gun, so both guns work there.
 * - On the way in it shoots the gun that reaches and holsters it between shots.
 *   It does not draw a gun that cannot reach yet.
 */
export const PracticeBotRange = {
    /** Move to the shortest-range gun's distance. Off: the distance follows the gun in hand. */
    fightAtShortestGun: true,
    /** Walk in until the target is inside this share of that gun's fire range (shotguns 12.65 → 10.1). */
    closeTo: 0.8,
    /** Only draw a gun to shoot when the target is inside its fire range. */
    drawOnlyInRange: true,
};

/**
 * When a practice bot reloads. A reload only works on the gun in hand, and the
 * bot cannot shoot while it reloads, so each rule says when that trade is worth it.
 *
 * - Safe (it has not seen you for `safeDelay` s): fill both guns, empty ones first.
 * - Nothing loaded: reload whichever gun gets a round in soonest, then shoot.
 * - One gun empty, one loaded, and it sees you: keep fighting with the loaded gun,
 *   unless one of the three `when…` reasons below holds.
 */
export const PracticeBotReload = {
    /** Seconds without seeing you before the bot counts as safe. */
    safeDelay: 0.4,
    /** Reload the empty gun when the loaded gun cannot reach you (see `reachSlack`). */
    whenOutOfReach: true,
    /**
     * A gun "reaches" you up to this multiple of its fire range: close enough to
     * step in and shoot. Shotguns fire from 12.65 units, so they reach to 19.
     */
    reachSlack: 1.5,
    /** Reload the empty gun while you are reloading or using a heal/boost. */
    whenTargetBusy: true,
    /**
     * Reload the empty gun when the loaded gun is nearly empty, but only if the
     * empty gun gets a round in at least `lowQuickerBy` s sooner than the loaded
     * gun would once dry (otherwise: shoot the last round, then the "nothing
     * loaded" rule reloads the quicker gun).
     */
    whenLow: true,
    /** "Nearly empty": this many rounds or fewer, in magazines of `lowMinClip` or more. */
    lowRounds: 1,
    lowMinClip: 3,
    lowQuickerBy: 1,
    /** A reload with this many seconds or fewer left is finished even after its reason is gone. */
    finishIfLeft: 0.75,
};

function isReloadAction(action: number): boolean {
    return action === GameConfig.Action.Reload || action === GameConfig.Action.ReloadAlt;
}

/**
 * Practice-only combat. All switches, fire, reloads and melee use the normal engine.
 * This class only decides when to press what a player can press; it must not
 * change a gun's timers, ranges or damage.
 */
export class PracticeCombat {
    meleeEngaged = false;
    /** The gun the bot is reloading on purpose this tick; it holds fire for it. */
    reloadSlot?: number;
    private lastAmmo: number[];
    private returnSlot?: number;
    private returnWait = 0;
    private committedSlot?: number;
    private unseenFor = 0;
    /** Ammo in the gun when "finish this reload" began, so one finish covers one reload. */
    private finishAmmo?: number;

    /**
     * @param fireRange how far the bot will shoot a given gun from (the brain's
     *   range for it). Past this the gun "cannot reach".
     */
    constructor(
        readonly player: Player,
        readonly settings: PracticeBotSettings,
        private readonly fireRange: (gun: string) => number = () => Infinity,
    ) {
        this.lastAmmo = player.weapons.slice(0, 2).map((w) => w.ammo);
    }

    get meleeReach(): number {
        const def = MeleeDefs[this.player.weapons[GameConfig.WeaponSlot.Melee].type];
        return def ? v2.length(def.attack.offset) + def.attack.rad : 0;
    }

    private loaded(slot: number): boolean {
        const weapon = this.player.weapons[slot];
        return !!GunDefs[weapon.type] && weapon.ammo > 0;
    }

    private switchDelay(slot: number): number {
        const p = this.player;
        const next = GunDefs[p.weapons[slot].type];
        const current = GunDefs[p.weaponManager.activeWeapon];
        if (!next) return Infinity;
        if (current?.deployGroup && current.deployGroup === next.deployGroup) return next.switchDelay;
        return p.freeSwitchTimer < 0 ? GameConfig.player.baseSwitchDelay : next.switchDelay;
    }

    /** Close enough to shoot this gun, or to step in and shoot it. */
    private reaches(slot: number, distance: number): boolean {
        return distance <= this.fireRange(this.player.weapons[slot].type) * PracticeBotReload.reachSlack;
    }

    /** The target is inside this gun's fire range right now. */
    private inFireRange(slot: number, distance: number): boolean {
        return !PracticeBotRange.drawOnlyInRange || distance <= this.fireRange(this.player.weapons[slot].type);
    }

    private hasGun(slot: number): boolean {
        return !!GunDefs[this.player.weapons[slot].type];
    }

    private clip(slot: number): number {
        const type = this.player.weapons[slot].type;
        return this.player.weaponManager.getAmmoStats(GunDefs[type], type).maxClip;
    }

    /** Seconds of reloading until this gun has a round more than now. */
    private reloadTime(slot: number, asIfEmpty = false): number {
        const p = this.player;
        const weapon = p.weapons[slot];
        const gun = GunDefs[weapon.type];
        if (!asIfEmpty && slot === p.curWeapIdx && isReloadAction(p.actionType) && p.actionItem === weapon.type) {
            return Math.max(0, p.action.duration - p.action.time);
        }
        // Bots carry endless ammo, so an empty gun always gets its full-clip reload.
        return (asIfEmpty || weapon.ammo === 0) && gun.reloadTimeAlt ? gun.reloadTimeAlt : gun.reloadTime;
    }

    /** Seconds until this gun could have a fresh round in: draw it if needed, then reload. */
    private timeToRound(slot: number): number {
        return (slot === this.player.curWeapIdx ? 0 : this.switchDelay(slot)) + this.reloadTime(slot);
    }

    /** Which gun to reload right now, if any. See PracticeBotReload. */
    private planReload(distance: number, target: Player): number | undefined {
        const R = PracticeBotReload;
        const p = this.player;
        const active = p.curWeapIdx;
        const ammo = (slot: number) => p.weapons[slot].ammo;
        const guns = [0, 1].filter((slot) => this.hasGun(slot));
        const empty = guns.filter((slot) => ammo(slot) === 0);
        const quickest = (slots: number[]) =>
            slots.reduce((best, slot) => {
                const d = this.timeToRound(slot) - this.timeToRound(best);
                return d < 0 || (d === 0 && slot === active) ? slot : best;
            });

        let want: number | undefined;
        if (this.unseenFor >= R.safeDelay) {
            // Safe: empty guns first, then top up (the gun in hand first, to save a switch).
            const partial = guns.filter((slot) => ammo(slot) > 0 && ammo(slot) < this.clip(slot));
            if (empty.length) want = quickest(empty);
            else if (partial.length) want = partial.includes(active) ? active : partial[0];
        } else if (empty.length && empty.length === guns.length) {
            // Nothing loaded: get a round in as fast as possible.
            want = quickest(empty);
        } else if (empty.length === 1) {
            const e = empty[0];
            const l = guns.find((slot) => slot !== e)!;
            const outOfReach = R.whenOutOfReach && !this.reaches(l, distance);
            const targetBusy = R.whenTargetBusy
                && (isReloadAction(target.actionType) || target.actionType === GameConfig.Action.UseItem);
            const low = R.whenLow && this.clip(l) >= R.lowMinClip && ammo(l) <= R.lowRounds
                && this.timeToRound(e) + R.lowQuickerBy <= this.reloadTime(l, true);
            if (outOfReach || targetBusy || low) want = e;
        }

        if (want !== undefined) {
            this.finishAmmo = undefined;
            return want;
        }
        // The reason is gone. Still finish a reload that is nearly done.
        if (
            this.reloadSlot === active && active < 2 && isReloadAction(p.actionType)
            && this.reloadTime(active) <= R.finishIfLeft
            && (this.finishAmmo === undefined || this.finishAmmo === ammo(active))
        ) {
            this.finishAmmo = ammo(active);
            return active;
        }
        this.finishAmmo = undefined;
        return undefined;
    }

    /** Put the gun away and draw it again right after. Ends the slow walk after a shot. */
    private holster(slot: number, dt: number): void {
        this.player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
        this.returnSlot = slot;
        this.returnWait = Math.max(dt, PracticeBotOverclock.holsterTime);
    }

    private preferredGun(distance: number): number {
        const loaded = [0, 1].filter((slot) => this.loaded(slot));
        if (!loaded.length) return this.player.curWeapIdx < 2 ? this.player.curWeapIdx : 0;
        const score = (slot: number) => {
            const gun = GunDefs[this.player.weapons[slot].type];
            if (gun.bulletCount > 1) return distance < 12 ? 3 : distance < 20 ? 1 : 0;
            if (gun.fireDelay >= 0.5) return distance > 24 ? 3 : 1;
            return 2;
        };
        // A gun that reaches always beats one that does not.
        const rank = (slot: number) => score(slot) + (this.inFireRange(slot, distance) ? 10 : 0);
        return loaded.reduce((best, slot) => rank(slot) > rank(best) ? slot : best);
    }

    /**
     * @param canAttack the bot sees the target and may shoot now (reaction time is over)
     * @param canSee the bot has line of sight to the target
     */
    update(dt: number, target: Player, canAttack: boolean, canSee = canAttack): void {
        const p = this.player;
        this.unseenFor = canSee ? 0 : this.unseenFor + dt;
        const active = p.curWeapIdx;
        const fired = active < 2 && p.weapons[active].ammo < this.lastAmmo[active];
        this.lastAmmo = p.weapons.slice(0, 2).map((w) => w.ammo);
        if (fired) this.committedSlot = undefined;
        if (!canAttack) this.committedSlot = undefined;

        const distance = v2.distance(p.pos, target.pos);
        const melee = MeleeDefs[p.weapons[GameConfig.WeaponSlot.Melee].type];
        const windup = melee?.attack.damageTimes[0] ?? 0;
        const futureSelf = v2.add(p.pos, v2.mul(p.moveVel, windup));
        const futureTarget = v2.add(target.pos, v2.mul(target.moveVel, windup));
        const reach = this.meleeReach + target.rad - 0.2;
        this.meleeEngaged = this.settings.autoMelee && canAttack && !!melee
            && distance <= reach + (this.meleeEngaged ? 0.5 : 0)
            && v2.distance(futureSelf, futureTarget) <= reach;
        // Do not cancel a swing before its scheduled damage has landed.
        if (active === GameConfig.WeaponSlot.Melee && p.weaponManager.meleeAttacks.length) return;
        if (this.meleeEngaged) {
            this.returnSlot = undefined;
            this.committedSlot = undefined;
            this.reloadSlot = undefined;
            p.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
            return;
        }

        if (this.returnSlot !== undefined) {
            this.returnWait -= dt;
            if (this.returnWait > 0) return;
            p.weaponManager.setCurWeapIndex(this.returnSlot);
            this.committedSlot = this.returnSlot;
            this.returnSlot = undefined;
            return;
        }

        const gun = GunDefs[p.weaponManager.activeWeapon];
        // A real shot leaves the gun on cooldown; a clip changed by hand does not.
        const slowShot = fired && p.weapons[active].cooldown > 0 && this.settings.quickSwitch
            && gun?.fireDelay >= PracticeBotOverclock.minFireDelay && gun.fireMode !== "burst";

        this.reloadSlot = this.planReload(distance, target);
        if (this.reloadSlot !== undefined) {
            this.committedSlot = undefined;
            if (active !== this.reloadSlot) {
                p.weaponManager.setCurWeapIndex(this.reloadSlot);
            } else if (slowShot && PracticeBotOverclock.cancelSlowdown) {
                // Reloading the gun it just fired: shed the slow walk first.
                this.holster(active, dt);
            }
            return;
        }

        if (slowShot && canAttack && p.actionType === GameConfig.Action.None) {
            const other = active === 0 ? 1 : 0;
            if (
                this.loaded(other) && this.inFireRange(other, distance)
                && this.switchDelay(other) + dt < p.weapons[active].cooldown
            ) {
                p.weaponManager.setCurWeapIndex(other);
                this.committedSlot = other;
                return;
            }
            // One slow gun: holster it, then draw it again. The swap
            // ends the half-speed walk after a shot, so it is worth it even
            // when the draw is no quicker than waiting, up to maxCancelCost.
            // A gun that just ran dry is not drawn again: the swap below ends the slow walk.
            const away = Math.max(dt, PracticeBotOverclock.holsterTime) + dt;
            const cost = gun.switchDelay + away - p.weapons[active].cooldown;
            const worth = cost < 0
                || (PracticeBotOverclock.cancelSlowdown && cost <= PracticeBotOverclock.maxCancelCost);
            if (this.loaded(active) && worth) {
                this.holster(active, dt);
                return;
            }
        }
        const usable = active < 2 && this.loaded(active) && this.inFireRange(active, distance);
        if (this.committedSlot === active && usable) return;
        if (p.actionType !== GameConfig.Action.None && active < 2 && this.loaded(active)) return;
        if (!usable || p.weapons[active].cooldown <= 0) {
            p.weaponManager.setCurWeapIndex(this.preferredGun(distance));
        }
    }

    aimPoint(target: Player): Vec2 {
        const p = this.player;
        if (this.meleeEngaged || p.curWeapIdx === GameConfig.WeaponSlot.Melee) {
            const melee = MeleeDefs[p.weapons[GameConfig.WeaponSlot.Melee].type];
            const windup = Math.max(0, p.weaponManager.meleeAttacks[0] ?? melee?.attack.damageTimes[0] ?? 0);
            return v2.add(target.pos, v2.mul(v2.sub(target.moveVel, p.moveVel), windup));
        }
        const gun = GunDefs[p.weaponManager.activeWeapon];
        const bullet = gun && BulletDefs[gun.bulletType];
        return bullet
            ? practiceInterceptPoint(
                p.pos,
                target.pos,
                target.moveVel,
                bullet.speed,
                gun.barrelLength,
                bullet.distance / bullet.speed,
            )
            : v2.copy(target.pos);
    }

    fire(ready: boolean): void {
        const p = this.player;
        p.shootHold = p.shootStart = false;
        if (this.returnSlot !== undefined) return;
        // A shot cancels a reload, so a loaded gun may fire mid-reload. Other actions are left alone.
        const reloadingGun = isReloadAction(p.actionType) && p.curWeapIdx < 2;
        if (p.actionType !== GameConfig.Action.None && !reloadingGun) return;
        if (p.curWeapIdx === GameConfig.WeaponSlot.Melee) {
            p.shootHold = p.shootStart = ready && this.meleeEngaged;
        } else if (p.curWeapIdx < 2) {
            if (this.reloadSlot === p.curWeapIdx || !this.loaded(p.curWeapIdx)) {
                p.weaponManager.tryReload();
                return;
            }
            p.shootHold = ready;
            p.shootStart = ready && GunDefs[p.weaponManager.activeWeapon]?.fireMode !== "auto";
        }
    }
}
