import { afterEach, expect, test } from "vitest";
import { PracticeBotHeal } from "../../server/src/game/practiceCombat.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { PracticeSettingsMsg } from "../../shared/net/practiceMsg.ts";
import { BitStream } from "../../shared/net/net.ts";
import { defaultPracticeBot, defaultPracticeSettings, sanitizePracticeSettings } from "../../shared/practice.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { duel, match } from "./practiceBotDuel.ts";

const Action = GameConfig.Action;
const dt = 0.02;
const defaults = { ...PracticeBotHeal };

afterEach(() => {
    Object.assign(PracticeBotHeal, defaults);
});

/**
 * A bot at `health` with no adrenaline and, unless `boosts` is set, no sodas or
 * pills, so only health decides what it does and nothing regenerates.
 */
function hurt(
    health: number,
    opts: Parameters<typeof duel>[3] = {},
    gun = "mosin",
    secondary = "spas12",
    distance = 10,
    boosts = false,
) {
    const d = duel(gun, secondary, distance, opts);
    const kit = { ...PracticeBotHeal.kit };
    d.bot.boost = 0;
    d.bot.invManager.set("bandage", kit.bandage);
    d.bot.invManager.set("healthkit", kit.healthkit);
    d.bot.invManager.set("soda", boosts ? kit.soda : 0);
    d.bot.invManager.set("painkiller", boosts ? kit.painkiller : 0);
    for (const slot of [0, 1]) {
        const type = d.bot.weapons[slot].type;
        if (type) d.bot.weapons[slot].ammo = GunDefs[type].maxClip;
    }
    /** Set the bot's health by hand without it counting as a hit. */
    const setHealth = (value: number) => {
        d.bot.health = value;
        const state = d.combat as unknown as { lastHealth: number; sinceHit: number };
        state.lastHealth = value;
        state.sinceHit = Infinity;
    };
    setHealth(health);
    // The warm-up fight may have ended with the target out of sight.
    (d.combat as unknown as { unseenFor: number }).unseenFor = 0;
    const item = () => d.bot.actionType === Action.UseItem ? d.bot.actionItem : "";
    const count = (type: "bandage" | "healthkit" | "soda" | "painkiller") => d.bot.invManager.get(type);
    return { ...d, item, count, setHealth };
}

test("a bot spawns with a full level 3 pack of heals and boosts", () => {
    const { bot, count } = hurt(100, {}, "mosin", "spas12", 10, true);
    expect(bot.backpack).toBe("backpack03");
    expect([count("bandage"), count("healthkit"), count("soda"), count("painkiller")]).toEqual([30, 4, 15, 4]);
});

test("Start with full adrenaline is off by default and fills the bar when on", () => {
    expect(defaultPracticeBot().startAdren).toBe(false);
    // Fresh from the spawn: the warm-up fight in the harness is too short to drink anything.
    expect(duel("mosin", "", 30, { bot: { shootsBack: false } }).bot.boost).toBe(0);
    expect(duel("mosin", "", 30, { bot: { shootsBack: false, startAdren: true } }).bot.boost).toBeGreaterThan(95);
});

test("out of sight and hurt, it waits safeDelay and then heals", () => {
    const { bot, run, item, count } = hurt(75);
    run(PracticeBotHeal.safeDelay - 2 * dt, false);
    expect(item()).toBe("");
    run(4 * dt, false);
    expect(item()).toBe("bandage");
    run(3.2, false, () => bot.health > 75);
    expect(bot.health).toBe(90);
    expect(count("bandage")).toBe(29);
    // Less than one bandage missing: it stops.
    run(1.5, false, () => item() !== "");
    expect(item()).toBe("");
});

test("it takes the quicker way back to full: med kit past two bandages", () => {
    // 60 missing: four bandages (12 s) against one med kit (6 s).
    const low = hurt(40);
    low.run(1, false, () => low.item() !== "");
    expect(low.item()).toBe("healthkit");
    low.run(6.2, false, () => low.bot.health > 40);
    expect(low.bot.health).toBe(100);
    expect(low.count("healthkit")).toBe(3);

    // 30 missing: two bandages take the same 6 s and keep the med kit.
    const mid = hurt(70);
    mid.run(1, false, () => mid.item() !== "");
    expect(mid.item()).toBe("bandage");
    mid.run(8, false, () => mid.bot.health === 100);
    expect(mid.bot.health).toBe(100);
    expect(mid.count("bandage")).toBe(28);
    expect(mid.count("healthkit")).toBe(4);

    // No bandages left: the med kit is all there is.
    const out = hurt(70);
    out.bot.invManager.set("bandage", 0);
    out.run(1, false, () => out.item() !== "");
    expect(out.item()).toBe("healthkit");
});

test("a bot never goes past its Health setting, with items or adrenaline", () => {
    const normal = hurt(90);
    expect(normal.bot.maxHealth).toBe(100);
    normal.bot.boost = 100;
    for (let t = 0; t < 10; t += dt) normal.bot.update(dt);
    expect(normal.bot.health).toBe(100);

    // Set to 60: a bandage stops at 60.
    const weak = hurt(40, { bot: { health: 60 } });
    expect(weak.bot.maxHealth).toBe(60);
    weak.run(1, false, () => weak.item() !== "");
    expect(weak.item()).toBe("bandage");
    weak.run(3.2, false, () => weak.bot.health > 40);
    expect(weak.bot.health).toBe(55);
    weak.run(1.5, false, () => weak.item() !== "");
    expect(weak.item()).toBe("");

    // Set to 200: the game only allows heal items below 100.
    const tank = hurt(120, { bot: { health: 200 } });
    expect(tank.bot.maxHealth).toBe(200);
    tank.run(1.5, false, () => tank.item() !== "");
    expect(tank.item()).toBe("");
});

test("in your sight it does not start an item, however hurt", () => {
    const { run, item } = hurt(15);
    run(2, true, () => item() !== "");
    expect(item()).toBe("");
});

test("taking damage stops the item, and it waits before trying again", () => {
    const { bot, run, item } = hurt(75);
    run(1, false, () => item() !== "");
    expect(item()).toBe("bandage");
    bot.health -= 10;
    run(2 * dt, false);
    expect(item()).toBe("");
    run(PracticeBotHeal.hitDelay - 6 * dt, false);
    expect(item()).toBe("");
    run(10 * dt, false);
    expect(item()).not.toBe("");
});

test("seeing you again stops the item, unless it is nearly done", () => {
    const early = hurt(60);
    early.run(1, false, () => early.item() !== "");
    early.run(1, false);
    early.run(3 * dt, true);
    expect(early.item()).toBe("");
    expect(early.bot.health).toBe(60);

    const late = hurt(75);
    late.run(1, false, () => late.item() !== "");
    late.run(3, false, () => late.bot.action.duration - late.bot.action.time <= PracticeBotHeal.finishIfLeft);
    late.run(1, true, () => late.bot.health > 75);
    expect(late.bot.health).toBe(90);
});

test("when you are low it does not heal: it pushes", () => {
    const { player, combat, run, item } = hurt(40);
    player.health = PracticeBotHeal.pushTargetAt;
    run(1.5, false, () => item() !== "");
    expect(item()).toBe("");
    expect(combat.pushing).toBe(true);

    // You dropping low also ends a heal in progress.
    const mid = hurt(75);
    mid.run(1, false, () => mid.item() !== "");
    expect(mid.item()).toBe("bandage");
    mid.player.health = 20;
    mid.run(2 * dt, false);
    expect(mid.item()).toBe("");

    const healthy = hurt(40);
    healthy.run(dt, false);
    expect(healthy.combat.pushing).toBe(false);
});

test("while you reload in view it heals only if none of its guns reaches you", () => {
    // Shotgun only, 30 units away: nothing to shoot with, so your reload is a free heal.
    const far = hurt(40, {}, "spas12", "", 30);
    far.player.doAction("mosin", Action.Reload, 30);
    far.run(1, true, () => far.item() !== "");
    expect(far.item()).toBe("healthkit");

    // Same reload inside its range: it shoots you instead.
    const near = hurt(40, {}, "spas12", "", 10);
    near.player.doAction("mosin", Action.Reload, 30);
    near.run(1, true, () => near.item() !== "");
    expect(near.item()).toBe("");
    expect(near.shots[0]).toBeGreaterThanOrEqual(1);
});

test("order when safe: a gun that shoots, urgent heal, empty gun, heal, clips, adrenaline", () => {
    // Nothing loaded: reload before healing.
    const dry = hurt(40);
    dry.bot.weapons[0].ammo = 0;
    dry.bot.weapons[1].ammo = 0;
    dry.run(10, false, () => dry.item() !== "");
    expect(dry.item()).toBe("healthkit");
    expect(dry.bot.weapons[0].ammo + dry.bot.weapons[1].ammo).toBeGreaterThan(0);

    // One gun loaded, badly hurt: heal before the empty gun.
    const urgent = hurt(40);
    urgent.bot.weapons[1].ammo = 0;
    urgent.run(1, false, () => urgent.item() !== "");
    expect(urgent.item()).toBe("healthkit");

    // One gun loaded, lightly hurt: the empty gun first, then the bandage.
    const light = hurt(70);
    light.bot.weapons[1].ammo = 0;
    light.run(1, false, () => light.item() !== "" || light.bot.weapons[1].ammo > 0);
    expect(light.item()).toBe("");
    light.run(3, false, () => light.item() !== "");
    expect(light.bot.weapons[1].ammo).toBeGreaterThan(0);
    expect(light.item()).toBe("bandage");

    // A clip that is only part empty waits for the bandage.
    const partial = hurt(70);
    partial.bot.weapons[0].ammo = 2;
    partial.run(1, false, () => partial.item() !== "");
    expect(partial.item()).toBe("bandage");

    // Adrenaline comes last: after the clip is full.
    const boost = hurt(100, {}, "mosin", "spas12", 10, true);
    boost.bot.weapons[0].ammo = 2;
    boost.run(1, false, () => boost.item() !== "" || boost.bot.actionType !== Action.None);
    expect(boost.item()).toBe("");
});

test("adrenaline: pills when nearly empty, soda to stay above 50, nothing above that", () => {
    const { bot, run, item } = hurt(100, {}, "mosin", "spas12", 10, true);
    run(2, false, () => item() !== "");
    expect(item()).toBe("painkiller");
    run(5.5, false, () => bot.boost > 40);
    expect(bot.boost).toBeGreaterThan(45);
    run(2, false, () => item() !== "");
    expect(item()).toBe("soda");
    run(3.5, false, () => bot.boost > 60);
    expect(bot.boost).toBeGreaterThan(70);
    run(1, false);
    expect(item()).toBe("");
});

test("a target dummy that does not shoot back never uses items", () => {
    const { run, item, combat } = hurt(20, { bot: { shootsBack: false } }, "mosin", "spas12", 10, true);
    run(2, false, () => item() !== "");
    expect(item()).toBe("");
    expect(combat.pushing).toBe(false);
});

test("Start with full adrenaline survives the trip over the network", () => {
    const settings = sanitizePracticeSettings({
        ...defaultPracticeSettings(),
        bots: [{ ...defaultPracticeBot(), startAdren: true }, defaultPracticeBot()],
    });
    const msg = new PracticeSettingsMsg();
    msg.settings = settings;
    const stream = new BitStream(new ArrayBuffer(1024));
    msg.serialize(stream);
    stream.index = 0;
    const back = new PracticeSettingsMsg();
    back.deserialize(stream);
    expect(back.settings.bots.map((bot) => bot.startAdren)).toEqual([true, false]);
});

test("in a match, a rifle bot closes in on you when you are low", () => {
    // A Mosin bot normally keeps 26 units or more. Random match: one good run in three is enough.
    let closest = Infinity;
    for (let attempt = 0; attempt < 3 && closest >= 20; attempt++) {
        const { game, player, bot, brain, distance } = match("mosin", "", 30);
        for (let t = 0; t < 12 && closest >= 20; t += 0.01) {
            player.health = 20;
            bot.health = 100;
            game.update(0.01);
            expect(brain.practiceCombat.pushing).toBe(true);
            closest = Math.min(closest, distance());
        }
    }
    expect(closest).toBeLessThan(20);
});

test("in a match, a hurt bot heals once you are far away, at the half speed every player has", () => {
    const { game, player, bot } = match("mosin", "spas12", 30);
    for (let t = 0; t < 2; t += 0.01) game.update(0.01);
    // You vanish to the far corner of the map; the bot is at 40 health.
    v2.set(player.pos, v2.create(8, 8));
    game.grid.updateObject(player);
    bot.health = 40;
    let usingTime = 0;
    let movedWhileUsing = 0;
    let last = v2.copy(bot.pos);
    for (let t = 0; t < 12 && bot.health < 100; t += 0.01) {
        const using = bot.actionType === Action.UseItem;
        game.update(0.01);
        if (using && bot.actionType === Action.UseItem) {
            usingTime += 0.01;
            movedWhileUsing += v2.distance(bot.pos, last);
        }
        last = v2.copy(bot.pos);
    }
    expect(usingTime).toBeGreaterThan(5);
    expect(bot.health).toBe(100);
    expect(bot.invManager.get("healthkit")).toBe(3);
    // Using an item halves walking speed for everyone. The bot must not move faster than that.
    expect(movedWhileUsing).toBeLessThanOrEqual(GameConfig.player.moveSpeed / 2 * usingTime + 0.5);
});

test("in view but farther than farDistance counts as safe", () => {
    const far = hurt(75, {}, "mosin", "spas12", PracticeBotHeal.farDistance + 10);
    far.run(1, true, () => far.item() !== "");
    expect(far.item()).toBe("bandage");

    const near = hurt(75, {}, "mosin", "spas12", PracticeBotHeal.farDistance - 10);
    near.run(1, true, () => near.item() !== "");
    expect(near.item()).toBe("");
});
