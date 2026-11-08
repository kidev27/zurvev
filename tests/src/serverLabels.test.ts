import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { configFileName, getConfig, saveConfig } from "../../config.ts";
import { ApiServer } from "../../server/src/api/apiServer.ts";
import { zHandshakeBody } from "../../server/src/utils/types.ts";
import { serverDisplayName } from "../../shared/utils/serverLabels.ts";

const translations: Record<string, string> = {
    "index-north-america": "North America",
    "index-europe": "Europe",
    "index-local": "Local",
};
const translate = (key: string) => translations[key] || "";

test.each([
    ["main", { name: "Fireteam", l10n: "index-north-america" }, "North America"],
    ["eu1", { name: "Fireteam 2", l10n: "index-europe" }, "Europe"],
    ["local", { name: "Local", l10n: "index-local" }, "Local"],
    ["custom", { name: "  Community server  ", l10n: "index-missing" }, "Community server"],
    ["custom", { name: "Community server" }, "Community server"],
    ["custom", { name: "  ", l10n: "index-missing" }, "custom"],
] as const)("server label for %s uses geographic metadata with a safe fallback", (id, data, expected) => {
    expect(serverDisplayName(id, data, translate)).toBe(expected);
});

test("game-node registration preserves geography while live populations refresh", () => {
    const api = new ApiServer();
    const { regionId, ...endpoint } = zHandshakeBody.parse({
        regionId: "main",
        name: "Fireteam",
        l10n: "index-north-america",
        url: "https://na.example.com",
        address: "127.0.0.1:8001",
    });
    api.registerRegion(regionId, endpoint);
    for (const count of [0, 7, 0]) {
        api.updateRegion(regionId, { playerCount: count });
        const pops = api.getSiteInfo().pops;
        expect(Object.keys(pops)).toContain("main");
        expect(pops.main).toMatchObject({
            name: "Fireteam",
            l10n: "index-north-america",
            address: "na.example.com",
            https: true,
            playerCount: count,
        });
        expect(serverDisplayName(regionId, pops.main, translate)).toBe("North America");
    }
    // Older nodes do not send l10n; reconnecting one must retain the master's metadata.
    api.registerRegion(regionId, { name: "Fireteam", address: "127.0.0.1:8001" });
    expect(api.getSiteInfo().pops.main.l10n).toBe("index-north-america");
});

test("compact geographic config survives normalization and a later config save", () => {
    const dir = mkdtempSync(join(tmpdir(), "survev-server-labels-"));
    vi.stubEnv("SURVEV_CONFIG_DIR", dir);
    try {
        writeFileSync(join(dir, configFileName), JSON.stringify({
            serverMode: "live",
            advertiseHost: "127.0.0.1",
            game: {
                id: "main",
                name: "Fireteam",
                l10n: "index-north-america",
                url: "https://na.example.com",
                address: "127.0.0.1:8001",
            },
            database: { engine: "sqlite" },
            secrets: {
                SURVEV_API_KEY: "server-labels-test-key-0123456789",
                SURVEV_IP_SECRET: "server-labels-test-ip-0123456789",
            },
        }));
        const config = getConfig(true, dir);
        expect(config.gameServer.thisRegion).toBe("main");
        expect(config.regions.main).toMatchObject({
            name: "Fireteam",
            l10n: "index-north-america",
            address: "127.0.0.1:8001",
            publicAddress: "na.example.com",
            https: true,
        });
        saveConfig(dir, { difficulty: "hardened" });
        const restored = getConfig(true, dir);
        expect(restored.difficulty).toBe("hardened");
        expect(restored.regions.main.l10n).toBe("index-north-america");
        expect(restored.gameServer.thisRegion).toBe("main");
    } finally {
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});
