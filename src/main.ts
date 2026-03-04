#!/usr/bin/env node
// ─── loca — Local Coding Agent ───────────────────────────────────────────────
// Entry point: parse CLI flags → run wizard or load saved config → start REPL

import readline from "readline";
import path from "path";
import chalk from "chalk";
import { loadConfig, clearConfig, type Config } from "./config.js";
import { runWizard, runProxyWizard } from "./wizard.js";
import { Agent } from "./agent.js";
import { listModels } from "./ollama.js";
import {
  applyProxy, clearProxy, printProxyStatus, proxyFromEnv, type ProxyConfig,
} from "./proxy.js";
import {
  saveSession, loadLatestSession, loadSession, listSessions,
} from "./session.js";

// ─── CLI flags ────────────────────────────────────────────────────────────────

interface CliArgs {
  forceConnect: boolean;
  host: string | null;
  model: string | null;
  help: boolean;
  resume: boolean;
  sessionFile: string | null;
  contextFiles: string[];
  auto: boolean;
  noMap: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const result: CliArgs = {
    forceConnect: false, host: null, model: null, help: false,
    resume: false, sessionFile: null, contextFiles: [], auto: false, noMap: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--connect":   case "-c":  result.forceConnect = true; break;
      case "--host":                  result.host  = args[++i] ?? null; break;
      case "--model":                 result.model = args[++i] ?? null; break;
      case "--help":      case "-h":  result.help = true; break;
      case "--resume":    case "-r":  result.resume = true; break;
      case "--session":               result.sessionFile = args[++i] ?? null; break;
      case "--context":               result.contextFiles.push(args[++i] ?? ""); break;
      case "--auto":                  result.auto = true; break;
      case "--no-map":                result.noMap = true; break;
      case "--reset":
        clearConfig();
        console.log(chalk.green("Config cleared."));
        process.exit(0);
    }
  }
  return result;
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${chalk.bold.cyan("loca")} — Local Coding Agent  v0.3

${chalk.bold("Usage:")}
  npm start                            Launch (wizard on first run, saved config after)
  npm start -- --connect               Force re-run connection wizard
  npm start -- --host <url>            Set server host directly
  npm start -- --model <name>          Set model directly
  npm start -- --resume                Resume last saved session
  npm start -- --session <file>        Resume a specific session file
  npm start -- --context <file>        Pre-load a file into context (repeatable)
  npm start -- --auto                  Start with auto-approve enabled
  npm start -- --no-map                Start without building context map
  npm start -- --reset                 Clear saved config

${chalk.bold("In-session commands:")}
  ${chalk.cyan("/connect")}                          Re-run connection + proxy wizard
  ${chalk.cyan("/model [name]")}                     Switch model, or list available models
  ${chalk.cyan("/context <file>")}                   Add a file to the LLM context
  ${chalk.cyan("/map")}                              Show current project map
  ${chalk.cyan("/map <path>")}                       Zoom map into a subdirectory
  ${chalk.cyan("/map rebuild")}                      Force a full project rescan
  ${chalk.cyan("/map budget <n>")}                   Set map token budget (default: 800)
  ${chalk.cyan("/map off")}                          Disable context map injection
  ${chalk.cyan("/map on")}                           Re-enable context map injection
  ${chalk.cyan("/auto")}                             Toggle auto-approve mode
  ${chalk.cyan("/session save")}                     Save current conversation
  ${chalk.cyan("/session list")}                     List saved sessions
  ${chalk.cyan("/session load <file>")}              Load a saved session
  ${chalk.cyan("/proxy")}                            Show proxy status
  ${chalk.cyan("/proxy set <url>")}                  Set proxy URL for this session
  ${chalk.cyan("/proxy auth")}                       Re-enter proxy credentials
  ${chalk.cyan("/proxy off")}                        Disable proxy for this session
  ${chalk.cyan("/proxy on")}                         Re-enable proxy
  ${chalk.cyan("/undo")}                             Revert last file action
  ${chalk.cyan("/clear")}                            Clear conversation history
  ${chalk.cyan("/status")}                           Show model, map, proxy, token info
  ${chalk.cyan("/help")}                             Show this help
  ${chalk.cyan("/exit")}  or  Ctrl+C                 Quit

${chalk.bold("Examples:")}
  npm start -- --host http://my-server:11434 --model deepseek-coder:6.7b
  npm start -- --resume
  npm start -- --context src/main.ts --context package.json
  npm start -- --auto --no-map
`);
}

// ─── Proxy init ───────────────────────────────────────────────────────────────

async function initProxy(config: Config): Promise<void> {
  const envProxy = proxyFromEnv();
  if (envProxy) {
    applyProxy(envProxy);
    console.log(chalk.dim(`  ℹ Proxy from environment: ${envProxy.url}`));
    return;
  }

  const saved = config.proxy;
  if (saved?.enabled && saved.url) {
    if (saved.username) {
      console.log(chalk.yellow(`\n  Proxy configured (${saved.url}) — password required each session.`));
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: process.platform !== "win32",
      });
      const password = await new Promise<string>((resolve) => {
        rl.question(chalk.dim(`  Proxy password for ${saved.username}: `), (ans) => {
          rl.close(); resolve(ans);
        });
      });
      applyProxy({ ...saved, password });
      console.log(chalk.dim("  Proxy active.\n"));
    } else {
      applyProxy(saved);
      console.log(chalk.dim(`  Proxy active: ${saved.url}`));
    }
  }
}

// ─── REPL ─────────────────────────────────────────────────────────────────────

async function startRepl(config: Config, args: CliArgs): Promise<void> {
  await initProxy(config);

  const agent = new Agent({
    ollama: {
      host: config.connection.host,
      model: config.connection.model,
      serverType: config.connection.serverType,
    },
    workDir: process.cwd(),
    contextFiles: args.contextFiles,
    mapEnabled: !args.noMap,
    autoApprove: args.auto,
  });

  // Restore session if requested
  if (args.resume || args.sessionFile) {
    const session = args.sessionFile
      ? loadSession(args.sessionFile)
      : loadLatestSession();
    if (session) {
      agent.setHistory(session.messages);
      console.log(chalk.dim(`  Resumed session from ${session.savedAt}\n`));
    } else {
      console.log(chalk.yellow("  No session found to resume.\n"));
    }
  }

  console.log();
  console.log(
    chalk.bold("  ✓") +
    chalk.dim(` ${config.connection.host}`) +
    chalk.dim("  |  ") + chalk.dim(config.connection.serverType) +
    chalk.dim("  |  ") + chalk.cyan(config.connection.model)
  );
  if (args.auto) console.log(chalk.yellow("  ⚡ Auto-approve is ON"));
  console.log(chalk.dim("  Type a task, or /help for commands. Ctrl+C to quit.\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.green("  you ▸ "),
    terminal: process.platform !== "win32",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input.startsWith("/")) {
      await handleCommand(input, config, agent, rl, args);
      rl.prompt();
      return;
    }

    rl.pause();
    try {
      await agent.run(input, rl);
    } catch (err: unknown) {
      console.error(chalk.red(`\n  Unexpected error: ${err instanceof Error ? err.message : String(err)}`));
    }
    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    // Auto-save session on clean exit if there's anything to save
    const history = agent.getHistory();
    if (history.filter((m) => m.role !== "system").length > 0) {
      const file = saveSession(history, config.connection.model, config.connection.host);
      console.log(chalk.dim(`\n  Session saved: ${path.basename(file)}`));
    }
    console.log(chalk.dim("  Bye!\n"));
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log(chalk.dim("\n\n  Interrupted. Type /exit to quit."));
    rl.prompt();
  });
}

// ─── Slash command handler ────────────────────────────────────────────────────

async function handleCommand(
  input: string,
  config: Config,
  agent: Agent,
  rl: readline.Interface,
  args: CliArgs,
): Promise<void> {
  const parts = input.slice(1).split(" ");
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(" ").trim();

  switch (cmd) {
    case "exit": case "quit":
      rl.close();
      break;

    case "help":
      printHelp();
      break;

    case "status":
      agent.status();
      printProxyStatus();
      break;

    case "clear":
      agent.clearHistory();
      break;

    case "undo":
      agent.undo();
      break;

    case "auto":
      agent.setAutoApprove(!agent.isAutoApprove());
      break;

    case "context":
      if (!rest) {
        console.log(chalk.yellow("  Usage: /context <file>"));
      } else {
        agent.addContextFile(rest);
      }
      break;

    case "map":
      await handleMapCommand(rest, agent);
      break;

    case "session":
      await handleSessionCommand(rest, agent, config);
      break;

    case "model":
      if (!rest) {
        console.log(chalk.dim("  Fetching models...\n"));
        try {
          const models = await listModels(config.connection.host, config.connection.serverType);
          models.forEach((m, i) => console.log(`  ${chalk.cyan(String(i + 1))}. ${m}`));
          console.log(chalk.dim("\n  Use /model <name> to switch."));
        } catch {
          console.log(chalk.red("  Could not fetch model list."));
        }
      } else {
        config.connection.model = rest;
        console.log(chalk.green(`  ✓ Switched to model: ${rest}`));
      }
      break;

    case "proxy":
      await handleProxyCommand(rest, config);
      break;

    case "connect":
      rl.close();
      const newConfig = await runWizard();
      startRepl(newConfig, args);
      break;

    default:
      console.log(chalk.yellow(`  Unknown command: /${cmd}. Type /help for a list.`));
  }
}

// ─── /map sub-commands ────────────────────────────────────────────────────────

async function handleMapCommand(arg: string, agent: Agent): Promise<void> {
  const sub = arg.split(" ")[0]?.toLowerCase() ?? "";
  const rest = arg.split(" ").slice(1).join(" ").trim();

  switch (sub) {
    case "":
      agent.printMap();
      break;
    case "rebuild":
      console.log(chalk.dim("  Rebuilding context map..."));
      agent.rebuildMap();
      console.log(chalk.green("  ✓ Map rebuilt."));
      agent.printMap();
      break;
    case "off":
      agent.setMapEnabled(false);
      break;
    case "on":
      agent.setMapEnabled(true);
      agent.rebuildMap();
      break;
    case "budget": {
      const n = parseInt(rest, 10);
      if (isNaN(n) || n < 100) {
        console.log(chalk.yellow("  Usage: /map budget <number>  (minimum 100)"));
      } else {
        agent.setMapBudget(n);
      }
      break;
    }
    default:
      // Treat the whole arg as a path to zoom into
      agent.printMap(arg);
  }
}

// ─── /session sub-commands ────────────────────────────────────────────────────

async function handleSessionCommand(
  arg: string,
  agent: Agent,
  config: Config
): Promise<void> {
  const sub = arg.split(" ")[0]?.toLowerCase() ?? "";
  const rest = arg.split(" ").slice(1).join(" ").trim();

  switch (sub) {
    case "save": {
      const file = saveSession(
        agent.getHistory(),
        config.connection.model,
        config.connection.host
      );
      console.log(chalk.green(`  ✓ Session saved: ${path.basename(file)}`));
      break;
    }

    case "list": {
      const sessions = listSessions();
      if (sessions.length === 0) {
        console.log(chalk.dim("  No saved sessions."));
      } else {
        console.log();
        sessions.forEach((s, i) => {
          console.log(
            `  ${chalk.cyan(String(i + 1).padStart(2))}. ${s.savedAt}` +
            chalk.dim(`  |  ${s.model}  |  ${s.messageCount} turns`) +
            `\n      ${chalk.dim(s.filePath)}`
          );
        });
        console.log();
        console.log(chalk.dim("  Use /session load <filepath> to restore one."));
      }
      break;
    }

    case "load": {
      if (!rest) {
        console.log(chalk.yellow("  Usage: /session load <filepath>"));
        return;
      }
      const session = loadSession(rest);
      if (!session) {
        console.log(chalk.red(`  Could not load session: ${rest}`));
      } else {
        agent.setHistory(session.messages);
        console.log(chalk.green(`  ✓ Loaded session from ${session.savedAt}`));
      }
      break;
    }

    default:
      console.log(chalk.yellow("  Usage: /session [save | list | load <file>]"));
  }
}

// ─── /proxy sub-commands ─────────────────────────────────────────────────────

async function handleProxyCommand(arg: string, config: Config): Promise<void> {
  const sub = arg.split(" ")[0]?.toLowerCase() ?? "";
  const rest = arg.split(" ").slice(1).join(" ").trim();

  switch (sub) {
    case "":
      printProxyStatus();
      break;
    case "set": {
      if (!rest) { console.log(chalk.yellow("  Usage: /proxy set <url>")); return; }
      const existing = config.proxy ?? { enabled: true, url: rest };
      applyProxy({ ...existing, enabled: true, url: rest } as ProxyConfig);
      console.log(chalk.green(`  ✓ Proxy set to: ${rest}`));
      break;
    }
    case "auth": {
      const proxyCfg = await runProxyWizard();
      if (proxyCfg) {
        config.proxy = { enabled: proxyCfg.enabled, url: proxyCfg.url, username: proxyCfg.username };
      }
      break;
    }
    case "off":
      clearProxy();
      console.log(chalk.dim("  Proxy disabled for this session."));
      break;
    case "on": {
      const saved = config.proxy;
      if (saved?.url) {
        applyProxy(saved as ProxyConfig);
        console.log(chalk.green(`  ✓ Proxy re-enabled: ${saved.url}`));
      } else {
        console.log(chalk.yellow("  No proxy configured. Use /proxy auth."));
      }
      break;
    }
    default:
      console.log(chalk.yellow("  Usage: /proxy [set <url> | auth | off | on]"));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) { printHelp(); process.exit(0); }

  let config: Config;

  if (args.host && args.model) {
    config = { connection: { host: args.host, model: args.model, serverType: "ollama" } };
  } else if (args.forceConnect) {
    config = await runWizard();
  } else {
    const saved = loadConfig();
    if (saved) {
      config = saved;
      if (args.host)  config.connection.host  = args.host;
      if (args.model) config.connection.model = args.model;
    } else {
      config = await runWizard();
    }
  }

  await startRepl(config, args);
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
