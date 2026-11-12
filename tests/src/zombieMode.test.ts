import { expect, test } from "vitest";
import { ZombieWonderWeapons } from "../../shared/defs/maps/zombieWonderWeapons.ts";

import type { Player } from "../../server/src/game/objects/player.ts";
import { ZombieWaveIntermissionTime } from "../../server/src/game/specOpsManager.ts";
import { WeaponManager } from "../../server/src/game/weaponManager.ts";
import {
    composeZombieWave,
    zombieBruteCount,
    ZombieEconomy,
    zombieEnemyHealth,
    ZombieLoadouts,
    ZombieMaxSpeedMult,
    ZombieMysteryBoxClaimDuration,
    ZombieMysteryBoxCooldown,
    ZombieMysteryBoxCost,
    ZombieMysteryBoxRelocateUses,
    ZombieMysteryBoxRollDuration,
    ZombieMysteryBoxWeapons,
    ZombieRayGun,
    ZombieRushSpeedBonus,
    ZombieSpeedByDifficulty,
    zombieSpeedMult,
    ZombieUpgradeCost,
    ZombieVariants,
    zombieWaveCount,
} from "../../server/src/game/zombieMode.ts";
import type { GunDef } from "../../shared/defs/gameObjects/gunDefs.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { FireteamMapPool, ZombieMapPool } from "../../shared/defs/maps/specOpsDefs.ts";
import {
    SpecOpsBagSizes,
    SpecOpsDifficulties,
    type SpecOpsDifficulty,
    SpecOpsShopCatalog,
} from "../../shared/defs/maps/specOpsShop.ts";
import {
    packAPunchArcBulletType,
    packAPunchBulletType,
    packAPunchSpecialFor,
    packAPunchType,
    packAPunchUpgradeFor,
    packAPunchUpgradeTime,
    ZombiePackAPunchArcBullet,
    ZombiePackAPunchNames,
    ZombiePackAPunchSpecials,
    ZombiePackAPunchStats,
    ZombiePackAPunchStunImmunity,
    ZombiePackAPunchStunStreakReset,
    ZombiePackAPunchTracer,
    ZombiePackAPunchType,
} from "../../shared/defs/maps/zombiePackAPunch.ts";
import { ZombieAmmoBagSizes } from "../../shared/defs/maps/zombieIndoorDefs.ts";
import { zombiePerkMachine, ZombiePerkMachines, ZombiePerkMachineTypes } from "../../shared/defs/maps/zombiePerks.ts";
import {
    isZombiePowerUpType,
    ZombieNukeCash,
    ZombiePowerUpDrops,
    zombiePowerUpFlashVisible,
    zombiePowerUpKillChance,
    zombiePowerUpHudFlashPeriod,
    ZombiePowerUpLifetime,
    ZombiePowerUpTypes,
    ZombieTimedPowerUpDuration,
} from "../../shared/defs/maps/zombiePowerUps.ts";
import { GameObjectDefs, MapObjectDefs } from "../../shared/defs/register.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { collider } from "../../shared/utils/collider.ts";
import { util } from "../../shared/utils/util.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

test("Zombie Survival uses a dedicated, scaling zombie wave profile", () => {
    expect(zombieWaveCount(1, 1)).toBe(6);
    expect(zombieWaveCount(10, 1)).toBeGreaterThan(zombieWaveCount(1, 1));
    expect(zombieWaveCount(10, 4)).toBeGreaterThan(zombieWaveCount(10, 1));
    expect(zombieWaveCount(100, 8)).toBe(48);
    expect(composeZombieWave(3, 1).every((kind) => kind === "zombie_walker")).toBe(true);
    expect(zombieEnemyHealth(10)).toBeGreaterThan(zombieEnemyHealth(1));
    expect(
        ZombieMysteryBoxWeapons.every(
            (weapon) => GameObjectDefs.typeToDefSafe(weapon)?.type === "gun",
        ),
    ).toBe(true);
    expect(zombiePowerUpHudFlashPeriod(1)).toBeLessThan(zombiePowerUpHudFlashPeriod(5));

    const flashes = (start: number, end: number) => {
        let transitions = 0;
        let previous = zombiePowerUpFlashVisible(start);
        for (let age = start + 0.01; age <= end; age += 0.01) {
            const visible = zombiePowerUpFlashVisible(age);
            if (visible !== previous) transitions++;
            previous = visible;
        }
        return transitions;
    };
    expect(flashes(29, 30)).toBeGreaterThan(flashes(25, 26));
});

test("Max Ammo refills every living operator without changing loaded magazines", () => {
    const game = createGame(TeamMode.Duo, "specops_complex");
    const first = game.playerBarn.addTestPlayer({ name: "First" });
    const second = game.playerBarn.addTestPlayer({ name: "Second" });
    game.update(0.1);

    first.weapons[GameConfig.WeaponSlot.Primary].ammo = 3;
    second.weapons[GameConfig.WeaponSlot.Primary].ammo = 5;
    first.invManager.set("9mm", 0);
    second.invManager.set("9mm", 1);
    first.invManager.set("frag", 0);
    second.invManager.set("frag", 1);

    game.specOps!.activateZombiePowerUp("zombie_powerup_max_ammo");

    expect(first.weapons[GameConfig.WeaponSlot.Primary].ammo).toBe(3);
    expect(second.weapons[GameConfig.WeaponSlot.Primary].ammo).toBe(5);
    for (const player of [first, second]) {
        expect(player.invManager.get("9mm")).toBe(player.invManager.getMaxCapacity("9mm"));
        expect(player.invManager.get("frag")).toBe(player.invManager.getMaxCapacity("frag"));
    }
});

test("Zombies: players start without throwables; Max Ammo refills only frags and MIRVs", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const player = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);

    const throwables = Object.keys(player.invManager.items).filter(
        (item) => GameObjectDefs.typeToDefSafe(item)?.type === "throwable",
    ) as Array<keyof typeof player.invManager.items>;
    expect(throwables.length).toBeGreaterThan(2);
    for (const item of throwables) expect(player.invManager.get(item)).toBe(0);

    game.specOps!.activateZombiePowerUp("zombie_powerup_max_ammo");
    for (const item of throwables) {
        const expected = item === "frag" || item === "mirv" ? player.invManager.getMaxCapacity(item) : 0;
        expect(player.invManager.get(item), item).toBe(expected);
    }

    // Throwables a player already owns (e.g. bought strobes) are left alone, not topped up.
    player.invManager.set("strobe", 1);
    game.specOps!.activateZombiePowerUp("zombie_powerup_max_ammo");
    expect(player.invManager.get("strobe")).toBe(1);
});

test("Insta-Kill one-shots walkers, doubles elite damage, and expires for the team", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();
    const walker = game.specOps!.livingEnemies()[0];
    const elite = game.specOps!.spawnEnemyPublic("juggernaut", true)!;

    game.specOps!.activateZombiePowerUp("zombie_powerup_insta_kill");
    game.specOps!.setNpcIgnoreOperators(true);
    expect(game.specOps!.modifyZombieDamage(elite, operator, 11)).toBe(22);
    walker.damage({
        amount: 1,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        source: operator,
    });
    expect(walker.dead).toBe(true);
    expect(operator.zombiePowerUps.instaKill).toBe(ZombieTimedPowerUpDuration);

    game.step(ZombieTimedPowerUpDuration + 0.1);
    expect(game.specOps!.isZombiePowerUpActive("instaKill")).toBe(false);
    expect(operator.zombiePowerUps.instaKill).toBe(0);
});

test("Double Points affects zombie kills and Nuke team cash only", () => {
    const game = createGame(TeamMode.Duo, "specops_complex");
    const first = game.playerBarn.addTestPlayer({ name: "First" });
    const second = game.playerBarn.addTestPlayer({ name: "Second" });
    game.update(0.1);
    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();
    const [target] = game.specOps!.livingEnemies();

    game.specOps!.activateZombiePowerUp("zombie_powerup_double_points");
    const firstCash = first.specOpsCash;
    target.damage({
        amount: 9999,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        source: first,
    });
    expect(first.specOpsCash - firstCash).toBe(ZombieEconomy.killCash * 2);

    const beforeNuke = [first.specOpsCash, second.specOpsCash];
    game.specOps!.activateZombiePowerUp("zombie_powerup_nuke");
    expect(first.specOpsCash - beforeNuke[0]).toBe(ZombieNukeCash * 2);
    expect(second.specOpsCash - beforeNuke[1]).toBe(ZombieNukeCash * 2);
    expect(game.specOps!.livingEnemies()).toHaveLength(0);
});

test("Nuke removes ordinary zombies and takes 35% of an elite's current health", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();
    const walkers = [...game.specOps!.livingEnemies()];
    const elite = game.specOps!.spawnEnemyPublic("juggernaut", true)!;
    const eliteHealth = elite.health;

    game.specOps!.activateZombiePowerUp("zombie_powerup_nuke");

    expect(walkers.every((walker) => walker.dead)).toBe(true);
    expect(elite.dead).toBe(false);
    expect(elite.health).toBeCloseTo(eliteHealth * 0.65, 5);
    expect(game.lootBarn.loots.some((loot) => isZombiePowerUpType(loot.type))).toBe(false);
});

test("Zombie power-up loot activates on touch and expires when ignored", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const pickup = game.specOps!.spawnZombiePowerUp(
        "zombie_powerup_double_points",
        v2.copy(operator.pos),
        operator.layer,
    )!;

    game.update(0.2);
    expect(pickup.destroyed).toBe(true);
    expect(game.specOps!.isZombiePowerUpActive("doublePoints")).toBe(true);

    const ignored = game.specOps!.spawnZombiePowerUp(
        "zombie_powerup_max_ammo",
        v2.add(operator.pos, v2.create(10, 0)),
        operator.layer,
    )!;
    game.step(ZombiePowerUpLifetime + 0.1);
    expect(ignored.destroyed).toBe(true);
});

test("AI zombies pass through power-ups without collecting or removing them", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();
    const zombie = game.specOps!.livingEnemies()[0];
    const pickup = game.specOps!.spawnZombiePowerUp(
        "zombie_powerup_insta_kill",
        v2.copy(zombie.pos),
        zombie.layer,
    )!;

    zombie.pickupLoot(pickup);
    game.update(0.2);

    expect(zombie.getClosestLoot()).toBeUndefined();
    expect(pickup.destroyed).toBe(false);
    expect(game.specOps!.isZombiePowerUpActive("instaKill")).toBe(false);
});

function powerUpDrops(game: ReturnType<typeof createGame>) {
    return game.lootBarn.loots.filter((loot) => !loot.destroyed && isZombiePowerUpType(loot.type));
}

function startZombieRound(players = 1) {
    const game = createGame(TeamMode.Solo, "specops_complex");
    for (let i = 0; i < players; i++) game.playerBarn.addTestPlayer({ name: `Operator ${i}` });
    game.update(0.1);
    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();
    return game;
}

test("Power-up hat hands out every power-up once before repeating", () => {
    const game = startZombieRound();
    const first = Array.from({ length: 4 }, () => game.specOps!.drawZombiePowerUp());
    const second = Array.from({ length: 4 }, () => game.specOps!.drawZombiePowerUp());
    expect([...first].sort()).toEqual([...ZombiePowerUpTypes].sort());
    expect([...second].sort()).toEqual([...ZombiePowerUpTypes].sort());
});

test("Zombie cash earns a drop at the point target, which then grows", () => {
    const game = startZombieRound();
    const ops = game.specOps!;
    const zombie = ops.livingEnemies()[0];
    const start = ZombiePowerUpDrops.pointStart;

    ops.onZombieKilledForDrops(zombie, start - 1, 1);
    expect(powerUpDrops(game)).toHaveLength(0);

    ops.onZombieKilledForDrops(zombie, 101, 1);
    const drops = powerUpDrops(game);
    expect(drops).toHaveLength(1);
    expect(v2.distance(drops[0].pos, zombie.pos)).toBeLessThan(3);
    expect(ops.zombiePointAccumulator).toBeCloseTo(100);
    expect(ops.zombiePointTarget).toBeCloseTo(start * ZombiePowerUpDrops.pointGrowth);
});

test("Each zombie kill has a 2% drop chance", () => {
    const game = startZombieRound();
    const ops = game.specOps!;
    const zombie = ops.livingEnemies()[0];
    ops.onZombieKilledForDrops(zombie, 0, 0.03);
    expect(powerUpDrops(game)).toHaveLength(0);
    ops.onZombieKilledForDrops(zombie, 0, 0.01);
    expect(powerUpDrops(game)).toHaveLength(1);
});

test("At most four power-ups drop per round; the cap resets next round", () => {
    const game = startZombieRound();
    const ops = game.specOps!;
    const zombie = ops.livingEnemies()[0];
    for (let i = 0; i < 10; i++) ops.onZombieKilledForDrops(zombie, 0, 0);
    expect(ops.zombieRoundDrops).toBe(ZombiePowerUpDrops.roundCap);
    expect(powerUpDrops(game)).toHaveLength(4);

    const operator = game.playerBarn.livingPlayers.find((p) => !p.specOpsAi)!;
    for (const enemy of [...ops.livingEnemies()]) {
        enemy.damage({
            amount: 9999,
            damageType: GameConfig.DamageType.Player,
            dir: v2.create(1, 0),
            source: operator,
        });
    }
    game.step(1);
    expect(ops.phase).not.toBe("combat");
    ops.startNextWave();
    expect(ops.wave).toBe(2);
    expect(ops.zombieRoundDrops).toBe(0);
});

test("Power-up drops use Black Ops point targets and a per-kill chance that shrinks each round", () => {
    expect(ZombiePowerUpDrops.pointStart).toBe(2000);
    expect(ZombiePowerUpDrops.pointGrowth).toBe(1.14);
    expect(zombiePowerUpKillChance(1)).toBeCloseTo(0.02);
    expect(zombiePowerUpKillChance(11)).toBeCloseTo(0.015);
    expect(zombiePowerUpKillChance(21)).toBeCloseTo(0.01);
    expect(zombiePowerUpKillChance(40)).toBeCloseTo(ZombiePowerUpDrops.killChanceMin);

    // A roll that drops on round 1 no longer drops on round 21.
    const game = startZombieRound();
    const ops = game.specOps!;
    const zombie = ops.livingEnemies()[0];
    const roll = 0.015 * ops.zombieDropTeamScale();
    ops.wave = 21;
    ops.onZombieKilledForDrops(zombie, 0, roll);
    expect(powerUpDrops(game)).toHaveLength(0);
    ops.wave = 1;
    ops.onZombieKilledForDrops(zombie, 0, roll);
    expect(powerUpDrops(game)).toHaveLength(1);
});

test("Zombies maps use smaller ammo bags that Max Ammo fills; Fireteam keeps Spec Ops bags", () => {
    for (const map of ZombieMapPool) {
        expect(MapDefs[map].gameConfig.bagSizes["9mm"]?.[1], map).toBe(ZombieAmmoBagSizes["9mm"][1]);
        expect(MapDefs[map].gameConfig.bagSizes["762mm"]?.[1], map).toBe(ZombieAmmoBagSizes["762mm"][1]);
        // Throwables keep their Spec Ops caps.
        expect(MapDefs[map].gameConfig.bagSizes.frag?.[1], map).toBe(SpecOpsBagSizes.frag[1]);
    }
    for (const map of FireteamMapPool) {
        expect(MapDefs[map].gameConfig.bagSizes["9mm"]?.[1], map).toBe(SpecOpsBagSizes["9mm"][1]);
    }

    const game = startZombieRound();
    const operator = game.playerBarn.livingPlayers.find((p) => !p.specOpsAi)!;
    operator.invManager.set("9mm", 10);
    operator.invManager.set("762mm", 0);
    game.specOps!.activateZombiePowerUp("zombie_powerup_max_ammo");
    expect(operator.invManager.get("9mm")).toBe(ZombieAmmoBagSizes["9mm"][1]);
    expect(operator.invManager.get("762mm")).toBe(ZombieAmmoBagSizes["762mm"][1]);
});

test("Bigger teams need more points and luckier kills per drop", () => {
    const game = startZombieRound(3);
    const ops = game.specOps!;
    const scale = ops.zombieDropTeamScale();
    expect(scale).toBeGreaterThan(1.5);
    const zombie = ops.livingEnemies()[0];

    ops.onZombieKilledForDrops(zombie, ZombiePowerUpDrops.pointStart, 1);
    ops.onZombieKilledForDrops(zombie, 0, ZombiePowerUpDrops.killChance * 0.9);
    expect(powerUpDrops(game)).toHaveLength(0);

    ops.onZombieKilledForDrops(zombie, ZombiePowerUpDrops.pointStart * scale, 1);
    expect(powerUpDrops(game)).toHaveLength(1);
});

test("Real zombie kills feed their cash into the drop counter", () => {
    const game = startZombieRound();
    const operator = game.playerBarn.livingPlayers.find((p) => !p.specOpsAi)!;
    const zombie = game.specOps!.livingEnemies()[0];
    zombie.damage({
        amount: 9999,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        source: operator,
    });
    expect(game.specOps!.zombiePointAccumulator).toBeGreaterThan(0);
});

test("Fireteam maps run classic Spec Ops and Zombies maps run zombie rules", () => {
    for (const key of FireteamMapPool) {
        expect(MapDefs[key].gameMode.specOpsMode).toBe(true);
        expect(MapDefs[key].gameMode.zombieMode).not.toBe(true);
        expect(MapDefs[key].gameMode.indoorMode).not.toBe(true);
    }
    expect(MapDefs.specops.gameMode.zombieMode).not.toBe(true);
    for (const key of ZombieMapPool) {
        expect(MapDefs[key].desc.name).toBe("Zombie Survival");
        expect(MapDefs[key].gameMode.specOpsMode).toBe(true);
        expect(MapDefs[key].gameMode.zombieMode).toBe(true);
        expect(MapDefs[key].gameMode.indoorMode).toBe(true);
    }
    expect(MapDefs.practice_specops.gameMode.zombieMode).toBe(false);
    expect(MapObjectDefs).not.toHaveProperty("zombie_indoor_arena_01");
});

test("Fireteam matches spawn soldiers, not zombies", () => {
    const game = createGame(TeamMode.Solo, "specops_woods");
    game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    expect(game.specOps?.zombieMode).toBe(false);
});

test("After Hours generates its furnished motel, maintenance, motor court and garage routes", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);

    const complex = game.map.buildings.find(
        (building) => building.type === "zombie_branching_complex_01",
    );
    expect(complex).toBeDefined();
    expect(complex?.surfaces).toHaveLength(9);
    expect(game.map.width).toBe(256);
    expect(game.map.height).toBe(208);

    const props = new Set(game.map.obstacles.map((obstacle) => obstacle.type));
    expect(props.has("bed_sm_01")).toBe(true);
    expect(props.has("lastcall_parts_rack")).toBe(true);
    expect(props.has("lastcall_sign_island")).toBe(true);
    expect(props.has("zombie_power_switch")).toBe(true);
    expect(props.has("zombie_pack_a_punch")).toBe(true);
    expect(props.has("zombie_garage_car")).toBe(true);
    expect(props.has("zombie_mystery_box")).toBe(true);
    expect(game.map.obstacles.filter((obstacle) => obstacle.type.startsWith("specops_station_")))
        .toHaveLength(0);
    for (const machineType of ZombiePerkMachineTypes) {
        expect(game.map.obstacles.filter((obstacle) => obstacle.type === machineType))
            .toHaveLength(1);
    }
    expect(game.map.obstacles.filter((obstacle) => obstacle.type === "zombie_spawn_point"))
        .toHaveLength(19);

    const gates = game.map.obstacles.filter((obstacle) => obstacle.type.startsWith("zombie_buy_gate_"));
    expect(gates).toHaveLength(9);
    expect(gates.every((gate) => gate.isButton && gate.collidable)).toBe(true);
    expect(
        game.map.obstacles
            .filter((object) => object.parentBuilding === complex && object.isWall)
            .every((wall) => !wall.destructible),
    ).toBe(true);
    // One painted floor for the whole block, generated from the same layout as the walls.
    const definition = MapObjectDefs.typeToDef("zombie_branching_complex_01", "building");
    expect(definition.floor.imgs.map((image) => image.sprite)).toEqual(["map-lastcall-floor.img"]);
    expect(MapDefs.specops_complex.assets.atlases).toContain("lastcall");
    expect(Math.abs(operator.pos.x - (game.map.center.x - 10))).toBeLessThan(8);
    expect(operator.pos.y).toBeLessThan(game.map.center.y - 35);
    expect(
        game.specOps!.ensureNavGraph().hasPath(
            operator,
            v2.add(game.map.center, v2.create(-80, 0)),
        ),
    ).toBe(false);
});

test("After Hours perk machines sell their fixed perks for cash", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    game.specOps!.grantCash(operator, 10_000);
    const startingCash = operator.specOpsCash;

    for (const machineType of ZombiePerkMachineTypes) {
        const machine = game.map.obstacles.find((obstacle) => obstacle.type === machineType)!;
        v2.set(operator.pos, machine.pos);
        game.grid.updateObject(operator);
        machine.interact(operator);
        game.update(0.5);
    }

    const totalCost = ZombiePerkMachineTypes.reduce(
        (sum, machineType) => sum + ZombiePerkMachines[machineType].cost,
        0,
    );
    expect(operator.specOpsCash).toBe(startingCash - totalCost);
    expect(operator.hasPerk("zombie_juggernog")).toBe(true);
    expect(operator.hasPerk("zombie_speed_cola")).toBe(true);
    expect(operator.hasPerk("self_revive")).toBe(true);
    expect(operator.hasPerk("zombie_stamin_up")).toBe(true);
    expect(operator.hasPerk("zombie_double_tap")).toBe(true);
    expect(operator.maxHealth).toBe(250);
    expect(operator.health).toBe(250);
});

test.each([false, true])("Zombies keeps its eight-second breather with continuous waves set to %s", (endless) => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    game.specOps!.endless = endless;
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();

    const zombies = game.playerBarn.livingPlayers.filter((player) => player.specOpsAi);
    for (const zombie of zombies) {
        zombie.damage({
            amount: 9999,
            damageType: GameConfig.DamageType.Player,
            dir: v2.create(1, 0),
            source: operator,
        });
    }
    game.update(0.05);

    expect(game.specOps!.phase).toBe("intermission");
    expect(game.specOps!.phaseDuration).toBe(ZombieWaveIntermissionTime);
    expect(game.specOps!.wave).toBe(1);
    game.step(ZombieWaveIntermissionTime - 0.25);
    expect(game.specOps!.wave).toBe(1);
    game.step(0.3);
    expect(game.specOps!.wave).toBe(2);
    expect(game.specOps!.phase).toBe("combat");
});

test("After Hours lobby gates charge cash and permanently open the selected route", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const gate = game.map.obstacles.find(
        (obstacle) =>
            obstacle.type === "zombie_buy_gate_750"
            && obstacle.pos.y < game.map.center.y
            && obstacle.pos.x < game.map.center.x,
    )!;
    const courtyard = v2.add(game.map.center, v2.create(-20, -15));

    expect(game.specOps!.ensureNavGraph().hasPath(operator, courtyard)).toBe(false);

    operator.specOpsCash = 1000;
    v2.set(operator.pos, gate.pos);
    game.grid.updateObject(operator);
    gate.interact(operator);

    expect(operator.specOpsCash).toBe(250);
    expect(gate.destroyed).toBe(true);
    expect(game.specOps!.ensureNavGraph().hasPath(operator, courtyard)).toBe(true);
});

test("After Hours spawns zombies at fixed entries in currently reachable zones", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);

    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();
    game.update(0.05);

    const zombies = game.playerBarn.livingPlayers.filter((player) => player.specOpsAi);
    const entries = game.map.obstacles.filter((obstacle) => obstacle.type === "zombie_spawn_point");
    expect(zombies.length).toBeGreaterThan(0);
    expect(
        zombies.every((zombie) => game.specOps!.ensureNavGraph().hasPath(zombie, operator.pos)),
    ).toBe(true);
    expect(
        zombies.every((zombie) => entries.some((entry) => v2.distance(zombie.pos, entry.pos) <= 6)),
    ).toBe(true);
});

test("After Hours power opens the garage and enables Pack-a-Punch", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const powerSwitch = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_power_switch")!;
    const powerGate = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_power_gate")!;
    const machine = game.map.obstacles.find((obstacle) => obstacle.type === ZombiePackAPunchType)!;

    expect(game.specOps!.zombiePowerOn).toBe(false);
    expect(machine.button?.canUse).toBe(false);
    v2.set(operator.pos, powerSwitch.pos);
    game.grid.updateObject(operator);
    powerSwitch.interact(operator);

    expect(game.specOps!.zombiePowerOn).toBe(true);
    expect(powerGate.destroyed).toBe(true);
    expect(machine.button?.canUse).toBe(true);
});

function packAPunchGame(teamMode = TeamMode.Solo, difficulty: SpecOpsDifficulty = "regular") {
    const game = createGame(teamMode, "specops_complex", { difficulty });
    const a = game.playerBarn.addTestPlayer({ name: "A" });
    const b = game.playerBarn.addTestPlayer({ name: "B" });
    game.update(0.1);
    const ops = game.specOps!;
    const powerSwitch = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_power_switch")!;
    v2.set(a.pos, powerSwitch.pos);
    game.grid.updateObject(a);
    powerSwitch.interact(a);
    const machine = game.map.obstacles.find((obstacle) => obstacle.type === ZombiePackAPunchType)!;
    const front = v2.add(machine.pos, v2.create(0, -(machine.interactionRad - 0.2)));
    for (const p of [a, b]) {
        v2.set(p.pos, front);
        game.grid.updateObject(p);
        p.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47", 30);
        p.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary);
    }
    return { game, ops, a, b, machine };
}

const machineLoot = (game: ReturnType<typeof createGame>, machine: { __id: number }) =>
    game.lootBarn.loots.find((loot) => loot.mysteryBoxId === machine.__id && !loot.destroyed);

test("Pack-a-Punch: Mark II twins exist for upgradable guns and aren't sold", () => {
    expect(Object.keys(ZombiePackAPunchNames)).toContain("m9");
    for (const gun of ZombieMysteryBoxWeapons) {
        expect(gun in ZombiePackAPunchNames, gun).toBe(true);
    }
    for (const [base, name] of Object.entries(ZombiePackAPunchNames)) {
        const def = GameObjectDefs.typeToDef(packAPunchType(base), "gun") as GunDef;
        expect(def.zombieUpgraded).toBe(true);
        expect(def.name).toBe(name);
        // Names are free-form (edited in zombiePackAPunch.ts); they just can't be empty.
        expect(name.trim().length, base).toBeGreaterThan(0);
        expect(def.dualWieldType).toBeUndefined();
        expect(def.ammo).toBe((GameObjectDefs.typeToDef(base, "gun") as GunDef).ammo);
        expect(SpecOpsShopCatalog.some((item) => item.sku === packAPunchType(base))).toBe(false);
    }
    expect(packAPunchUpgradeFor("raygun")).toBeUndefined();
});

test("Pack-a-Punch: gun goes in, works, pops out for the payer, who takes it", () => {
    const { game, ops, a, b, machine } = packAPunchGame(TeamMode.Duo);
    const reserveBefore = a.invManager.get("762mm");
    ops.grantCash(a, ZombieUpgradeCost);
    const paid = a.specOpsCash;
    machine.interact(a);

    // Paid, gun is gone into the machine (its magazine went back to the reserve).
    expect(a.specOpsCash).toBe(paid - ZombieUpgradeCost);
    expect(a.weapons[GameConfig.WeaponSlot.Primary].type).toBe("");
    expect(a.invManager.get("762mm")).toBe(reserveBefore + 30);
    expect(machine.button!.onOff).toBe(true);
    expect(machineLoot(game, machine)).toBeUndefined();

    // Busy: nobody else can start a second upgrade.
    ops.grantCash(b, ZombieUpgradeCost);
    const bCash = b.specOpsCash;
    machine.interact(b);
    expect(b.specOpsCash).toBe(bCash);

    game.step(packAPunchUpgradeTime("regular") + 0.2);
    const loot = machineLoot(game, machine)!;
    expect(loot.type).toBe("ak47_pap");
    expect(loot.mysteryBoxOwnerId).toBe(a.__id);
    expect(machine.button!.onOff).toBe(true);

    // Teammate can't take it.
    b.pickupTicker = 0;
    b.pickupLoot(loot);
    expect(loot.destroyed).toBe(false);

    a.pickupTicker = 0;
    machine.interact(a);
    expect(loot.destroyed).toBe(true);
    const slot = a.weapons.findIndex((w) => w.type === "ak47_pap");
    expect(slot).toBeGreaterThanOrEqual(0);
    const def = GameObjectDefs.typeToDef("ak47_pap", "gun");
    const stats = a.weaponManager.getAmmoStats(def, "ak47_pap");
    const baseStats = a.weaponManager.getAmmoStats(GameObjectDefs.typeToDef("ak47", "gun"), "ak47");
    expect(stats.maxClip).toBe(Math.ceil(baseStats.maxClip * ZombiePackAPunchStats.magazineMult));
    expect(a.weapons[slot].ammo).toBe(stats.maxClip);

    game.step(0.1);
    expect(machine.button!.onOff).toBe(false);
});

test("Pack-a-Punch: an unclaimed gun is lost after the claim window", () => {
    const { game, ops, a, machine } = packAPunchGame();
    ops.grantCash(a, ZombieUpgradeCost);
    machine.interact(a);
    game.step(packAPunchUpgradeTime("regular") + 0.2);
    const loot = machineLoot(game, machine)!;
    expect(loot).toBeDefined();
    game.step(ZombiePackAPunchStats.claimTime - 1);
    expect(loot.destroyed).toBe(false);
    game.step(1.5);
    expect(loot.destroyed).toBe(true);
    expect(a.weapons.some((w) => w.type.startsWith("ak47"))).toBe(false);
    expect(machine.button!.onOff).toBe(false);

    // Machine is free again.
    a.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "mp5", 30);
    a.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary);
    ops.grantCash(a, ZombieUpgradeCost);
    expect(ops.tryUpgradeZombieWeapon(a, machine)).toBe(true);
});

test("Pack-a-Punch timings: upgrade grows 2 s per difficulty step, claim window is always 12 s", () => {
    expect(SpecOpsDifficulties.map((difficulty) => packAPunchUpgradeTime(difficulty))).toEqual([3, 5, 7, 9]);
    expect(ZombiePackAPunchStats.claimTime).toBe(12);

    for (const difficulty of SpecOpsDifficulties) {
        const { game, ops, a, machine } = packAPunchGame(TeamMode.Solo, difficulty);
        const upgradeTime = packAPunchUpgradeTime(difficulty);
        ops.grantCash(a, ZombieUpgradeCost * 2);
        expect(ops.tryUpgradeZombieWeapon(a, machine)).toBe(true);

        game.step(upgradeTime - 0.3);
        expect(machineLoot(game, machine), `${difficulty}: still working`).toBeUndefined();
        game.step(0.5);
        const loot = machineLoot(game, machine)!;
        expect(loot, `${difficulty}: gun ready`).toBeDefined();

        game.step(ZombiePackAPunchStats.claimTime - 0.5);
        expect(loot.destroyed, `${difficulty}: still claimable`).toBe(false);
        game.step(1);
        expect(loot.destroyed, `${difficulty}: lost after the claim window`).toBe(true);
        expect(machine.button!.onOff).toBe(false);
    }
});

test("Pack-a-Punch: refuses Mark II guns, non-upgradable guns, no power, or no cash", () => {
    const { ops, a, machine } = packAPunchGame();
    a.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47_pap", 45);
    ops.grantCash(a, ZombieUpgradeCost);
    expect(ops.tryUpgradeZombieWeapon(a, machine)).toBe(false);
    a.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "raygun", 20);
    expect(ops.tryUpgradeZombieWeapon(a, machine)).toBe(false);
    a.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47", 30);
    a.specOpsCash = ZombieUpgradeCost - 1;
    expect(ops.tryUpgradeZombieWeapon(a, machine)).toBe(false);
    a.specOpsCash = ZombieUpgradeCost;
    ops.zombiePowerOn = false;
    expect(ops.tryUpgradeZombieWeapon(a, machine)).toBe(false);
    ops.zombiePowerOn = true;
    expect(ops.tryUpgradeZombieWeapon(a, machine)).toBe(true);
});

test("Pack-a-Punch: the machine sits clear of walls with room to stand in front", () => {
    const { game, a, machine } = packAPunchGame();
    // No other solid object overlaps the machine.
    for (const other of game.map.obstacles) {
        if (other === machine || other.dead || !other.collidable) continue;
        expect(collider.intersect(machine.collider, other.collider), other.type).toBeFalsy();
    }
    // The pop-out spot and the front of the machine are reachable.
    // A player can stand in front of the machine (where the gun pops out) without hitting anything.
    const front = v2.add(machine.pos, v2.create(0, -(1.8 + a.rad + 0.3)));
    for (const other of game.map.obstacles) {
        if (other.dead || !other.collidable || !util.sameLayer(other.layer, machine.layer)) continue;
        expect(!!collider.intersectCircle(other.collider, front, a.rad), other.type).toBe(false);
    }
});

test("After Hours relocates the Mystery Box after repeated uses", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    const startingPos = v2.copy(box.pos);

    for (let use = 0; use < ZombieMysteryBoxRelocateUses; use++) {
        v2.set(operator.pos, v2.add(box.pos, v2.create(0, -3)));
        game.grid.updateObject(operator);
        game.specOps!.grantCash(operator, ZombieMysteryBoxCost);
        box.interact(operator);
        game.step(
            ZombieMysteryBoxRollDuration
                + ZombieMysteryBoxClaimDuration
                + ZombieMysteryBoxCooldown
                + 0.5,
        );
    }

    expect(v2.distance(box.pos, startingPos)).toBeGreaterThan(4);
    expect(box.button?.canUse).toBe(true);
});

test("Zombie speed scales with difficulty and stays under the navigation cap", () => {
    expect(SpecOpsDifficulties.map((difficulty) => ZombieSpeedByDifficulty[difficulty])).toEqual([
        0.51,
        0.55,
        0.59,
        0.64,
    ]);
    for (const difficulty of SpecOpsDifficulties) {
        expect(zombieSpeedMult("zombie_walker", difficulty)).toBe(ZombieSpeedByDifficulty[difficulty]);
        expect(zombieSpeedMult("zombie_walker", difficulty)).toBeLessThanOrEqual(ZombieMaxSpeedMult);
    }

    // A future fast type is clamped instead of outrunning the navigation.
    const walker = ZombieLoadouts.zombie_walker;
    walker.speedScale = 5;
    try {
        expect(zombieSpeedMult("zombie_walker", "veteran")).toBe(ZombieMaxSpeedMult);
    } finally {
        delete walker.speedScale;
    }
});

test("Spawned zombies move at their difficulty's speed", () => {
    const speeds: number[] = [];
    for (const difficulty of SpecOpsDifficulties) {
        const game = createGame(TeamMode.Solo, "zombie_dead_air", { difficulty });
        game.playerBarn.addTestPlayer({ name: "A" });
        game.update(0.1);
        const zombie = game.specOps!.spawnEnemyPublic("zombie_walker", true);
        expect(zombie.specOpsSpeedMult, difficulty).toBe(ZombieSpeedByDifficulty[difficulty]);
        game.update(0.01);
        speeds.push(zombie.speed);
    }
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
});

test("Kill-heat rush speeds up zombies by 15% and Fireteam enemies by 38% at full pressure", () => {
    const rushRatio = (map: "zombie_dead_air" | "test_specops", kind: "zombie_walker" | "militia") => {
        const game = createGame(TeamMode.Solo, map);
        game.playerBarn.addTestPlayer({ name: "A" });
        game.update(0.1);
        const ops = game.specOps!;
        // Hold pressure where the test puts it instead of letting kills drive it.
        (ops as unknown as { refreshPushPressure: () => void }).refreshPushPressure = () => {};
        const enemy = ops.spawnEnemyPublic(kind, true);
        ops.pushPressure = 0;
        game.update(0.01);
        const calm = enemy.speed;
        ops.pushPressure = 1;
        game.update(0.01);
        return enemy.speed / calm;
    };
    expect(ZombieRushSpeedBonus).toBe(0.15);
    expect(rushRatio("zombie_dead_air", "zombie_walker")).toBeCloseTo(1.15, 5);
    expect(rushRatio("test_specops", "militia")).toBeCloseTo(1.38, 5);
});

test("Zombie wave one spawns unarmed melee walkers with cash bounties", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);

    expect(game.specOps?.zombieMode).toBe(true);
    game.specOps!.startNextWave();
    game.specOps!.drainWaveSpawnQueuePublic();
    game.update(0.05);

    const zombies = game.playerBarn.livingPlayers.filter((player) => player.specOpsAi);
    expect(zombies).toHaveLength(6);
    expect(zombies.every((zombie) => zombie.name === "Zombie")).toBe(true);
    expect(
        zombies.every((zombie) => !zombie.weapons[GameConfig.WeaponSlot.Primary].type),
    ).toBe(true);
    expect(
        zombies.every((zombie) => zombie.weapons[GameConfig.WeaponSlot.Melee].type === "fists"),
    ).toBe(true);
    expect(zombies.every((zombie) => zombie.specOpsBounty === ZombieEconomy.killCash)).toBe(true);
    expect(zombies.every((zombie) => zombie.health === 42)).toBe(true);
    expect(zombies.every((zombie) => zombie.indoors)).toBe(true);

    const start = v2.copy(zombies[0].pos);
    game.step(0.5);
    expect(v2.distance(zombies[0].pos, start)).toBeGreaterThan(0.05);
});

test("Mystery Box charges once, synchronizes its roll, and replaces the held gun", () => {
    const game = createGame(TeamMode.Duo, "specops_complex");
    const buyer = game.playerBarn.addTestPlayer({ name: "Buyer" });
    const teammate = game.playerBarn.addTestPlayer({ name: "Teammate" });
    game.update(0.1);
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    const interactionPos = v2.add(box.pos, v2.create(0, -4.5));
    v2.set(buyer.pos, interactionPos);
    v2.set(teammate.pos, interactionPos);
    game.grid.updateObject(buyer);
    game.grid.updateObject(teammate);

    const startingCash = buyer.specOpsCash;
    expect(startingCash).toBeLessThan(ZombieMysteryBoxCost);
    box.interact(buyer);
    expect(buyer.specOpsCash).toBe(startingCash);
    expect(box.button?.canUse).toBe(true);

    game.specOps!.grantCash(buyer, ZombieMysteryBoxCost);
    const paidCash = buyer.specOpsCash;
    box.interact(buyer);
    expect(buyer.specOpsCash).toBe(paidCash - ZombieMysteryBoxCost);
    expect(box.button?.onOff).toBe(true);
    expect(box.button?.canUse).toBe(false);
    let preview = game.lootBarn.loots.find((loot) => loot.mysteryBoxId === box.__id)!;
    expect(preview.mysteryBoxLocked).toBe(true);
    // The cycling preview is any box gun, or the Ray Gun flashing by as a tease.
    expect([...ZombieMysteryBoxWeapons, ...ZombieWonderWeapons.map((weapon) => weapon.type)]).toContain(preview.type);

    const teammateCash = teammate.specOpsCash;
    box.interact(teammate);
    expect(teammate.specOpsCash).toBe(teammateCash);
    expect(game.lootBarn.loots.filter((loot) => loot.mysteryBoxId === box.__id)).toHaveLength(1);

    game.step(ZombieMysteryBoxRollDuration + 0.2);
    preview = game.lootBarn.loots.find(
        (loot) => loot.mysteryBoxId === box.__id && !loot.destroyed,
    )!;
    expect(preview.mysteryBoxLocked).toBe(false);
    expect(box.button?.canUse).toBe(true);

    buyer.weaponManager.setWeapon(GameConfig.WeaponSlot.Secondary, "glock", 17);
    buyer.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
    box.interact(buyer);
    expect(preview.destroyed).toBe(false);
    expect(box.button?.canUse).toBe(true);

    const replacedSlot = GameConfig.WeaponSlot.Secondary;
    buyer.weaponManager.setCurWeapIndex(replacedSlot);
    box.interact(buyer);
    expect(preview.destroyed).toBe(true);
    expect(buyer.weapons[replacedSlot].type).toBe(preview.type);
    expect(buyer.weapons[replacedSlot].ammo).toBeGreaterThan(0);
    expect(buyer.weapons[GameConfig.WeaponSlot.Primary].type).toBe("m9");
    // With two guns the held one is replaced, not dropped on the floor.
    expect(game.lootBarn.loots.some((loot) => !loot.destroyed && loot.type === "glock")).toBe(false);

    game.update(0.1);
    expect(box.button?.onOff).toBe(false);
    expect(box.button?.canUse).toBe(false);
    game.step(ZombieMysteryBoxCooldown + 0.1);
    expect(box.button?.canUse).toBe(true);
});

/** Roll the box for `buyer` and return the revealed gun. */
function rollMysteryBox(game: ReturnType<typeof createGame>, buyer: Player) {
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    v2.set(buyer.pos, v2.add(box.pos, v2.create(0, -4.5)));
    game.grid.updateObject(buyer);
    game.specOps!.grantCash(buyer, ZombieMysteryBoxCost);
    box.interact(buyer);
    game.step(ZombieMysteryBoxRollDuration + 0.2);
    const prize = game.lootBarn.loots.find((loot) => loot.mysteryBoxId === box.__id && !loot.destroyed)!;
    return { box, prize };
}

test("Mystery Box with two guns can't be taken while holding a grenade or melee", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const buyer = game.playerBarn.addTestPlayer({ name: "Buyer" });
    game.update(0.1);
    buyer.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "m9", 15);
    buyer.weaponManager.setWeapon(GameConfig.WeaponSlot.Secondary, "glock", 17);
    buyer.invManager.set("frag", 2);
    buyer.weaponManager.setWeapon(GameConfig.WeaponSlot.Throwable, "frag", 0);
    const { box, prize } = rollMysteryBox(game, buyer);

    for (const slot of [GameConfig.WeaponSlot.Throwable, GameConfig.WeaponSlot.Melee]) {
        buyer.weaponManager.setCurWeapIndex(slot);
        box.interact(buyer);
        expect(prize.destroyed, `slot ${slot}`).toBe(false);
    }
    expect(buyer.weapons[GameConfig.WeaponSlot.Primary].type).toBe("m9");
    expect(buyer.weapons[GameConfig.WeaponSlot.Secondary].type).toBe("glock");

    // Switching to a gun takes it, replacing that gun with no floor drop.
    buyer.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary);
    box.interact(buyer);
    expect(prize.destroyed).toBe(true);
    expect(buyer.weapons[GameConfig.WeaponSlot.Primary].type).toBe(prize.type);
    expect(game.lootBarn.loots.some((loot) => !loot.destroyed && loot.type === "m9")).toBe(false);
});

test("Ordinary gun pickups outside the Mystery Box still drop the replaced gun", () => {
    const game = createGame(TeamMode.Solo, "test_specops");
    const player = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "m9", 15);
    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Secondary, "glock", 17);
    player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Secondary);
    const loot = game.lootBarn.addLoot("mp5", v2.copy(player.pos), player.layer, 1, { pushSpeed: 0 })!;
    player.pickupLoot(loot);
    expect(player.weapons[GameConfig.WeaponSlot.Secondary].type).toBe("mp5");
    expect(game.lootBarn.loots.some((l) => !l.destroyed && l.type === "glock")).toBe(true);
});

test("Mystery Box fills an empty gun slot when the player takes it while holding fists", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const buyer = game.playerBarn.addTestPlayer({ name: "Buyer" });
    game.update(0.1);
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    v2.set(buyer.pos, v2.add(box.pos, v2.create(0, -4.5)));
    game.grid.updateObject(buyer);
    game.specOps!.grantCash(buyer, ZombieMysteryBoxCost);
    box.interact(buyer);
    game.step(ZombieMysteryBoxRollDuration + 0.2);
    const prize = game.lootBarn.loots.find(
        (loot) => loot.mysteryBoxId === box.__id && !loot.destroyed,
    )!;

    expect(buyer.weapons[GameConfig.WeaponSlot.Secondary].type).toBe("");
    buyer.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
    box.interact(buyer);

    expect(prize.destroyed).toBe(true);
    expect(buyer.weapons[GameConfig.WeaponSlot.Secondary].type).toBe(prize.type);
    expect(buyer.curWeapIdx).toBe(GameConfig.WeaponSlot.Secondary);
});

test("Zombies: E starts round 1 early, but not later rounds", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const ops = game.specOps!;
    game.step(3);
    expect(ops.phase).toBe("prep");
    expect(ops.tryStartWaveEarly(operator)).toBe(true);
    expect(ops.phase).toBe("combat");

    ops.drainWaveSpawnQueuePublic();
    for (const enemy of [...ops.livingEnemies()]) {
        enemy.damage({
            amount: 9999,
            damageType: GameConfig.DamageType.Player,
            dir: v2.create(1, 0),
            source: operator,
        });
    }
    game.step(1);
    expect(ops.phase).toBe("intermission");
    game.step(ZombieWaveIntermissionTime - 2);
    expect(ops.tryStartWaveEarly(operator)).toBe(false);
    expect(ops.phase).toBe("intermission");
});

test("Zombies economy: 500 to start, 10 per hit (capped), 60 per kill, +50 for melee, no round bonus", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const ops = game.specOps!;
    expect(operator.specOpsCash).toBe(ZombieEconomy.startingCash);
    ops.startNextWave();
    ops.drainWaveSpawnQueuePublic();
    const [a, b] = ops.livingEnemies();

    const hit = (z: typeof a, amount: number, gameSourceType?: string) =>
        z.damage({
            amount,
            damageType: GameConfig.DamageType.Player,
            dir: v2.create(1, 0),
            source: operator,
            gameSourceType,
        });

    let cash = operator.specOpsCash;
    hit(a, 1);
    expect(operator.specOpsCash - cash).toBe(ZombieEconomy.hitCash);
    a.health = 9999;
    for (let i = 0; i < 30; i++) hit(a, 1);
    expect(a.zombieHitCashPaid).toBe(ZombieEconomy.maxHitCashPerZombie);

    cash = operator.specOpsCash;
    hit(a, 99999);
    expect(operator.specOpsCash - cash).toBe(ZombieEconomy.killCash);

    cash = operator.specOpsCash;
    hit(b, 99999, "fists");
    expect(operator.specOpsCash - cash).toBe(ZombieEconomy.killCash + ZombieEconomy.meleeKillBonus);

    for (const z of [...ops.livingEnemies()]) hit(z, 99999);
    cash = operator.specOpsCash;
    game.step(1);
    expect(ops.phase).toBe("intermission");
    expect(operator.specOpsCash).toBe(cash);
});

function rayGunGame(teamMode = TeamMode.Duo) {
    const game = createGame(teamMode, "specops_complex");
    const a = game.playerBarn.addTestPlayer({ name: "A" });
    const b = game.playerBarn.addTestPlayer({ name: "B" });
    game.update(0.1);
    return { game, ops: game.specOps!, a, b };
}

function giveRayGun(player: { weaponManager: { setWeapon(slot: number, type: string, ammo: number): void } }) {
    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, ZombieRayGun.type, 20);
}

test("Ray Gun: wonder weapon def, 50AE, box-only (never in the shop)", () => {
    const def = GameObjectDefs.typeToDef(ZombieRayGun.type, "gun") as GunDef;
    expect(def.wonderWeapon).toBe(true);
    expect(def.ammo).toBe("50AE");
    expect(def.maxClip).toBe(20);
    expect(def.bulletType).toBe("bullet_raygun");
    expect(GameObjectDefs.typeToDef(def.bulletType, "bullet").damage).toBe(180);
    const splash = GameObjectDefs.typeToDef("explosion_raygun", "explosion");
    expect(splash.damage).toBe(90);
    expect(splash.rad.max).toBe(3);
    expect(SpecOpsShopCatalog.some((item) => item.sku === ZombieRayGun.type)).toBe(false);
    expect(ZombieMysteryBoxWeapons).not.toContain(ZombieRayGun.type);
});

test("Ray Gun: box odds follow ZombieRayGun.boxChance, ordinary guns share the rest", () => {
    const { ops, a } = rayGunGame(TeamMode.Solo);
    const chance = ZombieRayGun.boxChance;
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThan(1);
    expect(ZombieMysteryBoxWeapons.length).toBeGreaterThan(0);
    expect(new Set(ZombieMysteryBoxWeapons).size).toBe(ZombieMysteryBoxWeapons.length);
    expect(ops.rollMysteryBoxResult(a, 0)).toBe(ZombieRayGun.type);
    expect(ops.rollMysteryBoxResult(a, chance * 0.99)).toBe(ZombieRayGun.type);
    const allWonderChance = ZombieWonderWeapons.reduce((sum, weapon) => sum + weapon.chance, 0);
    for (let i = 0; i < 50; i++) {
        const result = ops.rollMysteryBoxResult(a, allWonderChance + (i / 50) * (1 - allWonderChance));
        expect(ZombieMysteryBoxWeapons).toContain(result);
    }
    let hits = 0;
    const rolls = 20000;
    for (let i = 0; i < rolls; i++) {
        if (ops.rollMysteryBoxResult(a) === ZombieRayGun.type) hits++;
    }
    // Within ~5 standard deviations of the configured chance.
    const sd = Math.sqrt((chance * (1 - chance)) / rolls);
    expect(Math.abs(hits / rolls - chance)).toBeLessThan(5 * sd);
});

test("Ray Gun: holding one or leaving a dropped one on the floor blocks rolling it; teammates roll their own", () => {
    const { game, ops, a, b } = rayGunGame();
    giveRayGun(a);
    expect(ops.canGetWonderWeapon(a, ZombieRayGun.type)).toBe(false);
    expect(ops.rollMysteryBoxResult(a, 0)).not.toBe(ZombieRayGun.type);
    expect(ops.canGetWonderWeapon(b, ZombieRayGun.type)).toBe(true);

    a.weaponManager.dropGun(GameConfig.WeaponSlot.Primary);
    const dropped = game.lootBarn.loots.find((loot) => loot.type === ZombieRayGun.type && !loot.destroyed)!;
    expect(dropped.droppedById).toBe(a.__id);
    expect(a.hasWonderWeapon(ZombieRayGun.type)).toBe(false);
    expect(ops.canGetWonderWeapon(a, ZombieRayGun.type)).toBe(false);
    expect(ops.canGetWonderWeapon(b, ZombieRayGun.type)).toBe(true);

    dropped.destroy();
    expect(ops.canGetWonderWeapon(a, ZombieRayGun.type)).toBe(true);
});

test("Ray Gun: anyone without one can pick up a dropped one; nobody holds two", () => {
    const { game, a, b } = rayGunGame();
    v2.set(b.pos, v2.copy(a.pos));
    giveRayGun(a);
    giveRayGun(b);
    a.weaponManager.dropGun(GameConfig.WeaponSlot.Primary);
    const dropped = game.lootBarn.loots.find((loot) => loot.type === ZombieRayGun.type && !loot.destroyed)!;

    // b already has one: blocked, loot stays, still one Ray Gun.
    b.weaponManager.setWeapon(GameConfig.WeaponSlot.Secondary, "", 0);
    b.pickupTicker = 0;
    b.pickupLoot(dropped);
    expect(dropped.destroyed).toBe(false);
    expect(b.weapons.filter((w) => w.type === ZombieRayGun.type)).toHaveLength(1);

    // a (no Ray Gun now) can take it back.
    a.pickupTicker = 0;
    a.pickupLoot(dropped);
    expect(dropped.destroyed).toBe(true);
    expect(a.hasWonderWeapon(ZombieRayGun.type)).toBe(true);
});

test("Mystery Box: only the player who paid can take the reveal", () => {
    const { game, a: buyer, b: teammate } = rayGunGame();
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    const near = v2.add(box.pos, v2.create(0, -4.5));
    v2.set(buyer.pos, near);
    v2.set(teammate.pos, v2.copy(near));
    game.grid.updateObject(buyer);
    game.grid.updateObject(teammate);
    game.specOps!.grantCash(buyer, ZombieMysteryBoxCost);
    box.interact(buyer);
    game.step(ZombieMysteryBoxRollDuration + 0.2);
    const prize = game.lootBarn.loots.find((loot) => loot.mysteryBoxId === box.__id && !loot.destroyed)!;
    expect(prize.mysteryBoxOwnerId).toBe(buyer.__id);

    teammate.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
    box.interact(teammate);
    teammate.pickupTicker = 0;
    teammate.pickupLoot(prize);
    expect(prize.destroyed).toBe(false);

    buyer.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
    buyer.pickupTicker = 0;
    box.interact(buyer);
    expect(prize.destroyed).toBe(true);
});

test("Mystery Box: a Ray Gun roll falls back to a normal gun if the payer got one mid-roll", () => {
    const { game, a: buyer } = rayGunGame(TeamMode.Solo);
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    v2.set(buyer.pos, v2.add(box.pos, v2.create(0, -4.5)));
    game.grid.updateObject(buyer);
    game.specOps!.grantCash(buyer, ZombieMysteryBoxCost);

    const random = Math.random;
    Math.random = () => 0;
    try {
        box.interact(buyer);
    } finally {
        Math.random = random;
    }
    giveRayGun(buyer);
    game.step(ZombieMysteryBoxRollDuration + 0.2);
    const prize = game.lootBarn.loots.find((loot) => loot.mysteryBoxId === box.__id && !loot.destroyed)!;
    expect(prize.type).not.toBe(ZombieRayGun.type);
    expect(ZombieMysteryBoxWeapons).toContain(prize.type);
});

test("Mystery Box: an eligible payer who rolls the Ray Gun gets it", () => {
    const { game, a: buyer } = rayGunGame(TeamMode.Solo);
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    v2.set(buyer.pos, v2.add(box.pos, v2.create(0, -4.5)));
    game.grid.updateObject(buyer);
    game.specOps!.grantCash(buyer, ZombieMysteryBoxCost);
    const random = Math.random;
    Math.random = () => 0;
    try {
        box.interact(buyer);
    } finally {
        Math.random = random;
    }
    game.step(ZombieMysteryBoxRollDuration + 0.2);
    const prize = game.lootBarn.loots.find((loot) => loot.mysteryBoxId === box.__id && !loot.destroyed)!;
    expect(prize.type).toBe(ZombieRayGun.type);
    buyer.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);
    box.interact(buyer);
    expect(buyer.hasWonderWeapon(ZombieRayGun.type)).toBe(true);
    const slot = buyer.weapons.findIndex((w) => w.type === ZombieRayGun.type);
    expect(buyer.weapons[slot].ammo).toBe(20);
});

test("Ray Gun splash: 90 near, 45 at the edge, zombies only, 10 to the shooter, none to teammates", () => {
    const { game, ops, a: shooter, b: teammate } = rayGunGame();
    ops.startNextWave();
    ops.drainWaveSpawnQueuePublic();
    const [near, edge, outside, ...others] = ops.livingEnemies();
    const center = v2.copy(shooter.pos);
    for (const z of others) {
        v2.set(z.pos, v2.add(center, v2.create(-40, 40)));
        game.grid.updateObject(z);
    }
    const place = (obj: typeof near, offset: number) => {
        v2.set(obj.pos, v2.add(center, v2.create(0, offset)));
        obj.layer = shooter.layer;
        game.grid.updateObject(obj);
    };
    place(near, near.rad + 1);
    place(edge, edge.rad + 3);
    place(outside, outside.rad + 3.5);
    place(teammate, -(teammate.rad + 1));
    for (const z of [near, edge, outside]) z.health = 9999;
    v2.set(shooter.pos, v2.add(center, v2.create(2, 0)));
    game.grid.updateObject(shooter);
    shooter.specOpsArmor = 0;
    shooter.chest = "";
    shooter.helmet = "";
    const before = {
        near: near.health,
        edge: edge.health,
        outside: outside.health,
        mate: teammate.health,
        shooter: shooter.health,
    };

    ops.rayGunSplash(center, shooter.layer, shooter, 1);
    expect(before.near - near.health).toBeCloseTo(90, 1);
    expect(before.edge - edge.health).toBeCloseTo(45, 1);
    expect(outside.health).toBe(before.outside);
    expect(teammate.health).toBe(before.mate);
    expect(before.shooter - shooter.health).toBeCloseTo(ZombieRayGun.selfDamage, 1);

    // Double Tap style damageMult scales zombie splash; the direct-hit target is skipped.
    const nearHp = near.health;
    const edgeHp = edge.health;
    ops.rayGunSplash(center, shooter.layer, undefined, 2, new Set([edge.__id]));
    expect(nearHp - near.health).toBeCloseTo(180, 1);
    expect(edge.health).toBe(edgeHp);
});

test("Ray Gun bolt: 180 direct hit, splash on neighbours, no full explosion pass", () => {
    const { game, ops, a: shooter } = rayGunGame(TeamMode.Solo);
    ops.startNextWave();
    ops.drainWaveSpawnQueuePublic();
    const [target, neighbour] = ops.livingEnemies();
    const start = v2.copy(shooter.pos);
    // Clear the firing lane of every other player/bot.
    for (const p of game.playerBarn.players) {
        if (p === shooter || p === target || p === neighbour) continue;
        v2.set(p.pos, v2.add(start, v2.create(-40, 40)));
        game.grid.updateObject(p);
    }
    const dir = v2.create(1, 0);
    for (
        const [z, pos] of [
            [target, v2.add(start, v2.create(6, 0))],
            [neighbour, v2.add(start, v2.create(6 + target.rad + neighbour.rad + 0.6, 0.5))],
        ] as const
    ) {
        v2.set(z.pos, pos);
        z.layer = shooter.layer;
        z.health = 9999;
        game.grid.updateObject(z);
    }
    const t0 = target.health;
    const n0 = neighbour.health;
    const bullet = game.bulletBarn.fireBullet({
        bulletType: "bullet_raygun",
        gameSourceType: ZombieRayGun.type,
        pos: v2.add(start, v2.mul(dir, shooter.rad + 0.1)),
        dir,
        layer: shooter.layer,
        damageMult: 1,
        damageType: GameConfig.DamageType.Player,
        playerId: shooter.__id,
    });
    for (let i = 0; i < 20 && bullet.active; i++) {
        game.bulletBarn.update(0.02);
        game.explosionBarn.update();
    }
    expect(bullet.active).toBe(false);
    expect(t0 - target.health).toBeCloseTo(180, 0);
    expect(n0 - neighbour.health).toBeGreaterThan(40);
    expect(n0 - neighbour.health).toBeLessThanOrEqual(90.5);
    expect(game.explosionBarn.explosions).toHaveLength(0);
    expect(game.explosionBarn.newExplosions.some((e) => e.type === "explosion_raygun")).toBe(true);
});

test("Zombies has no contracts (no Most Wanted)", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const ops = game.specOps!;
    expect(ops.zombieMode).toBe(true);
    expect(ops.contractsEnabled).toBe(false);
});

test("Zombies only ever spawns zombies: no soldiers, bosses, or Ironclads", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const ops = game.specOps!;

    // Non-zombie classes are refused; zombies still spawn.
    expect(() => ops.spawnEnemyPublic("warlord")).toThrow();
    expect(() => ops.spawnEnemyPublic("rifle")).toThrow();
    expect(ops.spawnEnemyPublic("zombie_walker").name).toBe("Zombie");

    // Late-round IR strobes call airstrikes but never summon Ironclads.
    ops.wave = 30;
    const before = ops.livingEnemies().length;
    ops.onHumanStrobeThrown(operator, v2.copy(operator.pos));
    expect(ops.livingEnemies().length).toBe(before);

    // Boss (10/30), mini-boss (7), vest (5/10) and Ironclad-era rounds are plain zombie rounds.
    for (const wave of [7, 10, 30]) {
        ops.wave = wave - 1;
        ops.startNextWave();
        ops.drainWaveSpawnQueuePublic();
    }
    const enemies = ops.livingEnemies();
    expect(enemies.length).toBeGreaterThan(0);
    for (const enemy of enemies) {
        expect(["Zombie", "Runner", "Brute"]).toContain(enemy.name);
        expect(enemy.weapons[GameConfig.WeaponSlot.Primary].type).toBe("");
        expect(enemy.weapons[GameConfig.WeaponSlot.Secondary].type).toBe("");
        expect(enemy.specOpsStrobeTank).toBe(false);
        expect(enemy.specOpsSuicideVest).toBe(false);
    }
});

test("Normal zombies wear one of the three zombie bodies, which players can't equip", async () => {
    const { UnlockDefs } = await import("../../shared/defs/gameObjects/unlockDefs.ts");
    const game = createGame(TeamMode.Solo, "specops_complex");
    game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const ops = game.specOps!;
    const zombieBodies = ["outfitZombie01", "outfitZombie02", "outfitZombie03"];
    for (const body of zombieBodies) {
        const def = GameObjectDefs.typeToDef(body, "outfit");
        expect(def.skinImg.baseSprite).toBe(`player-base-zombie-${body.slice(-2)}.img`);
        expect(UnlockDefs.unlock_default.unlocks).not.toContain(body);
    }
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(ops.spawnEnemyPublic("zombie_walker").outfit);
    for (const outfit of seen) expect(zombieBodies).toContain(outfit);
    expect(seen.size).toBeGreaterThan(1);
});

test("Ray Gun: legendary ring on the floor and it flashes by in the box cycle", () => {
    const def = GameObjectDefs.typeToDef(ZombieRayGun.type, "gun") as GunDef;
    expect(def.lootImg.legendaryRing).toBe("loot-circle-legendary-ring.img");
    expect(GameObjectDefs.typeToDef("explosion_legendary_reveal", "explosion").damage).toBe(0);

    const { ops } = rayGunGame(TeamMode.Solo);
    const pick = (previous: string) =>
        (ops as unknown as { pickMysteryBoxWeapon(previous: string): string }).pickMysteryBoxWeapon(previous);
    const seen = new Set<string>();
    let previous = "";
    for (let i = 0; i < 2000; i++) {
        previous = pick(previous);
        seen.add(previous);
    }
    expect(seen.has(ZombieRayGun.type)).toBe(true);
    for (const gun of ZombieMysteryBoxWeapons) expect(seen.has(gun), gun).toBe(true);
    for (const weapon of ZombieWonderWeapons) expect(seen.has(weapon.type), weapon.type).toBe(true);
    expect(seen.size).toBe(ZombieMysteryBoxWeapons.length + ZombieWonderWeapons.length);
});

test("Ray Gun: the box reveal plays the legendary burst", () => {
    const { game, a: buyer } = rayGunGame(TeamMode.Solo);
    const box = game.map.obstacles.find((obstacle) => obstacle.type === "zombie_mystery_box")!;
    v2.set(buyer.pos, v2.add(box.pos, v2.create(0, -4.5)));
    game.grid.updateObject(buyer);
    game.specOps!.grantCash(buyer, ZombieMysteryBoxCost);
    const random = Math.random;
    Math.random = () => 0;
    try {
        box.interact(buyer);
    } finally {
        Math.random = random;
    }
    let burst = false;
    const t0 = ZombieMysteryBoxRollDuration + 0.3;
    for (let t = 0; t < t0; t += 0.1) {
        game.explosionBarn.newExplosions.length = 0;
        game.step(0.1);
        burst ||= game.explosionBarn.newExplosions.some((e) => e.type === "explosion_legendary_reveal");
    }
    expect(burst).toBe(true);
    const prize = game.lootBarn.loots.find((loot) => loot.mysteryBoxId === box.__id && !loot.destroyed)!;
    expect(prize.type).toBe(ZombieRayGun.type);
});

test("Dev cheat: set and add cash (clamped to the cap, not counted as earned)", async () => {
    const { Config } = await import("../../server/src/config.ts");
    const { EditMsg } = await import("../../shared/net/editMsg.ts");
    const { SpecOpsCashCap } = await import("../../shared/defs/maps/specOpsShop.ts");
    const game = createGame(TeamMode.Solo, "specops_complex");
    const player = game.playerBarn.addTestPlayer({ name: "Dev" });
    game.update(0.1);
    const allow = Config.debug.allowEditMsg;
    Config.debug.allowEditMsg = true;
    try {
        const earned = player.specOpsCashEarned;
        const send = (setCash: number, addCash: number) => {
            const msg = new EditMsg();
            msg.setCash = setCash;
            msg.addCash = addCash;
            player.processEditMsg(msg);
        };
        send(25000, 0);
        expect(player.specOpsCash).toBe(25000);
        send(-1, 5000);
        expect(player.specOpsCash).toBe(30000);
        send(0, 0);
        expect(player.specOpsCash).toBe(0);
        send(SpecOpsCashCap + 999, 0);
        expect(player.specOpsCash).toBe(SpecOpsCashCap);
        expect(player.specOpsCashEarned).toBe(earned);

        // A plain edit message (no cash fields) leaves cash alone.
        send(-1, 0);
        expect(player.specOpsCash).toBe(SpecOpsCashCap);

        // With edit messages disabled (prod), cheats do nothing.
        Config.debug.allowEditMsg = false;
        send(100, 0);
        expect(player.specOpsCash).toBe(SpecOpsCashCap);
    } finally {
        Config.debug.allowEditMsg = allow;
    }
});

test("Pack-a-Punch: Mark II tracers are visual only (same damage, speed, range)", () => {
    for (const base of Object.keys(ZombiePackAPunchNames)) {
        const gun = GameObjectDefs.typeToDef(base, "gun") as GunDef;
        const upgraded = GameObjectDefs.typeToDef(packAPunchType(base), "gun") as GunDef;
        const kind = ZombiePackAPunchSpecials[base]?.kind;
        const ownBullet = kind === "pierce" || kind === "chain";
        expect(upgraded.bulletType, base).toBe(
            ownBullet ? packAPunchBulletType(gun.bulletType, base) : packAPunchBulletType(gun.bulletType),
        );
        const orig = GameObjectDefs.typeToDef(gun.bulletType, "bullet");
        const bullet = GameObjectDefs.typeToDef(upgraded.bulletType, "bullet");
        expect(bullet.damage).toBe(orig.damage);
        expect(bullet.speed).toBe(orig.speed);
        expect(bullet.distance).toBe(orig.distance);
        expect(bullet.obstacleDamage).toBe(orig.obstacleDamage);
        expect(bullet.onHit).toBe(orig.onHit);
        expect(bullet.tracerColor).toBe("pap");
        expect(bullet.tracerWidth).toBeCloseTo(orig.tracerWidth * ZombiePackAPunchTracer.widthMult, 6);
        const pellets = gun.bulletCount > 1;
        expect(!!bullet.sparkTrail, base).toBe(!pellets);
        expect(!!bullet.tracerCore, base).toBe(!pellets);
        expect(bullet.glowColor, base).toBe(orig.glowColor);
    }
    expect(GameConfig.tracerColors.pap).toBeDefined();
});

test("Pack-a-Punch: a Mark II gun fires its Mark II bullet", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const player = game.playerBarn.addTestPlayer({ name: "P" });
    game.update(0.1);
    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47_pap", 45);
    player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary);
    const papBullet = packAPunchBulletType("bullet_ak47");
    const firedPap = () => game.bulletBarn.bullets.some((b) => b.bulletType === papBullet);
    expect(firedPap()).toBe(false);
    player.shootStart = true;
    player.shootHold = true;
    for (let i = 0; i < 10 && !firedPap(); i++) game.step(0.05);
    expect(firedPap()).toBe(true);
});

test("Pack-a-Punch specials: table is valid and only listed guns change behaviour", () => {
    for (const [base, special] of Object.entries(ZombiePackAPunchSpecials)) {
        expect(base in ZombiePackAPunchNames, base).toBe(true);
        expect(special.label.length, base).toBeGreaterThan(0);
        expect(packAPunchSpecialFor(packAPunchType(base)), base).toBe(special);
        expect(packAPunchSpecialFor(base), base).toBeUndefined();
    }
    for (const base of Object.keys(ZombiePackAPunchNames)) {
        const gun = GameObjectDefs.typeToDef(base, "gun") as GunDef;
        const mk2 = GameObjectDefs.typeToDef(packAPunchType(base), "gun") as GunDef;
        const bullet = GameObjectDefs.typeToDef(mk2.bulletType, "bullet");
        const special = ZombiePackAPunchSpecials[base];
        switch (special?.kind) {
            case "burstToAuto":
                expect(gun.fireMode, base).toBe("burst");
                expect(mk2.fireMode, base).toBe("auto");
                expect(mk2.fireDelay, base).toBe(special.fireDelay);
                expect(mk2.burstCount, base).toBeUndefined();
                break;
            case "variableFireRate":
                expect(mk2.variableFireRate, base).toEqual({
                    fastFireDelay: special.fastFireDelay,
                    fastShots: special.fastShots,
                    rampShots: special.rampShots,
                });
                break;
            case "pierce":
                expect(bullet.pierce, base).toEqual({
                    maxTargets: special.maxTargets,
                    damageFalloff: special.damageFalloff,
                });
                break;
            case "chain":
                expect(bullet.chain, base).toEqual({
                    maxJumps: special.maxJumps,
                    range: special.range,
                    damageMult: special.damageMult,
                    arcBullet: packAPunchArcBulletType(base),
                    ...(special.chainEvery ? { chainEvery: special.chainEvery } : {}),
                    ...(special.stun ? { stun: special.stun } : {}),
                    ...(special.stunEvery ? { stunEvery: special.stunEvery } : {}),
                });
                {
                    // Each chain gun has its own arc bullet carrying its arc duration.
                    const arc = GameObjectDefs.typeToDef(packAPunchArcBulletType(base), "bullet");
                    expect(arc.chainArc, base).toEqual({ life: special.arcLife });
                    expect(arc.damage, base).toBe(0);
                    expect(arc.skipCollision, base).toBe(true);
                }
                break;
            default:
                expect(mk2.fireMode, base).toBe(gun.fireMode);
                expect(mk2.fireDelay, base).toBe(gun.fireDelay);
                expect(mk2.variableFireRate, base).toBeUndefined();
        }
        if (special?.kind !== "pierce") {
            expect(bullet.pierce, base).toEqual(GameObjectDefs.typeToDef(gun.bulletType, "bullet").pierce);
        }
        if (special?.kind !== "chain") {
            expect(bullet.chain, base).toEqual(GameObjectDefs.typeToDef(gun.bulletType, "bullet").chain);
        }
        // The shared Mark II bullet never carries a gun's special.
        const shared = GameObjectDefs.typeToDefSafe(packAPunchBulletType(gun.bulletType));
        if (shared?.type === "bullet") {
            expect(shared.pierce, base).toEqual(GameObjectDefs.typeToDef(gun.bulletType, "bullet").pierce);
            expect(shared.chain, base).toEqual(GameObjectDefs.typeToDef(gun.bulletType, "bullet").chain);
        }
    }
    const arc = GameObjectDefs.typeToDef(ZombiePackAPunchArcBullet, "bullet");
    expect(arc.chainArc?.life).toBeGreaterThan(0);
    expect(arc.damage).toBe(0);
    expect(arc.skipCollision).toBe(true);
    // Vector arcs clear faster than AWM-S arcs.
    const life = (gun: string) => GameObjectDefs.typeToDef(packAPunchArcBulletType(gun), "bullet").chainArc!.life;
    expect(life("vector")).toBeLessThan(life("awc"));
});

test("Pack-a-Punch specials: M249 Overdrive fires fast after each reload, then eases back", () => {
    const def = GameObjectDefs.typeToDef(packAPunchType("m249"), "gun") as GunDef;
    const vfr = def.variableFireRate!;
    expect(WeaponManager.shotFireDelay(def, 0)).toBe(vfr.fastFireDelay);
    expect(WeaponManager.shotFireDelay(def, vfr.fastShots - 1)).toBe(vfr.fastFireDelay);
    const mid = WeaponManager.shotFireDelay(def, vfr.fastShots + vfr.rampShots / 2);
    expect(mid).toBeGreaterThan(vfr.fastFireDelay);
    expect(mid).toBeLessThan(def.fireDelay);
    expect(WeaponManager.shotFireDelay(def, vfr.fastShots + vfr.rampShots)).toBeCloseTo(def.fireDelay, 6);
    expect(WeaponManager.shotFireDelay(def, 999)).toBeCloseTo(def.fireDelay, 6);
    // Guns without the special always use their own delay.
    const ak = GameObjectDefs.typeToDef("ak47", "gun") as GunDef;
    expect(WeaponManager.shotFireDelay(ak, 0)).toBe(ak.fireDelay);

    // Same 0.6 s of trigger hold: the Mark II fires about twice as many shots.
    const shotsIn = (gunType: string) => {
        const game = createGame(TeamMode.Solo, "specops_complex");
        const player = game.playerBarn.addTestPlayer({ name: "P" });
        game.update(0.1);
        const slot = GameConfig.WeaponSlot.Primary;
        player.weaponManager.setWeapon(slot, gunType, 150);
        player.weaponManager.setCurWeapIndex(slot);
        for (let i = 0; i < 100; i++) game.update(0.01); // finish the equip delay
        const weapon = player.weapons[slot];
        const ammo0 = weapon.ammo;
        expect(weapon.shotsSinceReload).toBe(0);
        player.shootHold = true;
        for (let i = 0; i < 60; i++) {
            player.shootStart = i === 0; // one press, then hold (like real input)
            game.update(0.01);
        }
        player.shootHold = false;
        return { player, weapon, shots: ammo0 - weapon.ammo };
    };
    const plain = shotsIn("m249");
    const { player, weapon, shots } = shotsIn(packAPunchType("m249"));
    expect(weapon.shotsSinceReload).toBe(shots);
    expect(shots).toBeGreaterThanOrEqual(plain.shots * 1.7);
    weapon.ammo = 0;
    player.invManager.set(def.ammo as never, 200);
    player.weaponManager.reload();
    expect(weapon.shotsSinceReload).toBe(0);
});

/** Zombie round with a clear lane east of the shooter; returns zombies placed at `offsets`. */
function specialsLane(offsets: Array<[number, number]>) {
    const game = createGame(TeamMode.Duo, "specops_complex");
    const shooter = game.playerBarn.addTestPlayer({ name: "Shooter" });
    const mate = game.playerBarn.addTestPlayer({ name: "Mate" });
    game.update(0.1);
    const ops = game.specOps!;
    ops.startNextWave();
    ops.drainWaveSpawnQueuePublic();
    const enemies = ops.livingEnemies();
    expect(enemies.length).toBeGreaterThanOrEqual(offsets.length);
    const start = v2.copy(shooter.pos);
    for (const p of game.playerBarn.players) {
        if (p === shooter) continue;
        v2.set(p.pos, v2.add(start, v2.create(-40, 40)));
        game.grid.updateObject(p);
    }
    const zombies = offsets.map(([x, y], i) => {
        const z = enemies[i];
        v2.set(z.pos, v2.add(start, v2.create(x, y)));
        z.layer = shooter.layer;
        z.health = z.maxHealth;
        game.grid.updateObject(z);
        return z;
    });
    const baseHealth = zombies.map((z) => z.health);
    const fire = (gunType: string) => {
        const gun = GameObjectDefs.typeToDef(gunType, "gun") as GunDef;
        const dir = v2.create(1, 0);
        const bullet = game.bulletBarn.fireBullet({
            bulletType: gun.bulletType,
            gameSourceType: gunType,
            pos: v2.add(start, v2.mul(dir, shooter.rad + 0.1)),
            dir,
            layer: shooter.layer,
            damageMult: 1,
            damageType: GameConfig.DamageType.Player,
            playerId: shooter.__id,
            varianceT: 0,
        });
        // No random headshots, so damage ratios are exact. Only bullet updates run
        // here (no game.step), so pinning Math.random can't stall other systems.
        const random = Math.random;
        Math.random = () => 0.999;
        try {
            for (let i = 0; i < 100 && bullet.active; i++) game.bulletBarn.update(0.01);
            game.bulletBarn.update(0.01);
        } finally {
            Math.random = random;
        }
        return bullet;
    };
    const lost = () => zombies.map((z, i) => baseHealth[i] - z.health);
    return { game, ops, shooter, mate, zombies, fire, lost };
}

test("Pack-a-Punch specials: SV-98 Mark II pierces 4 zombies with falloff; normal SV-98 stops at 1", () => {
    // Five zombies in a line, spaced so each is hit on a different tick.
    const offsets: Array<[number, number]> = [[5, 0], [8, 0], [11, 0], [14, 0], [17, 0]];
    const normal = specialsLane(offsets);
    normal.fire("sv98");
    const n = normal.lost();
    expect(n[0]).toBeGreaterThan(0);
    expect(n.slice(1).every((d) => d === 0)).toBe(true);

    const lane = specialsLane(offsets);
    lane.fire(packAPunchType("sv98"));
    const d = lane.lost();
    const falloff = ZombiePackAPunchSpecials.sv98.kind === "pierce" ? ZombiePackAPunchSpecials.sv98.damageFalloff : 0;
    for (let i = 0; i < 4; i++) expect(d[i], `zombie ${i}`).toBeGreaterThan(0);
    expect(d[4]).toBe(0);
    // Each pierce keeps (1 - falloff) of the previous hit (distance falloff aside).
    for (let i = 1; i < 4; i++) expect(d[i] / d[i - 1]).toBeCloseTo(1 - falloff, 2);
});

test("Pack-a-Punch specials: piercing rounds still stop at walls", () => {
    const lane = specialsLane([[0, 0], [0, 0]]);
    const { game, shooter, zombies } = lane;
    // A solid, indestructible, bullet-height obstacle on the shooter's layer.
    const wall = game.map.obstacles.find(
        (o) =>
            o.collidable
            && !o.destructible
            && !o.dead
            && o.height >= GameConfig.bullet.height
            && o.layer === shooter.layer
            && (() => {
                // Thin along x so both sides are open floor.
                const west = v2.add(o.pos, v2.create(-8, 0));
                const east = v2.add(o.pos, v2.create(8, 0));
                const a = collider.intersectSegment(o.collider, west, east);
                const b = collider.intersectSegment(o.collider, east, west);
                return !!a && !!b && b.point.x - a.point.x < 2;
            })(),
    )!;
    expect(wall).toBeDefined();
    const from = v2.add(wall.pos, v2.create(-8, 0));
    const firstHit = collider.intersectSegment(wall.collider, from, v2.add(wall.pos, v2.create(8, 0)))!;
    const exit = collider.intersectSegment(wall.collider, v2.add(wall.pos, v2.create(8, 0)), from)!;
    // One zombie in front of the wall, one right behind it.
    const [front, behind] = zombies;
    v2.set(front.pos, v2.add(firstHit.point, v2.create(-front.rad - 0.6, 0)));
    v2.set(behind.pos, v2.add(exit.point, v2.create(behind.rad + 0.6, 0)));
    for (const z of [front, behind]) game.grid.updateObject(z);
    const start = v2.add(front.pos, v2.create(-front.rad - 2, 0));
    const bullet = game.bulletBarn.fireBullet({
        bulletType: (GameObjectDefs.typeToDef(packAPunchType("sv98"), "gun") as GunDef).bulletType,
        gameSourceType: packAPunchType("sv98"),
        pos: start,
        dir: v2.create(1, 0),
        layer: shooter.layer,
        damageMult: 1,
        damageType: GameConfig.DamageType.Player,
        playerId: shooter.__id,
    });
    expect(bullet.pierceLeft).toBe(3);
    for (let i = 0; i < 100 && bullet.active; i++) game.bulletBarn.update(0.01);
    const [dFront, dBehind] = lane.lost();
    expect(dFront).toBeGreaterThan(0);
    expect(dBehind).toBe(0);
});

test("Pack-a-Punch specials: AWM-S Mark II chains through 3 zombies in range, once each", () => {
    // Hit A; B, C, D each within 6 of the previous; E is out of range of everyone.
    const lane = specialsLane([[5, 0], [5, 4.5], [5, 9], [9, 12], [5, 40]]);
    const arcType = packAPunchArcBulletType("awc");
    const arcsBefore = lane.game.bulletBarn.bullets.filter((b) => b.bulletType === arcType).length;
    lane.fire(packAPunchType("awc"));
    const d = lane.lost();
    const special = ZombiePackAPunchSpecials.awc;
    if (special.kind !== "chain") throw new Error("awc should chain");
    expect(d[0]).toBeGreaterThan(0);
    for (let i = 1; i <= 3; i++) expect(d[i] / d[0], `jump ${i}`).toBeCloseTo(special.damageMult, 2);
    expect(d[4]).toBe(0);
    const arcs = lane.game.bulletBarn.bullets.filter((b) => b.bulletType === arcType);
    expect(arcs.length - arcsBefore).toBe(3);
    // Arc bullets are exact hop lengths and never collide.
    for (const arc of arcs) {
        expect(arc.skipCollision).toBe(true);
        expect(arc.damage).toBe(0);
    }
});

test("Pack-a-Punch specials: AWM-S chain stuns every zombie it hits, then they recover", () => {
    const special = ZombiePackAPunchSpecials.awc;
    if (special.kind !== "chain" || !special.stun) throw new Error("awc should chain and stun");
    const stun = special.stun;
    const lane = specialsLane([[5, 0], [5, 4.5], [5, 40]]);
    const { game, ops, zombies } = lane;
    lane.fire(packAPunchType("awc"));
    const [hit, chained, far] = zombies;
    expect(ops.stunTimerPublic(hit)).toBeCloseTo(stun, 5);
    expect(ops.stunTimerPublic(chained)).toBeCloseTo(stun, 5);
    expect(ops.stunTimerPublic(far)).toBe(0);

    // While stunned the AI gives no move or attack input.
    game.update(0.1);
    for (const z of [hit, chained]) {
        expect(z.touchMoveActive).toBe(false);
        expect(z.moveUp || z.moveDown || z.moveLeft || z.moveRight).toBe(false);
        expect(z.shootHold).toBe(false);
    }
    // A longer stun is never shortened by a shorter one.
    ops.stunEnemy(hit, 5);
    ops.stunEnemy(hit, 0.1);
    expect(ops.stunTimerPublic(hit)).toBeGreaterThan(4);

    for (let i = 0; i < Math.ceil(stun / 0.1) + 1; i++) game.update(0.1);
    expect(ops.stunTimerPublic(chained)).toBeLessThanOrEqual(0);
});

test("Pack-a-Punch specials: Vector chain stuns only on every Nth hit", () => {
    const special = ZombiePackAPunchSpecials.vector;
    if (special.kind !== "chain" || !special.stun || !special.stunEvery) throw new Error("vector should stun every N");
    const lane = specialsLane([[5, 0], [5, 3]]);
    const [hit, chained] = lane.zombies;
    for (let i = 1; i < special.stunEvery; i++) {
        lane.fire(packAPunchType("vector"));
        expect(lane.ops.stunTimerPublic(hit), `hit ${i}`).toBe(0);
        expect(lane.ops.stunTimerPublic(chained), `hit ${i}`).toBe(0);
    }
    expect(lane.lost()[1]).toBeGreaterThan(0);
    lane.fire(packAPunchType("vector"));
    expect(lane.ops.stunTimerPublic(hit)).toBeCloseTo(special.stun, 5);
    expect(lane.ops.stunTimerPublic(chained)).toBeCloseTo(special.stun, 5);
    // Let the stun and its immunity run out, put the zombies back, and the
    // count starts over: hits 11-19 don't stun, hit 20 does.
    const placed = lane.zombies.map((z) => v2.copy(z.pos));
    const ticks = Math.ceil((special.stun + ZombiePackAPunchStunImmunity) / 0.1) + 2;
    for (let i = 0; i < ticks; i++) lane.game.update(0.1);
    expect(lane.ops.stunTimerPublic(hit)).toBeLessThanOrEqual(0);
    const replace = () => {
        lane.zombies.forEach((z, i) => {
            v2.set(z.pos, placed[i]);
            z.health = z.maxHealth;
            lane.game.grid.updateObject(z);
        });
    };
    for (let i = 1; i < special.stunEvery; i++) {
        replace();
        lane.fire(packAPunchType("vector"));
        expect(lane.ops.stunTimerPublic(hit), `hit ${special.stunEvery + i}`).toBeLessThanOrEqual(0);
    }
    replace();
    lane.fire(packAPunchType("vector"));
    expect(lane.ops.stunTimerPublic(hit)).toBeCloseTo(special.stun, 5);
});

test("Pack-a-Punch specials: Vector stun needs one continuous trigger hold", () => {
    const special = ZombiePackAPunchSpecials.vector;
    if (special.kind !== "chain" || !special.stun || !special.stunEvery) throw new Error("vector should stun every N");
    const lane = specialsLane([[5, 0], [5, 3]]);
    const { shooter } = lane;
    const [hit] = lane.zombies;
    // Many hits on the same zombies: keep them alive between shots.
    const vector = packAPunchType("vector");
    const fire = lane.fire;
    lane.fire = (gun: string) => {
        for (const z of lane.zombies) z.health = z.maxHealth;
        return fire(gun);
    };

    // Tap-firing (a new trigger press per shot) never builds a stun.
    for (let i = 0; i < special.stunEvery * 3; i++) {
        shooter.triggerPressId++;
        lane.fire(vector);
        expect(lane.ops.stunTimerPublic(hit), `tap ${i + 1}`).toBe(0);
    }

    // Holding: 9 hits, release and press again, and the count starts over.
    shooter.triggerPressId++;
    for (let i = 1; i < special.stunEvery; i++) lane.fire(vector);
    shooter.triggerPressId++;
    for (let i = 1; i < special.stunEvery; i++) {
        lane.fire(vector);
        expect(lane.ops.stunTimerPublic(hit), `hold hit ${i}`).toBe(0);
    }
    // 10th hit of this one hold stuns.
    lane.fire(vector);
    expect(lane.ops.stunTimerPublic(hit)).toBeCloseTo(special.stun, 5);
});

test("Pack-a-Punch specials: a long gap between hits resets the Vector count even while holding", () => {
    const special = ZombiePackAPunchSpecials.vector;
    if (special.kind !== "chain" || !special.stun || !special.stunEvery) throw new Error("vector should stun every N");
    const lane = specialsLane([[5, 0], [5, 3]]);
    const [hit] = lane.zombies;
    const vector = packAPunchType("vector");
    for (let i = 1; i < special.stunEvery; i++) lane.fire(vector);
    lane.game.timeRunning += ZombiePackAPunchStunStreakReset + 0.25;
    lane.fire(vector);
    expect(lane.ops.stunTimerPublic(hit)).toBe(0);
});

test("Trigger press id: goes up on each new press, not while holding", () => {
    const game = createGame(TeamMode.Solo, "specops_complex");
    const player = game.playerBarn.addTestPlayer({ name: "P" });
    game.update(0.1);
    const input = (shootStart: boolean, shootHold: boolean) => {
        const msg = new net.InputMsg();
        msg.shootStart = shootStart;
        msg.shootHold = shootHold;
        player.handleInput(msg);
    };
    const id0 = player.triggerPressId;
    input(true, true); // press
    expect(player.triggerPressId).toBe(id0 + 1);
    input(false, true); // still holding
    input(false, true);
    expect(player.triggerPressId).toBe(id0 + 1);
    input(false, false); // release
    expect(player.triggerPressId).toBe(id0 + 1);
    input(false, true); // pressed again (start flag missed)
    expect(player.triggerPressId).toBe(id0 + 2);
    input(false, false);
    input(true, false); // very quick tap inside one input
    expect(player.triggerPressId).toBe(id0 + 3);
});

test("Pack-a-Punch specials: a zombie can't be re-stunned right after a stun wears off", () => {
    const lane = specialsLane([[5, 0]]);
    const { game, ops } = lane;
    const [z] = lane.zombies;
    ops.stunEnemy(z, 0.3);
    for (let i = 0; i < 4; i++) game.update(0.1);
    expect(ops.stunTimerPublic(z)).toBeLessThanOrEqual(0);
    // Inside the immunity window: ignored.
    ops.stunEnemy(z, 0.5);
    expect(ops.stunTimerPublic(z)).toBeLessThanOrEqual(0);
    // After it: works again.
    for (let i = 0; i < Math.ceil(ZombiePackAPunchStunImmunity / 0.1) + 1; i++) game.update(0.1);
    ops.stunEnemy(z, 0.5);
    expect(ops.stunTimerPublic(z)).toBeCloseTo(0.5, 5);
});

test("Pack-a-Punch specials: Vector Mark II chains to only 1 zombie, never teammates", () => {
    const lane = specialsLane([[5, 0], [5, 3], [5, 6]]);
    v2.set(lane.mate.pos, v2.add(lane.zombies[0].pos, v2.create(0, -2.5)));
    lane.mate.layer = lane.shooter.layer;
    lane.game.grid.updateObject(lane.mate);
    const mateHp = lane.mate.health;
    const special = ZombiePackAPunchSpecials.vector;
    const hitsToChain = special.kind === "chain" ? special.chainEvery ?? 1 : 1;
    for (let i = 0; i < hitsToChain; i++) lane.fire(packAPunchType("vector"));
    const d = lane.lost();
    expect(d[0]).toBeGreaterThan(0);
    expect(d[1]).toBeGreaterThan(0);
    expect(d[2]).toBe(0);
    expect(lane.mate.health).toBe(mateHp);
});

test("Pack-a-Punch specials: Vector lightning only on every Nth hit of a held trigger", () => {
    const special = ZombiePackAPunchSpecials.vector;
    if (special.kind !== "chain" || !special.chainEvery || special.chainEvery < 2) {
        throw new Error("vector should chain every N hits");
    }
    const every = special.chainEvery;
    const lane = specialsLane([[5, 0], [5, 3]]);
    const { shooter } = lane;
    const arcType = packAPunchArcBulletType("vector");
    const arcCount = () => lane.game.bulletBarn.newBullets.filter((b) => b.bulletType === arcType).length;
    const fire = () => {
        for (const z of lane.zombies) z.health = z.maxHealth;
        lane.game.bulletBarn.flush();
        lane.fire(packAPunchType("vector"));
        return arcCount();
    };

    // Tap-firing: a new press per shot never arcs.
    for (let i = 0; i < every * 3; i++) {
        shooter.triggerPressId++;
        expect(fire(), `tap ${i + 1}`).toBe(0);
    }
    // Holding: only every Nth hit arcs (stun hits aside).
    shooter.triggerPressId++;
    const stunEvery = special.stunEvery ?? 0;
    for (let hit = 1; hit <= every * 2; hit++) {
        const expected = hit % every === 0 || (stunEvery > 0 && hit % stunEvery === 0) ? 1 : 0;
        expect(fire(), `hold hit ${hit}`).toBe(expected);
    }
});

/** Players (1 = solo game) standing at the Quick Revive machine with plenty of cash. */
function quickReviveGame(humans: number) {
    const game = createGame(humans > 1 ? TeamMode.Duo : TeamMode.Solo, "specops_complex");
    const players = Array.from({ length: humans }, (_, i) => game.playerBarn.addTestPlayer({ name: `P${i}` }));
    game.update(0.1);
    const ops = game.specOps!;
    const machine = game.map.obstacles.find((o) => o.type === "zombie_perk_machine_quick_revive")!;
    expect(machine).toBeDefined();
    const front = v2.add(machine.pos, v2.create(0, -(machine.interactionRad - 0.2)));
    const msgs: Array<{ player: string; type: number; item: string }> = [];
    for (const p of players) {
        v2.set(p.pos, front);
        game.grid.updateObject(p);
        ops.grantCash(p, 10_000);
        const send = p.client.sendMsg.bind(p.client);
        p.client.sendMsg = (type, msg) => {
            if (type === net.MsgType.Pickup) {
                const m = msg as net.PickupMsg;
                msgs.push({ player: p.name, type: m.type, item: m.item });
            }
            send(type, msg);
        };
    }
    const offer = zombiePerkMachine(machine.type)!;
    const glow = () =>
        game.decalBarn.decals.find((d) =>
            d.type === "zombie_perk_glow_quick_revive" && v2.length(v2.sub(d.pos, machine.pos)) < 4
        );
    /** Buy, then "use" it (drop the perk) so the next buy is allowed. */
    const buyAndUse = (p: (typeof players)[number]) => {
        ops["buyCooldown"].delete(p.__id);
        const ok = ops.tryBuyZombiePerk(p, machine);
        if (ok) p.removePerk(offer.perk);
        return ok;
    };
    return { game, ops, players, machine, offer, msgs, glow, buyAndUse };
}

test("Quick Revive: each player can buy it only maxBuys times (co-op machine stays on)", () => {
    const { ops, players, machine, offer, msgs, glow, buyAndUse } = quickReviveGame(2);
    const [a, b] = players;
    expect(offer.perk).toBe("self_revive");
    expect(offer.maxBuys).toBe(3);
    for (let i = 0; i < offer.maxBuys!; i++) expect(buyAndUse(a), `buy ${i + 1}`).toBe(true);
    expect(ops.zombiePerkBuyCount(a, offer.perk)).toBe(offer.maxBuys);

    const cash = a.specOpsCash;
    expect(buyAndUse(a)).toBe(false);
    expect(a.specOpsCash).toBe(cash);
    expect(msgs).toContainEqual({ player: a.name, type: net.PickupMsgType.PerkNoUsesLeft, item: offer.perk });

    // Co-op: the machine stays on and the other player still has all their buys.
    expect(machine.button!.canUse).toBe(true);
    expect(glow()!.lifeTime).toBeGreaterThan(1e6);
    expect(buyAndUse(b)).toBe(true);
    expect(ops.zombiePerkBuyCount(b, offer.perk)).toBe(1);
});

test("Quick Revive: in solo the machine powers down after the last buy", () => {
    const { game, players, machine, offer, glow, buyAndUse } = quickReviveGame(1);
    const [a] = players;
    // Owning it doesn't count as a use; only buys do.
    for (let i = 0; i < offer.maxBuys! - 1; i++) expect(buyAndUse(a)).toBe(true);
    expect(machine.button!.canUse).toBe(true);
    expect(glow()).toBeDefined();
    expect(buyAndUse(a)).toBe(true);

    expect(machine.button!.canUse).toBe(false);
    game.update(0.1);
    expect(glow()).toBeUndefined();
    // Powered down: nothing more to buy, and the def has a dark sprite for it.
    expect(buyAndUse(a)).toBe(false);
    const def = MapObjectDefs.typeToDef(machine.type, "obstacle");
    expect(def.button?.offImg).toBe("map-zombie-perk-quick-revive-off.img");
    expect(machine.button!.canUse).toBe(false);
});

test("Perk machines without maxBuys stay unlimited", () => {
    for (const type of ZombiePerkMachineTypes) {
        const offer = zombiePerkMachine(type)!;
        if (offer.perk === "self_revive") continue;
        expect(offer.maxBuys, type).toBeUndefined();
    }
});

/** Zombies duo: A has every machine perk (and, optionally, Quick Revive), B stays up. */
function downedPerksGame(withQuickRevive: boolean, mapName = "specops_complex") {
    const game = createGame(TeamMode.Duo, mapName);
    const a = game.playerBarn.addTestPlayer({ name: "A" });
    const b = game.playerBarn.addTestPlayer({ name: "B" });
    game.update(0.1);
    const baseMaxHealth = a.maxHealth;
    const perks = ZombiePerkMachineTypes
        .map((type) => ZombiePerkMachines[type].perk)
        .filter((perk) => perk !== "self_revive");
    for (const perk of perks) a.addPerk(perk, false);
    if (withQuickRevive) a.addPerk("self_revive", false);
    a.health = a.maxHealth;
    a.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47_pap", 45);
    game.specOps!.grantCash(a, 1234);
    const knock = () => a.damage({ amount: 9999, damageType: GameConfig.DamageType.Player, dir: v2.create(1, 0) });
    return { game, a, b, perks, knock, baseMaxHealth };
}

test("Zombies: going down loses every perk, but keeps guns and cash", () => {
    const { a, perks, knock, baseMaxHealth } = downedPerksGame(false);
    expect(perks.length).toBeGreaterThan(0);
    expect(a.maxHealth).toBeGreaterThan(baseMaxHealth);
    const cash = a.specOpsCash;
    knock();
    expect(a.downed).toBe(true);
    expect(a.perks.length).toBe(0);
    for (const perk of perks) expect(a.hasPerk(perk), perk).toBe(false);
    // Juggernog's extra health goes with it.
    expect(a.maxHealth).toBe(baseMaxHealth);
    expect(a.weapons[GameConfig.WeaponSlot.Primary].type).toBe("ak47_pap");
    expect(a.specOpsCash).toBe(cash);
});

test("Zombies: Quick Revive survives the down long enough to get up, then is spent", () => {
    const { game, a, knock } = downedPerksGame(true);
    knock();
    expect(a.downed).toBe(true);
    expect(a.perks.map((p) => p.type)).toEqual(["self_revive"]);
    game.step(GameConfig.player.reviveDuration + 0.2);
    expect(a.downed).toBe(false);
    expect(a.dead).toBe(false);
    expect(a.perks.length).toBe(0);
});

test("Fireteam: going down still keeps perks (zombies-only rule)", () => {
    const { a, perks, knock } = downedPerksGame(false, FireteamMapPool[0]);
    expect(a.perks.length).toBe(perks.length);
    knock();
    expect(a.downed).toBe(true);
    expect(a.perks.length).toBe(perks.length);
});

test("waves mix in Runners from round 4 and Brutes from round 8 without changing the total", () => {
    const { runner, brute } = ZombieVariants;
    for (let round = 1; round <= 40; round++) {
        for (const humans of [1, 2, 4]) {
            const roster = composeZombieWave(round, humans);
            expect(roster.length).toBe(zombieWaveCount(round, humans));
            const runners = roster.filter((k) => k === "zombie_runner").length;
            const brutes = roster.filter((k) => k === "zombie_brute").length;
            expect(runners > 0, `round ${round}`).toBe(round >= runner.fromRound);
            expect(runners).toBeLessThanOrEqual(Math.max(1, Math.floor(roster.length * runner.shareMax)));
            expect(brutes).toBe(zombieBruteCount(round));
            expect(brutes).toBeLessThanOrEqual(brute.maxPerWave);
            // Brutes arrive last.
            expect(roster.slice(roster.length - brutes).every((k) => k === "zombie_brute")).toBe(true);
        }
    }
    expect(zombieBruteCount(brute.fromRound - 1)).toBe(0);
    expect(zombieBruteCount(brute.fromRound)).toBe(1);
    expect(zombieBruteCount(brute.secondFromRound)).toBe(2);
    expect(composeZombieWave(20, 1).filter((k) => k === "zombie_runner").length)
        .toBe(Math.floor(zombieWaveCount(20, 1) * runner.shareMax));
});

test("Runners are faster and frailer; Brutes are bigger, tougher, hit twice as hard and pay more", () => {
    const game = createGame(TeamMode.Solo, "zombie_dead_air");
    const operator = game.playerBarn.addTestPlayer({ name: "A" });
    game.update(0.1);
    const ops = game.specOps!;
    ops.wave = 10;
    const walker = ops.spawnEnemyPublic("zombie_walker", true)!;
    const runner = ops.spawnEnemyPublic("zombie_runner", true)!;
    const brute = ops.spawnEnemyPublic("zombie_brute", true)!;

    expect(runner.name).toBe("Runner");
    expect(runner.outfit).toBe("outfitZombieRunner");
    expect(runner.specOpsSpeedMult).toBeCloseTo(Math.min(ZombieMaxSpeedMult, walker.specOpsSpeedMult * 1.3), 5);
    expect(runner.health).toBe(Math.round(walker.health * ZombieVariants.runner.healthMult));
    expect(runner.scale).toBe(1);

    expect(brute.name).toBe("Brute");
    expect(brute.outfit).toBe("outfitZombieBrute");
    expect(brute.specOpsSpeedMult).toBeCloseTo(walker.specOpsSpeedMult * 0.8, 5);
    expect(brute.health).toBe(Math.min(ZombieVariants.brute.healthCap, walker.health * ZombieVariants.brute.healthMult));
    expect(brute.health).toBeGreaterThan(280);
    expect(brute.scale).toBe(ZombieVariants.brute.scale);
    expect(brute.rad).toBeCloseTo(walker.rad * ZombieVariants.brute.scale, 5);
    expect(brute.specOpsBounty).toBe(ZombieVariants.brute.killCash);
    expect(walker.specOpsBounty).toBe(ZombieEconomy.killCash);
    // Perk changes recalculate scale from the Brute's base size.
    brute.recalculateScale();
    expect(brute.scale).toBe(ZombieVariants.brute.scale);

    // Measures the damage each punch deals before the operator's own protections.
    const dealt: number[] = [];
    const takeDamage = operator.damage.bind(operator);
    operator.damage = (params) => {
        dealt.push(params.amount!);
        takeDamage(params);
    };
    const punch = (zombie: Player) => {
        dealt.length = 0;
        zombie.layer = operator.layer;
        v2.set(zombie.pos, v2.add(operator.pos, v2.create(1.5 * zombie.scale, 0)));
        game.grid.updateObject(zombie);
        game.grid.updateObject(operator);
        zombie.dir = v2.create(-1, 0);
        zombie.weaponManager.meleeDamage();
        return dealt[0] ?? 0;
    };
    const walkerHit = punch(walker);
    expect(walkerHit).toBeGreaterThan(0);
    expect(punch(brute)).toBeCloseTo(walkerHit * ZombieVariants.brute.meleeDamageMult, 5);
    expect(punch(runner)).toBeCloseTo(walkerHit, 5);
});

test("Insta-Kill and Nuke kill Runners like walkers; Brutes resist", () => {
    const game = createGame(TeamMode.Solo, "zombie_dead_air");
    const operator = game.playerBarn.addTestPlayer({ name: "A" });
    game.update(0.1);
    const ops = game.specOps!;
    ops.wave = 12;
    ops.setNpcIgnoreOperators(true);
    const runner = ops.spawnEnemyPublic("zombie_runner", true)!;
    const brute = ops.spawnEnemyPublic("zombie_brute", true)!;
    ops.activateZombiePowerUp("zombie_powerup_insta_kill");
    expect(ops.modifyZombieDamage(runner, operator, 1)).toBeGreaterThan(runner.health);
    expect(ops.modifyZombieDamage(brute, operator, 11)).toBe(22);

    const bruteHealth = brute.health;
    ops.activateZombiePowerUp("zombie_powerup_nuke");
    expect(runner.dead).toBe(true);
    expect(brute.dead).toBe(false);
    expect(brute.health).toBeLessThan(bruteHealth);
});
