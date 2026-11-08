import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Exercise the real lobby handlers and render path without sockets or a browser.
const dom = vi.hoisted(() => {
    class Element {
        value = "";
        properties: Record<string, unknown> = {};
        styles: Record<string, unknown> = {};
        attributes: Record<string, string> = {};
        classes = new Set<string>();
        handlers: Record<string, (() => void)[]> = {};
        options: { value: string }[] = [];
        length = 1;

        on(event: string, callback: () => void) {
            (this.handlers[event] ??= []).push(callback);
            return this;
        }
        trigger(event: string) {
            for (const callback of this.handlers[event] ?? []) callback();
            return this;
        }
        val(): string;
        val(value: string): this;
        val(value?: string) {
            if (value === undefined) return this.value;
            this.value = value;
            return this;
        }
        prop(name: string): unknown;
        prop(name: string, value: unknown): this;
        prop(name: string, value?: unknown) {
            if (arguments.length === 1) return this.properties[name];
            this.properties[name] = value;
            return this;
        }
        attr(name: string): string;
        attr(name: string, value: string): this;
        attr(name: string, value?: string) {
            if (value === undefined) return this.attributes[name] || "";
            this.attributes[name] = value;
            return this;
        }
        css(name: string | Record<string, unknown>, value?: unknown) {
            if (typeof name === "string") this.styles[name] = value;
            else Object.assign(this.styles, name);
            return this;
        }
        addClass(names: string) {
            for (const name of names.split(" ")) this.classes.add(name);
            return this;
        }
        removeClass(names: string) {
            for (const name of names.split(" ")) this.classes.delete(name);
            return this;
        }
        toggleClass(name: string, enabled: boolean) {
            if (enabled) this.classes.add(name);
            else this.classes.delete(name);
            return this;
        }
        find() {
            return this;
        }
        toArray() {
            return this.options;
        }
        each() {
            return this;
        }
        empty() {
            return this;
        }
        append() {
            return this;
        }
        html() {
            return this;
        }
        text() {
            return this;
        }
        hide() {
            return this;
        }
    }
    const elements = new Map<string, Element>();
    const get = (selector: string) => {
        if (!elements.has(selector)) elements.set(selector, new Element());
        return elements.get(selector)!;
    };
    return { get, elements };
});

vi.mock("jquery", () => ({ default: dom.get }));
vi.mock("../../client/src/api.ts", () => ({ api: {} }));
vi.mock("../../client/src/device.ts", () => ({ device: { mobile: false } }));
vi.mock("../../client/src/errorLogs.ts", () => ({ errorLogManager: {} }));
vi.mock("../../client/src/helpers.ts", () => ({
    helpers: { htmlEscape: (value: string) => value },
}));
vi.mock("../../client/src/matchRejoin.ts", () => ({
    clearTeamLobbySession: vi.fn(),
    getActiveMatchSession: vi.fn(),
    getRejoinSession: vi.fn(),
    saveTeamLobbySession: vi.fn(),
}));
vi.mock("../../client/src/sdk/sdk.ts", () => ({
    SDK: { showInviteButton: vi.fn(), supportsInviteLink: () => false },
}));
vi.mock("../../client/src/siteInfo.ts", () => ({
    resolveServerId: (id: string) => id || "local",
}));

import { TeamMenu } from "../../client/src/ui/teamMenu.ts";
import { FireteamMapPool, ZombieMapPool } from "../../shared/defs/maps/specOpsDefs.ts";

beforeEach(() => {
    vi.useFakeTimers();
    dom.elements.clear();
    const browser = { location: { href: "https://example.com/" } };
    vi.stubGlobal("window", Object.assign(browser, { top: browser }));
    vi.stubGlobal("document", { hasFocus: () => true });
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function lobby(mapName = "specops_outdoor", endless = false, isLeader = true) {
    const settings: Record<string, unknown> = { teamEndless: endless };
    const config = {
        get: vi.fn((key: string) => settings[key]),
        set: vi.fn((key: string, value: unknown) => {
            settings[key] = value;
        }),
    };
    const menu = new TeamMenu(
        config as never,
        {} as never,
        { info: {}, getGameModeStyles: () => [] } as never,
        { translate: (key: string) => key } as never,
        {} as never,
        vi.fn(),
        vi.fn(),
    );
    menu.active = true;
    menu.joined = true;
    menu.isLeader = isLeader;
    menu.roomData = {
        roomUrl: "",
        region: "local",
        mapName,
        difficulty: "regular",
        endless,
        gameModeIdx: 0,
        enabledGameModeIdxs: [0, 1, 2],
        autoFill: false,
        squadSize: 4,
        squadName: "",
        maxPlayers: 2,
        findingGame: false,
        lastError: undefined,
        captchaEnabled: false,
    };
    dom.get("#team-map-select").options = ["random", ...FireteamMapPool, ...ZombieMapPool]
        .map((value) => ({ value }));
    vi.spyOn(menu, "ensureMapSelectOptions").mockImplementation(() => {});
    vi.spyOn(menu, "ensureSquadSizeSelectOptions").mockImplementation(() => {});
    const send = vi.spyOn(menu, "sendMessage").mockImplementation(() => {});
    menu.refreshUi();
    return { menu, config, settings, send };
}

test.each(ZombieMapPool.flatMap((map) => [false, true].map((endless) => [map, endless] as const)))(
    "%s hides wave controls and preserves the Fireteam choice (%s) when switching back",
    (map, endless) => {
        const { config, settings, send } = lobby("specops_outdoor", endless);
        const select = dom.get("#team-map-select");
        dom.get("#btn-team-wave-wait").addClass("menu-gamepad-focus");
        const blur = vi.fn();
        dom.get("#btn-team-wave-wait").on("blur", blur);
        select.val(map).trigger("change");
        expect(dom.get("#team-wave-mode-field").styles.display).toBe("none");
        expect(dom.get("#team-endless-toggle").properties.disabled).toBe(true);
        for (const id of ["#btn-team-wave-wait", "#btn-team-wave-continuous"]) {
            expect(dom.get(id).attributes.tabindex).toBe("-1");
            expect(dom.get(id).attributes["aria-disabled"]).toBe("true");
            expect(dom.get(id).classes.has("menu-gamepad-focus")).toBe(false);
            dom.get(id).trigger("click");
        }
        expect(blur).toHaveBeenCalled();
        expect(config.set).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledTimes(1);
        expect(settings.teamEndless).toBe(endless);
        select.val("specops_outdoor").trigger("change");
        expect(dom.get("#team-wave-mode-field").styles.display).toBe("flex");
        expect(dom.get("#team-endless-toggle").properties).toMatchObject({ disabled: false, checked: endless });
        expect(dom.get(endless ? "#btn-team-wave-continuous" : "#btn-team-wave-wait").classes.has("is-active"))
            .toBe(true);
        expect(config.set).not.toHaveBeenCalled();
    },
);

test("Fireteam wave buttons still save and send both choices", () => {
    const { config, menu, send } = lobby();
    dom.get("#btn-team-wave-continuous").trigger("click");
    expect(menu.roomData.endless).toBe(true);
    expect(config.set).toHaveBeenLastCalledWith("teamEndless", true);
    expect(send).toHaveBeenLastCalledWith("setRoomProps", expect.objectContaining({ endless: true }));
    dom.get("#btn-team-wave-wait").trigger("click");
    expect(menu.roomData.endless).toBe(false);
    expect(config.set).toHaveBeenLastCalledWith("teamEndless", false);
    expect(send).toHaveBeenLastCalledWith("setRoomProps", expect.objectContaining({ endless: false }));
});

test.each(ZombieMapPool)("a fresh %s lobby hides the field before joining", (map) => {
    const { menu, config } = lobby(map, true);
    menu.joined = false;
    menu.refreshUi();
    expect(dom.get("#team-wave-mode-field").styles.display).toBe("none");
    expect(dom.get("#team-endless-toggle").properties.checked).toBe(true);
    expect(config.set).not.toHaveBeenCalled();
});

test("teammate state updates and reconnects follow the host's map without echoing settings", () => {
    const { menu, config, send } = lobby("specops_outdoor", true, false);
    for (const mapName of [...ZombieMapPool, "specops_outdoor"]) {
        const room = { ...menu.roomData, mapName, endless: true };
        menu.onMessage("state", {
            room,
            localPlayerId: 2,
            players: [{ playerId: 2, name: "Teammate", isLeader: false, inGame: false }],
        });
        expect(dom.get("#team-wave-mode-field").styles.display)
            .toBe(mapName === "specops_outdoor" ? "flex" : "none");
        expect(dom.get("#team-endless-toggle").properties).toMatchObject({ disabled: true, checked: true });
        dom.get("#btn-team-wave-wait").trigger("click");
    }
    expect(config.set).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
});

test("a stale host broadcast cannot reveal wave controls after switching to Zombies", () => {
    const { menu, config } = lobby("specops_outdoor", true);
    const staleRoom = { ...menu.roomData };
    dom.get("#team-map-select").val("specops_complex").trigger("change");
    menu.onMessage("state", {
        room: staleRoom,
        localPlayerId: 1,
        players: [{ playerId: 1, name: "Host", isLeader: true, inGame: false }],
    });
    expect(menu.roomData.mapName).toBe("specops_complex");
    expect(dom.get("#team-wave-mode-field").styles.display).toBe("none");
    expect(dom.get("#team-endless-toggle").properties.checked).toBe(true);
    expect(config.set).not.toHaveBeenCalled();
});
