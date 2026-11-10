import { expect, test, vi } from "vitest";
import type { Game } from "../../server/src/game/game.ts";
import { GameModeManager } from "../../server/src/game/gameModeManager.ts";
import type { Player } from "../../server/src/game/objects/player.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { BitStream, Constants, MsgType } from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import type { PlayerInfo } from "../../shared/net/updateMsg.ts";
import { UpdateMsg } from "../../shared/net/updateMsg.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

test("Spec Ops status contains the viewer's team, sorted and bounded to the wire limit", () => {
    const viewer = { __id: 60000, teamId: 1 } as Player;
    const ally = { __id: 59000, teamId: 1 } as Player;
    const enemies = Array.from({ length: 600 }, (_, i) => ({ __id: i + 1, teamId: 200 } as Player));
    const players = [...enemies, viewer, ally];
    const game = {
        map: { specOpsMode: true, factionMode: false },
        teamMode: TeamMode.Duo,
        playerBarn: { players },
    } as unknown as Game;
    const manager = new GameModeManager(game);
    expect(manager.getPlayerStatusPlayers(viewer)).toEqual([ally, viewer]);
    expect(players).toEqual([...enemies, viewer, ally]);
    for (const enemy of enemies) enemy.teamId = 1;
    expect(manager.getPlayerStatusPlayers(viewer)).toHaveLength(Constants.MaxPlayerStatus);
});

test("255 team statuses round-trip without changing the 8-bit array format", () => {
    const message = new UpdateMsg();
    message.activePlayerData = {} as UpdateMsg["activePlayerData"];
    message.playerStatusDirty = true;
    message.playerStatus = Array.from({ length: Constants.MaxPlayerStatus }, (_, i) => ({
        hasData: true,
        pos: v2.create(100, 200),
        visible: true,
        dead: false,
        downed: i % 2 === 0,
        role: "",
        health: i % 101,
        armor: 20,
        boost: 0,
    }));
    const stream = new BitStream(new ArrayBuffer(1 << 16));
    const trace = vi.spyOn(console, "trace").mockImplementation(() => {});
    try {
        message.serialize(stream);
        const written = stream.index;
        stream.index = 0;
        const decoded = new UpdateMsg();
        decoded.deserialize(stream, { m_getTypeById: () => ObjectType.Invalid });
        expect(decoded.playerStatus).toHaveLength(255);
        expect(decoded.playerStatus.map((status) => status.health))
            .toEqual(message.playerStatus.map((status) => status.health));
        expect(stream.index).toBe(written);
        expect(trace).not.toHaveBeenCalled();
    } finally {
        trace.mockRestore();
    }
});

for (const map of ["test_specops", "specops_complex"] as const) {
    test(`${map}: waves keep live object IDs unique across allocator exhaustion`, () => {
        const game = createGame(TeamMode.Duo, map);
        const operator = game.playerBarn.addTestPlayer({ name: "A" });
        game.playerBarn.addTestPlayer({ name: "B" });
        game.update(0.1);
        game.netSync();
        game.objectRegister.idNext = 65535 - 32;
        const trace = vi.spyOn(console, "trace").mockImplementation(() => {});
        const check = () => {
            const objects = game.objectRegister.objects.filter((obj) => obj !== undefined);
            expect(new Set(objects.map((obj) => obj.__id)).size).toBe(objects.length);
            for (const obj of objects) expect(game.objectRegister.getById(obj.__id)).toBe(obj);
        };
        try {
            for (let wave = 0; wave < 6; wave++) {
                game.specOps!.startNextWave();
                game.specOps!.drainWaveSpawnQueuePublic();
                game.update(0.1);
                check();
                game.netSync();
                for (const enemy of [...game.playerBarn.livingPlayers]) {
                    if (!enemy.specOpsAi || enemy.teamId === operator.teamId) continue;
                    enemy.kill({
                        damageType: GameConfig.DamageType.Player,
                        dir: v2.create(1, 0),
                        source: operator,
                    });
                }
                game.update(0.1);
                check();
                game.netSync();
                check();
            }
            expect(game.objectRegister.idNext).toBe(65535);
            expect(trace).not.toHaveBeenCalled();
        } finally {
            trace.mockRestore();
        }
    });
}

test("reconnect metadata includes off-screen support and retries batches over 255", () => {
    const game = createGame(TeamMode.Duo, "test_specops");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const support = game.specOps!.spawnSentryPublic(operator)!;
    expect(support).toBeDefined();
    const hostiles = Array.from({ length: 300 }, () => game.specOps!.spawnEnemyPublic("militia"));
    const client = operator.client as unknown as {
        collectPlayerInfos(barn: Game["playerBarn"], visible: Iterable<Player>, teamId: number): PlayerInfo[];
    };
    const first = client.collectPlayerInfos(game.playerBarn, hostiles, operator.teamId);
    expect(first.some((info) => info.playerId === support.__id)).toBe(true);
    expect(first).toHaveLength(255);
    const second = client.collectPlayerInfos(game.playerBarn, hostiles, operator.teamId);
    expect(new Set([...first, ...second].map((info) => info.playerId)).size).toBe(302);
    expect(client.collectPlayerInfos(game.playerBarn, hostiles, operator.teamId)).toEqual([]);

    const deleted = hostiles.map((hostile) => hostile.__id);
    for (const hostile of hostiles) game.playerBarn.removePlayer(hostile);
    const batches: number[][] = [];
    const serialize = operator.client.msgStream.serializeMsg.bind(operator.client.msgStream);
    const spy = vi.spyOn(operator.client.msgStream, "serializeMsg").mockImplementation((type, message) => {
        if (type === MsgType.Update) batches.push([...(message as UpdateMsg).deletedPlayerIds]);
        serialize(type, message);
    });
    const trace = vi.spyOn(console, "trace").mockImplementation(() => {});
    try {
        game.netSync();
        game.netSync();
        expect(batches.map((batch) => batch.length)).toEqual([255, 45]);
        expect(new Set(batches.flat())).toEqual(new Set(deleted));
        expect(trace).not.toHaveBeenCalled();
    } finally {
        spy.mockRestore();
        trace.mockRestore();
    }
});

test("a player ID recycled after backpressure sends fresh metadata and its queued delete", () => {
    const game = createGame(TeamMode.Solo, "test_specops");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    game.objectRegister.idNext = 65535;
    const first = game.specOps!.spawnEnemyPublic("militia");
    const id = first.__id;
    while (game.objectRegister.freeLists[ObjectType.Player].length > 0) {
        game.specOps!.spawnEnemyPublic("militia");
    }
    const client = operator.client;
    const collect = client as unknown as {
        collectPlayerInfos(barn: Game["playerBarn"], visible: Iterable<Player>, teamId: number): PlayerInfo[];
    };
    collect.collectPlayerInfos(game.playerBarn, [first], operator.teamId);
    const pressure = vi.spyOn(client.socket, "isBackpressured").mockReturnValue(true);
    game.playerBarn.removePlayer(first);
    game.netSync();
    const replacement = game.specOps!.spawnEnemyPublic("rifle");
    expect(replacement.__id).toBe(id);
    pressure.mockReturnValue(false);
    let received: UpdateMsg | undefined;
    const serialize = client.msgStream.serializeMsg.bind(client.msgStream);
    const spy = vi.spyOn(client.msgStream, "serializeMsg").mockImplementation((type, message) => {
        if (type === MsgType.Update) received = message as UpdateMsg;
        serialize(type, message);
    });
    try {
        v2.set(replacement.pos, operator.pos);
        game.grid.updateObject(replacement);
        game.update(0.1);
        game.netSync();
        expect(received?.deletedPlayerIds).toContain(id);
        expect(received?.playerInfos.some((info) => info.playerId === id)).toBe(true);
        expect(received?.playerInfos.find((info) => info.playerId === id)?.name).toBe(replacement.name);
    } finally {
        spy.mockRestore();
        pressure.mockRestore();
    }
});
