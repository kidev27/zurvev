import { expect, test, vi } from "vitest";

// These tests exercise name lookup without constructing the browser UI.
vi.mock("jquery", () => ({ default: vi.fn() }));
vi.mock("../../client/src/device.ts", () => ({ device: { touch: false } }));

import { Localization } from "../../client/src/ui/localization.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";

const names = [
    ["pressure_cannon", "Pressure Cannon"],
    ["tesla_rifle", "Tesla Rifle"],
    ["gravegun", "Gravegun"],
    ["ppsh41", "PPSh-41"],
] as const;

for (const [type, name] of names) {
    test(`${type}: untranslated base and Mk II names reach the HUD`, () => {
        const localization = new Localization();
        const hudName = (type: string) =>
            localization.translate(`game-hud-${type}`)
            || localization.translate(`game-${type}`);
        expect(hudName(type)).toBe(name);
        expect(hudName(`${type}_pap`)).toBe(`${name} Mk II`);
        expect(localization.translate(`game-${type}`)).toBe(name);
    });
}

test("localized HUD and full names take precedence over definition fallback", () => {
    const localization = new Localization("es", ["en", "es"], {
        en: {},
        es: {
            "game-hud-tesla_rifle": "Tesla",
            "game-tesla_rifle": "Rifle Tesla",
        },
    });
    expect(localization.translate("game-hud-tesla_rifle")).toBe("Tesla");
    expect(localization.translate("game-tesla_rifle")).toBe("Rifle Tesla");
    expect(localization.translate("game-pressure_cannon")).toBe("Pressure Cannon");
    expect(localization.translate("game-gravegun_pap")).toBe("Gravegun Mk II");
    expect(localization.translate("game-nonexistent_weapon")).toBe("");
    expect(localization.translate("game-constructor")).toBe("");
});

test("renaming a new gun in its definition updates fallback labels", () => {
    const original = GunDefs.pressure_cannon.name;
    try {
        GunDefs.pressure_cannon.name = "Renamed Cannon";
        expect(new Localization().translate("game-pressure_cannon")).toBe("Renamed Cannon");
    } finally {
        GunDefs.pressure_cannon.name = original;
    }
});
