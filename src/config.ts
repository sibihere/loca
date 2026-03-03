import fs from "fs";
import path from "path";
import os from "os";
import { parse, stringify } from "smol-toml";
import type { ProxyConfig } from "./proxy.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServerType = "ollama" | "openai-compatible";

export interface Config {
  connection: {
    host: string;
    model: string;
    serverType: ServerType;
  };
  // Password is NEVER saved — only url/username persisted
  proxy?: Omit<ProxyConfig, "password">;
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
  const tomlString = stringify(safe as Record<string, unknown>);
  fs.writeFileSync(getConfigPath(), tomlString, "utf-8");
}

export function clearConfig(): void {
  const p = getConfigPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
