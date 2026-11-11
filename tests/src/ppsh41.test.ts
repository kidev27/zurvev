import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { LoadoutAtlas } from "../../client/atlas-builder/defs/loadout.ts";
import soundDefs from "../../client/src/soundDefs.ts";
import { lastCallNavPoints, lastCallWalkable } from "../../server/src/game/lastCallNav.ts";
import type { Player } from "../../server/src/game/objects/player.ts";
import { ZombieMysteryBoxWeapons } from "../../server/src/game/zombieMode.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { ZombieMapPool } from "../../shared/defs/maps/specOpsDefs.ts";
import { SpecOpsShopCatalog } from "../../shared/defs/maps/specOpsShop.ts";
import { packAPunchUpgradeTime, ZombiePackAPunchType } from "../../shared/defs/maps/zombiePackAPunch.ts";
import { ZombieWonderWeapons } from "../../shared/defs/maps/zombieWonderWeapons.ts";
import { GameObjectDefs } from "../../shared/defs/register.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { PracticeGuns } from "../../shared/practice.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

const slot = GameConfig.WeaponSlot.Primary;

function place(player: Player, pos: Vec2, layer = 0) {
    v2.set(player.pos, pos);
    player.layer = layer;
    player.game.grid.updateObject(player);
}

function setup(map: (typeof ZombieMapPool)[number] = "specops_complex") {
    const game = createGame(TeamMode.Solo, map);
    const player = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const start = lastCallNavPoints(game).find(p => lastCallWalkable(game, p, v2.add(p, v2.create(12, 0)), player.rad));
    expect(start).toBeDefined();
    place(player, start!);
    player.dir = v2.create(1, 0);
    return { game, player, ops: game.specOps! };
}

function equip(player: Player, type = "ppsh41", ammo?: number) {
    player.weaponManager.setWeapon(slot, type, ammo ?? GunDefs[type].maxClip);
    player.weaponManager.setCurWeapIndex(slot);
}

test("PPSh-41 rolls as an ordinary gun, is sold, and keeps wonder-weapon intervals unchanged", () => {
    const { player, ops } = setup();
    const index = ZombieMysteryBoxWeapons.indexOf("ppsh41");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(PracticeGuns).toContain("ppsh41");
    const random = vi.spyOn(Math, "random").mockReturnValue((index + 0.5) / ZombieMysteryBoxWeapons.length);
    try {
        equip(player);
        expect(ops.rollMysteryBoxResult(player, 0.5)).toBe("ppsh41");
        let lower = 0;
        for (const weapon of ZombieWonderWeapons) {
            expect(ops.rollMysteryBoxResult(player, lower + weapon.chance / 2)).toBe(weapon.type);
            lower += weapon.chance;
        }
        expect(lower).toBeCloseTo(ZombieWonderWeapons.reduce((sum, weapon) => sum + weapon.chance, 0));
    } finally {
        random.mockRestore();
    }
    expect(SpecOpsShopCatalog.find(item => item.sku === "ppsh41")?.cost).toBe(2600);
    expect(GunDefs.ppsh41.wonderWeapon).not.toBe(true);
    expect(GunDefs.ppsh41.lootImg.legendaryRing).toBeUndefined();
    expect(GunDefs.ppsh41_pap.lootImg.legendaryRing).toBeUndefined();
    expect(SpecOpsShopCatalog.some(item => item.sku === "ppsh41_pap")).toBe(false);
});

for (
    const { type, doubleTap, damage } of [
        { type: "ppsh41", doubleTap: false, damage: 11 },
        { type: "ppsh41_pap", doubleTap: false, damage: 14.85 },
        { type: "ppsh41", doubleTap: true, damage: 13.75 },
        { type: "ppsh41_pap", doubleTap: true, damage: 18.5625 },
    ]
) {
    test(`${type}, Double Tap ${doubleTap}: actual firing applies damage and consumes a round`, () => {
        const { game, player, ops } = setup();
        const target = ops.spawnEnemyPublic("zombie_walker");
        place(target, v2.add(player.pos, v2.create(6, 0)));
        target.health = target.maxHealth;
        const health = target.health;
        if (doubleTap) player.addPerk("zombie_double_tap", false);
        equip(player, type);
        const loaded = player.weapons[slot].ammo;
        player.weaponManager.fireWeapon(false);
        const shots = game.bulletBarn.newBullets.filter(bullet => bullet.shotSourceType === type);
        expect(shots).toHaveLength(1);
        expect(shots[0].damage).toBeCloseTo(damage);
        expect(player.weapons[slot].ammo).toBe(loaded - 1);
        for (let i = 0; i < 10; i++) game.bulletBarn.update(0.02);
        expect(target.health).toBeLessThan(health);
    });
}

test("holding the trigger fires the 71-round drum at approximately 900 RPM and stops when empty", () => {
    const { game, player } = setup();
    equip(player);
    player.invManager.set("762mm", 0);
    for (let i = 0; i < 100; i++) game.update(0.01);
    expect(player.weapons[slot].ammo).toBe(71);
    player.shootHold = true;
    for (let i = 0; i < 100; i++) {
        player.shootStart = i === 0;
        game.update(0.01);
    }
    const used = 71 - player.weapons[slot].ammo;
    expect(used).toBeGreaterThanOrEqual(14);
    expect(used).toBeLessThanOrEqual(16);
    for (let i = 0; i < 500; i++) game.update(0.01);
    player.shootHold = false;
    expect(player.weapons[slot].ammo).toBe(0);
    expect(player.weapons[slot].shotsSinceReload).toBe(71);
});

for (const type of ["ppsh41", "ppsh41_pap"]) {
    for (const speedCola of [false, true]) {
        test(`${type}, Speed Cola ${speedCola}: timed drum reload uses reserve ammunition`, () => {
            const { game, player } = setup();
            equip(player, type, 0);
            player.invManager.set("762mm", 200);
            if (speedCola) player.addPerk("zombie_speed_cola", false);
            player.weaponManager.tryReload();
            expect(player.actionType).toBe(GameConfig.Action.Reload);
            const duration = 3.5 * 0.9 * (speedCola ? 0.585 : 1);
            expect(player.action.duration).toBeCloseTo(duration);
            game.step(duration - 0.1);
            expect(player.weapons[slot].ammo).toBe(0);
            game.step(0.2);
            const loaded = type.endsWith("_pap") ? 107 : 71;
            expect(player.weapons[slot].ammo).toBe(loaded);
            expect(player.invManager.get("762mm")).toBe(200 - loaded);
        });
    }
}

for (const map of ZombieMapPool) {
    test(`${map}: PPSh rounds cannot damage a zombie on another floor`, () => {
        const { game, player, ops } = setup(map);
        const target = ops.spawnEnemyPublic("zombie_walker");
        place(target, v2.add(player.pos, v2.create(6, 0)), 1);
        const health = target.health;
        equip(player);
        player.weaponManager.fireWeapon(false);
        for (let i = 0; i < 10; i++) game.bulletBarn.update(0.02);
        expect(target.health).toBe(health);
    });
}

test("Pack-a-Punch returns the new Mk II and Max Ammo refills reserves without topping its drum", () => {
    const { game, player, ops } = setup();
    const power = game.map.obstacles.find(obstacle => obstacle.type === "zombie_power_switch")!;
    place(player, power.pos, power.layer);
    power.interact(player);
    const machine = game.map.obstacles.find(obstacle => obstacle.type === ZombiePackAPunchType)!;
    place(player, machine.pos, machine.layer);
    equip(player);
    ops.setCashForDebug(player, 10000);
    machine.interact(player);
    expect(player.weapons[slot].type).toBe("");
    game.step(packAPunchUpgradeTime(ops.difficulty) + 0.1);
    machine.interact(player);
    expect(player.weapons[slot].type).toBe("ppsh41_pap");
    expect(player.weaponManager.getAmmoStats(GunDefs.ppsh41_pap).maxClip).toBe(107);
    player.weapons[slot].ammo = 25;
    player.invManager.set("762mm", 0);
    ops.activateZombiePowerUp("zombie_powerup_max_ammo");
    expect(player.invManager.get("762mm")).toBe(player.invManager.getMaxCapacity("762mm"));
    expect(player.weapons[slot].ammo).toBe(25);
});

test("base and Mk II use registered art and the reviewed firing/reload assets", () => {
    for (const type of ["ppsh41", "ppsh41_pap"]) {
        const def = GameObjectDefs.typeToDef(type, "gun");
        for (const sprite of [def.worldImg.sprite, def.lootImg.sprite]) {
            const path = LoadoutAtlas.images.find(path => path.split("/").at(-1) === sprite.replace(".img", ".svg"));
            expect(path).toBeDefined();
            expect(readFileSync(new URL(`../../client/public/img/${path}`, import.meta.url), "utf8")).toContain("<svg");
        }
        for (const kind of ["shoot", "reload"] as const) {
            const sound = soundDefs.Sounds.players[def.sound[kind]];
            expect(sound).toBeDefined();
            expect(readFileSync(new URL(`../../client/public/${sound.path}`, import.meta.url)).byteLength)
                .toBeGreaterThan(1000);
        }
        expect(def.sound.reload).toBe("ppsh41_reload_01");
        expect(def.sound.reloadDuration).toBe(2.85);
    }
});
