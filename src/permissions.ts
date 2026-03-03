// ─── Permission gate + undo stack ────────────────────────────────────────────
// Every write/execute tool call passes through askPermission() before running.
//
// The gate:
//   1. Renders a coloured preview of the proposed change
//   2. Prompts: [y] Approve  [n] Reject  [e] Edit first  [s] Stop agent
//   3. Returns the decision (and possibly edited content for write_file)
//
// The undo stack records the previous state of every file before mutation,
// enabling /undo to revert the last action cleanly.

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import readline from "readline";
import chalk from "chalk";
import type { ToolCall } from "./parser.js";
import { getConfigDir } from "./config.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionDecision = "approved" | "rejected" | "stop";

export interface PermissionResult {
  decision: PermissionDecision;
  // If the user chose 'e' (edit), the edited content replaces call.params.content
  editedParams?: Record<string, string>;
}

// ─── Undo entry ───────────────────────────────────────────────────────────────

interface UndoEntry {
  action: string;
  filePath: string;
  // null = file did not exist before this action (undo = delete it)
  previousContent: Buffer | null;
  timestamp: number;
}

// ─── Undo stack (module-level singleton) ──────────────────────────────────────

const _undoStack: UndoEntry[] = [];
const MAX_UNDO = 20;

export function snapshotForUndo(action: string, filePath: string): void {
  const resolved = path.resolve(filePath);
  let previousContent: Buffer | null = null;

  if (fs.existsSync(resolved)) {
    try {
      previousContent = fs.readFileSync(resolved);
    } catch {
      // Can't snapshot — undo won't be available for this action
      return;
    }
  }

  _undoStack.push({ action, filePath: resolved, previousContent, timestamp: Date.now() });

  // Keep stack bounded
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();

  // Also persist to disk so undo survives a crash
  persistUndoEntry(_undoStack[_undoStack.length - 1]);
}

export function undoLast(): string {
  const entry = _undoStack.pop();
  if (!entry) return "Nothing to undo.";

  try {
    if (entry.previousContent === null) {
      // File was created by this action — remove it
      if (fs.existsSync(entry.filePath)) {
        fs.unlinkSync(entry.filePath);
        return `Undid: removed ${entry.filePath} (was created by ${entry.action})`;
      }
      return `Undo: file ${entry.filePath} already gone.`;
    } else {
      // Restore previous content
      fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
      fs.writeFileSync(entry.filePath, entry.previousContent);
      return `Undid: restored ${entry.filePath} (action: ${entry.action})`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Undo failed: ${msg}`;
  }
}

function persistUndoEntry(entry: UndoEntry): void {
  try {
    const undoDir = path.join(getConfigDir(), "undo");
    fs.mkdirSync(undoDir, { recursive: true });
    const name = `${entry.timestamp}-${path.basename(entry.filePath)}.undo`;
    const meta = JSON.stringify({
      action: entry.action,
      filePath: entry.filePath,
      timestamp: entry.timestamp,
      hasContent: entry.previousContent !== null,
    });
    fs.writeFileSync(path.join(undoDir, name + ".meta"), meta);
    if (entry.previousContent) {
      fs.writeFileSync(path.join(undoDir, name + ".data"), entry.previousContent);
    }
  } catch {
    // Non-fatal — in-memory undo still works
  }
}

// ─── Permission gate ──────────────────────────────────────────────────────────

export async function askPermission(call: ToolCall): Promise<PermissionResult> {
  console.log();
  renderPreview(call);

  while (true) {
    const answer = await promptUser(
      chalk.dim("  [y] Approve  [n] Reject  [e] Edit first  [s] Stop agent\n") +
      chalk.bold("  > ")
    );

    switch (answer.toLowerCase().trim()) {
      case "y":
      case "yes":
      case "":
        return { decision: "approved" };

      case "n":
      case "no":
        console.log(chalk.dim("  ✗ Rejected.\n"));
        return { decision: "rejected" };

      case "s":
      case "stop":
        console.log(chalk.dim("  ⏹ Agent stopped.\n"));
        return { decision: "stop" };

      case "e":
      case "edit": {
        const edited = await openInEditor(call);
        if (edited) {
          return {
            decision: "approved",
            editedParams: { ...call.params, ...edited },
          };
        }
        // Editor returned nothing / cancelled — re-prompt
        console.log(chalk.yellow("  Editor returned empty content. Re-prompting.\n"));
        renderPreview(call);
        break;
      }

      default:
        console.log(chalk.yellow("  Please type y, n, e, or s."));
    }
  }
}

// ─── Preview renderer ─────────────────────────────────────────────────────────

function renderPreview(call: ToolCall): void {
  const p = call.params;
  const isDestructive = isDangerous(call);

  // Box width
  const W = 64;
  const line = "─".repeat(W);

  // Header
  const actionLabel = isDestructive
    ? chalk.red.bold(`  ACTION  ${call.name}  ⚠ DESTRUCTIVE`)
    : chalk.yellow(`  ACTION  ${chalk.bold(call.name)}`);

  console.log(chalk.dim("  ┌" + line + "┐"));
  console.log(actionLabel);

  if (p.path || p.command) {
    const label = p.command ? "  CMD   " : "  PATH  ";
    const value = p.command ?? p.path ?? "";
    console.log(chalk.dim(label) + chalk.cyan(value));
  }

  console.log(chalk.dim("  ├" + line + "┤"));

  // Body — depends on tool
  switch (call.name) {
    case "write_file":
      renderWritePreview(p.content ?? "");
      break;

    case "edit_file":
      renderDiffPreview(p.diff ?? "");
      break;

    case "delete_file":
      renderDeletePreview(p.path ?? "");
      break;

    case "run_command":
      renderCommandPreview(p.command ?? "", isDestructive);
      break;

    case "create_dir":
      console.log(chalk.dim("  ") + chalk.green(`+ mkdir -p ${p.path}`));
      break;

    default:
      console.log(chalk.dim("  ") + JSON.stringify(p));
  }

  console.log(chalk.dim("  └" + line + "┘"));
  console.log();
}

function renderWritePreview(content: string): void {
  const lines = content.split("\n").slice(0, 40);
  for (const l of lines) {
    console.log(chalk.green("  + ") + l);
  }
  if (content.split("\n").length > 40) {
    console.log(chalk.dim(`  … (${content.split("\n").length - 40} more lines)`));
  }
}

function renderDiffPreview(diff: string): void {
  const lines = diff.split("\n").slice(0, 50);
  for (const l of lines) {
    if (l.startsWith("+") && !l.startsWith("+++")) {
      console.log(chalk.green("  " + l));
    } else if (l.startsWith("-") && !l.startsWith("---")) {
      console.log(chalk.red("  " + l));
    } else if (l.startsWith("@@")) {
      console.log(chalk.cyan("  " + l));
    } else {
      console.log(chalk.dim("  " + l));
    }
  }
  if (diff.split("\n").length > 50) {
    console.log(chalk.dim(`  … (${diff.split("\n").length - 50} more lines)`));
  }
}

function renderDeletePreview(filePath: string): void {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) {
    try {
      const content = fs.readFileSync(resolved, "utf-8");
      const lines = content.split("\n").slice(0, 10);
      for (const l of lines) {
        console.log(chalk.red("  - ") + chalk.dim(l));
      }
      if (content.split("\n").length > 10) {
        console.log(chalk.dim("  … (file continues)"));
      }
    } catch {
      console.log(chalk.dim("  (unable to preview file contents)"));
    }
  } else {
    console.log(chalk.dim("  (file does not exist)"));
  }
}

function renderCommandPreview(command: string, dangerous: boolean): void {
  const color = dangerous ? chalk.red : chalk.yellow;
  console.log(color("  $ " + command));
  if (dangerous) {
    console.log(chalk.red.bold("  ⚠  This command may be irreversible."));
  }
}

// ─── Danger detection ─────────────────────────────────────────────────────────

const DANGER_UNIX = [
  /\brm\s+-[rfR]*f/,        // rm -rf, rm -f
  /\brm\s+-[rfR]/,           // rm -r, rm -R
  /\bdd\b/,                  // dd (disk copy)
  /\bmkfs\b/,                // format filesystem
  /\bformat\b/,              // format (unix)
  /:\(\)\s*\{.*\|.*&/,      // fork bomb
  /\b>\s*\/dev\//,           // write to device
  /\bchmod\s+[0-7]*777/,     // chmod 777
  /\bsudo\b/,                // any sudo
];

const DANGER_WINDOWS = [
  /\bdel\s+\/[fFqQsS]/i,    // del /f /s
  /\brd\s+\/[sS]/i,          // rd /s
  /\brmdir\s+\/[sS]/i,       // rmdir /s
  /\bformat\s+[a-zA-Z]:/i,   // format C:
  /\breg\s+delete\b/i,        // reg delete
  /\bnetsh\s+firewall/i,      // firewall changes
  /\bshutdown\b/i,            // shutdown
  /\bpowershell.*ExecutionPolicy/i, // bypass execution policy
];

export function isDangerous(call: ToolCall): boolean {
  if (call.name !== "run_command") return false;
  const cmd = call.params.command ?? "";
  const patterns = process.platform === "win32"
    ? [...DANGER_UNIX, ...DANGER_WINDOWS]
    : DANGER_UNIX;
  return patterns.some((re) => re.test(cmd));
}

// ─── Open in editor ───────────────────────────────────────────────────────────

async function openInEditor(
  call: ToolCall
): Promise<Record<string, string> | null> {
  const content = call.params.content ?? call.params.diff ?? call.params.command ?? "";
  const ext = getFileExt(call.params.path ?? "txt");
  const tmpFile = path.join(os.tmpdir(), `loca-edit-${Date.now()}${ext}`);

  try {
    fs.writeFileSync(tmpFile, content, "utf-8");

    const editor =
      process.env.EDITOR ??
      process.env.VISUAL ??
      (process.platform === "win32" ? "notepad" : "nano");

    // Spawn editor synchronously — wait for it to close
    execSync(`${editor} "${tmpFile}"`, { stdio: "inherit" });

    const edited = fs.readFileSync(tmpFile, "utf-8");
    fs.unlinkSync(tmpFile);

    if (!edited.trim()) return null;

    // Return the right param key depending on tool
    if (call.name === "write_file") return { content: edited };
    if (call.name === "edit_file") return { diff: edited };
    if (call.name === "run_command") return { command: edited.trim() };
    return { content: edited };
  } catch (err: unknown) {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`  Editor error: ${msg}`));
    return null;
  }
}

function getFileExt(filePath: string): string {
  const ext = path.extname(filePath);
  return ext || ".txt";
}

// ─── Simple stdin prompt ──────────────────────────────────────────────────────

function promptUser(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
