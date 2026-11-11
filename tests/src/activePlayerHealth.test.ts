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

test("spectating a full-health Spec Ops enemy keeps the spectator connected", () => {
    const game = createGame(TeamMode.Solo, "test_specops");
    const human = game.playerBarn.addTestPlayer({ name: "A" });
    game.update(0.1);
    game.netSync();

    const enemy = game.specOps!.spawnEnemyPublic("militia", true);
    enemy.health = enemy.maxHealth;
    expect(enemy.health).toBe(SpecOpsEnemyMaxHealth);

    human.damage({
        damageType: GameConfig.DamageType.Player,
        source: enemy,
        amount: 9999,
        dir: v2.randomUnit(),
    });
    // A downed operator still needs finishing in Spec Ops.
    if (!human.dead) {
        human.damage({
            damageType: GameConfig.DamageType.Player,
            source: enemy,
            amount: 9999,
            dir: v2.randomUnit(),
        });
    }
    expect(human.dead).toBe(true);

    const spectate = new SpectateMsg();
    spectate.action = SpectateAction.Begin;
    human.client.handleMsg(MsgType.Spectate, spectate);
    expect(human.client.spectating).toBe(enemy);

    const disconnect = vi.spyOn(human.client, "disconnect");
    const error = vi.spyOn(game.logger, "error").mockImplementation(() => {});
    try {
        game.update(0.01);
        game.netSync();
        expect(error).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();
    } finally {
        disconnect.mockRestore();
        error.mockRestore();
    }
});
