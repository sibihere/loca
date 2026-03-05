// ─── Tool registry ────────────────────────────────────────────────────────────
// dispatchReadOnly  — run read-only tools immediately, return result
// executeTool       — run write/execute tools AFTER permission has been granted

import { readFile, listDir, searchFiles, writeFile, editFile, deleteFile, createDir } from "./fs.js";
import { runCommand, formatCommandOutput } from "./shell.js";
import { runTests } from "./testing.js";
import { gitStatus, gitDiff, gitAdd, gitCommit, gitBranch, gitLog } from "./git.js";
import type { ToolCall } from "../parser.js";

export interface ToolResult {
  output: string;
  requiresPermission: boolean;
}

// ─── Read-only dispatch (no permission needed) ────────────────────────────────

export function dispatchReadOnly(call: ToolCall): ToolResult | null {
  const p = call.params;

  switch (call.name) {
    case "read_file":
      if (!p.path) return err("read_file requires a path parameter.");
      return ok(readFile(p.path));

    case "list_dir":
      return ok(listDir(p.path ?? "."));

    case "search_files":
      if (!p.pattern) return err("search_files requires a pattern parameter.");
      return ok(searchFiles(p.pattern, p.path ?? "."));

    default:
      return null; // Write tool — agent handles permission gate first
  }
}

// ─── Write/execute dispatch (called AFTER user approves) ─────────────────────

export async function executeTool(call: ToolCall): Promise<string> {
  const p = call.params;

  switch (call.name) {
    case "write_file":
      if (!p.path) return "Error: write_file requires a path.";
      if (p.content === undefined) return "Error: write_file requires content.";
      return writeFile(p.path, p.content);

    case "edit_file":
      if (!p.path) return "Error: edit_file requires a path.";
      if (!p.diff) return "Error: edit_file requires a diff.";
      return editFile(p.path, p.diff);

    case "delete_file":
      if (!p.path) return "Error: delete_file requires a path.";
      return deleteFile(p.path);

    case "create_dir":
      if (!p.path) return "Error: create_dir requires a path.";
      return createDir(p.path);

    case "run_command":
      if (!p.command) return "Error: run_command requires a command.";
      return formatCommandOutput(await runCommand(p.command, p.working_directory));

    case "run_tests":
      return runTests(p.filter, p.working_directory);
    case "git_status":
      return gitStatus();
    case "git_diff":
      return gitDiff(p.staged === "true", p.path);
    case "git_add":
      return gitAdd(p.path);
    case "git_commit":
      return gitCommit(p.message);
    case "git_branch":
      return gitBranch(p.name);
    case "git_log":
      return gitLog(p.n ? parseInt(p.n) : 5);

    default:
      return `Error: Unknown tool: ${call.name}`;
  }
}

// ─── Tools that require the undo snapshot before execution ───────────────────
// These modify the file system in a reversible way.

export const UNDOABLE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);

// ─── Tools that need permission ───────────────────────────────────────────────

export const PERMISSION_TOOLS = new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "run_command",
  "create_dir",
  "run_tests",
  "git_commit",
  "git_add",
  "git_branch",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ok(output: string): ToolResult {
  return { output, requiresPermission: false };
}

function err(msg: string): ToolResult {
  return { output: `Error: ${msg}`, requiresPermission: false };
}
