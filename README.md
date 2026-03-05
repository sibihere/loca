# loca — Local Coding Agent

An autonomous coding agent that talks to any Ollama or OpenAI-compatible model —
local or cloud-hosted. Permission-gated, proxy-aware, and context-map powered.
Runs directly from source with no build step and no admin privileges.

## Requirements

- **Node.js 18+**
  - Windows (no admin): `winget install OpenJS.NodeJS.LTS`
  - Or download the portable `.zip` from [nodejs.org](https://nodejs.org)
  - Or use `nvm-windows` / `fnm` (both user-level, no admin)
- **A running model server** — [Ollama](https://ollama.com), LM Studio, llama.cpp, Jan, vLLM, etc.
- At least one model pulled: `ollama pull deepseek-coder:6.7b`

## Quick Start

```bash
git clone https://github.com/you/loca
cd loca
npm install
npm start
```

The wizard runs on first launch — picks server type, tests connection, lists models,
optionally configures a proxy, then saves settings for next time.

---

## CLI flags

| Flag | Description |
|---|---|
| *(none)* | Launch with wizard on first run, saved config after |
| `--connect`, `-c` | Force re-run the full connection + proxy wizard |
| `--host <url>` | Set server host directly, skip wizard |
| `--model <name>` | Set model directly, skip wizard |
| `--resume`, `-r` | Resume the last saved session |
| `--session <file>` | Resume a specific session file |
| `--context <file>` | Pre-load a file into the LLM context (repeatable) |
| `--auto` | Start with auto-approve enabled (no permission prompts) |
| `--no-map` | Start without building a context map |
| `--reset` | Clear saved config and exit |
| `--help`, `-h` | Show help and exit |

**Examples:**
```bash
npm start -- --host http://my-server:11434 --model deepseek-coder:6.7b
npm start -- --connect
npm start -- --resume
npm start -- --context src/main.ts --context package.json
npm start -- --auto --no-map
```

---

## In-session commands

### Navigation
| Command | Description |
|---|---|
| `/help` | Show all commands with descriptions |
| `/status` | Show model, server, proxy status, token count, and map info |
| `/exit` | Save session and quit (also Ctrl+C) |

### Agent control
| Command | Description |
|---|---|
| `/clear` | Clear conversation history, keep context map |
| `/undo` | Revert the last approved file write, edit, or delete |
| `/auto` | Toggle auto-approve mode on/off (skips permission prompts when on) |

### Connection
| Command | Description |
|---|---|
| `/connect` | Re-run the full connection and proxy wizard |
| `/model` | List all available models on the current server |
| `/model <name>` | Switch to a different model for this session |

### Context
| Command | Description |
|---|---|
| `/context <file>` | Add a file's full contents to the LLM's system context |
| `/map` | Print the current project map (file tree + exported symbols) |
| `/map <path>` | Zoom the map into a subdirectory for higher detail |
| `/map rebuild` | Force a full project rescan |
| `/map budget <n>` | Set the map token budget (default: 800) |
| `/map off` | Disable context map injection into the system prompt |
| `/map on` | Re-enable context map injection |

### Sessions
| Command | Description |
|---|---|
| `/session save` | Manually save the current conversation to disk |
| `/session list` | List the last 20 saved sessions with timestamps and model info |
| `/session load <file>` | Restore a saved session from a file path |

### Proxy
| Command | Description |
|---|---|
| `/proxy` | Show current proxy settings (password fully masked) |
| `/proxy set <url>` | Set a new proxy URL for this session |
| `/proxy auth` | Re-enter proxy credentials (updates session, not saved to disk) |
| `/proxy off` | Disable proxy for this session |
| `/proxy on` | Re-enable the configured proxy |

---

## Permission system

Every write or execute action shows a preview and requires approval before running:

```
  ┌────────────────────────────────────────────────────────────────┐
  ACTION  write_file
  PATH    src/utils/parser.ts
  ├────────────────────────────────────────────────────────────────┤
  + export function parseJson(data: string): object {
  +   return JSON.parse(data);
  + }
  └────────────────────────────────────────────────────────────────┘
  [y] Approve   [n] Reject   [e] Edit first   [s] Stop agent
```

| Key | Action |
|---|---|
| `y` | Approve and execute |
| `n` | Reject — LLM is told and can try a different approach |
| `e` | Open proposed content in `$EDITOR` (falls back to `notepad` on Windows) |
| `s` | Stop the agent loop entirely |

Use `/auto` to toggle auto-approve for scripted or trusted tasks.

---

## Context map

On startup, loca scans the project directory and builds a compact summary of the
file tree and exported symbols — injected into the LLM's system prompt so it
understands your project structure without reading every file.

```
PROJECT MAP  (loca · 12 files · ~420 tokens)
────────────────────────────────────────────
src/
  agent.ts         Agent, AgentOptions
  config.ts        Config, loadConfig(), saveConfig()
  context_map.ts   ContextMap, buildContextMap(), renderContextMap()
  ollama.ts        OllamaOptions, streamChat(), listModels()
  tools/
    fs.ts          readFile(), writeFile(), editFile()
    shell.ts       runCommand()
────────────────────────────────────────────
```

Supports: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin.
Respects `.gitignore`. Rebuilt incrementally after each approved file change.

---

## Proxy support

loca works behind HTTP/HTTPS proxies. Three ways to configure:

1. **Environment variables** — `HTTP_PROXY`, `HTTPS_PROXY` (auto-detected at startup)
2. **Startup wizard** — offered automatically when connection fails, or at step 4 of wizard
3. **In-session** — `/proxy auth` at any time

Proxy passwords are **never written to disk** — stored in session memory only.
The proxy URL and username are saved in `config.toml`; password is re-prompted each session.

---

## Supported servers

| Server | Type to select | Default port |
|---|---|---|
| Ollama (local or remote) | Ollama | 11434 |
| LM Studio | LM Studio | 1234 |
| llama.cpp server | OpenAI-compatible | 8080 |
| Jan | OpenAI-compatible | 1337 |
| Msty | OpenAI-compatible | varies |
| vLLM | OpenAI-compatible | 8000 |

---

## Config file location

Settings are saved after the wizard completes:

- **Windows:** `%APPDATA%\loca\config.toml`
- **macOS / Linux:** `~/.loca/config.toml`

Sessions are saved alongside config in the `sessions/` subdirectory.
Undo snapshots are in `undo/`. Neither passwords nor secrets are ever written to these files.

---
