import { expect, test } from "vitest";
import type { Game } from "../../server/src/game/game.ts";
import type { Player } from "../../server/src/game/objects/player.ts";
import { SpecOpsAllyRoles } from "../../shared/defs/maps/specOpsShop.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

type Info = { playerId: number; teamId: number; groupId: number; name: string };

/** What the browser knows: player infos (deletes first, as the client applies them) and kill messages. */
function attachMirror(viewer: Player) {
    const objs = new Map<number, ObjectType>();
    const infos = new Map<number, Info>();
    const kills: net.KillMsg[] = [];
    const killsWithUnknownNames: net.KillMsg[] = [];
    (viewer.client.socket as unknown as { send: (data: Uint8Array) => void }).send = (data) => {
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
                msg.deserialize(s, { m_getTypeById: (id: number) => objs.get(id) ?? ObjectType.Invalid });
                for (const id of msg.delObjIds) objs.delete(id);
                for (const obj of msg.fullObjects) objs.set(obj.__id, obj.__type);
                for (const id of msg.deletedPlayerIds) infos.delete(id);
                for (const info of msg.playerInfos) infos.set(info.playerId, { ...info });
            } else if (type === net.MsgType.Kill) {
                const kill = new net.KillMsg();
                kill.deserialize(s);
                kills.push(kill);
                const ids = [kill.targetId, kill.killerId, kill.killCreditId].filter((id) => id > 0);
                if (ids.some((id) => !infos.has(id))) killsWithUnknownNames.push(kill);
            } else return;
            stream.stream.readAlignToNextByte();
        }
    };
    return { infos, kills, killsWithUnknownNames };
}

function step(game: Game, seconds: number) {
    for (let i = 0; i < Math.round(seconds * 100); i++) {
        game.update(0.01);
        if (i % 3 === 0) game.netSync();
    }
}

/** Hired support on the viewer's team, counted the way the shop's support cap does (client/src/ui/ui.ts). */
function clientHiredCount(infos: Map<number, Info>, viewer: Player): number {
    const local = infos.get(viewer.__id)!;
    let hired = 0;
    for (const info of infos.values()) {
        if (info.playerId === viewer.__id || info.teamId !== local.teamId || info.groupId === local.groupId) continue;
        const name = info.name.toLowerCase();
        const isRole = (SpecOpsAllyRoles as readonly string[]).some(
            (role) => name === role.replace(/_/g, " ") || name === role,
        );
        if (name === "sentry" || name === "juggernaut" || isRole) hired++;
    }
    return hired;
}

function hireAtStation(game: Game, player: Player, sku: string): boolean {
    const station = game.map.obstacles.find((o) => o.type === "specops_station_support")!;
    v2.set(player.pos, station.pos);
    player.layer = station.layer;
    game.grid.updateObject(player);
    const ok = game.specOps!.tryBuy(player, sku);
    step(game, 0.5);
    return ok;
}

test("kill feed names enemies the viewer never saw", () => {
    const game = createGame(TeamMode.Duo, "specops_outdoor");
    const viewer = game.playerBarn.addTestPlayer({ name: "A" });
    const teammate = game.playerBarn.addTestPlayer({ name: "B" });
    const mirror = attachMirror(viewer);
    step(game, 0.1);

    const enemy = game.specOps!.spawnEnemyPublic("militia", true);
    // Far outside the viewer's view: its object (and, before the fix, its info) never reaches them.
    v2.set(enemy.pos, v2.add(viewer.pos, v2.create(400, 0)));
    game.grid.updateObject(enemy);
    step(game, 0.2);
    expect(viewer.client.visibleObjects.has(enemy)).toBe(false);

    enemy.kill({
        damageType: GameConfig.DamageType.Player,
        source: teammate,
        amount: 9999,
        dir: v2.create(1, 0),
    });
    step(game, 0.1);

    const kill = mirror.kills.find((k) => k.targetId === enemy.__id);
    expect(kill).toBeDefined();
    expect(mirror.infos.get(enemy.__id)?.name).toBe(enemy.name);
    expect(mirror.killsWithUnknownNames).toEqual([]);
});

test("hired support keeps correct team metadata through hire, death, removal and rehire", () => {
    const game = createGame(TeamMode.Duo, "test_specops");
    const viewer = game.playerBarn.addTestPlayer({ name: "A" });
    game.playerBarn.addTestPlayer({ name: "B" });
    const mirror = attachMirror(viewer);
    step(game, 0.1);
    const ops = game.specOps!;
    ops.wave = 4;
    ops.grantCash(viewer, 500000);

    for (const sku of ["recon", "cqc", "assaulter", "specops_sentry"]) {
        expect(hireAtStation(game, viewer, sku), sku).toBe(true);
    }
    const support = game.playerBarn.players.filter((p) =>
        p.specOpsKind === "ally" || p.specOpsKind === "sentry"
    );
    expect(support).toHaveLength(4);
    for (const unit of support) {
        // bindToOwner: owner's team, but a support group of its own.
        expect(unit.teamId).toBe(viewer.teamId);
        expect(unit.groupId).not.toBe(viewer.groupId);
        const info = mirror.infos.get(unit.__id)!;
        expect(info, unit.name).toBeDefined();
        expect(info.teamId).toBe(unit.teamId);
        expect(info.groupId).toBe(unit.groupId);
    }
    expect(clientHiredCount(mirror.infos, viewer)).toBe(ops.hiredSupportCount());

    // Hired support never shows up in the enemy marker list.
    step(game, 0.5);
    const enemyMarkerIds = new Set(game.modeManager.getEnemyMarkerPlayers(viewer).map((p) => p.__id));
    for (const unit of support) expect(enemyMarkerIds.has(unit.__id)).toBe(false);

    const lost = support[0];
    lost.kill({
        damageType: GameConfig.DamageType.Player,
        source: undefined,
        amount: 9999,
        dir: v2.create(1, 0),
    });
    // Dead support is removed after its corpse timer; its info must go with it.
    step(game, 11);
    expect(lost.destroyed).toBe(true);
    expect(mirror.infos.has(lost.__id)).toBe(false);
    expect(clientHiredCount(mirror.infos, viewer)).toBe(ops.hiredSupportCount());

    ops.grantCash(viewer, 500000);
    expect(hireAtStation(game, viewer, "recon")).toBe(true);
    const rehired = game.playerBarn.players.find((p) =>
        p.specOpsKind === "ally" && !p.dead && !support.includes(p)
    )!;
    expect(rehired).toBeDefined();
    expect(mirror.infos.get(rehired.__id)?.groupId).toBe(rehired.groupId);
    expect(clientHiredCount(mirror.infos, viewer)).toBe(ops.hiredSupportCount());
});
