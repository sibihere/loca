// ─── Shell tool ───────────────────────────────────────────────────────────────
// run_command: execute a shell command in the current working directory.
// Always requires user permission (handled by the agent before calling here).

import { execSync, spawn } from "child_process";
import { ensureInsideWorkspace } from "../utils/paths.js";
import chalk from "chalk";

let _cachedShell: string | null = null;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ─── run_command ──────────────────────────────────────────────────────────────

export async function runCommand(
  command: string,
  workingDirectory?: string
): Promise<string> {
  if (workingDirectory) {
    try {
      ensureInsideWorkspace(workingDirectory);
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  const shell = resolveShell();
  const cwd = workingDirectory ? (workingDirectory.startsWith(".") ? workingDirectory : workingDirectory) : process.cwd();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;

    try {
      child = spawn(command, {
        shell,
        cwd,
        env: process.env,
        timeout: 120_000, // Phase 2: increased to 120s
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve(`Error starting command: ${msg}`);
      return;
    }

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 1024 * 1024 * 2) { // 2MB cap
        child.kill();
      }
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 1024 * 1024 * 2) { // 2MB cap
        child.kill();
      }
    });

    child.on("error", (err) => {
      resolve(`Error: ${err.message}`);
    });

    child.on("close", (code) => {
      const out = stdout.trim();
      if (code === 0) {
        resolve(out || "(command exited with no output)");
      } else {
        const parts: string[] = [`Exit code: ${code ?? 1}`];
        if (out) parts.push(`stdout:\n${out}`);
        if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
        resolve(parts.join("\n"));
      }
    });
  });
}

// ─── Resolve platform shell ───────────────────────────────────────────────────

function resolveShell(): string {
  if (_cachedShell) return _cachedShell;

  if (process.platform === "win32") {
    try {
      execSync("pwsh --version", { stdio: "ignore", timeout: 2000 });
      _cachedShell = "pwsh";
    } catch {
      _cachedShell = "cmd";
    }
  } else {
    _cachedShell = process.env.SHELL ?? "/bin/sh";
  }
  return _cachedShell;
}

// ─── Type guard for execSync errors ──────────────────────────────────────────

interface ExecError extends Error {
  status?: number;
  stdout?: Buffer;
  stderr?: Buffer;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error && "status" in err;
}

// ─── Pretty-print command output for the terminal ────────────────────────────

export function formatCommandOutput(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length <= 20) return raw;
  // Truncate long output
  const head = lines.slice(0, 15).join("\n");
  const tail = lines.slice(-5).join("\n");
  return (
    head +
    chalk.dim(`\n  … (${lines.length - 20} lines omitted) …\n`) +
    tail
  );
}
