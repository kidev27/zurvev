import type { AmmoDef } from "../../../shared/defs/gameObjects/gearDefs.ts";
import type { GunDef } from "../../../shared/defs/gameObjects/gunDefs.ts";
import { GameObjectDefs } from "../../../shared/defs/register.ts";
import {
    defaultPracticeBot,
    type PracticeBotSettings,
    PracticeBotSkillLabels,
    PracticeBotSkills,
    type PracticeBotSkill,
    practiceBotSkillOf,
    practiceGunGroup,
    type PracticeGunGroup,
    PracticeGunGroupLabels,
    PracticeGunGroups,
    PracticeGuns,
    practiceGunName,
    PracticeKitItems,
    type PracticeKitItem,
    PracticeKitMaxCount,
    PracticeMaxArmor,
    PracticeMaxBotHealth,
    PracticeMaxBots,
    PracticeMaxGearLevel,
    PracticeMaxPackLevel,
    PracticeMaxReaction,
    PracticeMaxRespawnDelay,
    PracticeMelees,
    PracticeMinBotHealth,
    PracticeRandomGun,
    type PracticeRespawnMode,
    PracticeRespawnModes,
    PracticeScopes,
    type PracticeSettings,
    PracticeSliderMax,
    practiceWiggleToAdvanced,
    withPracticeBotSkill,
} from "../../../shared/practice.ts";
import { helpers } from "../helpers.ts";

/**
 * The Practice setup editor: Guns, Gear & kit and Bots sections. The home-screen
 * loadout screen and the in-match drawer both render these; each sets the
 * --pe-* colors on its own root (homescreen look vs in-game look).
 */

export type GunTarget = { who: "you" | number; slot: "primary" | "secondary" };

export interface EditorState {
    gunTarget: GunTarget;
    gunGroup: PracticeGunGroup | "all";
    gunSearch: string;
    bot: number;
    editAllBots: boolean;
}

export function newEditorState(): EditorState {
    return {
        gunTarget: { who: "you", slot: "primary" },
        gunGroup: "all",
        gunSearch: "",
        bot: 0,
        editAllBots: false,
    };
}

export interface EditorHost {
    readonly settings: PracticeSettings;
    readonly state: EditorState;
    /** Settings or state changed: save/mark dirty and re-render. */
    changed(): void;
    /** Switch the visible section (Bots → Guns to pick a bot's gun, and back). */
    showSection(section: "guns" | "bots"): void;
    /** In a match: bring dead bots back now. Absent on the home screen. */
    respawnBotsNow?(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
}

export function itemIcon(type: string): string {
    return type ? helpers.getSvgFromGameType(type) : "";
}

export function itemName(type: string): string {
    if (!type) return "None";
    if (type === PracticeRandomGun) return "Random";
    return (GameObjectDefs.typeToDefSafe(type) as { name?: string } | undefined)?.name ?? type;
}

const KitItemLabels: Record<PracticeKitItem, string> = {
    bandage: "Bandages",
    healthkit: "Med kits",
    soda: "Sodas",
    painkiller: "Pills",
    frag: "Frags",
    smoke: "Smokes",
    mirv: "MIRVs",
};

export function sectionTitle(text: string): HTMLElement {
    return el("div", { class: "pe-title" }, text);
}

export function button(text: string, onClick: () => void, kind: "plain" | "primary" | "dashed" = "plain"): HTMLButtonElement {
    const b = el("button", { type: "button", class: `pe-btn pe-btn-${kind}` }, text);
    b.addEventListener("click", onClick);
    return b;
}

function segmented<T extends string | number>(
    label: string,
    options: Array<{ value: T; text: string }>,
    value: T,
    onPick: (v: T) => void,
): HTMLDivElement {
    const group = el("div", { class: "pe-seg", role: "group", "aria-label": label });
    for (const opt of options) {
        const b = el("button", {
            type: "button",
            "aria-pressed": String(opt.value === value),
        }, opt.text);
        b.addEventListener("click", () => onPick(opt.value));
        group.append(b);
    }
    return group;
}

let sliderSeq = 0;
function slider(
    label: string,
    value: number,
    min: number,
    max: number,
    fmt: (v: number) => string,
    onSet: (v: number) => void,
): HTMLDivElement {
    const id = `pe-slider-${++sliderSeq}`;
    const row = el("div", { class: "pe-slider" });
    const head = el("div", { class: "pe-slider-head" });
    const val = el("span", { class: "pe-val" }, fmt(value));
    head.append(el("label", { for: id }, label), val);
    const input = el("input", { id, type: "range", min: String(min), max: String(max), step: "1" });
    input.value = String(value);
    input.addEventListener("input", () => {
        val.textContent = fmt(Number(input.value));
    });
    input.addEventListener("change", () => onSet(Number(input.value)));
    row.append(head, input);
    return row;
}

function toggle(label: string, checked: boolean, onSet: (v: boolean) => void): HTMLLabelElement {
    const row = el("label", { class: "pe-toggle" });
    const input = el("input", { type: "checkbox" });
    input.checked = checked;
    input.addEventListener("change", () => onSet(input.checked));
    row.append(input, label);
    return row;
}

function labeledRow(label: string, control: HTMLElement, icon?: string): HTMLDivElement {
    const row = el("div", { class: "pe-row" });
    row.append(el("span", { class: "pe-label" }, label));
    const img = el("span", { class: "pe-row-icon" });
    if (icon) img.style.backgroundImage = `url(${icon})`;
    row.append(img, control);
    return row;
}

function select(label: string, options: Array<{ value: string; text: string }>, value: string, onSet: (v: string) => void) {
    const s = el("select", { "aria-label": label });
    for (const o of options) s.append(el("option", { value: o.value }, o.text));
    s.value = value;
    s.addEventListener("change", () => onSet(s.value));
    return s;
}

const meleeOptions = () => PracticeMelees.map((m) => ({ value: m, text: itemName(m) }));

/* ── Guns ─────────────────────────────────────────────────────────────── */

function gunOf(host: EditorHost, target: GunTarget): string {
    if (target.who === "you") return target.slot === "primary" ? host.settings.primary : host.settings.secondary;
    const bot = host.settings.bots[target.who];
    return target.slot === "primary" ? bot.gun : bot.secondary;
}

function setGun(host: EditorHost, target: GunTarget, gun: string): void {
    if (target.who === "you") {
        if (target.slot === "primary") host.settings.primary = gun;
        else host.settings.secondary = gun;
    } else {
        editBot(host, target.who, (bot) => {
            if (target.slot === "primary") bot.gun = gun;
            else bot.secondary = gun;
        });
        return;
    }
    host.changed();
}

function gunDetail(type: string): string {
    const def = GameObjectDefs.typeToDefSafe(type) as GunDef | undefined;
    if (!def || def.type !== "gun") return "";
    const ammo = (GameObjectDefs.typeToDefSafe(def.ammo) as AmmoDef | undefined)?.name ?? def.ammo;
    return `${ammo} · ${def.maxClip} rounds · ${def.fireDelay} s between shots · ${def.switchDelay} s to switch to`;
}

export function renderGuns(root: HTMLElement, host: EditorHost): void {
    const { state } = host;
    const target = state.gunTarget;
    if (target.who !== "you" && !host.settings.bots[target.who]) state.gunTarget = { who: "you", slot: "primary" };

    if (target.who === "you") {
        const slots = el("div", { class: "pe-slots" });
        for (const slot of ["primary", "secondary"] as const) {
            const gun = slot === "primary" ? host.settings.primary : host.settings.secondary;
            const b = el("button", {
                type: "button",
                class: "pe-slot",
                "aria-pressed": String(target.slot === slot),
            });
            const icon = el("span", { class: "pe-slot-icon" });
            if (gun) icon.style.backgroundImage = `url(${itemIcon(gun)})`;
            b.append(el("span", { class: "pe-label" }, slot === "primary" ? "PRIMARY" : "SECONDARY"), icon, el("b", {}, itemName(gun)));
            b.addEventListener("click", () => {
                state.gunTarget = { who: "you", slot };
                host.changed();
            });
            slots.append(b);
        }
        root.append(slots);
    } else {
        const banner = el("div", { class: "pe-banner" });
        banner.append(
            el("span", {}, `Choosing Bot ${target.who + 1} ${target.slot === "primary" ? "primary" : "secondary"} gun`),
            button("Back to bots", () => {
                state.gunTarget = { who: "you", slot: "primary" };
                host.showSection("bots");
            }),
        );
        root.append(banner);
    }

    const filters = el("div", { class: "pe-filters" });
    for (const g of ["all", ...PracticeGunGroups] as const) {
        const b = el("button", {
            type: "button",
            class: "pe-chip",
            "aria-pressed": String(state.gunGroup === g),
        }, g === "all" ? "All" : PracticeGunGroupLabels[g]);
        b.addEventListener("click", () => {
            state.gunGroup = g;
            host.changed();
        });
        filters.append(b);
    }
    const search = el("input", { type: "search", class: "pe-search", placeholder: "Search guns", "aria-label": "Search guns" });
    search.value = state.gunSearch;
    filters.append(search);
    root.append(filters);

    const grid = el("div", { class: "pe-grid" });
    const selected = gunOf(host, target);
    const other = gunOf(host, { who: target.who, slot: target.slot === "primary" ? "secondary" : "primary" });
    const fillGrid = () => {
        grid.innerHTML = "";
        const q = state.gunSearch.trim().toLowerCase();
        const extras: string[] = [];
        if (target.slot === "secondary") extras.push("");
        if (target.who !== "you") extras.push(PracticeRandomGun);
        const guns = PracticeGuns.filter((g) =>
            (state.gunGroup === "all" || practiceGunGroup(g) === state.gunGroup)
            && (!q || practiceGunName(g).toLowerCase().includes(q))
        );
        for (const gun of [...extras, ...guns]) {
            const tile = el("button", { type: "button", class: "pe-tile", "aria-pressed": String(gun === selected) });
            const icon = el("span", { class: "pe-tile-icon" });
            if (gun && gun !== PracticeRandomGun) icon.style.backgroundImage = `url(${itemIcon(gun)})`;
            else icon.textContent = gun ? "?" : "—";
            tile.append(icon, el("b", {}, itemName(gun)));
            if (gun && gun !== PracticeRandomGun) {
                const def = GameObjectDefs.typeToDefSafe(gun) as GunDef;
                const ammo = (GameObjectDefs.typeToDefSafe(def.ammo) as AmmoDef | undefined)?.name ?? def.ammo;
                tile.append(el("span", { class: "pe-muted" }, `${PracticeGunGroupLabels[practiceGunGroup(gun)]} · ${ammo}`));
            }
            if (gun && gun === other) tile.append(el("span", { class: "pe-badge" }, target.slot === "primary" ? "Secondary" : "Primary"));
            tile.addEventListener("click", () => setGun(host, target, gun));
            grid.append(tile);
        }
        if (!grid.children.length) grid.append(el("p", { class: "pe-muted" }, "No guns match."));
    };
    search.addEventListener("input", () => {
        state.gunSearch = search.value;
        fillGrid();
    });
    fillGrid();
    root.append(grid);

    const detail = el("div", { class: "pe-detail" });
    detail.append(el("b", {}, itemName(selected)), el("span", { class: "pe-muted" }, gunDetail(selected)));
    root.append(detail);
}

/* ── Gear & kit ───────────────────────────────────────────────────────── */

export function renderGear(root: HTMLElement, host: EditorHost): void {
    const kit = host.settings.kit;
    const set = (fn: () => void) => () => {
        fn();
        host.changed();
    };
    const levels = (max: number, none: boolean) =>
        Array.from({ length: max + 1 }, (_, i) => ({ value: i, text: i === 0 && none ? "None" : `Lv ${i}` }));
    root.append(sectionTitle("GEAR"));
    root.append(labeledRow(
        "HELMET",
        segmented("Helmet", levels(PracticeMaxGearLevel, true), kit.helmet, (v) => set(() => (kit.helmet = v))()),
        itemIcon("helmet02"),
    ));
    root.append(labeledRow(
        "VEST",
        segmented("Vest", levels(PracticeMaxGearLevel, true), kit.vest, (v) => set(() => (kit.vest = v))()),
        itemIcon("chest02"),
    ));
    root.append(labeledRow(
        "BACKPACK",
        segmented("Backpack", levels(PracticeMaxPackLevel, false), kit.backpack, (v) => set(() => (kit.backpack = v))()),
        itemIcon("backpack02"),
    ));
    root.append(labeledRow(
        "SCOPE",
        segmented(
            "Scope",
            PracticeScopes.map((s) => ({ value: s as string, text: s.replace("scope", "") })),
            kit.scope,
            (v) => set(() => (kit.scope = v))(),
        ),
        itemIcon("4xscope"),
    ));
    root.append(labeledRow("MELEE", select("Melee", meleeOptions(), kit.melee, (v) => set(() => (kit.melee = v))())));

    const head = el("div", { class: "pe-title-row" });
    head.append(sectionTitle("KIT"), toggle("Full ammo for your guns", kit.fillAmmo, (v) => set(() => (kit.fillAmmo = v))()));
    root.append(head);
    const grid = el("div", { class: "pe-kit" });
    for (const item of PracticeKitItems) {
        const cell = el("div", { class: "pe-kit-item" });
        const icon = el("span", { class: "pe-kit-icon" });
        icon.style.backgroundImage = `url(${itemIcon(item)})`;
        const count = el("span", { class: "pe-val" }, String(kit.counts[item]));
        const step = (d: number) => {
            kit.counts[item] = Math.max(0, Math.min(PracticeKitMaxCount, kit.counts[item] + d));
            host.changed();
        };
        const less = el("button", { type: "button", "aria-label": `Fewer ${KitItemLabels[item]}` }, "−");
        less.addEventListener("click", () => step(-1));
        const more = el("button", { type: "button", "aria-label": `More ${KitItemLabels[item]}` }, "+");
        more.addEventListener("click", () => step(1));
        const stepper = el("div", { class: "pe-stepper" });
        stepper.append(less, count, more);
        cell.append(icon, el("span", {}, KitItemLabels[item]), stepper);
        grid.append(cell);
    }
    root.append(grid);
    root.append(el("p", { class: "pe-muted" }, "Your backpack still caps what you carry in game."));
}

/* ── Bots ─────────────────────────────────────────────────────────────── */

/** Change one bot; with "Edit all bots together" the others copy it. */
function editBot(host: EditorHost, index: number, fn: (bot: PracticeBotSettings) => void): void {
    const bots = host.settings.bots;
    fn(bots[index]);
    if (host.state.editAllBots) {
        for (let i = 0; i < bots.length; i++) if (i !== index) bots[i] = structuredClone(bots[index]);
    }
    host.changed();
}

export function botSummary(bot: PracticeBotSettings): string {
    const guns = [bot.gun, bot.secondary].filter(Boolean).map(itemName).join(" + ");
    const armor = bot.armor ? `Lv ${bot.armor}` : "no armor";
    return `${guns} · ${PracticeBotSkillLabels[practiceBotSkillOf(bot)]} · ${armor} · ${bot.health} HP${bot.shootsBack ? "" : " · target"}`;
}

export const RespawnModeText: Record<PracticeRespawnMode, string> = {
    each: "Each bot",
    wave: "Wave",
    off: "By hand",
};

export function renderRespawnControls(root: HTMLElement, host: EditorHost): void {
    const s = host.settings;
    root.append(sectionTitle("RESPAWN"));
    root.append(segmented(
        "Bots respawn",
        PracticeRespawnModes.map((m) => ({ value: m as PracticeRespawnMode, text: RespawnModeText[m] })),
        s.respawnMode,
        (v) => {
            s.respawnMode = v;
            host.changed();
        },
    ));
    if (s.respawnMode !== "off") {
        root.append(slider("Delay", s.respawnDelay, 0, PracticeMaxRespawnDelay, (v) => `${(v / 10).toFixed(1)} s`, (v) => {
            s.respawnDelay = v;
            host.changed();
        }));
    }
    if (host.respawnBotsNow) root.append(button("Respawn bots now", () => host.respawnBotsNow!()));
}

export function renderBotList(root: HTMLElement, host: EditorHost, onPick: (i: number) => void): void {
    const bots = host.settings.bots;
    root.append(sectionTitle(`BOTS (${bots.length} OF ${PracticeMaxBots})`));
    bots.forEach((bot, i) => {
        const b = el("button", { type: "button", class: "pe-bot", "aria-pressed": String(host.state.bot === i) });
        const icon = el("span", { class: "pe-slot-icon" });
        if (bot.gun && bot.gun !== PracticeRandomGun) icon.style.backgroundImage = `url(${itemIcon(bot.gun)})`;
        const text = el("span", { class: "pe-bot-text" });
        text.append(el("b", {}, `Bot ${i + 1}`), el("span", { class: "pe-muted" }, botSummary(bot)));
        b.append(icon, text);
        b.addEventListener("click", () => onPick(i));
        root.append(b);
    });
    if (bots.length < PracticeMaxBots) {
        root.append(button("+ Add bot", () => {
            bots.push(structuredClone(bots[bots.length - 1] ?? defaultPracticeBot()));
            host.state.bot = bots.length - 1;
            host.changed();
        }, "dashed"));
    }
    root.append(toggle("Edit all bots together", host.state.editAllBots, (v) => {
        host.state.editAllBots = v;
        if (v) for (let i = 0; i < bots.length; i++) bots[i] = structuredClone(bots[host.state.bot]);
        host.changed();
    }));
}

export function renderBotEditor(root: HTMLElement, host: EditorHost): void {
    const bots = host.settings.bots;
    const i = Math.min(host.state.bot, bots.length - 1);
    host.state.bot = i;
    const bot = bots[i];
    const edit = (fn: (b: PracticeBotSettings) => void) => editBot(host, i, fn);

    const head = el("div", { class: "pe-title-row" });
    head.append(sectionTitle(host.state.editAllBots ? "ALL BOTS · WEAPONS" : `BOT ${i + 1} · WEAPONS`));
    if (bots.length > 1) {
        head.append(button("Remove bot", () => {
            bots.splice(i, 1);
            host.state.bot = Math.max(0, i - 1);
            host.changed();
        }));
    }
    root.append(head);
    for (const slot of ["primary", "secondary"] as const) {
        const gun = slot === "primary" ? bot.gun : bot.secondary;
        const row = el("div", { class: "pe-weapon" });
        const icon = el("span", { class: "pe-slot-icon" });
        if (gun && gun !== PracticeRandomGun) icon.style.backgroundImage = `url(${itemIcon(gun)})`;
        row.append(el("span", { class: "pe-label" }, slot === "primary" ? "PRIMARY" : "SECONDARY"), icon, el("b", {}, itemName(gun)));
        row.append(button("Change", () => {
            host.state.gunTarget = { who: i, slot };
            host.state.gunGroup = "all";
            host.state.gunSearch = "";
            host.showSection("guns");
        }));
        root.append(row);
    }
    root.append(labeledRow("MELEE", select(`Bot ${i + 1} melee`, meleeOptions(), bot.melee, (v) => edit((b) => (b.melee = v)))));

    root.append(sectionTitle("SKILL"));
    const skill = practiceBotSkillOf(bot);
    root.append(segmented(
        "Skill",
        [
            ...(Object.keys(PracticeBotSkills) as PracticeBotSkill[]).map((k) => ({ value: k as string, text: PracticeBotSkillLabels[k] })),
            { value: "custom", text: "Custom" },
        ],
        skill,
        (v) => {
            if (v !== "custom") edit((b) => Object.assign(b, withPracticeBotSkill(b, v as PracticeBotSkill)));
        },
    ));
    root.append(slider("Accuracy", bot.accuracy, 0, 100, (v) => `${v}%`, (v) => edit((b) => (b.accuracy = v))));
    root.append(slider("Reaction time", bot.reaction, 0, PracticeMaxReaction, (v) => `${(v / 10).toFixed(1)} s`, (v) => edit((b) => (b.reaction = v))));
    root.append(slider("Wiggle", bot.wiggle, 0, PracticeSliderMax, String, (v) =>
        edit((b) => {
            b.wiggle = v;
            Object.assign(b, practiceWiggleToAdvanced(v));
        })));
    const advanced = el("details", { class: "pe-details" });
    advanced.append(
        el("summary", {}, `Advanced movement: strafe ${bot.strafe} · turns ${bot.turn} · dodge ${bot.dodge}`),
        slider("Strafe speed", bot.strafe, 0, PracticeSliderMax, String, (v) => edit((b) => (b.strafe = v))),
        slider("Direction change", bot.turn, 0, PracticeSliderMax, String, (v) => edit((b) => (b.turn = v))),
        slider("Aim dodging", bot.dodge, 0, PracticeSliderMax, String, (v) => edit((b) => (b.dodge = v))),
    );
    root.append(advanced);

    root.append(sectionTitle("TOUGHNESS"));
    root.append(slider("Health", bot.health, PracticeMinBotHealth, PracticeMaxBotHealth, String, (v) => edit((b) => (b.health = v))));
    root.append(labeledRow(
        "ARMOR",
        segmented(
            "Bot armor",
            Array.from({ length: PracticeMaxArmor + 1 }, (_, l) => ({ value: l, text: l ? `Lv ${l}` : "None" })),
            bot.armor,
            (v) => edit((b) => (b.armor = v)),
        ),
    ));
    root.append(toggle("Shoots back", bot.shootsBack, (v) => edit((b) => (b.shootsBack = v))));
    root.append(toggle("Quick switch", bot.quickSwitch, (v) => edit((b) => (b.quickSwitch = v))));
    root.append(toggle("Auto melee up close", bot.autoMelee, (v) => edit((b) => (b.autoMelee = v))));
}

/* ── Styles ───────────────────────────────────────────────────────────── */

/** Theme values for the two places the editor lives. */
/** Home screen: the Survivor Kit theme in specops-menu.css (mode color follows body[data-home-mode]). */
export const HomeTheme = `
  --pe-font: "Roboto Condensed", arial, sans-serif; --pe-text: var(--kit-text, #f2ead2); --pe-muted: var(--kit-muted, #b7ad8c);
  --pe-label: var(--kit-muted, #b7ad8c); --pe-tile: var(--kit-tile, #33332b); --pe-border: var(--kit-line, #4a4a3c);
  --pe-sel: var(--kit-mode, #e2ad35); --pe-sel-bg: rgba(226, 173, 53, 0.14); --pe-input: var(--kit-field, #11110e);
  --pe-btn: var(--kit-gray, #4a4a3c); --pe-btn-edge: var(--kit-gray-dark, #2c2c23); --pe-btn-text: var(--kit-text, #f2ead2);
  --pe-primary: var(--kit-mode, #e2ad35); --pe-primary-text: var(--kit-mode-text, #1b1606); --pe-primary-edge: var(--kit-mode-dark, #9b7417);
  --pe-notch: var(--kit-notch, none); --pe-radius: 3px;`;
export const GameTheme = `
  --pe-font: "Barlow Condensed", "Roboto Condensed", sans-serif; --pe-text: #e8ecef; --pe-muted: #a9b4bc; --pe-label: #a9b4bc;
  --pe-tile: #1a2127; --pe-border: #3a444c; --pe-sel: #6fbf73; --pe-sel-bg: #1c2a20;
  --pe-input: #232a30; --pe-btn-text: #e8ecef; --pe-primary: #3f7d44; --pe-primary-text: #ffffff; --pe-primary-edge: #2c5a30;`;

export const EditorCss = `
.pe { font-family: var(--pe-font); color: var(--pe-text); font-size: 16px; }
.pe button, .pe select, .pe input { font: inherit; color: inherit; }
.pe .pe-title { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: var(--pe-label); margin: 6px 0 2px; }
.pe .pe-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.pe .pe-label { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; color: var(--pe-label); }
.pe .pe-muted { color: var(--pe-muted); font-size: 14px; }
.pe .pe-btn { min-height: 40px; padding: 0 14px; border-radius: var(--pe-radius, 7px); cursor: pointer; background: var(--pe-btn, var(--pe-tile));
  border: 1px solid var(--pe-border); color: var(--pe-btn-text); font-weight: 700; clip-path: var(--pe-notch, none); }
.pe .pe-btn:disabled { opacity: 0.5; cursor: default; }
.pe .pe-btn-primary { background: var(--pe-primary); color: var(--pe-primary-text); border: 0; border-bottom: 4px solid var(--pe-primary-edge); }
.pe .pe-btn-dashed { background: transparent; border-style: dashed; width: 100%; clip-path: none; }
.pe .pe-btn:hover { filter: brightness(1.15); }
.pe select, .pe .pe-search { height: 40px; box-sizing: border-box; padding: 0 10px; border-radius: 6px; background: var(--pe-input); border: 1px solid var(--pe-border); color-scheme: dark; min-width: 0; }
.pe .pe-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.pe .pe-row > .pe-label { width: 84px; flex: none; }
.pe .pe-row > select, .pe .pe-row > .pe-seg { flex: 1; }
.pe .pe-row-icon { width: 30px; height: 30px; flex: none; background: center / contain no-repeat; }
.pe .pe-seg { display: flex; border: 1px solid var(--pe-border); border-radius: 8px; overflow: hidden; }
.pe .pe-seg button { flex: 1; min-height: 40px; white-space: nowrap; border: 0; border-left: 1px solid var(--pe-border); background: var(--pe-tile); cursor: pointer; padding: 0 6px; }
.pe .pe-seg button:first-child { border-left: 0; }
.pe .pe-seg button[aria-pressed=true] { background: var(--pe-primary); color: var(--pe-primary-text); font-weight: 700; }
.pe .pe-slider { margin: 6px 0; }
.pe .pe-slider-head { display: flex; justify-content: space-between; }
.pe .pe-slider input { width: 100%; accent-color: var(--pe-sel); margin: 2px 0; }
.pe .pe-val { font-variant-numeric: tabular-nums; }
.pe .pe-toggle { display: flex; align-items: center; gap: 10px; min-height: 40px; cursor: pointer; }
.pe .pe-toggle input { width: 18px; height: 18px; accent-color: var(--pe-sel); }
.pe .pe-slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.pe .pe-slot, .pe .pe-bot { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 0 12px; border-radius: 8px; background: var(--pe-tile); border: 1px solid var(--pe-border); cursor: pointer; text-align: left; width: 100%; box-sizing: border-box; margin-bottom: 6px; }
.pe .pe-slot[aria-pressed=true], .pe .pe-bot[aria-pressed=true], .pe .pe-tile[aria-pressed=true] { border: 2px solid var(--pe-sel); background: var(--pe-sel-bg); }
.pe .pe-slot-icon { width: 60px; height: 34px; flex: none; background: center / contain no-repeat; }
.pe .pe-bot-text { display: flex; flex-direction: column; min-width: 0; }
.pe .pe-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 10px 0; }
.pe .pe-chip { min-height: 34px; padding: 0 12px; border-radius: 999px; background: var(--pe-tile); border: 1px solid var(--pe-border); cursor: pointer; }
.pe .pe-chip[aria-pressed=true] { border-color: var(--pe-sel); background: var(--pe-sel-bg); }
.pe .pe-search { margin-left: auto; width: 170px; }
.pe .pe-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; max-height: 300px; overflow-y: auto; padding-right: 4px; }
.pe .pe-tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px; border-radius: 8px; background: var(--pe-tile); border: 1px solid var(--pe-border); cursor: pointer; }
.pe .pe-tile-icon { width: 84px; height: 42px; background: center / contain no-repeat; display: flex; align-items: center; justify-content: center; font-size: 24px; }
.pe .pe-badge { position: absolute; top: 4px; right: 4px; font-size: 12px; padding: 0 6px; border-radius: 999px; background: var(--pe-input); }
.pe .pe-detail { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: var(--pe-tile); border: 1px solid var(--pe-border); }
.pe .pe-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--pe-sel); background: var(--pe-sel-bg); }
.pe .pe-kit { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.pe .pe-kit-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px; border-radius: 8px; background: var(--pe-tile); border: 1px solid var(--pe-border); }
.pe .pe-kit-icon { width: 36px; height: 36px; background: center / contain no-repeat; }
.pe .pe-stepper { display: flex; align-items: center; gap: 6px; }
.pe .pe-stepper button { width: 34px; height: 34px; border-radius: 6px; background: var(--pe-input); border: 1px solid var(--pe-border); cursor: pointer; font-size: 18px; }
.pe .pe-stepper .pe-val { width: 26px; text-align: center; }
.pe .pe-weapon { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 10px; border-radius: 8px; background: var(--pe-tile); border: 1px solid var(--pe-border); margin: 6px 0; }
.pe .pe-weapon > .pe-label { width: 84px; }
.pe .pe-weapon > .pe-btn { margin-left: auto; }
.pe .pe-details { border-radius: 8px; background: var(--pe-tile); border: 1px solid var(--pe-border); padding: 0 10px; margin: 6px 0; }
.pe .pe-details summary { min-height: 40px; display: flex; align-items: center; cursor: pointer; color: var(--pe-muted); }
.pe .pe-bots { display: flex; flex-wrap: wrap; gap: 16px; }
.pe .pe-bots > .pe-bot-list { flex: 1 1 210px; min-width: 0; }
.pe .pe-bots > .pe-bot-editor { flex: 999 1 320px; min-width: 0; }
`;

export function ensureEditorCss(): void {
    if (document.getElementById("practice-editor-style")) return;
    const style = el("style", { id: "practice-editor-style" });
    style.textContent = EditorCss;
    document.head.appendChild(style);
}
