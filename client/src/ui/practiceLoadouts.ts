import {
    activePracticeLoadout,
    addPracticeLoadout,
    defaultPracticeSettings,
    type PracticeLoadoutStore,
    type PracticeSettings,
    sanitizePracticeLoadoutStore,
    sanitizePracticeSettings,
} from "../../../shared/practice.ts";

/** Saved Practice loadouts on this device (the home screen picks one, matches start with it). */
const StoreKey = "practiceLoadouts";
/** The single settings blob the in-match panel saved before loadouts existed. */
const LegacyKey = "practiceSettings";

export function newPracticeLoadoutId(): string {
    return `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function loadPracticeLoadouts(): PracticeLoadoutStore {
    try {
        const raw = localStorage.getItem(StoreKey);
        if (raw) return sanitizePracticeLoadoutStore(JSON.parse(raw));
        // First run after the update: keep the old setup as Loadout 1.
        const legacy = localStorage.getItem(LegacyKey);
        if (legacy) {
            const store = sanitizePracticeLoadoutStore(undefined);
            addPracticeLoadout(store, sanitizePracticeSettings(JSON.parse(legacy)), newPracticeLoadoutId());
            savePracticeLoadouts(store);
            return store;
        }
    } catch {
        // Private mode or corrupt data: start empty.
    }
    return sanitizePracticeLoadoutStore(undefined);
}

export function savePracticeLoadouts(store: PracticeLoadoutStore): void {
    try {
        localStorage.setItem(StoreKey, JSON.stringify(store));
    } catch {
        // Storage unavailable; loadouts just won't be remembered.
    }
}

/** The setup a match starts with: the active loadout, or the defaults when none is saved. */
export function activePracticeSettings(store = loadPracticeLoadouts()): PracticeSettings {
    const active = activePracticeLoadout(store);
    return structuredClone(active ? active.settings : defaultPracticeSettings());
}

/** Off = stay down until you press Respawn. */
const AutoRespawnKey = "practiceAutoRespawn";

export function loadAutoRespawn(): boolean {
    try {
        return localStorage.getItem(AutoRespawnKey) !== "0";
    } catch {
        return true;
    }
}

export function saveAutoRespawn(on: boolean): void {
    try {
        localStorage.setItem(AutoRespawnKey, on ? "1" : "0");
    } catch {
        // Not remembered; harmless.
    }
}
