// ─── Startup connection wizard ────────────────────────────────────────────────
// Step 1: Pick server type
// Step 2: Enter host URL + test connection
// Step 3: Pick model
// Step 4: Proxy? (optional — auto-offered on connection failure, or manually)
// Step 5: Save settings?

import readline from "readline";
import chalk from "chalk";
import { listModels } from "./ollama.js";
import { saveConfig, type Config, type ServerType } from "./config.js";
import { applyProxy, proxyFromEnv, type ProxyConfig } from "./proxy.js";

// ─── Readline helpers ─────────────────────────────────────────────────────────

function ask(question: string, defaultVal = ""): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultVal ? chalk.dim(` [${defaultVal}]`) : "";
    rl.question(`  ${question}${hint}: `, (ans) => {
      rl.close();
      resolve(ans.trim() || defaultVal);
    });
  });
}

function askYN(question: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = chalk.dim(defaultYes ? " [Y/n]" : " [y/N]");
    rl.question(`  ${question}${hint}: `, (ans) => {
      rl.close();
      const a = ans.trim().toLowerCase();
      resolve(a ? a === "y" || a === "yes" : defaultYes);
    });
  });
}

function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Hide input for password on supported terminals
    if (process.stdout.isTTY) {
      process.stdout.write(`  ${question}: `);
      process.stdin.setRawMode(true);
      let pwd = "";
      process.stdin.resume();
      process.stdin.setEncoding("utf-8");
      const onData = (ch: string) => {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(pwd);
        } else if (ch === "\u0003") { // Ctrl+C
          process.exit();
        } else if (ch === "\u007f") { // Backspace
          pwd = pwd.slice(0, -1);
        } else {
          pwd += ch;
          process.stdout.write("•");
        }
      };
      process.stdin.on("data", onData);
    } else {
      rl.question(`  ${question}: `, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    }
  });
}

// ─── Numbered menu ────────────────────────────────────────────────────────────

async function pickFromMenu<T>(
  items: { label: string; value: T; hint?: string }[],
  prompt: string,
  defaultIndex = 0
): Promise<T> {
  items.forEach((item, i) => {
    const num = chalk.cyan(`${i + 1}.`.padStart(3));
    const hint = item.hint ? chalk.dim(`  — ${item.hint}`) : "";
    console.log(`${num}  ${item.label}${hint}`);
  });
  console.log();

  while (true) {
    const raw = await ask(prompt, String(defaultIndex + 1));
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n <= items.length) return items[n - 1].value;
    console.log(chalk.yellow(`  Enter a number between 1 and ${items.length}.`));
  }
}

// ─── Server profiles ──────────────────────────────────────────────────────────

interface ServerProfile {
  type: ServerType;
  label: string;
  hint: string;
  defaultPort: number;
  defaultHost: string;
}

const SERVER_PROFILES: ServerProfile[] = [
  { type: "ollama", label: "Ollama", hint: "local or remote Ollama server", defaultPort: 11434, defaultHost: "http://localhost:11434" },
  { type: "openai-compatible", label: "LM Studio", hint: "LM Studio local server", defaultPort: 1234, defaultHost: "http://localhost:1234" },
  { type: "openai-compatible", label: "OpenAI-compatible", hint: "llama.cpp, Jan, Msty, vLLM, etc.", defaultPort: 8080, defaultHost: "http://localhost:8080" },
];

// ─── Proxy wizard (standalone — can be called from /proxy connect) ────────────

export async function runProxyWizard(): Promise<ProxyConfig | null> {
  console.log();
  console.log(chalk.bold("  Proxy Configuration"));
  console.log();

  const enabled = await askYN("Enable proxy?", true);
  if (!enabled) return { enabled: false, url: "" };

  const url = await ask("Proxy URL (e.g. http://proxy.corp.com:8080)");
  if (!url) {
    console.log(chalk.yellow("  No URL entered — proxy not configured."));
    return null;
  }

  const needsAuth = await askYN("Does the proxy require authentication?", false);
  let username: string | undefined;
  let password: string | undefined;

  if (needsAuth) {
    username = await ask("Username");
    password = await askPassword("Password");
    console.log(chalk.dim("  (Password stored in session memory only — not saved to disk)"));
  }

  const cfg: ProxyConfig = { enabled: true, url, username, password };
  applyProxy(cfg);
  console.log(chalk.green(`  ✓ Proxy configured: ${url}`));
  console.log();

  return cfg;
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export async function runWizard(): Promise<Config> {
  console.log();
  console.log(chalk.bold.cyan("╔══════════════════════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║           loca — Local Coding Agent  v0.2            ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════════════════════════╝"));
  console.log();

  // ── Step 1: Server type ───────────────────────────────────────────────────
  console.log(chalk.bold("  What kind of server are you connecting to?"));
  console.log();
  const profile = await pickFromMenu(
    SERVER_PROFILES.map((p) => ({ label: p.label, value: p, hint: p.hint })),
    "Select server type",
    0
  );
  console.log();

  // Check for env proxy and mention it before connection attempt
  const envProxy = proxyFromEnv();
  if (envProxy) {
    console.log(chalk.dim(`  ℹ Using proxy from environment: ${envProxy.url}`));
    applyProxy(envProxy);
    console.log();
  }

  // ── Step 2: Host URL + connection loop ────────────────────────────────────
  console.log(chalk.bold("  Enter the server URL:"));
  console.log(chalk.dim(`  Default port for ${profile.label}: ${profile.defaultPort}`));
  console.log();

  let host = "";
  let apiKey: string | undefined;
  let basePath: string | undefined;
  let models: string[] = [];
  let proxyConfigured = !!envProxy;

  while (true) {
    host = (await ask("Host", profile.defaultHost)).replace(/\/$/, "");

    if (profile.type === "openai-compatible") {
      basePath = await ask("API Base Path (e.g. /v1, /v1/chat)", "/v1");
      if (basePath === "/v1") basePath = undefined;
    }

    const needsAuth = await askYN("Does this server require an API key (Bearer token)?", false);
    if (needsAuth) {
      apiKey = await askPassword("API Key");
    }

    process.stdout.write(chalk.dim(`\n  Connecting to ${host} ...`));

    try {
      models = await listModels(host, profile.type, apiKey, basePath);
      process.stdout.write(chalk.green(" ✓\n\n"));
      break;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(chalk.red(" ✗\n\n"));
      console.log(chalk.red("  Connection failed:"), chalk.dim(msg));
      console.log();
      printConnectionHints(profile, host, proxyConfigured);

      // Offer proxy setup if not yet configured and it looks like a network error
      if (!proxyConfigured) {
        const wantProxy = await askYN("Are you behind a proxy?", false);
        if (wantProxy) {
          await runProxyWizard();
          proxyConfigured = true;
          console.log(chalk.dim("  Retrying connection with proxy...\n"));
          continue; // retry immediately with proxy active
        }
      }

      const retry = await askYN("Try a different host?", true);
      if (!retry) {
        console.log(chalk.red("\n  Exiting. Fix the connection and run loca again.\n"));
        process.exit(1);
      }
      console.log();
    }
  }

  // ── Step 3: Model ─────────────────────────────────────────────────────────
  if (models.length === 0) {
    console.log(chalk.yellow("  No models found on this server."));
    printNoModelsHint(profile);
    const manual = await ask("Enter model name manually");
    models = [manual.trim() || "default"];
  }

  console.log(chalk.bold("  Available models:"));
  console.log();
  const model = await pickFromMenu(
    models.map((m) => ({ label: m, value: m })),
    "Select model",
    0
  );
  console.log();
  console.log(chalk.green("  ✓") + chalk.dim(` ${profile.label}  |  `) + chalk.bold(model));
  console.log();

  // ── Step 4: Proxy (if not already configured) ─────────────────────────────
  if (!proxyConfigured) {
    const wantProxy = await askYN("Are you behind a proxy? (optional)", false);
    if (wantProxy) await runProxyWizard();
    console.log();
  }

  // ── Step 5: Save? ─────────────────────────────────────────────────────────
  const save = await askYN("Save these settings for next time?", true);

  const config: Config = {
    connection: {
      host,
      model,
      serverType: profile.type,
      apiKey,
      basePath,
    },
  };
  if (save) {
    saveConfig(config);
    console.log(chalk.dim("  Settings saved."));
    console.log(chalk.dim("  Note: proxy password is not saved — you will be prompted each session."));
  }
  console.log();

  return config;
}

// ─── Hints ────────────────────────────────────────────────────────────────────

function printConnectionHints(profile: ServerProfile, host: string, proxyTried: boolean): void {
  console.log(chalk.yellow("  Troubleshooting:"));
  if (profile.type === "ollama") {
    console.log(chalk.dim("  • Is Ollama running?  →  ollama serve"));
    console.log(chalk.dim(`  • Default port: ${profile.defaultPort}`));
    if (!host.includes("localhost") && !host.includes("127.0.0.1")) {
      console.log(chalk.dim("  • Remote host: ensure firewall allows port " + profile.defaultPort));
      console.log(chalk.dim("  • Set OLLAMA_HOST=0.0.0.0 on the remote machine"));
    }
  } else {
    console.log(chalk.dim("  • Is the local server running?"));
    console.log(chalk.dim(`  • LM Studio: Server tab → Start Server (port ${profile.defaultPort})`));
    console.log(chalk.dim("  • Ensure a model is loaded before starting the server"));
  }
  if (!proxyTried) {
    console.log(chalk.dim("  • On a corporate network? You may need a proxy."));
  }
  console.log(chalk.dim("  • Include http:// or https:// in the URL"));
  console.log();
}

function printNoModelsHint(profile: ServerProfile): void {
  console.log();
  if (profile.type === "ollama") {
    console.log(chalk.dim("  Pull a model:  ollama pull deepseek-coder:6.7b"));
  } else {
    console.log(chalk.dim("  Load a model in LM Studio before starting the server."));
  }
  console.log();
}
