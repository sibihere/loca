// ─── Context map ──────────────────────────────────────────────────────────────
// Builds a compact, token-budgeted summary of the project's file structure and
// exported symbols. Injected into the LLM's system prompt so it has structural
// awareness of the codebase without needing to read every file.
//
// Output example:
//
//   PROJECT MAP  (src · 9 files · 312 tokens)
//   ──────────────────────────────────────────
//   src/
//     agent.ts         Agent, runLoop()
//     ollama.ts        OllamaClient, streamChat()
//     tools/
//       fs.ts          readFile(), writeFile(), editFile()
//       shell.ts       runCommand()
//   ──────────────────────────────────────────

import fs from "fs";
import path from "path";
import ignore from "ignore";
// @ts-ignore - ignore is not always correctly typed for ESM default export
const ignoreFactory = (ignore as any).default || ignore;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MapEntry {
  relativePath: string;    // e.g. "src/agent.ts"
  symbols: string[];       // exported symbol names
  isDir: boolean;
}

export interface ContextMap {
  rootDir: string;
  entries: MapEntry[];
  tokenCount: number;
  isTruncated: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_TOKEN_BUDGET = 800;

const ALWAYS_SKIP = new Set([
  "node_modules", ".git", "dist", "build", "target", ".next", "out",
  "__pycache__", ".venv", "venv", ".cache", "coverage",
  ".turbo", ".svelte-kit", ".nuxt", ".output", "vendor",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so",
  ".wasm", ".ttf", ".woff", ".woff2", ".eot", ".mp4", ".mp3",
  ".lock", ".sum",
]);

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".cs",
  ".cpp", ".c", ".h", ".hpp", ".rb", ".php",
  ".swift", ".vue", ".svelte",
]);

// ─── Symbol extractors per language ──────────────────────────────────────────

function extractSymbols(filePath: string, content: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  const symbols: string[] = [];

  try {
    if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs") {
      extractTS(content, symbols);
    } else if (ext === ".py") {
      extractPython(content, symbols);
    } else if (ext === ".go") {
      extractGo(content, symbols);
    } else if (ext === ".rs") {
      extractRust(content, symbols);
    } else if (ext === ".java" || ext === ".kt") {
      extractJava(content, symbols);
    }
  } catch {
    // Symbol extraction is best-effort — never crash the map build
  }

  return symbols.slice(0, 8); // cap per file to keep map compact
}

function extractTS(content: string, out: string[]): void {
  const patterns = [
    /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
    /^export\s+(?:abstract\s+)?class\s+(\w+)/gm,
    /^export\s+(?:const|let|var)\s+(\w+)\s*[:=]/gm,
    /^export\s+(?:type|interface)\s+(\w+)/gm,
    /^export\s+enum\s+(\w+)/gm,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && !out.includes(m[1])) out.push(m[1]);
    }
  }
}

function extractPython(content: string, out: string[]): void {
  const patterns = [
    /^(?:async\s+)?def\s+(\w+)\s*\(/gm,
    /^class\s+(\w+)/gm,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && !out.includes(m[1]) && !m[1].startsWith("_")) {
        out.push(m[1]);
      }
    }
  }
}

function extractGo(content: string, out: string[]): void {
  const re = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Z]\w*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  const typeRe = /^type\s+([A-Z]\w*)\s+(?:struct|interface)/gm;
  while ((m = typeRe.exec(content)) !== null) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
}

function extractRust(content: string, out: string[]): void {
  const patterns = [
    /^pub\s+(?:async\s+)?fn\s+(\w+)/gm,
    /^pub\s+struct\s+(\w+)/gm,
    /^pub\s+enum\s+(\w+)/gm,
    /^pub\s+trait\s+(\w+)/gm,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && !out.includes(m[1])) out.push(m[1]);
    }
  }
}

function extractJava(content: string, out: string[]): void {
  const patterns = [
    /^public\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm,
    /^public\s+(?:abstract\s+)?class\s+(\w+)/gm,
    /^public\s+interface\s+(\w+)/gm,
    /^public\s+enum\s+(\w+)/gm,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && !out.includes(m[1])) out.push(m[1]);
    }
  }
}

// ─── .gitignore loader ────────────────────────────────────────────────────────

function loadGitignore(dir: string, extraPatterns: string[] = []): any {
  const ig = ignoreFactory();
  if (extraPatterns.length > 0) {
    ig.add(extraPatterns);
  }
  const gitignorePath = path.join(dir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    try {
      ig.add(fs.readFileSync(gitignorePath, "utf-8"));
    } catch { /* ignore read errors */ }
  }
  return ig;
}

// ─── Directory walker ─────────────────────────────────────────────────────────

function walkDir(
  dir: string,
  rootDir: string,
  ig: any,
  entries: MapEntry[],
  tokenBudget: number,
  usedTokens: { count: number },
  depth: number
): boolean {
  if (depth > 6) return false;

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  // Dirs first, then files — both sorted
  const dirs = dirEntries
    .filter((e) => e.isDirectory() && !ALWAYS_SKIP.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = dirEntries
    .filter((e) => e.isFile() && SOURCE_EXTS.has(path.extname(e.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const d of dirs) {
    const fullPath = path.join(dir, d.name);
    const rel = path.relative(rootDir, fullPath);
    // Check gitignore
    if (ig.ignores(rel.replace(/\\/g, "/"))) continue;

    entries.push({ relativePath: rel, symbols: [], isDir: true });
    usedTokens.count += Math.ceil(rel.length / 4) + 2;

    if (usedTokens.count >= tokenBudget) return true; // truncated

    const truncated = walkDir(fullPath, rootDir, ig, entries, tokenBudget, usedTokens, depth + 1);
    if (truncated) return true;
  }

  for (const f of files) {
    const fullPath = path.join(dir, f.name);
    const rel = path.relative(rootDir, fullPath);

    if (ig.ignores(rel.replace(/\\/g, "/"))) continue;
    if (BINARY_EXTS.has(path.extname(f.name).toLowerCase())) continue;

    // Extract symbols
    let symbols: string[] = [];
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size < 200 * 1024) { // skip very large files for perf
        const content = fs.readFileSync(fullPath, "utf-8");
        symbols = extractSymbols(fullPath, content);
      }
    } catch { /* skip unreadable */ }

    entries.push({ relativePath: rel, symbols, isDir: false });

    // Estimate token cost: path + symbols
    const lineTokens = Math.ceil((rel.length + symbols.join(", ").length) / 4) + 2;
    usedTokens.count += lineTokens;

    if (usedTokens.count >= tokenBudget) return true; // truncated
  }

  return false;
}

// ─── Build map ────────────────────────────────────────────────────────────────

export function buildContextMap(
  rootDir: string,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  extraExcludes: string[] = []
): ContextMap {
  const ig = loadGitignore(rootDir, extraExcludes);
  const entries: MapEntry[] = [];
  const usedTokens = { count: 0 };

  const isTruncated = walkDir(rootDir, rootDir, ig, entries, tokenBudget, usedTokens, 0);

  return { rootDir, entries, tokenCount: usedTokens.count, isTruncated };
}

// ─── Render map to string for LLM injection ───────────────────────────────────

export function renderContextMap(map: ContextMap): string {
  if (map.entries.length === 0) return "";

  const fileCount = map.entries.filter((e) => !e.isDir).length;
  const header = `PROJECT MAP  (${path.basename(map.rootDir)} · ${fileCount} files · ~${map.tokenCount} tokens)`;
  const line = "─".repeat(Math.min(header.length, 60));

  const lines: string[] = [header, line];

  for (const entry of map.entries) {
    const parts = entry.relativePath.replace(/\\/g, "/").split("/");
    const indent = "  ".repeat(parts.length - 1);
    const name = parts[parts.length - 1];

    if (entry.isDir) {
      lines.push(`${indent}${name}/`);
    } else {
      const symbolStr = entry.symbols.length > 0
        ? `  ${chalk_dim(entry.symbols.join(", "))}`
        : "";
      lines.push(`${indent}${name}${symbolStr}`);
    }
  }

  if (map.isTruncated) {
    lines.push(`${line}`);
    lines.push(`(map truncated — use /map <path> to zoom into a subdirectory)`);
  } else {
    lines.push(line);
  }

  return lines.join("\n");
}

// Lightweight chalk.dim substitute for use inside the map string
// (the map is embedded in the system prompt, not printed with chalk)
function chalk_dim(s: string): string {
  return s; // plain text in the prompt — no ANSI
}

// ─── Incremental update ───────────────────────────────────────────────────────
// Called after write_file / edit_file / delete_file / create_dir so the map
// stays current without a full rescan.

export function rebuildFileInMap(map: ContextMap, filePath: string): void {
  const rel = path.relative(map.rootDir, path.resolve(filePath)).replace(/\\/g, "/");

  // Remove existing entry for this path
  const idx = map.entries.findIndex((e) => e.relativePath.replace(/\\/g, "/") === rel);
  if (idx !== -1) map.entries.splice(idx, 1);

  // If file still exists, re-add with fresh symbols
  const fullPath = path.resolve(filePath);
  if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const symbols = extractSymbols(fullPath, content);
      // Insert at correct sorted position
      const newEntry: MapEntry = { relativePath: rel, symbols, isDir: false };
      map.entries.push(newEntry);
      map.entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    } catch { /* skip */ }
  }
}

export function removeFromMap(map: ContextMap, filePath: string): void {
  const rel = path.relative(map.rootDir, path.resolve(filePath)).replace(/\\/g, "/");
  map.entries = map.entries.filter(
    (e) => !e.relativePath.replace(/\\/g, "/").startsWith(rel)
  );
}
