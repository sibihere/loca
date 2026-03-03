// ─── Shell tool ───────────────────────────────────────────────────────────────
// run_command: execute a shell command in the current working directory.
// Always requires user permission (handled by the agent before calling here).

import { execSync } from "child_process";
import chalk from "chalk";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ─── run_command ──────────────────────────────────────────────────────────────

export function runCommand(command: string): string {
  const shell = resolveShell();

  try {
    const stdout = execSync(command, {
      shell,
      timeout: 30_000,     // 30 second timeout
      maxBuffer: 1024 * 512, // 512 KB output cap
      cwd: process.cwd(),
      env: process.env,
    });

    const out = stdout.toString("utf-8").trim();
    return out || "(command exited with no output)";
  } catch (err: unknown) {
    // execSync throws when exit code != 0
    if (isExecError(err)) {
      const stdout = (err.stdout?.toString("utf-8") ?? "").trim();
      const stderr = (err.stderr?.toString("utf-8") ?? "").trim();
      const code = err.status ?? 1;

      const parts: string[] = [`Exit code: ${code}`];
      if (stdout) parts.push(`stdout:\n${stdout}`);
      if (stderr) parts.push(`stderr:\n${stderr}`);
      return parts.join("\n");
    }

    const msg = err instanceof Error ? err.message : String(err);
    return `Error running command: ${msg}`;
  }
}

// ─── Resolve platform shell ───────────────────────────────────────────────────

function resolveShell(): string {
  if (process.platform === "win32") {
    // Prefer PowerShell 7 if available, fallback to cmd
    try {
      execSync("pwsh --version", { stdio: "ignore", timeout: 2000 });
      return "pwsh";
    } catch {
      return "cmd";
    }
  }
  // Unix: use $SHELL or fallback to /bin/sh
  return process.env.SHELL ?? "/bin/sh";
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
