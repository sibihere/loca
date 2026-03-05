// ─── Session management ───────────────────────────────────────────────────────
// Saves and restores conversation history across runs.
// Sessions stored as JSON in:
//   Windows: %APPDATA%\loca\sessions\
//   macOS/Linux: ~/.loca/sessions/

import fs from "fs";
import path from "path";
import { getConfigDir } from "./config.js";
import type { Message } from "./ollama.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Session {
  id: string;          // ISO timestamp used as filename key
  savedAt: string;     // Human-readable date string
  model: string;
  host: string;
  messageCount: number;
  messages: Message[];
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getSessionDir(): string {
  return path.join(getConfigDir(), "sessions");
}

function ensureSessionDir(): string {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export function saveSession(
  messages: Message[],
  model: string,
  host: string
): string {
  const dir = ensureSessionDir();
  const now = new Date();
  const id = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const session: Session = {
    id,
    savedAt: now.toLocaleString(),
    model,
    host,
    messageCount: messages.filter((m) => m.role !== "system").length,
    messages,
  };

  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
  return filePath;
}

// ─── Load latest session ──────────────────────────────────────────────────────

export function loadLatestSession(): Session | null {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse(); // newest first

  if (files.length === 0) return null;
  return loadSession(path.join(dir, files[0]));
}

// ─── Load specific session ────────────────────────────────────────────────────

export function loadSession(filePath: string): Session | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

// ─── List all sessions ────────────────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  savedAt: string;
  model: string;
  messageCount: number;
  filePath: string;
}

export function listSessions(): SessionSummary[] {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, 20) // last 20 sessions
    .map((f) => {
      const filePath = path.join(dir, f);
      const session = loadSession(filePath);
      if (!session) return null;
      return {
        id: session.id,
        savedAt: session.savedAt,
        model: session.model,
        messageCount: session.messageCount,
        filePath,
      };
    })
    .filter((s): s is SessionSummary => s !== null);
}

// ─── Delete old sessions (keep last 50) ──────────────────────────────────────

export function pruneOldSessions(): void {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  for (const f of files.slice(50)) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch { /* ignore */ }
  }
}

// ─── Clear all sessions ───────────────────────────────────────────────────────

export interface ClearSessionResult {
  deletedCount: number;
  error?: string;
}

export function clearSessions(): ClearSessionResult {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) return { deletedCount: 0 };

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    let deletedCount = 0;
    
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(dir, f));
        deletedCount++;
      } catch { /* ignore individual failures */ }
    }
    return { deletedCount };
  } catch (e) {
    return { deletedCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
