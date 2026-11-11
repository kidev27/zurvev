import { expect, test } from "vitest";
import { EnemyMarkers } from "../../client/src/objects/enemyMarkers.ts";
import type { Game } from "../../server/src/game/game.ts";
import { GameModeManager } from "../../server/src/game/gameModeManager.ts";
import type { Player } from "../../server/src/game/objects/player.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { BitStream, Constants } from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { type EnemyMarker, UpdateMsg } from "../../shared/net/updateMsg.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

function fakeManager(specOpsMode: boolean, livingPlayers: Player[]) {
    const game = {
        map: { specOpsMode, factionMode: false },
        teamMode: TeamMode.Duo,
        playerBarn: { players: livingPlayers, livingPlayers },
    } as unknown as Game;
    return new GameModeManager(game);
}

const fakePlayer = (id: number, teamId: number, x = 0) =>
    ({ __id: id, teamId, pos: v2.create(x, 0), dead: false, downed: false }) as Player;

test("enemy markers list living players on other teams only, in Spec Ops only", () => {
    const viewer = fakePlayer(1, 1);
    const ally = fakePlayer(2, 1);
    const enemy = fakePlayer(3, 2);
    const downed = { ...fakePlayer(4, 2), downed: true } as Player;
    const dead = { ...fakePlayer(5, 2), dead: true } as Player;
    const living = [viewer, ally, enemy, downed, dead];

    expect(fakeManager(true, living).getEnemyMarkerPlayers(viewer)).toEqual([enemy, downed]);
    expect(fakeManager(false, living).getEnemyMarkerPlayers(viewer)).toEqual([]);
});

test("enemy markers keep the nearest hostiles when over the 8-bit limit", () => {
    const viewer = fakePlayer(1, 1);
    const enemies = Array.from({ length: 600 }, (_, i) => fakePlayer(i + 10, 2, 600 - i));
    const markers = fakeManager(true, [viewer, ...enemies]).getEnemyMarkerPlayers(viewer);

    expect(markers).toHaveLength(Constants.MaxEnemyMarkers);
    const farthestKept = Math.max(...markers.map((p) => p.pos.x));
    const nearestDropped = Math.min(...enemies.filter((p) => !markers.includes(p)).map((p) => p.pos.x));
    expect(farthestKept).toBeLessThan(nearestDropped);
});

test("enemy markers round-trip after team status without disturbing it", () => {
    const message = new UpdateMsg();
    message.activePlayerData = {} as UpdateMsg["activePlayerData"];
    message.playerStatusDirty = true;
    message.playerStatus = [{
        hasData: true,
        pos: v2.create(10, 20),
        visible: true,
        dead: false,
        downed: false,
        role: "",
        health: 50,
        armor: 0,
        boost: 0,
    }];
    message.enemyMarkers = Array.from({ length: Constants.MaxEnemyMarkers }, (_, i): EnemyMarker => ({
        playerId: 65535 - i,
        pos: v2.create((i * 4) % 1000, 1000 - ((i * 7) % 1000)),
        downed: i % 3 === 0,
    }));
    message.ack = 42;

    const stream = new BitStream(new ArrayBuffer(1 << 16));
    message.serialize(stream);
    stream.index = 0;
    const decoded = new UpdateMsg();
    decoded.deserialize(stream, { m_getTypeById: () => ObjectType.Invalid });

    expect(decoded.playerStatus).toHaveLength(1);
    expect(decoded.playerStatus[0].health).toBe(50);
    expect(decoded.enemyMarkers.map((m) => [m.playerId, m.downed]))
        .toEqual(message.enemyMarkers.map((m) => [m.playerId, m.downed]));
    for (let i = 0; i < message.enemyMarkers.length; i++) {
        expect(v2.distance(decoded.enemyMarkers[i].pos, message.enemyMarkers[i].pos)).toBeLessThan(0.75);
    }
    expect(decoded.ack).toBe(42);
});

/** Run the game and return the enemy markers from the next status update sent to `viewer`. */
function nextMarkers(game: Game, viewer: Player): EnemyMarker[] {
    const serialize = UpdateMsg.prototype.serialize;
    let markers: EnemyMarker[] | undefined;
    UpdateMsg.prototype.serialize = function(this: UpdateMsg, s: BitStream) {
        if (this.playerStatusDirty && this.activePlayerId === viewer.__id) {
            markers = this.enemyMarkers.map((m) => ({ ...m, pos: v2.copy(m.pos) }));
        }
        return serialize.call(this, s);
    };
    try {
        for (let i = 0; i < 60 && !markers; i++) {
            game.update(0.01);
            if (i % 3 === 0) game.netSync();
        }
    } finally {
        UpdateMsg.prototype.serialize = serialize;
    }
    expect(markers).toBeDefined();
    return markers!;
}

test("zombies show as map markers that follow spawns and deaths", () => {
    const game = createGame(TeamMode.Duo, "zombie_dead_air");
    const viewer = game.playerBarn.addTestPlayer({ name: "A" });
    const teammate = game.playerBarn.addTestPlayer({ name: "B" });
    game.update(0.1);
    game.netSync();

    const zombies = [0, 1, 2].map(() => game.specOps!.spawnEnemyPublic("zombie_walker", true));
    let markers = nextMarkers(game, viewer);
    const ids = new Set(markers.map((m) => m.playerId));
    for (const zombie of zombies) expect(ids.has(zombie.__id)).toBe(true);
    expect(ids.has(viewer.__id)).toBe(false);
    expect(ids.has(teammate.__id)).toBe(false);
    for (const zombie of zombies) {
        const marker = markers.find((m) => m.playerId === zombie.__id)!;
        expect(v2.distance(marker.pos, zombie.pos)).toBeLessThan(2);
    }

    const victim = zombies[0];
    victim.kill({
        damageType: GameConfig.DamageType.Player,
        source: viewer,
        amount: 9999,
        dir: v2.randomUnit(),
    });
    markers = nextMarkers(game, viewer);
    expect(markers.some((m) => m.playerId === victim.__id)).toBe(false);
    expect(markers.some((m) => m.playerId === zombies[1].__id)).toBe(true);
});

test("non Spec Ops matches send no enemy markers", () => {
    const game = createGame(TeamMode.Duo, "test_normal");
    const viewer = game.playerBarn.addTestPlayer({ name: "A" });
    game.playerBarn.addTestPlayer({ name: "B" });
    game.update(0.1);
    game.netSync();
    expect(nextMarkers(game, viewer)).toEqual([]);
});

test("client enemy dots glide between updates, snap on far jumps and drop missing enemies", () => {
    const dots = new EnemyMarkers();
    dots.set([
        { playerId: 7, pos: v2.create(100, 100), downed: false },
        { playerId: 8, pos: v2.create(200, 200), downed: false },
    ]);
    expect(dots.markers[7].pos).toEqual(v2.create(100, 100));

    dots.set([
        { playerId: 7, pos: v2.create(104, 100), downed: true },
        { playerId: 8, pos: v2.create(500, 500), downed: false },
    ]);
    expect(dots.markers[7].downed).toBe(true);
    expect(dots.markers[8].pos).toEqual(v2.create(500, 500));

    dots.update(0.125, 0.25);
    expect(dots.markers[7].pos.x).toBeCloseTo(102);
    dots.update(0.5, 0.25);
    expect(dots.markers[7].pos.x).toBeCloseTo(104);

    dots.set([{ playerId: 8, pos: v2.create(500, 501), downed: false }]);
    expect(dots.markers[7]).toBeUndefined();
    expect(Object.keys(dots.markers)).toEqual(["8"]);
});
