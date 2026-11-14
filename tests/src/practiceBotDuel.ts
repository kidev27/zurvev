import type { PracticeCombat } from "../../server/src/game/practiceCombat.ts";
import { TeamMode } from "../../shared/gameConfig.ts";
import {
    defaultPracticeBot,
    defaultPracticeSettings,
    type PracticeBotSettings,
    type PracticeQsProfile,
    sanitizePracticeSettings,
} from "../../shared/practice.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { createGame } from "./gameTestHelpers.ts";

/** One practice bot facing the player `distance` units away, driven tick by tick. */
export function duel(
    gun: string,
    secondary: string,
    distance: number,
    {
        quickSwitch = true,
        dt = 0.02,
        bot: overrides = {} as Partial<PracticeBotSettings>,
        qsProfile = "survev" as PracticeQsProfile,
    } = {},
) {
    const game = createGame(TeamMode.Solo, "practice_arena", { endless: false });
    const player = game.playerBarn.addTestPlayer({ name: "Trainee" });
    // The warm-up fight below must not kill the target.
    player.debug.godMode = true;
    game.update(0.1);
    game.specOps!.practice!.applySettings(
        player,
        sanitizePracticeSettings({
            ...defaultPracticeSettings(),
            bots: [{
                ...defaultPracticeBot(),
                gun,
                secondary,
                accuracy: 100,
                reaction: 0,
                wiggle: 0,
                strafe: 0,
                turn: 0,
                dodge: 0,
                autoMelee: false,
                quickSwitch,
                ...overrides,
            }],
            qsProfile,
        }),
    );
    for (let i = 0; i < 20; i++) game.update(0.1);
    const bot = game.playerBarn.livingPlayers.find((p) => p.specOpsAi)!;
    const combat: PracticeCombat = game.specOps!.getBrainPublic(bot)!.practiceCombat!;
    v2.set(bot.pos, v2.create(30, 30));
    v2.set(player.pos, v2.create(30 + distance, 30));
    bot.dir = v2.create(1, 0);
    game.grid.updateObject(bot);
    game.grid.updateObject(player);
    // The warm-up fight may have left a holster half done; start from a clean hand.
    (combat as unknown as { returnSlot?: number }).returnSlot = undefined;
    bot.weaponManager.setCurWeapIndex(0);
    bot.weapons[0].cooldown = 0;
    bot.freeSwitchTimer = -1;
    bot.cancelAction();
    // The brain is not running here; clear the movement it last asked for.
    bot.haltSpecOpsInput();
    const botPos = v2.copy(bot.pos);

    const shots = [0, 0];
    /** Advance the bot alone: its combat decisions, trigger and engine update. */
    const run = (seconds: number, sees: boolean, until?: () => boolean) => {
        for (let t = 0; t < seconds; t += dt) {
            const before = [bot.weapons[0].ammo, bot.weapons[1].ammo];
            combat.update(dt, player, sees, sees);
            combat.fire(sees);
            bot.update(dt);
            v2.set(bot.pos, botPos);
            for (const slot of [0, 1]) if (bot.weapons[slot].ammo < before[slot]) shots[slot]++;
            if (until?.()) return t + dt;
        }
        return seconds;
    };
    return { game, player, bot, combat, run, shots, dt };
}

/** A whole Practice match with one bot, its brain running, `start` units from a player who cannot die. */
export function match(gun: string, secondary: string, start: number) {
    const game = createGame(TeamMode.Solo, "practice_arena", { endless: false });
    const player = game.playerBarn.addTestPlayer({ name: "Trainee" });
    player.debug.godMode = true;
    game.update(0.1);
    game.specOps!.practice!.applySettings(
        player,
        sanitizePracticeSettings({
            ...defaultPracticeSettings(),
            bots: [{ ...defaultPracticeBot(), gun, secondary, quickSwitch: true }],
        }),
    );
    for (let i = 0; i < 20; i++) game.update(0.1);
    const bot = game.playerBarn.livingPlayers.find((p) => p.specOpsAi)!;
    const away = v2.normalizeSafe(v2.sub(bot.pos, player.pos), v2.create(1, 0));
    v2.set(bot.pos, v2.add(player.pos, v2.mul(away, start)));
    game.grid.updateObject(bot);
    const brain = game.specOps!.getBrainPublic(bot)! as unknown as {
        practiceMove?: { range: number; holdRange: number; closeTo: number };
        practiceCombat: PracticeCombat;
    };
    const distance = () => v2.distance(bot.pos, player.pos);
    return { game, player, bot, brain, distance };
}
