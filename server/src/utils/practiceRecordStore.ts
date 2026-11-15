import { appendFile, mkdir, statfs } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { Config } from "../config.ts";
import type { PracticeRecordChunk } from "../game/practiceRecorder.ts";

const gzipAsync = promisify(gzip);

/** Writes go one after another per file, so chunks stay in order. */
const queues = new Map<string, Promise<void>>();
/** A game's file stays in the folder of the day it started. */
const days = new Map<string, string>();
let lowDiskWarned = false;

function recordDir(): string {
    const dir = Config.practiceRecording?.dir?.trim() || "logs/practice";
    return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

async function enoughDisk(dir: string): Promise<boolean> {
    const minMb = Config.practiceRecording?.minFreeDiskMb ?? 2048;
    const s = await statfs(dir);
    const freeMb = (s.bavail * s.bsize) / (1024 * 1024);
    if (freeMb >= minMb) return true;
    if (!lowDiskWarned) {
        lowDiskWarned = true;
        const free = Math.round(freeMb);
        console.warn(`[practiceRecordStore] ${free} MB free (< ${minMb} MB): dropping Practice recordings`);
    }
    return false;
}

async function write(chunk: PracticeRecordChunk): Promise<void> {
    if (!chunk.lines.length) return;
    const root = recordDir();
    let day = days.get(chunk.id);
    if (!day) {
        day = new Date().toISOString().slice(0, 10);
        days.set(chunk.id, day);
    }
    const dir = path.join(root, day);
    await mkdir(dir, { recursive: true });
    if (!(await enoughDisk(root))) return;
    // Each chunk is its own gzip member; a gzip reader reads the members back to back as one stream.
    const body = await gzipAsync(Buffer.from(`${chunk.lines.join("\n")}\n`, "utf8"));
    await appendFile(path.join(dir, `${chunk.id}.jsonl.gz`), body);
}

/**
 * Append a chunk of a Practice recording to logs/practice/<day>/<id>.jsonl.gz (by default).
 * Compression and the write happen off the game tick; errors are logged, never thrown.
 */
export function appendPracticeRecord(chunk: PracticeRecordChunk): Promise<void> {
    const prev = queues.get(chunk.id) ?? Promise.resolve();
    const next = prev
        .then(() => write(chunk))
        .catch((err) => console.error("[practiceRecordStore] write failed", err));
    queues.set(chunk.id, next);
    if (chunk.final) {
        next.finally(() => {
            queues.delete(chunk.id);
            days.delete(chunk.id);
        });
    }
    return next;
}
