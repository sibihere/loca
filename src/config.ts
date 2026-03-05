import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { parse, stringify } from "smol-toml";
import type { ProxyConfig } from "./proxy.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServerType = "ollama" | "openai-compatible";

export interface Config {
  connection: {
    host: string;
    model: string;
    serverType: ServerType;
    apiKey?: string;
    basePath?: string;
  };
  proxy?: ProxyConfig;
  project?: ProjectConfig;
}

export interface ProjectConfig {
  model?: string;
  exclude?: string[];
  autoApprove?: boolean;
  mapBudget?: number;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function getConfigDir(): string {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "loca");
  }
  return path.join(os.homedir(), ".loca");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.toml");
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export function loadConfig(): Config | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = parse(raw) as unknown as Config;
    if (parsed?.connection?.host && parsed?.connection?.model) {
      parsed.connection.serverType ??= "ollama";
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export function saveConfig(config: Config): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Strip password before saving (safety guard — should never be on Config)
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.proxy) delete safe.proxy.password;
  if (safe.connection) delete safe.connection.apiKey; // Never persist API keys
  const tomlString = stringify(safe as Record<string, unknown>);
  fs.writeFileSync(getConfigPath(), tomlString, "utf-8");
}

export function clearConfig(): void {
  const p = getConfigPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * Loads project-specific config from .loca.toml in the working directory.
 */
export function loadProjectConfig(cwd: string): ProjectConfig | null {
  const p = path.join(cwd, ".loca.toml");
  if (!fs.existsSync(p)) return null;

  try {
    const content = fs.readFileSync(p, "utf-8");
    return parse(content) as ProjectConfig;
  } catch (err) {
    console.error(chalk.red(`  Error parsing .loca.toml: ${err instanceof Error ? err.message : String(err)}`));
    return null;
  }
}
