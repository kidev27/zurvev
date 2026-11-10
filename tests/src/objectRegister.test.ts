import { expect, test } from "vitest";
import type { Grid } from "../../server/src/game/grid.ts";
import { type GameObject, ObjectRegister } from "../../server/src/game/objects/gameObject.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";

function createRegister() {
    return new ObjectRegister({ addObject() {} } as unknown as Grid);
}

function add(register: ObjectRegister, type: ObjectType): GameObject {
    const object = { __type: type, init() {} } as unknown as GameObject;
    register.register(object);
    return object;
}

function expectConsistent(register: ObjectRegister) {
    const liveIds = new Set<number>();
    for (const object of register.objects) {
        expect(object).toBeDefined();
        const obj = object!;
        expect(liveIds.has(obj.__id)).toBe(false);
        expect(obj.__id).toBeGreaterThan(0);
        expect(obj.__id).toBeLessThan(65535);
        expect(register.getById(obj.__id)).toBe(obj);
        expect(register.objects[obj.__arrayIdx]).toBe(obj);
        expect(register.idToType[obj.__id]).toBe(obj.__type);
        liveIds.add(obj.__id);
    }
    const freeIds = new Set<number>();
    for (const [type, ids] of Object.entries(register.freeLists)) {
        for (const id of ids) {
            expect(liveIds.has(id)).toBe(false);
            expect(freeIds.has(id)).toBe(false);
            expect(register.idToObj[id]).toBeNull();
            expect(register.idToType[id]).toBe(Number(type));
            freeIds.add(id);
        }
    }
    expect(liveIds.size + freeIds.size).toBe(register.idNext - 1);
}

test("exhaustion never loans a live id from its previous type's free list", () => {
    const register = createRegister();
    for (let i = 1; i < 65535; i++) add(register, ObjectType.Player);
    expectConsistent(register);
    expect(() => add(register, ObjectType.Loot)).toThrow("Ran out of ids");

    const old = register.objects[0]!;
    const id = old.__id;
    register.unregister(old);
    expect(old.__id).toBe(0);
    expect(register.idToType[id]).toBe(ObjectType.Player);
    const borrowed = add(register, ObjectType.Obstacle);
    expect(borrowed.__id).toBe(id);
    expect(register.freeLists[ObjectType.Player]).not.toContain(id);
    expect(() => add(register, ObjectType.Player)).toThrow("Ran out of ids");
    expect(register.getById(id)).toBe(borrowed);
    expectConsistent(register);
});

test("mixed-type recycling stays unique beyond MAX_ID cumulative allocations", () => {
    const register = createRegister();
    const types = [
        ObjectType.Player,
        ObjectType.Obstacle,
        ObjectType.Loot,
        ObjectType.Building,
        ObjectType.Structure,
        ObjectType.DeadBody,
        ObjectType.Decal,
        ObjectType.Projectile,
        ObjectType.Smoke,
        ObjectType.Airdrop,
    ];
    const objects = Array.from({ length: 1024 }, (_, i) => add(register, types[i % types.length]));
    const liveIds = new Set(objects.map((object) => object.__id));
    for (let i = 0; i < 70000; i++) {
        const slot = i % objects.length;
        const old = objects[slot];
        liveIds.delete(old.__id);
        register.unregister(old);
        const next = add(register, types[(i + 1) % types.length]);
        expect(liveIds.has(next.__id)).toBe(false);
        liveIds.add(next.__id);
        objects[slot] = next;
    }
    expect(register.idNext).toBe(65535);
    expect(liveIds.size).toBe(objects.length);
    expectConsistent(register);
});

test("recycling prefers the requested type and flush releases an id once", () => {
    const register = createRegister();
    const player = add(register, ObjectType.Player);
    const loot = add(register, ObjectType.Loot);
    const playerId = player.__id;
    const lootId = loot.__id;
    register.deletedObjs.push(player, loot);
    register.flush();
    expect(register.deletedObjs).toHaveLength(0);
    expect(register.dirtyPart[playerId]).toBe(0);
    expect(register.dirtyFull[playerId]).toBe(0);
    // Reach the recycle path without manufacturing untracked free slots.
    for (let i = register.idNext; i < 65535; i++) add(register, ObjectType.Obstacle);
    const replacement = add(register, ObjectType.Player);
    expect(register.idToType[replacement.__id]).toBe(ObjectType.Player);
    expect(register.freeLists[ObjectType.Loot]).toContain(lootId);
    expect(() => register.unregister(player)).toThrow();
    expectConsistent(register);
});
