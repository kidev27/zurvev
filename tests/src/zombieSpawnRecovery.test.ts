import { afterEach, expect, test, vi } from "vitest";
import type { Player } from "../../server/src/game/objects/player.ts";
import { SpecOpsManager } from "../../server/src/game/specOpsManager.ts";
import { composeZombieWave } from "../../server/src/game/zombieMode.ts";
import { TeamMode } from "../../shared/gameConfig.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

type SpawnJob = {
    kind: string;
    indexInSquad: number;
    squadSize: number;
    approachAngle: number;
    host?: Player;
};
type SpawnState = {
    waveSpawnQueue: SpawnJob[];
    waveSpawnComplete: boolean;
    spawnEnemy: (...args: unknown[]) => Player | undefined;
    spawnWaveBatch: (size: number) => void;
    pickEnemySpawn: (...args: unknown[]) => unknown;
};

afterEach(() => vi.restoreAllMocks());

test.each(["specops_complex", "zombie_high_water", "zombie_dead_air"] as const)(
    "%s: a completely blocked roster cannot finish an empty round",
    (map) => {
        const game = createGame(TeamMode.Solo, map);
        game.playerBarn.addTestPlayer({ name: "Operator" });
        game.update(0.1);
        const ops = game.specOps!;
        const state = ops as unknown as SpawnState;
        vi.spyOn(state, "spawnEnemy").mockReturnValue(undefined);

        ops.startNextWave();
        const planned = composeZombieWave(1, 1, ops.difficulty).length;
        for (let i = 0; i < 200; i++) game.update(0.1);

        expect(ops.wave).toBe(1);
        expect(ops.phase).toBe("combat");
        expect(ops.livingEnemies()).toHaveLength(0);
        expect(state.waveSpawnQueue).toHaveLength(planned);
        expect(state.waveSpawnComplete).toBe(false);
    },
);

test("Dead Air: clearing a temporary spawn block recovers the complete roster", () => {
    const game = createGame(TeamMode.Solo, "zombie_dead_air");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    operator.specOpsImmunityTicker = 120;
    const ops = game.specOps!;
    const state = ops as unknown as SpawnState;
    const spawn = state.spawnEnemy.bind(ops);
    let blocked = true;
    vi.spyOn(state, "spawnEnemy").mockImplementation((...args) => blocked ? undefined : spawn(...args));

    ops.startNextWave();
    const planned = composeZombieWave(1, 1, ops.difficulty).length;
    for (let i = 0; i < 100; i++) game.update(0.1);
    expect(state.waveSpawnQueue).toHaveLength(planned);
    expect(ops.wave).toBe(1);

    blocked = false;
    for (let i = 0; i < 200 && !state.waveSpawnComplete; i++) game.update(0.1);
    expect(state.waveSpawnQueue).toHaveLength(0);
    expect(state.waveSpawnComplete).toBe(true);
    expect(ops.livingEnemies()).toHaveLength(planned);
    expect(ops.wave).toBe(1);
    expect(ops.phase).toBe("combat");
});

test("a pulse attempts each selected job once and retains only failures for later", () => {
    const ops = Object.create(SpecOpsManager.prototype) as SpecOpsManager;
    const state = ops as unknown as SpawnState;
    const jobs = [0, 1, 2, 3, 4].map(indexInSquad => ({
        kind: "zombie_walker", indexInSquad, squadSize: 5, approachAngle: 0,
    }));
    state.waveSpawnQueue = [...jobs];
    state.spawnEnemy = vi.fn((...args: unknown[]) => args[1] === 1 ? {} as Player : undefined);

    state.spawnWaveBatch(3);
    expect(state.spawnEnemy).toHaveBeenCalledTimes(3);
    expect(state.waveSpawnQueue).toEqual([jobs[3], jobs[4], jobs[0], jobs[2]]);

    state.waveSpawnQueue = [jobs[0]];
    vi.mocked(state.spawnEnemy).mockClear();
    state.spawnWaveBatch(999);
    expect(state.spawnEnemy).toHaveBeenCalledTimes(1);
    expect(state.waveSpawnQueue).toEqual([jobs[0]]);
});

test("the queue-drain test helper returns with blocked jobs still pending", () => {
    const ops = Object.create(SpecOpsManager.prototype) as SpecOpsManager;
    const state = ops as unknown as SpawnState;
    const job = { kind: "zombie_walker", indexInSquad: 0, squadSize: 1, approachAngle: 0 };
    state.waveSpawnQueue = [job];
    state.spawnEnemy = vi.fn(() => undefined);
    ops.drainWaveSpawnQueuePublic();
    expect(state.waveSpawnQueue).toEqual([job]);
    expect(state.waveSpawnComplete).toBe(false);
    expect(state.spawnEnemy).toHaveBeenCalledTimes(1);
});

test("a retried job replaces a departed host with a living operator", () => {
    const game = createGame(TeamMode.Solo, "zombie_dead_air");
    const operator = game.playerBarn.addTestPlayer({ name: "Operator" });
    game.update(0.1);
    const state = game.specOps! as unknown as SpawnState;
    const departed = { pos: v2.create(0, 0), dead: true, disconnected: true } as Player;
    const pick = vi.spyOn(state, "pickEnemySpawn").mockReturnValue(undefined);
    vi.spyOn(game.logger, "warn").mockImplementation(() => {});
    state.spawnEnemy("zombie_walker", 0, 1, 0, departed);
    expect(pick.mock.calls[0][4]).toBe(operator);
    expect(pick.mock.calls[0][0]).toEqual(operator.pos);
});
