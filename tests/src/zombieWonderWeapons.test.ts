import { describe, expect, test } from "vitest";
import { lastCallNavPoints, lastCallWalkable } from "../../server/src/game/lastCallNav.ts";
import type { Player } from "../../server/src/game/objects/player.ts";
import { stairAtPos } from "../../server/src/game/specOpsNav.ts";
import type { GunDef } from "../../shared/defs/gameObjects/gunDefs.ts";
import { ZombieMapPool } from "../../shared/defs/maps/specOpsDefs.ts";
import { SpecOpsShopCatalog } from "../../shared/defs/maps/specOpsShop.ts";
import { packAPunchType, ZombiePackAPunchType } from "../../shared/defs/maps/zombiePackAPunch.ts";
import { ZombiePressureBlast, ZombieWonderWeapons } from "../../shared/defs/maps/zombieWonderWeapons.ts";
import { GameObjectDefs } from "../../shared/defs/register.ts";
import { GameConfig, type InventoryItem, TeamMode } from "../../shared/gameConfig.ts";
import { collider } from "../../shared/utils/collider.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

const added = ZombieWonderWeapons.slice(1);
const primary = GameConfig.WeaponSlot.Primary;
const damageCases = [
    { label: "base", upgraded: false, doubleTap: false, multiplier: 1 },
    { label: "Mk II", upgraded: true, doubleTap: false, multiplier: 1.35 },
    { label: "base with Double Tap", upgraded: false, doubleTap: true, multiplier: 1.25 },
    { label: "Mk II with Double Tap", upgraded: true, doubleTap: true, multiplier: 1.35 * 1.25 },
];

function place(player: Player, pos: Vec2, layer = 0) {
    v2.set(player.pos, pos);
    player.layer = layer;
    player.game.grid.updateObject(player);
}

function arena(map: (typeof ZombieMapPool)[number] = "zombie_high_water") {
    const game = createGame(TeamMode.Solo, map);
    const shooter = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const start = lastCallNavPoints(game).find((p) =>
        lastCallWalkable(game, p, v2.add(p, v2.create(22, 0)), shooter.rad)
    );
    expect(start).toBeDefined();
    place(shooter, start!);
    v2.set(shooter.dir, v2.create(1, 0));
    const ops = game.specOps!;
    ops.setNpcIgnoreOperators(true);
    const zombie = (x: number, y = 0, layer = 0) => {
        const enemy = ops.spawnEnemyPublic("zombie_walker");
        place(enemy, v2.add(shooter.pos, v2.create(x, y)), layer);
        enemy.health = enemy.maxHealth;
        return enemy;
    };
    return { game, shooter, ops, zombie };
}

function shoot(shooter: Player, type: string) {
    const def = GameObjectDefs.typeToDef(type, "gun");
    shooter.weaponManager.setWeapon(primary, type, def.maxClip);
    shooter.weaponManager.setCurWeapIndex(primary);
    shooter.weaponManager.fireWeapon(false);
}

test("each wonder weapon occupies a fixed mystery-box interval; an owned result falls back", () => {
    const { shooter, ops } = arena();
    let start = 0;
    for (const weapon of ZombieWonderWeapons) {
        const midpoint = start + weapon.chance / 2;
        expect(ops.rollMysteryBoxResult(shooter, midpoint)).toBe(weapon.type);
        shooter.weaponManager.setWeapon(primary, weapon.type, 1);
        expect(ops.rollMysteryBoxResult(shooter, midpoint)).not.toBe(weapon.type);
        shooter.weaponManager.setWeapon(primary, "", 0);
        start += weapon.chance;
    }
    expect(start).toBeCloseTo(0.1);
});

for (const { type } of added) {
    describe(type, () => {
        test("base and upgrade retain legendary pickup, finite clips, and no shop entry", () => {
            for (const name of [type, packAPunchType(type)]) {
                const def = GameObjectDefs.typeToDef(name, "gun") as GunDef;
                expect(def.wonderWeapon).toBe(true);
                expect(def.lootImg.legendaryRing).toBe("loot-circle-legendary-ring.img");
                expect(def.maxClip).toBeLessThanOrEqual(3);
                expect(def.ignoreEndlessAmmo).toBe(true);
                expect(SpecOpsShopCatalog.some((item) => item.sku === name)).toBe(false);
            }
        });
        test("an upgraded held or dropped copy blocks another base copy", () => {
            const { shooter, ops, game } = arena();
            const other = game.playerBarn.addTestPlayer({ name: "Teammate" });
            shooter.weaponManager.setWeapon(primary, packAPunchType(type), 1);
            expect(ops.canGetWonderWeapon(shooter, type)).toBe(false);
            const loot = game.lootBarn.addLoot(type, shooter.pos, 0, 1, {})!;
            shooter.pickupLoot(loot);
            expect(loot.destroyed).toBe(false);
            shooter.weaponManager.dropGun(primary);
            expect(ops.canGetWonderWeapon(shooter, type)).toBe(false);
            expect(ops.canGetWonderWeapon(other, type)).toBe(true);
        });
    });
}

for (const map of ZombieMapPool) {
    test(`pressure cannon damages once, pushes safely, and isolates floors and allies on ${map}`, () => {
        const { game, shooter, ops, zombie } = arena(map);
        const front = zombie(6);
        const rear = zombie(-6);
        const side = zombie(0, 6);
        const otherFloor = zombie(6, 0, 1);
        const friend = game.playerBarn.addTestPlayer({ name: "Friend" });
        place(friend, v2.add(shooter.pos, v2.create(6, 2)));
        const friendHp = friend.health;
        const before = v2.copy(front.pos);
        shoot(shooter, "pressure_cannon");
        expect(shooter.weapons[primary].ammo).toBe(1);
        const damage = game.bulletBarn.damages.filter((d) => d.obj === front);
        expect(damage).toHaveLength(1);
        expect(damage[0].amount).toBe(220);
        game.bulletBarn.update(0.35);
        expect(front.health).toBe(front.maxHealth - 220);
        expect(front.pos.x).toBeGreaterThan(before.x);
        expect(lastCallWalkable(game, before, front.pos, front.rad, 0)).toBe(true);
        expect(front.layer).toBe(0);
        expect(ops.stunTimerPublic(front)).toBeGreaterThan(0);
        expect(rear.health).toBe(rear.maxHealth);
        expect(side.health).toBe(side.maxHealth);
        expect(otherFloor.health).toBe(otherFloor.maxHealth);
        expect(friend.health).toBe(friendHp);
        expect(ops.ensureNavGraph().hasPath(front, shooter.pos)).toBe(true);
    });
}

test("pressure blast and Tesla arcs cannot damage through solid cover", () => {
    const { game, shooter, ops, zombie } = arena();
    const front = zombie(5);
    const covered = zombie(11);
    game.map.genObstacle("stone_01", v2.add(shooter.pos, v2.create(8, 0)), 0, 0, 1);
    ops.pressureBlast(shooter, v2.create(1, 0), 1, "pressure_cannon");
    game.bulletBarn.update(0);
    expect(covered.health).toBe(covered.maxHealth);
    const startHp = front.health;
    const chain = GameObjectDefs.typeToDef("bullet_tesla", "bullet").chain!;
    ops.papChain(front, shooter, 180, chain, new Set(), "tesla_rifle");
    game.bulletBarn.update(0);
    expect(covered.health).toBe(covered.maxHealth);
    expect(front.health).toBe(startHp);
});

for (const { label, upgraded, doubleTap, multiplier } of damageCases) {
    test(`Tesla ${label}: Ray Gun-level damage, bounded chain, no repeated hits or cross-floor arcs`, () => {
        const { game, shooter, zombie } = arena();
        const targets = Array.from({ length: 8 }, (_, i) => zombie(6 + i * 2.1));
        const otherFloor = zombie(7, 0, 1);
        if (doubleTap) shooter.addPerk("zombie_double_tap", false);
        shoot(shooter, upgraded ? packAPunchType("tesla_rifle") : "tesla_rifle");
        for (let tick = 0; tick < 10; tick++) game.bulletBarn.update(0.02);
        for (const [i, target] of targets.entries()) {
            const damage = i < 6 ? 180 * multiplier : 0;
            expect(target.health).toBeCloseTo(Math.max(0, target.maxHealth - damage));
        }
        expect(otherFloor.health).toBe(otherFloor.maxHealth);
        expect(shooter.weapons[primary].ammo).toBe(2);
    });

    test(`Gravegun ${label}: pellet damage, empty chamber, and reserve reload`, () => {
        const { game, shooter, zombie } = arena();
        const target = zombie(6);
        const type = upgraded ? packAPunchType("gravegun") : "gravegun";
        if (doubleTap) shooter.addPerk("zombie_double_tap", false);
        shoot(shooter, type);
        const pellets = game.bulletBarn.newBullets.filter((b) => b.shotSourceType === type);
        expect(pellets).toHaveLength(16);
        for (const pellet of pellets) expect(pellet.damage).toBeCloseTo(18 * multiplier);
        expect(pellets.reduce((total, pellet) => total + pellet.damage, 0)).toBeCloseTo(288 * multiplier);
        expect(shooter.weapons[primary].ammo).toBe(0);
        for (let tick = 0; tick < 10; tick++) game.bulletBarn.update(0.02);
        expect(target.maxHealth - target.health).toBeGreaterThan(100);
        shooter.invManager.set("12gauge", 5);
        shooter.weaponManager.tryReload();
        shooter.weaponManager.reload();
        const loaded = upgraded ? 2 : 1;
        expect(shooter.weapons[primary].ammo).toBe(loaded);
        expect(shooter.invManager.get("12gauge")).toBe(5 - loaded);
    });
}

test("pressure knockback stops before a native stair and keeps the enemy's floor", () => {
    const { game, shooter, ops, zombie } = arena();
    const stair = game.map.structures.flatMap((s) => s.stairs)[0];
    expect(stair).toBeDefined();
    const center = v2.mul(v2.add(stair.collision.min, stair.collision.max), 0.5);
    const target = zombie(6);
    place(
        target,
        v2.add(center, v2.create(-target.rad - (stair.collision.max.x - stair.collision.min.x) / 2 - 0.2, 0)),
    );
    place(shooter, v2.add(target.pos, v2.create(-6, 0)));
    const before = v2.copy(target.pos);
    ops.pressureBlast(shooter, v2.create(1, 0), 1, "pressure_cannon");
    expect(target.layer).toBe(0);
    expect(stairAtPos(game, target.pos, target.rad)).toBeUndefined();
    expect(v2.distance(target.pos, before)).toBeLessThan(ZombiePressureBlast.push);
});

for (const { type } of added) {
    test(`${type}: Pack-a-Punch completes and blocks box rerolls throughout the upgrade`, () => {
        const { game, shooter, ops } = arena();
        const power = game.map.obstacles.find((o) => o.type === "zombie_power_switch")!;
        place(shooter, power.pos, power.layer);
        power.interact(shooter);
        const machine = game.map.obstacles.find((o) => o.type === ZombiePackAPunchType)!;
        place(shooter, machine.pos, machine.layer);
        shooter.weaponManager.setWeapon(primary, type, 1);
        shooter.weaponManager.setCurWeapIndex(primary);
        ops.setCashForDebug(shooter, 10000);
        machine.interact(shooter);
        expect(shooter.weapons[primary].type).toBe("");
        expect(ops.canGetWonderWeapon(shooter, type)).toBe(false);
        game.step(3.1);
        const loot = game.lootBarn.loots.find((l) => l.type === packAPunchType(type) && !l.destroyed)!;
        expect(loot).toBeDefined();
        expect(ops.canGetWonderWeapon(shooter, type)).toBe(false);
        machine.interact(shooter);
        expect(loot.destroyed).toBe(true);
        expect(shooter.weapons[primary].type).toBe(packAPunchType(type));
        expect(ops.canGetWonderWeapon(shooter, type)).toBe(false);
        const def = GameObjectDefs.typeToDef(type, "gun");
        const ammo = def.ammo as InventoryItem;
        shooter.invManager.set(ammo, 0);
        const clip = shooter.weapons[primary].ammo;
        ops.activateZombiePowerUp("zombie_powerup_max_ammo");
        expect(shooter.invManager.get(ammo)).toBe(shooter.invManager.getMaxCapacity(ammo));
        expect(shooter.weapons[primary].ammo).toBe(clip);
    });
}

for (const { label, upgraded, doubleTap, multiplier } of damageCases) {
    test(`Pressure Cannon ${label}: damage falls from 220 to 90 and stops at its advertised range`, () => {
        const { game, shooter, zombie } = arena();
        const near = zombie(6);
        const far = zombie(18);
        const edge = zombie(20);
        const outside = zombie(21);
        const outsidePos = v2.copy(outside.pos);
        if (doubleTap) shooter.addPerk("zombie_double_tap", false);
        shoot(shooter, upgraded ? packAPunchType("pressure_cannon") : "pressure_cannon");
        for (const [target, baseDamage] of [[near, 220], [far, 220 - 130 * 10 / 12], [edge, 90]] as const) {
            const hits = game.bulletBarn.damages.filter((damage) => damage.obj === target);
            expect(hits).toHaveLength(1);
            expect(hits[0].amount).toBeCloseTo(baseDamage * multiplier);
        }
        game.bulletBarn.update(0);
        expect(far.health).toBeGreaterThan(0);
        expect(far.health).toBeLessThan(far.maxHealth);
        expect(outside.health).toBe(outside.maxHealth);
        expect(outside.pos).toEqual(outsidePos);
    });
}

test("a buy gate blocks the pressure blast until the squad opens it", () => {
    const { game, shooter, ops, zombie } = arena("specops_complex");
    const gate = game.map.obstacles.find((o) => o.type === "zombie_buy_gate_750")!;
    const col = gate.collider;
    expect(col.type).toBe(collider.Type.Aabb);
    if (col.type !== collider.Type.Aabb) throw new Error("Expected a rectangular shutter");
    const dir = col.max.x - col.min.x > col.max.y - col.min.y ? v2.create(0, 1) : v2.create(1, 0);
    place(shooter, v2.sub(gate.pos, v2.mul(dir, 4)));
    const target = zombie(6);
    place(target, v2.add(gate.pos, v2.mul(dir, 4)));
    ops.pressureBlast(shooter, dir, 1, "pressure_cannon");
    expect(game.bulletBarn.damages.some((damage) => damage.obj === target)).toBe(false);
    ops.setCashForDebug(shooter, 10000);
    place(shooter, gate.pos);
    gate.interact(shooter);
    expect(gate.destroyed).toBe(true);
    place(shooter, v2.sub(gate.pos, v2.mul(dir, 4)));
    ops.pressureBlast(shooter, dir, 1, "pressure_cannon");
    expect(game.bulletBarn.damages.some((damage) => damage.obj === target)).toBe(true);
});

for (const { type } of added) {
    test(`${type}: the custom reload recording matches its declared timing and Mk II variant`, async () => {
        const { readFileSync } = await import("node:fs");
        const { default: soundDefs } = await import("../../client/src/soundDefs.ts");
        const base = GameObjectDefs.typeToDef(type, "gun");
        const upgrade = GameObjectDefs.typeToDef(packAPunchType(type), "gun");
        expect(upgrade.sound.reload).toBe(base.sound.reload);
        expect(base.sound.reload).not.toBe("ray_gun_reload_01");
        const sound = soundDefs.Sounds.players[base.sound.reload];
        const wav = readFileSync(new URL(`../../client/public/${sound.path}`, import.meta.url));
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
        const duration = wav.readUInt32LE(40) / wav.readUInt32LE(28);
        expect(base.sound.reloadDuration).toBeCloseTo(duration, 4);
        expect(upgrade.sound.reloadDuration).toBeCloseTo(duration, 4);
    });
}
