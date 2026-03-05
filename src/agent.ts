// ─── Agent core ───────────────────────────────────────────────────────────────
// ReAct loop with context map injection, auto-approve mode, context compression,
// and session-aware history management.

import fs from "fs";
import path from "path";
import readline from "readline";
import chalk from "chalk";
import { streamChat, chat, type Message, type OllamaOptions } from "./ollama.js";
import { parseToolCall, hasToolCall } from "./parser.js";
import { dispatchReadOnly, executeTool, PERMISSION_TOOLS, UNDOABLE_TOOLS } from "./tools/index.js";
import { askPermission, snapshotForUndo, undoLast } from "./permissions.js";
import { buildSystemPrompt } from "./prompts.js";
import {
  buildContextMap,
  renderContextMap,
  rebuildFileInMap,
  removeFromMap,
  type ContextMap,
} from "./context_map.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
// Warn when estimated tokens exceed this fraction of a conservative 8k context window
// (Can be overridden via AgentOptions)
const DEFAULT_TOKEN_WARN_THRESHOLD = 6000;
// When over limit, compress: keep system prompt + last N turns
const DEFAULT_COMPRESSION_KEEP_TURNS = 10;

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface AgentOptions {
  ollama: OllamaOptions;
  workDir?: string;         // project root for context map (default: process.cwd())
  contextFiles?: string[];  // extra files to pre-load into system prompt
  mapBudget?: number;       // token budget for context map (default: 800)
  mapEnabled?: boolean;     // whether to inject context map (default: true)
  autoApprove?: boolean;    // skip permission prompts (default: false)
  excludePatterns?: string[]; // custom patterns to skip in context map
  tokenThreshold?: number;  // when to trigger compression
  keepTurns?: number;       // how many turns to keep when compressing
}

export class Agent {
  private history: Message[] = [];
  private opts: OllamaOptions;
  private workDir: string;
  private contextFiles: string[] = [];
  private extraFileContents: string[] = [];
  private mapBudget: number;
  private mapEnabled: boolean;
  private autoApprove: boolean;
  private excludePatterns: string[];
  private tokenThreshold: number;
  private keepTurns: number;
  private contextMap: ContextMap | null = null;
  private retryCount = 0;

  constructor(options: AgentOptions) {
    this.opts = options.ollama;
    this.workDir = options.workDir ?? process.cwd();
    this.contextFiles = options.contextFiles ?? [];
    this.mapBudget = options.mapBudget ?? 800;
    this.mapEnabled = options.mapEnabled ?? true;
    this.autoApprove = options.autoApprove ?? false;
    this.excludePatterns = options.excludePatterns ?? [];
    this.tokenThreshold = options.tokenThreshold ?? DEFAULT_TOKEN_WARN_THRESHOLD;
    this.keepTurns = options.keepTurns ?? DEFAULT_COMPRESSION_KEEP_TURNS;

    // Load context files content
    this.loadContextFileContents();

    // Build initial context map
    if (this.mapEnabled) {
      this.rebuildMap();
    }

    // Build system prompt with map
    this.resetSystemPrompt();
  }

  // ─── System prompt management ─────────────────────────────────────────────

  private resetSystemPrompt(): void {
    const mapText = this.mapEnabled && this.contextMap
      ? renderContextMap(this.contextMap)
      : undefined;

    const systemContent = buildSystemPrompt({
      contextMap: mapText,
      contextFiles: this.extraFileContents,
    });

    if (this.history.length === 0) {
      this.history = [{ role: "system", content: systemContent }];
    } else {
      this.history[0] = { role: "system", content: systemContent };
    }
  }

  // ─── Context map operations ───────────────────────────────────────────────

  rebuildMap(): void {
    try {
      if (this.mapEnabled) {
        this.contextMap = buildContextMap(this.workDir, this.mapBudget, this.excludePatterns);
      }
      this.resetSystemPrompt();
    } catch { /* non-fatal */ }
  }

  setMapEnabled(enabled: boolean): void {
    this.mapEnabled = enabled;
    this.resetSystemPrompt();
    console.log(chalk.dim(`  Context map ${enabled ? "enabled" : "disabled"}.`));
  }

  setMapBudget(tokens: number): void {
    this.mapBudget = tokens;
    this.rebuildMap();
    console.log(chalk.dim(`  Map budget set to ${tokens} tokens.`));
  }

  getMap(): ContextMap | null {
    return this.contextMap;
  }

  printMap(subPath?: string): void {
    if (!this.mapEnabled || !this.contextMap) {
      console.log(chalk.yellow("  Context map is disabled. Use /map on to enable."));
      return;
    }

    let map = this.contextMap;

    // If subpath provided, rebuild map rooted there
    if (subPath) {
      const target = path.resolve(this.workDir, subPath);
      if (!fs.existsSync(target)) {
        console.log(chalk.red(`  Path not found: ${subPath}`));
        return;
      }
      try {
        const { buildContextMap: bm, renderContextMap: rm } = {
          buildContextMap: buildContextMap,
          renderContextMap: renderContextMap,
        };
        const subMap = bm(target, this.mapBudget);
        console.log();
        console.log(chalk.dim(rm(subMap)));
        console.log();
        return;
      } catch { /* fall through */ }
    }

    console.log();
    console.log(chalk.dim(renderContextMap(map)));
    console.log();
  }

  // ─── Context files ────────────────────────────────────────────────────────

  addContextFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.log(chalk.red(`  File not found: ${filePath}`));
      return;
    }
    try {
      const content = fs.readFileSync(resolved, "utf-8");
      const rel = path.relative(this.workDir, resolved);
      this.extraFileContents.push(`### ${rel}\n\`\`\`\n${content}\n\`\`\``);
      this.contextFiles.push(filePath);
      this.resetSystemPrompt();
      console.log(chalk.green(`  ✓ Added to context: ${rel}`));
    } catch (err: unknown) {
      console.log(chalk.red(`  Could not read file: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  private loadContextFileContents(): void {
    this.extraFileContents = [];
    for (const f of this.contextFiles) {
      const resolved = path.resolve(f);
      if (!fs.existsSync(resolved)) continue;
      try {
        const content = fs.readFileSync(resolved, "utf-8");
        const rel = path.relative(this.workDir, resolved);
        this.extraFileContents.push(`### ${rel}\n\`\`\`\n${content}\n\`\`\``);
      } catch { /* skip */ }
    }
  }

  // ─── Auto-approve mode ────────────────────────────────────────────────────

  setAutoApprove(enabled: boolean): void {
    this.autoApprove = enabled;
    if (enabled) {
      console.log(chalk.yellow("\n  ⚡ Auto-approve ON — all actions will execute without prompting.\n"));
    } else {
      console.log(chalk.green("\n  ✓ Auto-approve OFF — actions will require your approval.\n"));
    }
  }

  isAutoApprove(): boolean {
    return this.autoApprove;
  }

  // ─── History access (for session save/restore) ────────────────────────────

  getHistory(): Message[] {
    return this.history;
  }

  setHistory(messages: Message[]): void {
    this.history = messages;
    // Refresh system prompt in case map/context changed
    this.resetSystemPrompt();
    console.log(chalk.dim(`  Restored ${messages.filter((m) => m.role !== "system").length} turns from session.`));
  }

  // ─── Public: send a user message, run loop ────────────────────────────────

  async run(userMessage: string, rl?: readline.Interface): Promise<void> {
    this.history.push({ role: "user", content: userMessage });
    this.retryCount = 0;
    await this.checkTokenWarning();
    await this.loop(rl);
  }

  // ─── Token warning + context compression ─────────────────────────────────

  private async checkTokenWarning(): Promise<void> {
    const approx = this.estimateTokens();
    if (approx > this.tokenThreshold) {
      console.log(
        chalk.yellow(`\n  ⚠ Context is large (~${approx} tokens). `) +
        chalk.dim("Older messages will be summarized to save context space.\n")
      );
      await this.compressHistory();
    }
  }

  private async compressHistory(): Promise<void> {
    const system = this.history[0];
    const nonSystem = this.history.slice(1);

    if (nonSystem.length <= this.keepTurns * 2) return;

    // Keep last N turns
    const keep = nonSystem.slice(-(this.keepTurns * 2));
    const toSummarize = nonSystem.slice(0, nonSystem.length - keep.length);

    process.stdout.write(chalk.dim("  Summarizing earlier turns..."));

    try {
      const summaryPrompt = [
        { role: "system" as const, content: "You are a concise assistant. Provide a very brief, high-level summary of the following conversation turns so the assistant can maintain context. Focus on key decisions, task status, and important discoveries." },
        { role: "user" as const, content: JSON.stringify(toSummarize) },
      ];

      const summary = await chat(this.opts, summaryPrompt);
      const summaryMessage = `[Summary of earlier conversation: ${summary}]`;

      this.history = [
        system,
        { role: "assistant", content: summaryMessage },
        ...keep,
      ];
      console.log(chalk.green(" ✓\n"));
    } catch (err) {
      // Fallback to simple truncation if summarization fails
      console.log(chalk.yellow(" ✗ (failed, falling back to truncation)\n"));
      this.history = [
        system,
        { role: "user", content: "[Earlier conversation truncated to save space.]" },
        ...keep,
      ];
    }
  }

  private estimateTokens(): number {
    return this.history
      .map((m) => Math.ceil(m.content.length / 4) + 12) // +12 for role/formatting overhead
      .reduce((a, b) => a + b, 0);
  }

  // ─── Main ReAct loop ──────────────────────────────────────────────────────

  private async loop(rl?: readline.Interface): Promise<void> {
    while (true) {
      // ── Stream LLM response ──────────────────────────────────────────
      let fullResponse = "";
      let toolBlockDepth = 0;  // Track nested tool/done blocks
      let thinkingDepth = 0;   // Track <think> blocks
      process.stdout.write(chalk.bold.cyan("\n  loca ▸ "));

      try {
        fullResponse = await streamChat(this.opts, this.history, (token) => {
          // Count opening and closing tags to track depth
          const openTool = (token.match(/<tool[^>]*>/gi) || []).length;
          const closeTool = (token.match(/<\/tool>/gi) || []).length;
          const openDone = (token.match(/<done/gi) || []).length;
          const closeDone = (token.match(/<\/done>/gi) || []).length;
          const openThink = (token.match(/<think>/gi) || []).length;
          const closeThink = (token.match(/<\/think>/gi) || []).length;

          toolBlockDepth += openTool + openDone - closeTool - closeDone;
          thinkingDepth += openThink - closeThink;

          // Only print if we're not inside any tool/done/thinking block
          if (toolBlockDepth <= 0 && thinkingDepth <= 0) {
            process.stdout.write(chalk.white(token));
          }
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\n\n  ✗ Connection error: ${msg}`));
        console.error(chalk.dim("  Check the server is running, then try again."));
        return;
      }

      console.log();

      // ── Parse ────────────────────────────────────────────────────────
      const parsed = parseToolCall(fullResponse);

      // Retry on malformed tool call
      if (parsed === null && hasToolCall(fullResponse)) {
        if (this.retryCount < MAX_RETRIES) {
          this.retryCount++;
          const errMsg =
            "Your last response contained what looked like a tool call but it could not be parsed. " +
            "Output a valid <tool> block: <tool><n>tool_name</n><path>…</path></tool>";
          this.history.push({ role: "assistant", content: fullResponse });
          this.history.push({ role: "user", content: errMsg });
          console.log(chalk.yellow(`\n  ⚠ Retrying (${this.retryCount}/${MAX_RETRIES})...`));
          continue;
        }
        // Max retries exceeded - show error and stop
        console.log(chalk.red(`\n  ✗ Could not parse tool block after ${MAX_RETRIES} attempts.`));
        console.log(chalk.dim("  The LLM may have output malformed XML. Try again or check the model output."));
        this.history.push({ role: "assistant", content: fullResponse });
        return;
      }

      this.retryCount = 0;

      // Plain text — return to REPL
      if (parsed === null) {
        this.history.push({ role: "assistant", content: fullResponse });
        return;
      }

      // Done
      if (parsed === "done") {
        this.history.push({ role: "assistant", content: fullResponse });
        console.log(chalk.green("\n  ✓ Task complete.\n"));
        return;
      }

      // ── Tool call ────────────────────────────────────────────────────
      this.history.push({ role: "assistant", content: fullResponse });

      const isWrite = PERMISSION_TOOLS.has(parsed.name);
      const icon = isWrite ? chalk.yellow("⚡") : chalk.blue("⚙");
      console.log(`\n  ${icon} ${chalk.bold(parsed.name)}(${summariseParams(parsed.params)})`);

      // Read-only tools: execute immediately
      const readResult = dispatchReadOnly(parsed);
      if (readResult !== null) {
        console.log(chalk.dim(`  → ${oneLineTrunc(readResult.output, 120)}`));
        this.history.push({
          role: "user",
          content: `[Tool result: ${parsed.name}]\n${readResult.output}`,
        });
        continue;
      }

      // Write/execute tools: permission gate (or auto-approve)
      let decision: "approved" | "rejected" | "stop" = "approved";
      let editedParams: Record<string, string> | undefined;

      if (this.autoApprove) {
        console.log(chalk.yellow("  ⚡ Auto-approved"));
      } else {
        const result = await askPermission(parsed, rl);
        decision = result.decision;
        editedParams = result.editedParams;
      }

      if (decision === "stop") {
        this.history.push({ role: "user", content: "[Agent stopped by user.]" });
        return;
      }

      if (decision === "rejected") {
        this.history.push({
          role: "user",
          content: `[Action rejected by user: ${parsed.name}. Try a different approach.]`,
        });
        continue;
      }

      // Apply editor changes if user edited
      if (editedParams) {
        parsed.params = { ...parsed.params, ...editedParams };
      }

      // Snapshot for undo
      if (UNDOABLE_TOOLS.has(parsed.name) && parsed.params.path) {
        snapshotForUndo(parsed.name, parsed.params.path);
      }

      const output = await executeTool(parsed);
      const isError = output.startsWith("Error:");

      if (isError) {
        console.log(chalk.red(`\n  ✗ ${output}\n`));
      } else {
        console.log(chalk.green(`\n  ✓ ${output}\n`));
        // Update context map after successful file mutations
        if (this.mapEnabled && this.contextMap) {
          this.updateMapAfterTool(parsed.name, parsed.params.path ?? "");
        }
      }

      this.history.push({
        role: "user",
        content: `[Tool result: ${parsed.name}]\n${output}`,
      });
    }
  }

  // ─── Map update after tool execution ─────────────────────────────────────

  private updateMapAfterTool(toolName: string, filePath: string): void {
    if (!this.contextMap || !filePath) return;
    try {
      if (toolName === "delete_file") {
        removeFromMap(this.contextMap, filePath);
      } else if (toolName === "write_file" || toolName === "edit_file") {
        rebuildFileInMap(this.contextMap, filePath);
      } else if (toolName === "create_dir") {
        this.rebuildMap(); // full rebuild for new directories
        return;
      }
      this.resetSystemPrompt();
    } catch { /* non-fatal */ }
  }

  // ─── Public commands ──────────────────────────────────────────────────────

  clearHistory(): void {
    this.history = [this.history[0]];
    console.log(chalk.dim("  Conversation history cleared."));
  }

  undo(): void {
    console.log(chalk.cyan(`\n  ↩ ${undoLast()}\n`));
  }

  status(): void {
    const turns = this.history.filter((m) => m.role !== "system").length;
    const approxTokens = this.estimateTokens();
    const tokenColor = approxTokens > this.tokenThreshold ? chalk.yellow : chalk.green;
    const mapStatus = !this.mapEnabled
      ? chalk.dim("off")
      : this.contextMap
        ? chalk.green(`${this.contextMap.entries.filter((e) => !e.isDir).length} files, ~${this.contextMap.tokenCount} tokens`)
        : chalk.dim("not built");

    console.log();
    console.log(chalk.bold("  Status"));
    console.log(`  Host:      ${chalk.cyan(this.opts.host)}`);
    console.log(`  Server:    ${chalk.cyan(this.opts.serverType)}`);
    console.log(`  Model:     ${chalk.cyan(this.opts.model)}`);
    console.log(`  Turns:     ${turns}`);
    console.log(`  Tokens:    ${tokenColor(`~${approxTokens}`)} (estimated)`);
    console.log(`  Map:       ${mapStatus}`);
    console.log(`  Auto:      ${this.autoApprove ? chalk.yellow("ON") : chalk.dim("off")}`);
    console.log(`  Work dir:  ${chalk.dim(this.workDir)}`);
    console.log();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function summariseParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}: ${oneLineTrunc(v, 40)}`)
    .join(", ");
}

function oneLineTrunc(s: string, n: number): string {
  const flat = s.replace(/\n/g, "↵");
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}
