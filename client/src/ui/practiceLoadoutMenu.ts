import {
    activePracticeLoadout,
    addPracticeLoadout,
    cleanPracticeLoadoutName,
    defaultPracticeSettings,
    type PracticeLoadout,
    type PracticeLoadoutStore,
    PracticeLoadoutNameMax,
    PracticeMaxLoadouts,
    PracticePresets,
    type PracticeSettings,
    removePracticeLoadout,
    sanitizePracticeSettings,
} from "../../../shared/practice.ts";
import {
    botSummary,
    button,
    type EditorHost,
    type EditorState,
    el,
    ensureEditorCss,
    HomeTheme,
    itemIcon,
    itemName,
    newEditorState,
    renderBotEditor,
    renderBotList,
    renderGear,
    renderGuns,
    renderRespawnControls,
    RespawnModeText,
    sectionTitle,
} from "./practiceEditor.ts";
import { loadPracticeLoadouts, newPracticeLoadoutId, savePracticeLoadouts } from "./practiceLoadouts.ts";

export type LoadoutTab = "presets" | "guns" | "gear" | "bots";
const Tabs: Array<[LoadoutTab, string]> = [["presets", "Presets"], ["guns", "Guns"], ["gear", "Gear & kit"], ["bots", "Bots"]];

const Css = `
#practice-loadout-modal { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background: rgba(8, 8, 6, 0.72); }
#practice-loadout-modal .plm { ${HomeTheme} width: min(1120px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; box-sizing: border-box;
  border-radius: 4px; overflow: hidden; background: var(--kit-panel-solid, #1f1f1a); border: 1px solid var(--kit-gray-dark, #2c2c23); border-top: 3px solid var(--kit-gold, #e2ad35);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); }
#practice-loadout-modal .plm-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px 12px 24px; background: var(--kit-head, #2a2a22); }
#practice-loadout-modal .plm-name { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
#practice-loadout-modal .plm-name h2 { margin: 0; font-size: 26px; letter-spacing: 0.06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#practice-loadout-modal .plm-name input { height: 40px; font-size: 20px; width: 260px; padding: 0 10px; border-radius: 3px; background: var(--pe-input); border: 2px solid var(--pe-sel); }
#practice-loadout-modal .plm-link { background: none; border: 0; color: var(--pe-sel); cursor: pointer; text-decoration: underline; min-height: 40px; }
#practice-loadout-modal .plm-close { width: 44px; height: 44px; border-radius: 3px; background: none; border: 0; color: var(--pe-muted); cursor: pointer; font-size: 22px; }
#practice-loadout-modal .plm-tabs { display: flex; gap: 4px; padding: 0 24px; background: var(--kit-head, #2a2a22); border-bottom: 1px solid var(--pe-border); }
#practice-loadout-modal .plm-tabs button { min-height: 46px; padding: 0 20px; background: none; border: 0; color: var(--pe-muted); cursor: pointer; font-size: 17px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
#practice-loadout-modal .plm-tabs button[aria-selected=true] { color: var(--pe-text); box-shadow: inset 0 -3px 0 var(--pe-sel); }
#practice-loadout-modal .plm-body { flex: 1; min-height: 0; display: flex; }
#practice-loadout-modal .plm-main { flex: 1; min-width: 0; overflow-y: auto; padding: 16px 24px; }
#practice-loadout-modal .plm-side { width: 290px; flex: none; overflow-y: auto; padding: 16px 20px; border-left: 1px solid var(--pe-border); background: rgba(0, 0, 0, 0.18); }
#practice-loadout-modal .plm-sum { display: flex; align-items: center; gap: 10px; min-height: 40px; }
#practice-loadout-modal .plm-sum > .pe-label { width: 92px; flex: none; }
#practice-loadout-modal .plm-sum-icon { width: 44px; height: 28px; flex: none; background: center / contain no-repeat; }
#practice-loadout-modal .plm-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 24px; border-top: 1px solid var(--pe-border); background: var(--kit-head, #2a2a22); }
#practice-loadout-modal .plm-foot > div { display: flex; gap: 10px; align-items: center; }
#practice-loadout-modal .plm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-bottom: 14px; }
#practice-loadout-modal .plm-card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 3px; background: var(--pe-tile); box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.35); border: 2px solid transparent; }
#practice-loadout-modal .plm-card.is-open { border-color: var(--pe-sel); }
#practice-loadout-modal .plm-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; }
#practice-loadout-modal .plm-card-icons { display: flex; gap: 6px; height: 36px; }
#practice-loadout-modal .plm-card-icons span { width: 64px; height: 36px; background: center / contain no-repeat; }
#practice-loadout-modal .plm-card-actions { display: flex; gap: 8px; margin-top: auto; }
#practice-loadout-modal .plm-tag { font-size: 13px; padding: 2px 8px; border-radius: 10px; background: var(--pe-sel); color: var(--pe-primary-text); font-weight: 700; }
#practice-loadout-modal .plm-note { color: var(--pe-muted); }
`;

/**
 * Practice loadout screen on the home page (Survev's Loadout modal layout):
 * Presets / Guns / Gear & kit / Bots tabs, a summary of the open loadout, and
 * edits saved on this device as you make them.
 */
export class PracticeLoadoutMenu implements EditorHost {
    store: PracticeLoadoutStore = loadPracticeLoadouts();
    state: EditorState = newEditorState();
    private root?: HTMLDivElement;
    private tab: LoadoutTab = "guns";
    private renaming = false;
    private confirmDelete = "";
    private note = "";
    private readonly onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !this.renaming) this.close();
    };

    constructor(private readonly onClose: () => void) {}

    get loadout(): PracticeLoadout {
        return activePracticeLoadout(this.store)!;
    }

    get settings(): PracticeSettings {
        return this.loadout.settings;
    }

    get isOpen(): boolean {
        return !!this.root;
    }

    /** Opens the active loadout; creates Loadout 1 first when none is saved. */
    open(tab: LoadoutTab = "guns"): void {
        this.store = loadPracticeLoadouts();
        if (!activePracticeLoadout(this.store)) {
            addPracticeLoadout(this.store, defaultPracticeSettings(), newPracticeLoadoutId());
            savePracticeLoadouts(this.store);
            tab = "presets";
        }
        this.tab = tab;
        this.state = newEditorState();
        this.note = "";
        if (!document.getElementById("practice-loadout-style")) {
            const style = el("style", { id: "practice-loadout-style" });
            style.textContent = Css;
            document.head.appendChild(style);
        }
        ensureEditorCss();
        this.root?.remove();
        this.root = el("div", { id: "practice-loadout-modal", role: "dialog", "aria-modal": "true", "aria-label": "Practice loadout" });
        this.root.addEventListener("mousedown", (e) => {
            if (e.target === this.root) this.close();
        });
        document.body.appendChild(this.root);
        window.addEventListener("keydown", this.onKey);
        this.render();
    }

    close(): void {
        window.removeEventListener("keydown", this.onKey);
        this.root?.remove();
        this.root = undefined;
        this.onClose();
    }

    changed(): void {
        this.loadout.settings = sanitizePracticeSettings(this.settings);
        savePracticeLoadouts(this.store);
        this.render();
    }

    showSection(section: "guns" | "bots"): void {
        this.tab = section;
        this.render();
    }

    private render(): void {
        const root = this.root;
        if (!root) return;
        const scroll = root.querySelector(".plm-main")?.scrollTop ?? 0;
        root.innerHTML = "";
        const box = el("section", { class: "plm pe" });

        const head = el("header", { class: "plm-head" });
        const name = el("div", { class: "plm-name" });
        name.append(el("span", { class: "pe-label" }, "PRACTICE LOADOUT"));
        if (this.renaming) {
            const input = el("input", { maxlength: String(PracticeLoadoutNameMax), "aria-label": "Loadout name" });
            input.value = this.loadout.name;
            const done = () => {
                if (!this.renaming) return;
                this.renaming = false;
                this.loadout.name = cleanPracticeLoadoutName(input.value, this.loadout.name);
                savePracticeLoadouts(this.store);
                this.render();
            };
            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") done();
                if (e.key === "Escape") {
                    this.renaming = false;
                    this.render();
                }
            });
            input.addEventListener("blur", done);
            name.append(input);
            queueMicrotask(() => input.select());
        } else {
            name.append(el("h2", {}, this.loadout.name));
            const rename = el("button", { type: "button", class: "plm-link" }, "Rename");
            rename.addEventListener("click", () => {
                this.renaming = true;
                this.render();
            });
            name.append(rename);
        }
        const close = el("button", { type: "button", class: "plm-close", "aria-label": "Close" }, "✕");
        close.addEventListener("click", () => this.close());
        head.append(name, close);
        box.append(head);

        const tabs = el("nav", { class: "plm-tabs", role: "tablist", "aria-label": "Loadout sections" });
        for (const [id, label] of Tabs) {
            const b = el("button", { type: "button", role: "tab", "aria-selected": String(id === this.tab) }, label);
            b.addEventListener("click", () => {
                if (id === "guns" && this.state.gunTarget.who !== "you") this.state.gunTarget = { who: "you", slot: "primary" };
                this.tab = id;
                this.render();
            });
            tabs.append(b);
        }
        box.append(tabs);

        const body = el("div", { class: "plm-body" });
        const main = el("div", { class: "plm-main", role: "tabpanel" });
        if (this.tab === "presets") this.renderPresets(main);
        else if (this.tab === "guns") renderGuns(main, this);
        else if (this.tab === "gear") renderGear(main, this);
        else {
            const bots = el("div", { class: "pe-bots" });
            const list = el("div", { class: "pe-bot-list" });
            renderBotList(list, this, (i) => {
                this.state.bot = i;
                this.render();
            });
            renderRespawnControls(list, this);
            const editor = el("div", { class: "pe-bot-editor" });
            renderBotEditor(editor, this);
            bots.append(list, editor);
            main.append(bots);
        }
        body.append(main, this.renderSummary());
        box.append(body);

        const foot = el("footer", { class: "plm-foot" });
        const left = el("div");
        const full = this.store.loadouts.length >= PracticeMaxLoadouts;
        const saveNew = button("Save as new loadout", () => {
            const added = addPracticeLoadout(this.store, this.settings, newPracticeLoadoutId());
            if (added) {
                savePracticeLoadouts(this.store);
                this.note = `Saved as ${added.name}. You are now editing it.`;
            }
            this.render();
        });
        saveNew.disabled = full;
        if (full) saveNew.title = `Up to ${PracticeMaxLoadouts} loadouts`;
        left.append(saveNew);
        if (this.note) left.append(el("span", { class: "plm-note" }, this.note));
        const right = el("div");
        right.append(
            button("Reset to default", () => {
                this.loadout.settings = defaultPracticeSettings();
                this.note = `${this.loadout.name} reset to the default setup.`;
                this.changed();
            }),
            button("Done", () => this.close(), "primary"),
        );
        foot.append(left, right);
        box.append(foot);
        root.append(box);
        const newMain = root.querySelector(".plm-main");
        if (newMain) newMain.scrollTop = scroll;
    }

    private renderSummary(): HTMLElement {
        const s = this.settings;
        const side = el("aside", { class: "plm-side", "aria-label": "Summary" });
        side.append(sectionTitle("YOUR SETUP"));
        const row = (label: string, icon: string, text: string) => {
            const r = el("div", { class: "plm-sum" });
            r.append(el("span", { class: "pe-label" }, label));
            if (icon) {
                const i = el("span", { class: "plm-sum-icon" });
                i.style.backgroundImage = `url(${icon})`;
                r.append(i);
            }
            r.append(el("span", {}, text));
            side.append(r);
        };
        row("PRIMARY", itemIcon(s.primary), itemName(s.primary));
        row("SECONDARY", itemIcon(s.secondary), itemName(s.secondary));
        row("MELEE", "", itemName(s.kit.melee));
        const lv = (n: number) => (n ? `Lv ${n}` : "none");
        row("GEAR", "", `Helmet ${lv(s.kit.helmet)} · vest ${lv(s.kit.vest)} · pack ${s.kit.backpack} · ${s.kit.scope.replace("scope", "")}`);
        const kit = Object.entries(s.kit.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${itemName(k)}`);
        row("KIT", "", `${kit.length ? kit.join(", ") : "Nothing extra"}${s.kit.fillAmmo ? " · full ammo" : ""}`);
        side.append(el("div", { style: "height: 1px; background: var(--pe-border); margin: 10px 0" }));
        row("BOTS", "", `${s.bots.length} · ${botSummary(s.bots[0])}`);
        row("RESPAWN", "", s.respawnMode === "off" ? "By hand" : `${RespawnModeText[s.respawnMode]}, ${(s.respawnDelay / 10).toFixed(1)} s`);
        side.append(el("p", { class: "plm-note" }, "Saved on this device. Used the moment you spawn."));
        return side;
    }

    private renderPresets(root: HTMLElement): void {
        root.append(el("p", { class: "plm-note" }, "Open one of your loadouts, or copy a preset into the one you have open."));
        root.append(sectionTitle(`MY LOADOUTS (${this.store.loadouts.length} OF ${PracticeMaxLoadouts})`));
        const mine = el("div", { class: "plm-cards" });
        for (const l of this.store.loadouts) {
            const open = l.id === this.store.activeId;
            const card = el("div", { class: `plm-card${open ? " is-open" : ""}` });
            const head = el("div", { class: "plm-card-head" });
            head.append(el("span", {}, l.name));
            if (open) head.append(el("span", { class: "plm-tag" }, "Open"));
            card.append(head, this.cardIcons(l.settings), el("span", { class: "pe-muted" }, `${l.settings.bots.length} bot${l.settings.bots.length > 1 ? "s" : ""} · ${botSummary(l.settings.bots[0])}`));
            const actions = el("div", { class: "plm-card-actions" });
            if (!open) {
                actions.append(button("Open", () => {
                    this.store.activeId = l.id;
                    this.confirmDelete = "";
                    savePracticeLoadouts(this.store);
                    this.render();
                }));
            }
            const confirming = this.confirmDelete === l.id;
            actions.append(button(confirming ? "Delete for good" : "Delete", () => {
                if (!confirming) {
                    this.confirmDelete = l.id;
                    this.render();
                    return;
                }
                this.confirmDelete = "";
                removePracticeLoadout(this.store, l.id);
                if (!this.store.loadouts.length) {
                    addPracticeLoadout(this.store, defaultPracticeSettings(), newPracticeLoadoutId());
                }
                savePracticeLoadouts(this.store);
                this.render();
            }));
            card.append(actions);
            mine.append(card);
        }
        if (this.store.loadouts.length < PracticeMaxLoadouts) {
            const add = button("+ New loadout (default setup)", () => {
                addPracticeLoadout(this.store, defaultPracticeSettings(), newPracticeLoadoutId());
                savePracticeLoadouts(this.store);
                this.render();
            }, "dashed");
            mine.append(add);
        }
        root.append(mine);

        root.append(sectionTitle("PRESETS"));
        const presets = el("div", { class: "plm-cards" });
        for (const preset of PracticePresets) {
            const settings = preset.settings();
            const card = el("div", { class: "plm-card" });
            const head = el("div", { class: "plm-card-head" });
            head.append(el("span", {}, preset.name));
            card.append(head, this.cardIcons(settings), el("span", { class: "pe-muted" }, preset.description));
            const actions = el("div", { class: "plm-card-actions" });
            actions.append(button(`Use in ${this.loadout.name}`, () => {
                this.loadout.settings = preset.settings();
                this.note = `${this.loadout.name} now uses ${preset.name}.`;
                this.changed();
            }));
            card.append(actions);
            presets.append(card);
        }
        root.append(presets);
    }

    private cardIcons(s: PracticeSettings): HTMLElement {
        const icons = el("div", { class: "plm-card-icons", "aria-hidden": "true" });
        for (const gun of [s.primary, s.secondary]) {
            if (!gun) continue;
            const i = el("span");
            i.style.backgroundImage = `url(${itemIcon(gun)})`;
            icons.append(i);
        }
        return icons;
    }
}
