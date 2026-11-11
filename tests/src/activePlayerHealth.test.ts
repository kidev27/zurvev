import { expect, test, vi } from "vitest";
import { PerkProperties } from "../../shared/defs/gameObjects/perkDefs.ts";
import {
    SpecOpsAllyMaxHealth,
    SpecOpsEnemyMaxHealth,
    SpecOpsMaxHealth,
} from "../../shared/defs/maps/specOpsShop.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { BitStream, Constants, MsgType, SpectateMsg } from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { SpectateAction } from "../../shared/net/spectateMsg.ts";
import { UpdateMsg } from "../../shared/net/updateMsg.ts";
import { PracticeMaxBotHealth } from "../../shared/practice.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

function roundTripHealth(health: number): number {
    const message = new UpdateMsg();
    message.activePlayerData = { healthDirty: true, health } as UpdateMsg["activePlayerData"];
    const stream = new BitStream(new ArrayBuffer(1 << 12));
    message.serialize(stream);
    stream.index = 0;
    const decoded = new UpdateMsg();
    decoded.deserialize(stream, { m_getTypeById: () => ObjectType.Invalid });
    return decoded.activePlayerData.health;
}

test("every player max health fits the active-player health wire range", () => {
    const maxHealths = {
        normal: GameConfig.player.health,
        specOpsOperator: SpecOpsMaxHealth + PerkProperties.zombie_juggernog.bonusHealth,
        specOpsAlly: SpecOpsAllyMaxHealth,
        specOpsEnemy: SpecOpsEnemyMaxHealth,
        practiceBot: PracticeMaxBotHealth,
    };
    for (const [kind, maxHealth] of Object.entries(maxHealths)) {
        expect(maxHealth, kind).toBeLessThanOrEqual(Constants.MaxActivePlayerHealth);
    }
});

test("active-player health round-trips to within one point from 0 to the wire maximum", () => {
    for (let health = 0; health <= Constants.MaxActivePlayerHealth; health += 0.5) {
        expect(Math.abs(roundTripHealth(health) - health)).toBeLessThanOrEqual(1);
    }
    expect(roundTripHealth(0)).toBe(0);
    expect(roundTripHealth(GameConfig.player.health)).toBeCloseTo(GameConfig.player.health, 0);
    expect(roundTripHealth(SpecOpsEnemyMaxHealth)).toBeCloseTo(SpecOpsEnemyMaxHealth, 0);
    expect(roundTripHealth(Constants.MaxActivePlayerHealth)).toBe(Constants.MaxActivePlayerHealth);
});

test("a dead operator watching the last teammate stays connected when the view moves to a 280 HP killer", () => {
    const game = createGame(TeamMode.Duo, "test_specops");
    const watcher = game.playerBarn.addTestPlayer({ name: "A" });
    const teammate = game.playerBarn.addTestPlayer({ name: "B" });
    game.update(0.1);
    game.netSync();

    const enemy = game.specOps!.spawnEnemyPublic("militia", true);
    enemy.health = enemy.maxHealth;
    expect(enemy.health).toBe(SpecOpsEnemyMaxHealth);
    const killBy = (target: typeof watcher) =>
        target.kill({
            damageType: GameConfig.DamageType.Player,
            source: enemy,
            amount: 9999,
            dir: v2.randomUnit(),
        });

    killBy(watcher);
    const spectate = new SpectateMsg();
    spectate.action = SpectateAction.Begin;
    watcher.client.handleMsg(MsgType.Spectate, spectate);
    expect(watcher.client.spectating).toBe(teammate);

    killBy(teammate);
    const disconnect = vi.spyOn(watcher.client, "disconnect");
    const error = vi.spyOn(game.logger, "error").mockImplementation(() => {});
    try {
        // The view moves to the teammate's killer two seconds after the death.
        for (let i = 0; i < 240; i++) {
            game.update(0.01);
            if (i % 3 === 0) game.netSync();
        }
        expect(watcher.client.spectating).toBe(enemy);
        expect(error).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();
    } finally {
        disconnect.mockRestore();
        error.mockRestore();
    }
});
