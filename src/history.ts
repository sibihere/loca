import fs from "fs";
import path from "path";
import { getConfigDir } from "./config.js";

/**
 * Manages persistent prompt history for the REPL.
 */

const HISTORY_FILE = "history.txt";
const MAX_HISTORY_LINES = 1000;

function getHistoryPath(): string {
    return path.join(getConfigDir(), HISTORY_FILE);
}

/**
 * Loads history from disk. Returns an array of lines, newest last.
 */
export function loadHistory(): string[] {
    const p = getHistoryPath();
    if (!fs.existsSync(p)) return [];

    try {
        const content = fs.readFileSync(p, "utf-8");
        return content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    } catch {
        return [];
    }
}

/**
 * Appends a single line to the history file.
 */
export function addToHistory(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    const p = getHistoryPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
        // We append. If the file gets too big, we should prune it occasionally.
        fs.appendFileSync(p, trimmed + "\n", "utf-8");
    } catch {
        // Ignore history save errors
    }
}

/**
 * Prunes the history file to a maximum number of lines.
 */
export function pruneHistory(): void {
    const p = getHistoryPath();
    if (!fs.existsSync(p)) return;

    try {
        const lines = loadHistory();
        if (lines.length > MAX_HISTORY_LINES) {
            const kept = lines.slice(-MAX_HISTORY_LINES);
            fs.writeFileSync(p, kept.join("\n") + "\n", "utf-8");
        }
    } catch {
        // Ignore
    }
}
