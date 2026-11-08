import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { LoadoutAtlas } from "../../client/atlas-builder/defs/loadout.ts";
import sounds from "../../client/src/soundDefs.ts";
import { lastCallNavPoints, lastCallWalkable } from "../../server/src/game/lastCallNav.ts";
import { ZombieMysteryBoxWeapons } from "../../server/src/game/zombieMode.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { PerkProperties } from "../../shared/defs/gameObjects/perkDefs.ts";
import { ZombieMapPool } from "../../shared/defs/maps/specOpsDefs.ts";
import { SpecOpsShopCatalog } from "../../shared/defs/maps/specOpsShop.ts";
import { ZombiePackAPunchType } from "../../shared/defs/maps/zombiePackAPunch.ts";
import { ZombieWonderWeapons } from "../../shared/defs/maps/zombieWonderWeapons.ts";
import { GameConfig, type InventoryItem, TeamMode } from "../../shared/gameConfig.ts";
import { PracticeGuns } from "../../shared/practice.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

const slot = GameConfig.WeaponSlot.Primary;
const weapons = [
    { type: "mp40", damage: 14, pellets: 1, clip: 32, upgradedClip: 48, reload: 2.6, price: 1500 },
    { type: "fal", damage: 23, pellets: 1, clip: 20, upgradedClip: 30, reload: 2.9, price: 3000 },
    { type: "rpd", damage: 14, pellets: 1, clip: 100, upgradedClip: 150, reload: 5, price: 3600 },
    { type: "winchester1887", damage: 14, pellets: 8, clip: 6, upgradedClip: 9, reload: 0.8, price: 2200 },
    { type: "pkp", damage: 18, pellets: 1, clip: 220, upgradedClip: 330, reload: 5 * 0.82, price: 4500 },
] as const;

function setup() {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const player = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const start = lastCallNavPoints(game).find(p =>
        lastCallWalkable(game, p, v2.add(p, v2.create(12, 0)), player.rad)
    )!;
    v2.set(player.pos, start);
    player.dir = v2.create(1, 0);
    game.grid.updateObject(player);
    return { game, player, ops: game.specOps! };
}

for (const weapon of weapons) {
    test(`${weapon.type}: ordinary box roll, shop and Practice registration`, () => {
        const { player, ops } = setup();
        expect(PracticeGuns).toContain(weapon.type);
        expect(SpecOpsShopCatalog.find(item => item.sku === weapon.type)?.cost).toBe(weapon.price);
        expect(GunDefs[weapon.type].wonderWeapon).not.toBe(true);
        expect(GunDefs[weapon.type].lootImg.legendaryRing).toBeUndefined();
        const index = ZombieMysteryBoxWeapons.indexOf(weapon.type);
        expect(index).toBeGreaterThanOrEqual(0);
        const random = vi.spyOn(Math, "random").mockReturnValue((index + 0.5) / ZombieMysteryBoxWeapons.length);
        try {
            expect(ops.rollMysteryBoxResult(player, 0.9)).toBe(weapon.type);
            let lower = 0;
            for (const wonder of ZombieWonderWeapons) {
                expect(ops.rollMysteryBoxResult(player, lower + wonder.chance / 2)).toBe(wonder.type);
                lower += wonder.chance;
            }
        } finally {
            random.mockRestore();
        }
    });

    for (const upgraded of [false, true]) {
        const type = `${weapon.type}${upgraded ? "_pap" : ""}`;
        test(`${type}: actual firing consumes ammo, emits its pellets and applies its upgrade multiplier`, () => {
            const { game, player, ops } = setup();
            const target = ops.spawnEnemyPublic("zombie_walker");
            v2.set(target.pos, v2.add(player.pos, v2.create(6, 0)));
            target.health = target.maxHealth;
            game.grid.updateObject(target);
            player.weaponManager.setWeapon(slot, type, 5);
            player.weaponManager.setCurWeapIndex(slot);
            player.weaponManager.fireWeapon(false);
            const shots = game.bulletBarn.newBullets.filter(bullet => bullet.shotSourceType === type);
            expect(shots).toHaveLength(weapon.pellets);
            for (const shot of shots) expect(shot.damage).toBeCloseTo(weapon.damage * (upgraded ? 1.35 : 1));
            expect(player.weapons[slot].ammo).toBe(4);
            for (let i = 0; i < 10; i++) game.bulletBarn.update(0.02);
            expect(target.health).toBeLessThan(target.maxHealth);
        });
        for (const speedCola of [false, true]) {
            test(`${type}, Speed Cola ${speedCola}: timed reload respects ammo and per-shell loading`, () => {
                const { game, player } = setup();
                const def = GunDefs[type];
                const ammo = def.ammo as InventoryItem;
                player.weaponManager.setWeapon(slot, type, 0);
                player.weaponManager.setCurWeapIndex(slot);
                player.invManager.set(ammo, 450);
                const before = player.invManager.get(ammo);
                if (speedCola) player.addPerk("zombie_speed_cola", false);
                player.weaponManager.tryReload();
                const duration = weapon.reload * 0.9 * (speedCola ? 0.585 : 1);
                expect(player.action.duration).toBeCloseTo(duration);
                for (let i = 0; i < Math.floor((duration - 0.02) / 0.01); i++) game.update(0.01);
                expect(player.weapons[slot].ammo).toBe(0);
                for (let i = 0; i < 5; i++) game.update(0.01);
                const loaded = weapon.type === "winchester1887"
                    ? (upgraded ? 2 : 1)
                    : upgraded
                    ? weapon.upgradedClip
                    : weapon.clip;
                expect(player.weapons[slot].ammo).toBe(loaded);
                expect(player.invManager.get(ammo)).toBe(before - loaded);
            });
        }
    }

    test(`${weapon.type}: Pack-a-Punch accepts the gun and returns its actual upgraded magazine`, () => {
        const { game, player, ops } = setup();
        const power = game.map.obstacles.find(o => o.type === "zombie_power_switch")!;
        v2.set(player.pos, power.pos);
        game.grid.updateObject(player);
        power.interact(player);
        const bench = game.map.obstacles.find(o => o.type === ZombiePackAPunchType)!;
        v2.set(player.pos, bench.pos);
        game.grid.updateObject(player);
        player.weaponManager.setWeapon(slot, weapon.type, weapon.clip);
        player.weaponManager.setCurWeapIndex(slot);
        ops.setCashForDebug(player, 10000);
        bench.interact(player);
        expect(player.weapons[slot].type).toBe("");
        game.step(3.1);
        bench.interact(player);
        expect(player.weapons[slot].type).toBe(`${weapon.type}_pap`);
        expect(player.weaponManager.getAmmoStats(GunDefs[`${weapon.type}_pap`]).maxClip).toBe(weapon.upgradedClip);
    });
}

for (const map of ZombieMapPool) {
    test(`${map}: human operators start with level 1 backpacks; zombies keep their loadouts`, () => {
        const game = createGame(TeamMode.Squad, map);
        const first = game.playerBarn.addTestPlayer({ name: "First" });
        const second = game.playerBarn.addTestPlayer({ name: "Second" });
        expect(first.backpack).toBe("backpack01");
        expect(second.backpack).toBe("backpack01");
        expect(first.invManager.getMaxCapacity("762mm")).toBe(450);
        game.update(0.1);
        expect(game.specOps!.spawnEnemyPublic("zombie_walker").backpack).toBe("backpack00");
    });
}
test("a configured better backpack is retained, while Fireteam and Practice keep their starting gear", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    game.playerBarn.defaultItems.backpack = "backpack03";
    expect(game.playerBarn.addTestPlayer({ name: "Configured" }).backpack).toBe("backpack03");
    for (const map of ["test_specops", "practice_arena"] as const) {
        const control = createGame(TeamMode.Solo, map);
        expect(control.playerBarn.addTestPlayer({ name: "Control" }).backpack).toBe("backpack00");
    }
});
test("Speed Cola shortens existing reload timers by another ten percent", () => {
    expect(PerkProperties.zombie_speed_cola.reloadMult).toBeCloseTo(0.65 * 0.9);
    const { player } = setup();
    player.weaponManager.setWeapon(slot, "ppsh41", 0);
    player.weaponManager.setCurWeapIndex(slot);
    player.invManager.set("762mm", 100);
    player.addPerk("zombie_speed_cola", false);
    player.weaponManager.tryReload();
    expect(player.action.duration).toBeCloseTo(2.0475 * 0.9);
});
test("new art and conventional reloads resolve, and their recorded lengths match the reload metadata", () => {
    for (const { type } of weapons.filter(weapon => weapon.type !== "pkp")) {
        const def = GunDefs[type];
        for (const sprite of [def.worldImg.sprite, def.lootImg.sprite]) {
            const path = LoadoutAtlas.images.find(path => path.split("/").at(-1) === sprite.replace(".img", ".svg"))!;
            expect(readFileSync(new URL(`../../client/public/img/${path}`, import.meta.url), "utf8")).toContain("<svg");
        }
        const reload = sounds.Sounds.players[def.sound.reload];
        const wav = readFileSync(new URL(`../../client/public/${reload.path}`, import.meta.url));
        expect(def.sound.reloadDuration).toBeGreaterThan(0);
        expect(GunDefs[`${type}_pap`].sound.reloadDuration).toBe(def.sound.reloadDuration);
        if (wav.toString("ascii", 0, 4) === "RIFF") {
            const duration = wav.readUInt32LE(40) / wav.readUInt32LE(28);
            expect(def.sound.reloadDuration).toBeCloseTo(duration);
        }
    }
});
