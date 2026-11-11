import { expect, test } from "vitest";
import type { Game } from "../../server/src/game/game.ts";
import type { Player } from "../../server/src/game/objects/player.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

type MirrorObj = { type: ObjectType; data: Record<string, unknown> };

/**
 * Decodes what the server sends to `viewer` the way the browser does (deletes, then full,
 * then partial updates) and lets the test switch the socket's backpressure on and off.
 */
function attachMirror(viewer: Player) {
    const objs = new Map<number, MirrorObj>();
    const socket = viewer.client.socket as unknown as {
        send: (data: Uint8Array) => void;
        isBackpressured: () => boolean;
    };
    const state = { backpressured: false, updates: 0 };
    socket.isBackpressured = () => state.backpressured;
    socket.send = (data: Uint8Array) => {
        const stream = new net.MsgStream(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        for (;;) {
            const type = stream.deserializeMsgType();
            if (type === net.MsgType.None) return;
            const s = stream.getStream();
            if (type === net.MsgType.Joined) new net.JoinedMsg().deserialize(s);
            else if (type === net.MsgType.Map) new net.MapMsg().deserialize(s);
            else if (type === net.MsgType.AliveCounts) new net.AliveCountsMsg().deserialize(s);
            else if (type === net.MsgType.Update) {
                const msg = new net.UpdateMsg();
                msg.deserialize(s, { m_getTypeById: (id: number) => objs.get(id)?.type ?? ObjectType.Invalid });
                for (const id of msg.delObjIds) objs.delete(id);
                for (const obj of msg.fullObjects) {
                    const current = objs.get(obj.__id);
                    if (current && current.type === obj.__type) Object.assign(current.data, obj);
                    else objs.set(obj.__id, { type: obj.__type, data: { ...obj } });
                }
                for (const obj of msg.partObjects) {
                    const current = objs.get(obj.__id);
                    if (current) Object.assign(current.data, obj);
                }
                state.updates++;
                return;
            } else return;
            stream.stream.readAlignToNextByte();
        }
    };
    return { objs, state };
}

function setup() {
    const game = createGame(TeamMode.Duo, "test_specops");
    const viewer = game.playerBarn.addTestPlayer({ name: "A" });
    game.playerBarn.addTestPlayer({ name: "B" });
    const mirror = attachMirror(viewer);
    game.update(0.1);
    game.netSync();

    const enemy = game.specOps!.spawnEnemyPublic("militia", true);
    v2.set(enemy.pos, v2.add(viewer.pos, v2.create(6, 0)));
    game.grid.updateObject(enemy);
    enemy.setDirty();
    sync(game);
    expect(mirror.objs.get(enemy.__id)?.data.layer).toBe(enemy.layer);
    return { game, viewer, enemy, mirror };
}

function sync(game: Game) {
    game.update(0.01);
    game.netSync();
}

/** One backpressured sync, so the next sync is a thin sync. */
function backpressureOnce(game: Game, mirror: ReturnType<typeof attachMirror>) {
    mirror.state.backpressured = true;
    sync(game);
    mirror.state.backpressured = false;
}

test("an enemy's floor change during a thin sync still reaches the client", () => {
    const { game, enemy, mirror } = setup();

    backpressureOnce(game, mirror);
    enemy.layer = enemy.layer === 0 ? 1 : 0;
    enemy.setDirty();
    sync(game);
    for (let i = 0; i < 10; i++) sync(game);

    expect(mirror.objs.get(enemy.__id)?.data.layer).toBe(enemy.layer);
});

test("an enemy's death during a thin sync still reaches the client", () => {
    const { game, viewer, enemy, mirror } = setup();

    backpressureOnce(game, mirror);
    enemy.kill({
        damageType: GameConfig.DamageType.Player,
        source: viewer,
        amount: 9999,
        dir: v2.create(1, 0),
    });
    sync(game);
    for (let i = 0; i < 10; i++) sync(game);

    expect(enemy.dead).toBe(true);
    expect(mirror.objs.get(enemy.__id)?.data.dead).toBe(true);
});

test("an enemy's floor change during a skipped (backpressured) sync reaches the client", () => {
    const { game, enemy, mirror } = setup();

    mirror.state.backpressured = true;
    enemy.layer = enemy.layer === 0 ? 1 : 0;
    enemy.setDirty();
    sync(game);
    mirror.state.backpressured = false;
    for (let i = 0; i < 10; i++) sync(game);

    expect(mirror.objs.get(enemy.__id)?.data.layer).toBe(enemy.layer);
});

test("an object moved once during a skipped sync shows at its new position", () => {
    const { game, viewer, mirror } = setup();
    const loot = game.lootBarn.addLoot("bandage", v2.add(viewer.pos, v2.create(-4, 0)), viewer.layer, 1, {
        pushSpeed: 0,
    })!;
    for (let i = 0; i < 20; i++) sync(game);
    expect(mirror.objs.has(loot.__id)).toBe(true);

    mirror.state.backpressured = true;
    loot.updatePos(v2.add(viewer.pos, v2.create(-4, 3)));
    sync(game);
    mirror.state.backpressured = false;
    for (let i = 0; i < 10; i++) sync(game);

    const seen = mirror.objs.get(loot.__id)?.data.pos as { x: number; y: number };
    expect(v2.distance(seen, loot.pos)).toBeLessThan(0.5);
});
