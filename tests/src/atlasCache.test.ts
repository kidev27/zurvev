import Path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
    files: new Map<string, Buffer>(),
    images: [] as string[],
    scales: {} as Record<string, number>,
}));

// Hash/cache tests do not render images or write into the checkout's atlas cache.
vi.mock("node:fs", () => ({
    default: {
        existsSync: (path: string) => fixture.files.has(String(path)),
        mkdirSync: vi.fn(),
        readFileSync: (path: string) => {
            const contents = fixture.files.get(String(path));
            if (contents === undefined) throw new Error(`Missing fixture file: ${path}`);
            return contents;
        },
    },
}));
vi.mock("canvas", () => ({ loadImage: vi.fn() }));
vi.mock("../../client/atlas-builder/atlasDefs.ts", () => ({
    Atlases: { shared: { compress: true, images: fixture.images } },
    scaledSprites: fixture.scales,
}));

import {
    AtlasManager,
    cacheFolder,
    imageFolder,
    imagesCacheFolder,
} from "../../client/atlas-builder/atlasBuilder.ts";

const original = "map/original.svg";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>';

beforeEach(() => {
    fixture.files.clear();
    fixture.images.splice(0, fixture.images.length, original);
    for (const key of Object.keys(fixture.scales)) delete fixture.scales[key];
    fixture.files.set(Path.join(imageFolder, original), Buffer.from(svg));
});

function warmCache(manager: AtlasManager) {
    const queued = vi.spyOn(manager.imageCache, "queueImage");
    const hash = manager.hashAtlas("shared");
    const [file, imageHash] = queued.mock.calls[0]!;
    fixture.files.set(
        Path.join(cacheFolder, "img-cache.json"),
        Buffer.from(JSON.stringify({
            [file]: { hash: imageHash, edges: { top: 0, bottom: 0, left: 0, right: 0 } },
        })),
    );
    fixture.files.set(Path.join(imagesCacheFolder, `${imageHash}.png`), Buffer.from("cached raster"));
    fixture.files.set(
        Path.join(manager.getAtlasFolderPath("shared", hash), "data.json"),
        Buffer.from(JSON.stringify({ high: [], low: [] })),
    );
    manager.imageCache.loadFromDisk();
    queued.mockClear();
    return { hash, imageHash, queued };
}

test("unchanged image paths and contents keep the cached atlas", () => {
    const manager = new AtlasManager();
    const { hash, queued } = warmCache(manager);
    expect(manager.hashAtlas("shared")).toBe(hash);
    expect(manager.getChangedAtlases()).toEqual([]);
    expect(queued).not.toHaveBeenCalled();
});

test.each(["map/renamed.svg", "loot/original.svg"])(
    "renaming an unchanged SVG to %s invalidates a warm atlas",
    (renamed) => {
        const manager = new AtlasManager();
        const { hash, imageHash, queued } = warmCache(manager);
        expect(manager.getChangedAtlases()).toEqual([]);

        const contents = fixture.files.get(Path.join(imageFolder, original))!;
        fixture.files.delete(Path.join(imageFolder, original));
        fixture.files.set(Path.join(imageFolder, renamed), contents);
        fixture.images[0] = renamed;

        const changed = manager.getChangedAtlases();
        expect(changed).toEqual([{ name: "shared", hash: expect.any(String) }]);
        expect(changed[0]!.hash).not.toBe(hash);
        expect(manager.atlasCache.shared).toBe(changed[0]!.hash);
        // The frame name changes, while the rendered image's content/scale key stays reusable.
        expect(queued).toHaveBeenCalledWith(renamed, imageHash);
    },
);

test("content and scale edits still invalidate the cached atlas", () => {
    const manager = new AtlasManager();
    const { hash } = warmCache(manager);
    fixture.files.set(Path.join(imageFolder, original), Buffer.from(svg.replaceAll("16", "32")));
    const contentHash = manager.hashAtlas("shared");
    expect(contentHash).not.toBe(hash);

    fixture.scales[original] = 0.5;
    const scaleHash = manager.hashAtlas("shared");
    expect(scaleHash).not.toBe(contentHash);
    expect(manager.getChangedAtlases()).toEqual([{ name: "shared", hash: scaleHash }]);
});
