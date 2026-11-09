import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
    COMMUNITY_ANNOUNCEMENT_SNOOZE_MS,
    COMMUNITY_ANNOUNCEMENT_VERSION,
    COMMUNITY_DISCORD_URL,
} from "../../client/src/graphicsQuality.ts";
import { setupCommunityAnnouncement } from "../../client/src/ui/communityAnnouncement.ts";

type KeyEvent = {
    key?: string;
    shiftKey?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
};

let focused: ElementStub | null;
class ElementStub {
    href = "about:blank";
    visible = false;
    controls: ElementStub[] = [];
    listeners = new Map<string, ((event: KeyEvent) => void)[]>();

    addEventListener(type: string, callback: (event: KeyEvent) => void) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(callback);
        this.listeners.set(type, listeners);
    }
    emit(type: string, fields: Partial<KeyEvent> = {}) {
        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ...fields };
        for (const listener of this.listeners.get(type) || []) listener(event);
        return event;
    }
    focus() {
        focused = this;
    }
    querySelectorAll() {
        return this.controls;
    }
    getClientRects() {
        return this.visible ? [1] : [];
    }
}

function fixture() {
    const dialog = new ElementStub();
    const join = new ElementStub();
    const close = new ElementStub();
    const snooze = new ElementStub();
    const corner = new ElementStub();
    const opener = new ElementStub();
    const footer = new ElementStub();
    const otherDialog = new ElementStub();
    dialog.controls = [corner, join, close, snooze];
    focused = opener;
    const elements = new Map([
        ["modal-community-announce", dialog],
        ["btn-community-announce-discord", join],
        ["btn-community-announce-close", close],
        ["btn-community-announce-snooze", snooze],
    ]);
    const session = new Map<string, string>();
    vi.stubGlobal("HTMLElement", ElementStub);
    vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => session.get(key) ?? null,
        setItem: (key: string, value: string) => session.set(key, value),
    });
    vi.stubGlobal("document", {
        get activeElement() {
            return focused;
        },
        getElementById: (id: string) => elements.get(id),
        querySelectorAll: (selector: string) => selector === "a[data-community-discord]"
            ? [footer, join]
            : [dialog, otherDialog],
    });
    const values: Record<string, number> = {};
    const config = {
        get: (key: string) => values[key],
        set: vi.fn((key: string, value: number) => {
            values[key] = value;
        }),
    };
    let show = () => {};
    let hide = () => {};
    const modal = {
        onShow: (fn: () => void) => {
            show = fn;
        },
        onHide: (fn: () => void) => {
            hide = fn;
        },
        show: vi.fn(() => {
            dialog.visible = true;
            show();
        }),
        hide: vi.fn(() => {
            if (!dialog.visible) return;
            dialog.visible = false;
            hide();
        }),
    };
    const start = (active = true) => setupCommunityAnnouncement(modal, config, () => active);
    return { dialog, join, close, snooze, corner, opener, footer, otherDialog, session, values, config, modal, start };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

test("the invite opens after the menu delay and focuses its Discord action", () => {
    const f = fixture();
    f.start();
    expect(f.footer.href).toBe(COMMUNITY_DISCORD_URL);
    expect(f.join.href).toBe(COMMUNITY_DISCORD_URL);
    vi.advanceTimersByTime(599);
    expect(f.modal.show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.modal.show).toHaveBeenCalledWith(true);
    expect(focused).toBe(f.join);
});

test.each(["close", "join"] as const)("%s dismisses for this session without a 14-day snooze", (action) => {
    const f = fixture();
    f.start();
    vi.advanceTimersByTime(600);
    const event = f[action].emit("click");
    expect(f.dialog.visible).toBe(false);
    expect(focused).toBe(f.opener);
    expect(f.session.get(`specops_announce_session_${COMMUNITY_ANNOUNCEMENT_VERSION}`)).toBe("1");
    expect(f.config.set).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    f.start();
    vi.advanceTimersByTime(600);
    expect(f.modal.show).toHaveBeenCalledTimes(1);
});

test("snooze stores 14 days and the current announcement version", () => {
    const f = fixture();
    f.start();
    vi.advanceTimersByTime(600);
    const now = Date.now();
    f.snooze.emit("click");
    expect(f.values.announcementHideUntil).toBe(now + COMMUNITY_ANNOUNCEMENT_SNOOZE_MS);
    expect(f.values.announcementVersionSeen).toBe(COMMUNITY_ANNOUNCEMENT_VERSION);
    expect(f.dialog.visible).toBe(false);
    f.session.clear(); // A new tab must respect the persisted snooze.
    f.start();
    vi.advanceTimersByTime(600);
    expect(f.modal.show).toHaveBeenCalledTimes(1);
});

test.each([false, true])("an expired or older announcement snooze allows the Zurvev invite (older: %s)", (older) => {
    const f = fixture();
    f.values.announcementVersionSeen = COMMUNITY_ANNOUNCEMENT_VERSION - (older ? 1 : 0);
    f.values.announcementHideUntil = Date.now() + (older ? 1000 : -1);
    f.start();
    vi.advanceTimersByTime(600);
    expect(f.modal.show).toHaveBeenCalledWith(true);
});

test("a current-version snooze suppresses the invite", () => {
    const f = fixture();
    f.values.announcementVersionSeen = COMMUNITY_ANNOUNCEMENT_VERSION;
    f.values.announcementHideUntil = Date.now() + 1000;
    f.start();
    vi.advanceTimersByTime(600);
    expect(f.modal.show).not.toHaveBeenCalled();
});

test.each(["inactive", "other-dialog"] as const)("the invite does not interrupt %s", (reason) => {
    const f = fixture();
    f.otherDialog.visible = reason === "other-dialog";
    f.start(reason !== "inactive");
    vi.advanceTimersByTime(600);
    expect(f.modal.show).not.toHaveBeenCalled();
});

test("Escape dismisses the dialog and restores focus", () => {
    const f = fixture();
    f.start();
    vi.advanceTimersByTime(600);
    const event = f.dialog.emit("keydown", { key: "Escape" });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(f.dialog.visible).toBe(false);
    expect(focused).toBe(f.opener);
});

test("Tab wraps within the dialog without suppressing ordinary navigation", () => {
    const f = fixture();
    f.start();
    vi.advanceTimersByTime(600);
    f.snooze.focus();
    expect(f.dialog.emit("keydown", { key: "Tab" }).preventDefault).toHaveBeenCalled();
    expect(focused).toBe(f.corner);
    expect(f.dialog.emit("keydown", { key: "Tab", shiftKey: true }).preventDefault).toHaveBeenCalled();
    expect(focused).toBe(f.snooze);
    f.join.focus();
    expect(f.dialog.emit("keydown", { key: "Tab" }).preventDefault).not.toHaveBeenCalled();
});

test("restricted session storage does not prevent showing or dismissing the invite", () => {
    const f = fixture();
    vi.stubGlobal("sessionStorage", {
        getItem() {
            throw new Error("Storage unavailable");
        },
        setItem() {
            throw new Error("Storage unavailable");
        },
    });
    f.start();
    vi.advanceTimersByTime(600);
    expect(f.modal.show).toHaveBeenCalledWith(true);
    expect(() => f.close.emit("click")).not.toThrow();
    expect(f.dialog.visible).toBe(false);
});

test("opening Discord from the footer before the delay suppresses the popup for this session", () => {
    const f = fixture();
    f.start();
    f.footer.emit("click");
    vi.advanceTimersByTime(600);
    expect(f.modal.show).not.toHaveBeenCalled();
    expect(f.config.set).not.toHaveBeenCalled();
});

test("a footer click still suppresses the pending popup when session storage is blocked", () => {
    const f = fixture();
    vi.stubGlobal("sessionStorage", {
        getItem() {
            throw new Error("Storage unavailable");
        },
        setItem() {
            throw new Error("Storage unavailable");
        },
    });
    f.start();
    f.footer.emit("click");
    vi.advanceTimersByTime(600);
    expect(f.modal.show).not.toHaveBeenCalled();
});
