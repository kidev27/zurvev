import { GameObjectDefs } from "../../../shared/defs/register.ts";
import {
    activePracticeLoadout,
    addPracticeLoadout,
    emptyPracticeStats,
    PracticePlayerRespawnDelay,
    PracticePresets,
    type PracticeSettings,
    type PracticeStats,
    sanitizePracticeSettings,
} from "../../../shared/practice.ts";
import {
    button,
    type EditorHost,
    type EditorState,
    el,
    ensureEditorCss,
    GameTheme,
    itemIcon,
    itemName,
    newEditorState,
    renderBotEditor,
    renderBotList,
    renderGear,
    renderGuns,
    renderRespawnControls,
    renderTimingControls,
    sectionTitle,
} from "./practiceEditor.ts";
import {
    activePracticeSettings,
    loadAutoRespawn,
    loadPracticeLoadouts,
    newPracticeLoadoutId,
    saveAutoRespawn,
    savePracticeLoadouts,
} from "./practiceLoadouts.ts";

const Css = `
#practice-menu { ${GameTheme} position: absolute; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); box-sizing: border-box;
  display: none; flex-direction: column; background: rgba(16, 20, 24, 0.97); border-left: 1px solid #2f3940; z-index: 1000; pointer-events: auto;
  box-shadow: -12px 0 40px rgba(0,0,0,0.45); }
#practice-menu.is-open { display: flex; }
#practice-menu .pm-head { flex: none; padding: 12px 12px 10px 20px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid #2a3238; }
#practice-menu .pm-head-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#practice-menu h2 { margin: 0; font-size: 26px; }
#practice-menu .pm-close { width: 44px; height: 44px; border: 0; background: none; color: #c9d1d6; cursor: pointer; font-size: 22px; }
#practice-menu .pm-head select { flex: 1; }
#practice-menu .pm-tabs { flex: none; display: flex; padding: 0 12px; border-bottom: 1px solid #2a3238; }
#practice-menu .pm-tabs button { flex: 1; min-height: 46px; background: none; border: 0; color: #a9b4bc; cursor: pointer; font-size: 18px; }
#practice-menu .pm-tabs button[aria-selected=true] { color: #fff; font-weight: 700; box-shadow: inset 0 -3px 0 #6fbf73; }
#practice-menu .pm-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 20px; }
#practice-menu .pm-foot { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid #2a3238; background: #0c1013; }
#practice-menu .pm-changes { flex: 1; color: #f0cf7a; }
#practice-menu .pm-changes.is-none { color: #a9b4bc; }
#practice-menu .pm-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 56px; box-sizing: border-box; padding: 6px 12px; margin-bottom: 8px;
  border-radius: 8px; background: #1a2127; border: 1px solid #33404a; cursor: pointer; text-align: left; }
#practice-menu .pm-row.is-changed { border-color: #8a7330; }
#practice-menu .pm-row > .pe-label { width: 84px; flex: none; }
#practice-menu .pm-row-icon { width: 52px; height: 30px; flex: none; background: center / contain no-repeat; }
#practice-menu .pm-row-end { margin-left: auto; display: flex; align-items: center; gap: 8px; color: #a9b4bc; }
#practice-menu .pm-changed { font-size: 13px; padding: 1px 8px; border-radius: 999px; background: #3d3420; color: #f0cf7a; border: 1px solid #8a7330; }
#practice-menu .pm-back { margin-bottom: 10px; }
#practice-menu .pm-give { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
#practice-menu .pm-give select { flex: 1 1 200px; }
#practice-menu .pm-give input { width: 80px; height: 40px; box-sizing: border-box; padding: 0 8px; border-radius: 6px; background: #232a30; border: 1px solid #3a444c; }
#practice-respawn { ${GameTheme} position: absolute; inset: 0; z-index: 900; display: none; align-items: center; justify-content: center; background: rgba(8, 10, 12, 0.55); pointer-events: auto; }
#practice-respawn.is-open { display: flex; }
#practice-respawn .pr-card { width: min(500px, calc(100vw - 32px)); box-sizing: border-box; padding: 22px; border-radius: 12px;
  background: rgba(16, 20, 24, 0.97); border: 1px solid #2f3940; display: flex; flex-direction: column; gap: 12px; }
#practice-menu.is-open ~ #practice-respawn .pr-card { margin-right: 440px; }
#practice-respawn .pr-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
#practice-respawn h2 { margin: 0; font-size: 32px; }
#practice-respawn .pr-chip { font-size: 15px; padding: 3px 10px; border-radius: 999px; background: #1f2e3a; color: #a9d4f5; border: 1px solid #3f6a8a; }
#practice-respawn .pr-bar { display: flex; align-items: center; gap: 12px; }
#practice-respawn .pr-track { flex: 1; height: 6px; border-radius: 3px; background: #2b343b; overflow: hidden; }
#practice-respawn .pr-fill { height: 100%; background: #6fbf73; }
#practice-respawn .pr-fill.is-held { background: #6c7780; }
#practice-respawn .pr-status { color: #f0cf7a; }
#practice-respawn .pr-guns { display: flex; gap: 10px; }
#practice-respawn .pr-gun { flex: 1; min-height: 72px; border-radius: 8px; background: #1a2127; border: 1px solid #33404a; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
#practice-respawn .pr-gun span:first-child { width: 64px; height: 36px; background: center / contain no-repeat; }
#practice-respawn .pr-actions { display: flex; gap: 12px; }
#practice-respawn .pr-actions > * { flex: 1; }
#practice-stats {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.45); border-radius: 6px; padding: 4px 12px; color: #fff;
  font-family: "Barlow Condensed", "Roboto Condensed", sans-serif; font-size: 16px;
  white-space: nowrap; pointer-events: none; z-index: 20; display: none;
  text-shadow: 0 1px 2px #000;
}
#practice-stats.is-visible { display: block; }
#practice-menu.is-open ~ #practice-stats { left: calc(50% - 220px); }
#practice-stats .pm-hint { color: #9aa6ad; margin-left: 10px; }
body.ui-practice-mode #ui-specops-hud,
body.ui-practice-mode #ui-specops-phase,
body.ui-practice-mode #ui-specops-contract,
body.ui-practice-mode #ui-specops-shop,
body.ui-practice-mode #ui-specops-cash,
body.ui-practice-mode #ui-specops-buyback,
body.ui-practice-mode #ui-specops-support,
body.ui-practice-mode #ui-specops-wait {
  display: none !important;
}
`;

/** Item categories offered by "Spawn items and perks", in menu order. */
const GiveCategories: Array<[string, string]> = [
    ["gun", "Guns"],
    ["melee", "Melee"],
    ["throwable", "Throwables"],
    ["heal", "Healing"],
    ["boost", "Boosts"],
    ["ammo", "Ammo"],
    ["scope", "Scopes"],
    ["helmet", "Helmets"],
    ["chest", "Vests"],
    ["backpack", "Backpacks"],
    ["perk", "Perks"],
];

function itemLabel(type: string): string {
    const def = GameObjectDefs.typeToDefSafe(type) as { name?: string } | undefined;
    return def?.name ? `${def.name} (${type})` : type;
}

/** Every item you can give yourself, grouped by category. */
function giveItemGroups(): Array<{ label: string; items: string[] }> {
    const all = GameObjectDefs.getAllTypes().filter((type) => {
        const def = GameObjectDefs.typeToDefSafe(type);
        return !!def && "lootImg" in def && (def.type !== "gun" || !def.pressureBlast);
    });
    return GiveCategories.map(([cat, label]) => ({
        label,
        items: all.filter((type) => GameObjectDefs.typeToDefSafe(type)?.type === cat),
    })).filter((g) => g.items.length > 0);
}

type Tab = "loadout" | "bots" | "tools";
/** What the Loadout / Bots tab shows: its overview rows, or one editor section. */
type Section = "" | "guns" | "gear" | "bot";

/** The parts of a setup the Apply bar counts as separate changes. */
function changeGroups(s: PracticeSettings): string[] {
    const { melee, helmet, vest, backpack, scope, fillAmmo, counts } = s.kit;
    return [
        s.primary,
        s.secondary,
        melee,
        JSON.stringify([helmet, vest, backpack, scope]),
        JSON.stringify([fillAmmo, counts]),
        ...s.bots.map((b) => JSON.stringify(b)),
        `bots:${s.bots.length}`,
        JSON.stringify([s.respawnMode, s.respawnDelay]),
    ];
}

/**
 * Practice panel in a match (Tab): a drawer on the right with Loadout, Bots and
 * Tools. Matches start right away with the loadout picked on the home screen;
 * Apply sends changes and saves them to that loadout. When you die, a respawn
 * card lets you change guns; touching anything pauses the auto-respawn.
 */
export class PracticeMenu implements EditorHost {
    open = false;
    /** What the drawer is editing (sent with Apply). */
    settings: PracticeSettings = activePracticeSettings();
    state: EditorState = newEditorState();
    private applied: PracticeSettings = structuredClone(this.settings);
    private stats: PracticeStats = emptyPracticeStats();
    private root!: HTMLDivElement;
    private respawnRoot!: HTMLDivElement;
    private statsElem!: HTMLDivElement;
    private started = false;
    private dead = false;
    private diedAt = 0;
    /** Countdown left when the auto-respawn was paused (the bar stops there). */
    private heldLeft: number = PracticePlayerRespawnDelay;
    private held = false;
    private killedBy = "";
    private respawnTimer = 0;
    private respawnFill?: HTMLElement;
    private respawnStatus?: HTMLElement;
    private tab: Tab = "loadout";
    private section: Section = "";
    private giveItem = "";
    private giveCount = 1;
    private note = "";

    private readonly onKey = (e: KeyboardEvent) => {
        if (!this.dead || e.code !== "Space" || PracticeMenu.focusInField()) return;
        e.preventDefault();
        this.respawnNow();
    };

    constructor(
        private readonly send: (settings: PracticeSettings) => void,
        private readonly sendGive: (item: string, count: number, clear: boolean, respawnBots?: boolean) => void,
        private readonly sendRespawn: (hold: boolean, now: boolean) => void,
    ) {}

    init() {
        if (!document.getElementById("practice-menu-style")) {
            const style = el("style", { id: "practice-menu-style" });
            style.textContent = Css;
            document.head.appendChild(style);
        }
        ensureEditorCss();
        for (const id of ["practice-menu", "practice-respawn", "practice-stats"]) document.getElementById(id)?.remove();

        this.root = el("div", { id: "practice-menu", class: "pe", role: "dialog", "aria-label": "Practice" });
        this.respawnRoot = el("div", { id: "practice-respawn", class: "pe" });
        for (const node of [this.root, this.respawnRoot]) {
            // Keep clicks, scrolling and typing in the panel away from the game's input.
            node.addEventListener("mousedown", (e) => e.stopPropagation());
            node.addEventListener("wheel", (e) => e.stopPropagation());
            const stopKeys = (e: KeyboardEvent) => {
                if (e.keyCode === 9) return; // Tab still reaches the game to close the panel
                if ((e.target as HTMLElement).matches("input, select, textarea, button")) e.stopPropagation();
            };
            node.addEventListener("keydown", stopKeys);
            node.addEventListener("keyup", stopKeys);
            // Buttons shouldn't keep focus, or game keys would go to them.
            node.addEventListener("click", (e) => {
                const target = e.target as HTMLElement;
                if (target.tagName === "BUTTON" && e.detail > 0) target.blur();
            });
        }
        document.body.append(this.root, this.respawnRoot);
        this.statsElem = el("div", { id: "practice-stats" });
        document.body.appendChild(this.statsElem);
        document.body.classList.add("ui-practice-mode");
        window.addEventListener("keydown", this.onKey);

        // Start with the home-screen loadout right away; Tab opens the panel.
        this.settings = activePracticeSettings();
        this.applied = structuredClone(this.settings);
        this.send(this.settings);
        this.started = true;
        this.dead = false;
        this.stats = emptyPracticeStats();
        this.renderStats();
        this.statsElem.classList.add("is-visible");
    }

    destroy() {
        window.removeEventListener("keydown", this.onKey);
        window.clearInterval(this.respawnTimer);
        this.root?.remove();
        this.respawnRoot?.remove();
        this.statsElem?.remove();
        document.body.classList.remove("ui-practice-mode");
        this.open = false;
    }

    toggle() {
        if (this.open) this.hide();
        else this.show();
    }

    show() {
        this.open = true;
        this.root.classList.add("is-open");
        this.render();
        if (this.dead) this.hold();
    }

    hide() {
        this.open = false;
        this.root.classList.remove("is-open");
    }

    setStats(stats: PracticeStats) {
        this.stats = stats;
        this.renderStats();
    }

    /** Who killed you, for the respawn card. */
    setKilledBy(text: string) {
        this.killedBy = text;
        if (this.dead) this.renderRespawn();
    }

    /** True if a key press should not drive the game (typing in a field). */
    static focusInField(): boolean {
        const active = document.activeElement;
        return !!active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)
            && !(active instanceof HTMLInputElement && active.type === "range");
    }

    /** Called every frame with whether the local player is dead. */
    setDead(dead: boolean) {
        if (dead === this.dead) return;
        this.dead = dead;
        window.clearInterval(this.respawnTimer);
        if (dead) {
            this.diedAt = performance.now();
            this.heldLeft = PracticePlayerRespawnDelay;
            this.held = false;
            if (!loadAutoRespawn()) this.hold();
            this.respawnTimer = window.setInterval(() => this.updateRespawnBar(), 200);
            this.respawnRoot.classList.add("is-open");
            this.renderRespawn();
        } else {
            this.held = false;
            this.killedBy = "";
            this.respawnRoot.classList.remove("is-open");
            if (this.open) this.hide();
        }
    }

    /* ── EditorHost ───────────────────────────────────────────────────── */

    changed(): void {
        this.render();
        if (this.dead) {
            this.hold();
            this.renderRespawn();
        }
    }

    showSection(section: "guns" | "bots"): void {
        if (section === "guns") {
            this.section = "guns";
        } else {
            this.tab = "bots";
            this.section = "bot";
        }
        this.render();
    }

    respawnBotsNow(): void {
        this.sendGive("", 1, false, true);
    }

    /* ── Apply / respawn ──────────────────────────────────────────────── */

    private get changeCount(): number {
        const now = changeGroups(this.settings);
        const before = changeGroups(this.applied);
        const n = Math.max(now.length, before.length);
        let count = 0;
        for (let i = 0; i < n; i++) if (now[i] !== before[i]) count++;
        return count;
    }

    /** Send the setup and save it to the loadout picked on the home screen. */
    private apply() {
        this.settings = sanitizePracticeSettings(this.settings);
        this.send(this.settings);
        this.applied = structuredClone(this.settings);
        const store = loadPracticeLoadouts();
        const active = activePracticeLoadout(store);
        if (active) active.settings = structuredClone(this.settings);
        else addPracticeLoadout(store, this.settings, newPracticeLoadoutId());
        savePracticeLoadouts(store);
        this.note = "";
        if (this.dead) this.render();
        else this.hide();
    }

    /** Pause the auto-respawn: you are changing your loadout. */
    private hold() {
        if (!this.dead || this.held) return;
        this.held = true;
        this.sendRespawn(true, false);
        this.renderRespawn();
    }

    private respawnNow() {
        if (!this.dead) return;
        if (this.changeCount > 0) this.apply();
        this.sendRespawn(false, true);
    }

    /* ── Rendering ────────────────────────────────────────────────────── */

    private renderStats() {
        if (!this.statsElem) return;
        const st = this.stats;
        const acc = st.shotsFired > 0 ? Math.round((st.shotsHit / st.shotsFired) * 100) : 0;
        const ttk = (ms: number) => (ms > 0 ? `${(ms / 1000).toFixed(2)}s` : "—");
        this.statsElem.innerHTML = "";
        this.statsElem.append(
            `Bots ${st.botsAlive}/${st.botsTotal} · K ${st.kills} / D ${st.deaths} · Acc ${acc}%`
                + ` · Dmg ${st.damageDealt} dealt / ${st.damageTaken} taken`
                + ` · TTK ${ttk(st.ttkAvgMs)} (best ${ttk(st.ttkBestMs)})`,
            el("span", { class: "pm-hint" }, "Tab: practice menu"),
        );
    }

    private openEditor(tab: Tab, section: Section) {
        this.tab = tab;
        this.section = section;
        if (!this.open) this.show();
        else this.render();
        if (this.dead) this.hold();
    }

    private render() {
        if (!this.open) return;
        const root = this.root;
        const scroll = root.querySelector(".pm-body")?.scrollTop ?? 0;
        root.innerHTML = "";

        const head = el("header", { class: "pm-head" });
        const top = el("div", { class: "pm-head-row" });
        top.append(el("h2", {}, "Practice"));
        const close = el("button", { type: "button", class: "pm-close", "aria-label": "Close" }, "✕");
        close.addEventListener("click", () => this.hide());
        top.append(close);
        head.append(top, this.renderLoadoutPicker());
        root.append(head);

        const tabs = el("nav", { class: "pm-tabs", role: "tablist", "aria-label": "Practice sections" });
        for (const [id, label] of [["loadout", "Loadout"], ["bots", "Bots"], ["tools", "Tools"]] as const) {
            const b = el("button", { type: "button", role: "tab", "aria-selected": String(this.tab === id) }, label);
            b.addEventListener("click", () => {
                this.tab = id;
                this.section = "";
                this.render();
            });
            tabs.append(b);
        }
        root.append(tabs);

        const body = el("div", { class: "pm-body", role: "tabpanel" });
        if (this.section) {
            const back = button("← Back", () => {
                this.section = "";
                this.state.gunTarget = { who: "you", slot: "primary" };
                this.render();
            });
            back.classList.add("pm-back");
            body.append(back);
        }
        if (this.section === "guns") renderGuns(body, this);
        else if (this.section === "gear") renderGear(body, this);
        else if (this.section === "bot") renderBotEditor(body, this);
        else if (this.tab === "loadout") this.renderLoadoutRows(body);
        else if (this.tab === "bots") {
            renderBotList(body, this, (i) => {
                this.state.bot = i;
                this.section = "bot";
                this.render();
            });
            renderRespawnControls(body, this);
            renderTimingControls(body, this);
            body.append(el("p", { class: "pe-muted" }, "Bots restart only when their own settings change."));
        } else this.renderTools(body);
        root.append(body);

        const foot = el("footer", { class: "pm-foot" });
        const n = this.changeCount;
        foot.append(el("span", { class: `pm-changes${n ? "" : " is-none"}` }, this.note || (n ? `${n} change${n > 1 ? "s" : ""}` : "No changes")));
        foot.append(button("Close", () => this.hide()));
        const apply = button("Apply", () => this.apply(), "primary");
        apply.disabled = n === 0;
        foot.append(apply);
        root.append(foot);
        const newBody = root.querySelector(".pm-body");
        if (newBody) newBody.scrollTop = scroll;
    }

    /** Header picker: switch to another saved loadout, or copy a preset in. */
    private renderLoadoutPicker(): HTMLElement {
        const store = loadPracticeLoadouts();
        const row = el("div", { class: "pm-head-row" });
        row.append(el("span", { class: "pe-label" }, "LOADOUT"));
        const select = el("select", { "aria-label": "Loadout" });
        if (store.loadouts.length) {
            const mine = el("optgroup", { label: "My loadouts" });
            for (const l of store.loadouts) mine.append(el("option", { value: `l:${l.id}` }, l.name));
            select.append(mine);
        } else {
            select.append(el("option", { value: "" }, "Default setup"));
        }
        const presets = el("optgroup", { label: "Copy a preset in" });
        for (const p of PracticePresets) presets.append(el("option", { value: `p:${p.id}` }, p.name));
        select.append(presets);
        select.value = store.activeId ? `l:${store.activeId}` : "";
        select.addEventListener("change", () => {
            const [kind, id] = [select.value.slice(0, 2), select.value.slice(2)];
            if (kind === "l:") {
                store.activeId = id;
                savePracticeLoadouts(store);
                this.settings = structuredClone(activePracticeLoadout(store)!.settings);
                this.note = "Switched loadout. Apply to use it.";
            } else if (kind === "p:") {
                const preset = PracticePresets.find((p) => p.id === id);
                if (preset) {
                    this.settings = preset.settings();
                    this.note = `${preset.name} copied in. Apply to use and save it.`;
                }
            }
            this.changed();
        });
        row.append(select);
        return row;
    }

    private renderLoadoutRows(body: HTMLElement) {
        const s = this.settings;
        const a = this.applied;
        body.append(sectionTitle("YOUR LOADOUT"));
        const row = (label: string, icons: string[], text: string, changed: boolean, onOpen: () => void) => {
            const r = el("button", { type: "button", class: `pm-row${changed ? " is-changed" : ""}` });
            r.append(el("span", { class: "pe-label" }, label));
            for (const icon of icons) {
                const i = el("span", { class: "pm-row-icon" });
                i.style.backgroundImage = `url(${icon})`;
                r.append(i);
            }
            r.append(el("span", {}, text));
            const end = el("span", { class: "pm-row-end" });
            if (changed) end.append(el("span", { class: "pm-changed" }, "Changed"));
            end.append("›");
            r.append(end);
            r.addEventListener("click", onOpen);
            body.append(r);
        };
        const gun = (slot: "primary" | "secondary") => () => {
            this.state.gunTarget = { who: "you", slot };
            this.openEditor("loadout", "guns");
        };
        row("PRIMARY", s.primary ? [itemIcon(s.primary)] : [], itemName(s.primary), s.primary !== a.primary, gun("primary"));
        row("SECONDARY", s.secondary ? [itemIcon(s.secondary)] : [], itemName(s.secondary), s.secondary !== a.secondary, gun("secondary"));
        const gear = () => this.openEditor("loadout", "gear");
        row("MELEE", [], itemName(s.kit.melee), s.kit.melee !== a.kit.melee, gear);
        const k = s.kit;
        const lv = (n: number) => (n ? `Lv ${n}` : "none");
        row(
            "GEAR",
            [],
            `Helmet ${lv(k.helmet)} · vest ${lv(k.vest)} · pack ${k.backpack} · ${k.scope.replace("scope", "")}`,
            JSON.stringify([k.helmet, k.vest, k.backpack, k.scope]) !== JSON.stringify([a.kit.helmet, a.kit.vest, a.kit.backpack, a.kit.scope]),
            gear,
        );
        const kit = Object.entries(k.counts).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${itemName(t)}`);
        row(
            "KIT",
            [],
            `${kit.length ? kit.join(", ") : "Nothing extra"}${k.fillAmmo ? " · full ammo" : ""}`,
            JSON.stringify([k.fillAmmo, k.counts]) !== JSON.stringify([a.kit.fillAmmo, a.kit.counts]),
            gear,
        );
        body.append(el("p", { class: "pe-muted" }, "Your new loadout is given when you press Apply, and saved to the loadout picked above."));
    }

    private renderTools(body: HTMLElement) {
        body.append(sectionTitle("SPAWN ITEMS AND PERKS"));
        body.append(el("p", { class: "pe-muted" }, "Drops a pickup next to you. Walk over it to take it. Perks work the same way."));
        const row = el("div", { class: "pm-give" });
        const select = el("select", { "aria-label": "Item to spawn" });
        for (const group of giveItemGroups()) {
            const optgroup = el("optgroup", { label: group.label });
            for (const type of group.items) optgroup.append(el("option", { value: type }, itemLabel(type)));
            select.append(optgroup);
        }
        if (this.giveItem) select.value = this.giveItem;
        this.giveItem = select.value;
        const count = el("input", { type: "number", min: "1", max: "999", step: "1", "aria-label": "How many" });
        const syncCount = () => {
            const type = GameObjectDefs.typeToDefSafe(this.giveItem)?.type;
            count.disabled = !type || !["ammo", "heal", "boost", "throwable"].includes(type);
            if (count.disabled) this.giveCount = 1;
            count.value = String(this.giveCount);
        };
        select.addEventListener("change", () => {
            this.giveItem = select.value;
            syncCount();
        });
        syncCount();
        count.addEventListener("change", () => {
            this.giveCount = Math.max(1, Math.min(999, Math.round(Number(count.value) || 1)));
            count.value = String(this.giveCount);
        });
        row.append(select, count, button("Spawn on ground", () => this.sendGive(this.giveItem, this.giveCount, false), "primary"));
        body.append(row);
        body.append(sectionTitle("INVENTORY"));
        body.append(button("Clear inventory", () => this.sendGive("", 1, true)));
        body.append(el("p", { class: "pe-muted" }, "Empties every slot, gear and your bag. Leaves fists and a 1x scope."));
        body.append(sectionTitle("BOTS"));
        body.append(button("Respawn bots now", () => this.respawnBotsNow()));
        body.append(el("p", { class: "pe-muted" }, "These act right away. They don't need Apply."));
    }

    private renderRespawn() {
        if (!this.dead) return;
        const root = this.respawnRoot;
        root.innerHTML = "";
        const card = el("section", { class: "pr-card", "aria-label": "Respawn" });
        const top = el("div", { class: "pr-top" });
        top.append(el("h2", {}, "You died"), el("span", { class: "pr-chip" }, "Bots paused"));
        card.append(top);

        const auto = loadAutoRespawn();
        const bar = el("div", { class: "pr-bar" });
        const track = el("div", { class: "pr-track" });
        this.respawnFill = el("div", { class: "pr-fill" });
        this.respawnStatus = el("span", { class: "pr-status" });
        track.append(this.respawnFill);
        bar.append(track, this.respawnStatus);
        card.append(bar);
        if (this.killedBy) card.append(el("div", { class: "pe-muted" }, this.killedBy));

        card.append(sectionTitle("RESPAWN WITH"));
        const guns = el("div", { class: "pr-guns" });
        for (const slot of ["primary", "secondary"] as const) {
            const gun = slot === "primary" ? this.settings.primary : this.settings.secondary;
            const b = el("button", { type: "button", class: "pr-gun" });
            const icon = el("span");
            if (gun) icon.style.backgroundImage = `url(${itemIcon(gun)})`;
            b.append(icon, el("span", {}, `${itemName(gun)} · change`));
            b.addEventListener("click", () => {
                this.state.gunTarget = { who: "you", slot };
                this.openEditor("loadout", "guns");
            });
            guns.append(b);
        }
        card.append(guns);
        const actions = el("div", { class: "pr-actions" });
        actions.append(
            button("Edit full loadout", () => this.openEditor("loadout", "")),
            button("Respawn (Space)", () => this.respawnNow(), "primary"),
        );
        card.append(actions);
        const autoRow = el("label", { class: "pe-toggle" });
        const box = el("input", { type: "checkbox" });
        box.checked = auto;
        box.addEventListener("change", () => {
            saveAutoRespawn(box.checked);
            if (!box.checked) this.hold();
            this.renderRespawn();
        });
        autoRow.append(box, `Auto-respawn after ${PracticePlayerRespawnDelay} s if I don't touch anything`);
        card.append(autoRow);
        card.append(el("p", { class: "pe-muted" }, "While you're down, bots freeze and dead bots wait. When you respawn, they start over with you."));
        root.append(card);
        this.updateRespawnBar();
    }

    /** Countdown bar and text only, so the card's buttons are never replaced mid-click. */
    private updateRespawnBar() {
        if (!this.dead || !this.respawnFill || !this.respawnStatus) return;
        if (!this.held) this.heldLeft = Math.max(0, PracticePlayerRespawnDelay - (performance.now() - this.diedAt) / 1000);
        const left = this.heldLeft;
        this.respawnFill.classList.toggle("is-held", this.held);
        this.respawnFill.style.width = `${Math.round((1 - left / PracticePlayerRespawnDelay) * 100)}%`;
        this.respawnStatus.textContent = this.held
            ? (loadAutoRespawn() ? "Auto-respawn paused: you're editing" : "Waiting for you")
            : `Respawning in ${Math.ceil(left)}`;
    }
}
