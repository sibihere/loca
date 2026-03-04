// ─── File system tools ────────────────────────────────────────────────────────
// Read-only tools (no permission needed):
//   read_file, list_dir, search_files
//
// Write tools (permission required — gate is in agent.ts):
//   write_file, edit_file, delete_file, create_dir

import fs from "fs";
import path from "path";
import { applyPatch } from "diff";

// ─── Shared constants ─────────────────────────────────────────────────────────

export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", ".cache", "coverage",
  ".turbo", ".svelte-kit", "out",
]);

// ─── read_file ────────────────────────────────────────────────────────────────

export function readFile(filePath: string): string {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) return `Error: File not found: ${filePath}`;

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return `Error: ${filePath} is a directory. Use list_dir instead.`;
  }

  // Refuse binary files (check for null bytes in first 512 bytes)
  const buf = Buffer.alloc(512);
  const fd = fs.openSync(resolved, "r");
  const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
  fs.closeSync(fd);
  for (let i = 0; i < bytesRead; i++) {
    if (buf[i] === 0) return `Error: ${filePath} appears to be binary.`;
  }

  if (stat.size > 500 * 1024) {
    return `Error: ${filePath} is ${Math.round(stat.size / 1024)} KB — too large. Use search_files to locate specific sections.`;
  }

  try {
    return fs.readFileSync(resolved, "utf-8");
  } catch (err: unknown) {
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── list_dir ─────────────────────────────────────────────────────────────────

export function listDir(dirPath: string, indent = 0): string {
  const resolved = path.resolve(dirPath);

  if (!fs.existsSync(resolved)) return `Error: Directory not found: ${dirPath}`;

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) return `Error: ${dirPath} is a file, not a directory.`;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err: unknown) {
    return `Error listing directory: ${err instanceof Error ? err.message : String(err)}`;
  }

  const lines: string[] = [];
  const prefix = "  ".repeat(indent);

  const dirs = entries
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = entries
    .filter((e) => e.isFile())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const d of dirs) {
    lines.push(`${prefix}${d.name}/`);
    if (indent < 2) {
      const sub = listDirFlat(path.join(resolved, d.name), indent + 1);
      if (sub) lines.push(sub);
    }
  }

  for (const f of files) {
    lines.push(`${prefix}${f.name}`);
  }

  return lines.join("\n") || "(empty directory)";
}

function listDirFlat(dirPath: string, indent: number): string {
  if (!fs.existsSync(dirPath)) return "";
  const prefix = "  ".repeat(indent);
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${prefix}${e.name}${e.isDirectory() ? "/" : ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

// ─── write_file ───────────────────────────────────────────────────────────────

export function writeFile(filePath: string, content: string): string {
  const resolved = path.resolve(filePath);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, "utf-8");
    return `Written: ${filePath} (${content.split("\n").length} lines)`;
  } catch (err: unknown) {
    return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── edit_file ────────────────────────────────────────────────────────────────

export function editFile(filePath: string, diff: string): string {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    return `Error: File not found: ${filePath}. Use write_file to create it.`;
  }

  let original: string;
  try {
    original = fs.readFileSync(resolved, "utf-8");
  } catch (err: unknown) {
    return `Error reading file for edit: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Detect original line endings
  const hasCRLF = original.includes("\r\n");

  // Normalize both to LF for patching (diff package expects LF)
  const normalizedOriginal = hasCRLF ? original.replace(/\r\n/g, "\n") : original;
  const normalizedDiff = recalibrateDiff(diff.replace(/\r\n/g, "\n"));

  try {
    const result = applyPatch(normalizedOriginal, normalizedDiff);

    if (result === false) {
      return (
        `Error: Diff did not apply cleanly to ${filePath}. ` +
        `This usually means the file content has changed since the diff was generated. ` +
        `Please read_file first to see the current content, then regenerate the diff.`
      );
    }

    // Restore original line endings
    const finalResult = hasCRLF ? result.replace(/\n/g, "\r\n") : result;

    fs.writeFileSync(resolved, finalResult, "utf-8");
    return `Edited: ${filePath}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error applying diff: ${msg}. Check that the hunk header (@@ line) has correct line counts.`;
  }
}

/**
 * Recalibrates the line counts in a unified diff hunk header (@@ -start,count +start,count @@).
 * LLMs often get these counts wrong, which causes applyPatch to fail.
 */
function recalibrateDiff(diff: string): string {
  const lines = diff.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("@@")) {
      // Parse header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@(.*)$/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const newStart = parseInt(match[2], 10);
        const rest = match[3];

        let oldCount = 0;
        let newCount = 0;

        // Count lines in this hunk
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith("@@")) {
          const hunkLine = lines[j];
          if (hunkLine.startsWith(" ")) {
            oldCount++;
            newCount++;
          } else if (hunkLine.startsWith("-")) {
            oldCount++;
          } else if (hunkLine.startsWith("+")) {
            newCount++;
          } else {
            // Unexpected content in hunk? Skip or break.
            // Some diffs might have \ No newline messages, etc.
          }
          j++;
        }

        result.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${rest}`);
        continue;
      }
    }
    result.push(line);
  }

  return result.join("\n");
}

// ─── delete_file ──────────────────────────────────────────────────────────────

export function deleteFile(filePath: string): string {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) return `Error: File not found: ${filePath}`;

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return `Error: ${filePath} is a directory. Cannot delete with delete_file.`;
  }

  try {
    fs.unlinkSync(resolved);
    return `Deleted: ${filePath}`;
  } catch (err: unknown) {
    return `Error deleting file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── create_dir ───────────────────────────────────────────────────────────────

export function createDir(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    return `Created directory: ${dirPath}`;
  } catch (err: unknown) {
    return `Error creating directory: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── search_files ─────────────────────────────────────────────────────────────

export function searchFiles(pattern: string, dirPath: string): string {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) return `Error: Directory not found: ${dirPath}`;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gm");
  } catch {
    return `Error: Invalid regex pattern: ${pattern}`;
  }

  const results: string[] = [];
  searchRecursive(resolved, regex, results, 0);

  return results.length === 0
    ? `No matches found for: ${pattern}`
    : results.join("\n");
}

function searchRecursive(dir: string, regex: RegExp, results: string[], depth: number): void {
  if (depth > 6 || results.length > 200) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        searchRecursive(fullPath, regex, results, depth + 1);
      }
    } else if (entry.isFile()) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        content.split("\n").forEach((line, i) => {
          regex.lastIndex = 0;
          if (regex.test(line)) {
            results.push(`${fullPath}:${i + 1}: ${line.trim()}`);
          }
        });
      } catch { /* skip unreadable */ }
    }
  }
}
