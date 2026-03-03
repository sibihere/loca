# Local Coding Agent (`loca`) — Product Requirements Document

> A lightweight, permission-first autonomous coding agent powered by any Ollama-compatible
> model — local or cloud-hosted — built in Node.js for zero-friction use on Windows, macOS,
> and Linux without administrator privileges.

**Version:** 2.0  
**Stack:** Node.js 18+ (TypeScript) · No admin required · Windows-first compatibility

---

## 1. Vision & Goals

Build a terminal-based coding agent — **`loca`** — that can autonomously read, plan, write,
and edit code by conversing with any LLM served through Ollama, whether running on
`localhost` or a remote/cloud machine. Every file-system mutation requires explicit user
approval before execution.

**Core principles:**

- **Zero-friction start:** `npx loca` works immediately on any machine with Node.js 18+.
  No global install, no admin, no virtual environments, no PATH configuration.
- **Windows-native:** Works identically in Windows Terminal, PowerShell, and CMD. No
  Unix-specific assumptions. Line endings, paths, and colors all handled correctly.
- **Flexible deployment:** Ollama can run locally or on a remote server (cloud VM, RunPod,
  vast.ai, on-prem GPU box). `loca` works identically either way.
- **Permission-gated:** Every destructive or creative action (write, delete, run) requires
  a `y/n` prompt showing exactly what will change.
- **Model-agnostic:** Works with any model available in Ollama.
- **Network-aware:** Supports HTTP/HTTPS proxies with optional credentials for corporate
  or restricted networks.

---

## 2. Why Node.js over Python

This was an explicit design decision. The comparison for this specific use case:

| Factor | Python | Node.js | Winner |
|---|---|---|---|
| Zero-friction run on Windows | PATH hell is common | `npx loca` — no install step | **Node** |
| No admin required | User-level pip works | User-level npm / winget | Tie |
| Windows Terminal color support | Rich has edge cases | Chalk is rock-solid | **Node** |
| Startup speed | 300–500 ms | 80–150 ms | **Node** |
| HTTP streaming (Ollama) | httpx | Built-in `fetch` (Node 18+) | Tie |
| Single executable bundle | PyInstaller is heavy | `pkg` / `bun build` — small | **Node** |
| Dependency footprint | ~15 MB | ~8 MB | **Node** |
| AST for context map | Native `ast` for .py files | Regex fallback (acceptable) | Python |

Node wins on the factors that matter most for a Windows terminal tool: install friction,
startup speed, and color/prompt reliability. The only Python advantage (native AST parsing)
is covered adequately with regex extraction, which already handles JS, TS, Go, Rust, etc.

---

## 3. Windows Compatibility Requirements

These apply throughout the entire codebase — not as an afterthought.

### 3.1 No Administrator Privileges — Ever

- Installation via `npm install -g loca` runs in the user's npm prefix (no admin needed).
- `npx loca` requires no installation at all.
- Config and session files go to `%APPDATA%\loca\` on Windows
  (`~/.loca/` on macOS/Linux) — user-writable without admin.
- Undo snapshots, session files, and logs all write to user directories.
- The `run_command` tool executes under the current user's privileges, never elevated.

### 3.2 Windows Terminal Compatibility

- Uses `chalk` for all color output — tested against Windows Terminal, PowerShell 5/7,
  CMD, and VS Code integrated terminal.
- Detects `NO_COLOR` and `TERM=dumb` environment variables and disables color gracefully.
- Interactive prompts (`inquirer`) tested on all four Windows terminal environments.
- Box-drawing characters (┌, │, └) fall back to ASCII (`+`, `|`, `+`) when the terminal
  reports a non-UTF-8 code page (common in legacy CMD).

### 3.3 Path Handling

- All internal path operations use Node's `path` module — never string concatenation.
- Paths displayed to the user use the OS-native separator (`\` on Windows).
- File globs use `glob` npm package (cross-platform, not `find` or `ls`).
- No hardcoded `/tmp/` — temp files go to `os.tmpdir()`.

### 3.4 Shell Command Execution

- `run_command` on Windows executes via `cmd.exe /c` by default.
- User can set `shell: powershell` in config to use PowerShell 7 instead.
- Dangerous pattern detection is OS-aware:
  - Windows: flags `del /f`, `rmdir /s`, `format`, `rd /s`, `reg delete`
  - Unix: flags `rm -rf`, `dd`, `mkfs`, `:(){ :|:& };:`
- Commands are shown exactly as they will be executed — no surprises.

### 3.5 Node.js Version & Installation (No Admin)

Minimum: **Node.js 18 LTS** (ships with built-in `fetch`, required for Ollama streaming).

How users can install Node.js on Windows without admin:
- `winget install OpenJS.NodeJS.LTS` — available without admin in most org policies
- Download the `.zip` portable build from nodejs.org and add to user PATH
- Use `nvm-windows` (user-level install, no admin)
- Use `fnm` (Fast Node Manager) — no admin, works in PowerShell

The README will document all four paths with copy-paste commands.

---

## 4. Functional Requirements

### 4.1 Core Agent Loop

```
User Task → LLM Thinks → LLM Selects Tool → Agent Asks Permission → Execute → Observe → Repeat
```

Continues until the LLM emits `<done/>` or the user interrupts with `Ctrl+C`.

### 4.2 Tool Set

| Tool | Description | Permission Required |
|---|---|---|
| `read_file` | Read a file's contents | No |
| `list_dir` | List directory contents | No |
| `search_files` | Regex search across files | No |
| `write_file` | Create or overwrite a file | **Yes** |
| `edit_file` | Apply a targeted diff to a file | **Yes** |
| `delete_file` | Delete a file | **Yes** |
| `run_command` | Execute a shell command | **Yes** |
| `create_dir` | Create a directory | **Yes** |

### 4.3 Permission Prompt

Every write/execute action shows a structured preview before executing:

```
┌─────────────────────────────────────────────────────────┐
│  ACTION  write_file                                     │
│  PATH    src\utils\parser.ts                            │
├─────────────────────────────────────────────────────────┤
│  + export function parseJson(data: string): object {   │
│  +   return JSON.parse(data);                           │
│  + }                                                    │
└─────────────────────────────────────────────────────────┘
  [y] Approve   [n] Reject   [e] Edit first   [s] Stop
> _
```

- `y` — execute and continue the agent loop
- `n` — skip this action; LLM is told the action was rejected
- `e` — open the proposed content in the user's `$EDITOR` / `notepad` before saving
- `s` — stop the agent loop entirely

For `run_command`, an additional `⚠ DESTRUCTIVE` badge appears if the command matches
the dangerous pattern list.

### 4.4 Startup Connection Wizard

Runs on every launch when no saved config exists (or when `--connect` is passed).
This is the very first thing the user sees:

```
╔══════════════════════════════════════════════════════════╗
║              loca — Local Coding Agent                   ║
╚══════════════════════════════════════════════════════════╝

  Where is your Ollama instance running?
  ❯ Local  (http://localhost:11434)
    Remote / Cloud  (enter URL)
```

After host entry, `loca` calls `GET /api/tags` and either shows available models or
a clear error with troubleshooting hints:

```
  ✓ Connected to http://my-server:11434

  Available models:
    1. deepseek-coder:6.7b
    2. llama3:8b
    3. mistral:7b

  Select model [1]: _
```

Final wizard step:

```
  Save these settings for next time? [Y/n]: _
```

Settings are saved to `%APPDATA%\loca\config.toml` (Windows) or `~/.loca/config.toml`.

When saved config exists, wizard is skipped and a one-line banner confirms state:

```
  ✓ http://localhost:11434  |  deepseek-coder:6.7b  |  project: my-app
```

**CLI flags that bypass the wizard:**

```
loca --host http://my-server:11434 --model deepseek-coder:6.7b
loca --connect          # force re-run wizard even with saved config
```

**Mid-session commands:** `/connect` reruns the full wizard, `/model <n>` switches model.

### 4.5 Proxy Configuration

Integrated into the startup wizard, automatically offered when connectivity fails:

```
  Connection failed. Is this network behind a proxy? [y/N]: y

  Proxy URL (e.g. http://proxy.corp.com:8080): _
  Requires authentication? [y/N]: y
  Username: _
  Password: _  (hidden · stored in system keychain)
```

Config file (`%APPDATA%\loca\config.toml`):

```toml
[connection]
host  = "http://my-gpu-server:11434"
model = "deepseek-coder:6.7b"

[proxy]
enabled  = true
url      = "http://proxy.corp.com:8080"
username = "alice"
# password lives in the OS keychain only — never written here
```

**Password storage:** Proxy passwords are stored in the OS keychain via the `keytar`
npm package (macOS Keychain, Windows Credential Manager, GNOME Keyring). Never written
to disk. On headless systems, falls back to a session-only env var with a warning.

**Proxy behaviour:**

| Scenario | Behaviour |
|---|---|
| `HTTP_PROXY` / `HTTPS_PROXY` env vars set | Auto-detected; wizard shows "Using proxy from environment" |
| Config has proxy + saved credentials | Silently applied; visible in `/status` |
| Proxy auth fails (407) | Error + prompt to run `/proxy auth` |
| `NO_PROXY` env var set | Respected; Ollama host can be exempted |
| TLS cert error through proxy | Warning shown; explicit user consent to skip verification |

**In-session proxy commands:**

```
/proxy              show current proxy settings (password masked)
/proxy set <url>    update proxy URL
/proxy auth         re-enter credentials (updates keychain)
/proxy off          disable proxy for this session
/proxy on           re-enable proxy
```

### 4.6 Context Map (MVP Feature)

On startup, `loca` scans the working directory and builds a **project context map** — a
compact, token-budgeted summary of the project's structure injected into the LLM's system
context. This gives the model structural awareness without dumping entire files.

**What it produces:**

```
PROJECT MAP  (src · 14 files · 847 tokens)
─────────────────────────────────────────
src/
  main.ts              exports: main()
  agent.ts             exports: Agent, runLoop(), parseToolCall()
  ollama.ts            exports: OllamaClient, streamChat()
  tools/
    fs.ts              exports: readFile(), writeFile(), editFile()
    shell.ts           exports: runCommand(), isDangerous()
    search.ts          exports: searchFiles()
  config.ts            exports: loadConfig(), saveConfig(), Config
  permissions.ts       exports: askPermission(), UndoStack
  wizard.ts            exports: runWizard()
  context_map.ts       exports: buildMap(), MapEntry[]
tests/
  agent.test.ts
  tools.test.ts
─────────────────────────────────────────
```

**How it works:**

- Walks the directory tree, respecting `.gitignore` and a built-in exclusion list
  (`node_modules`, `.git`, `dist`, `__pycache__`, `*.lock`, binary files).
- For each source file, extracts exported symbols using regex patterns per language:
  - TypeScript/JavaScript: `export function`, `export class`, `export const`
  - Python: `def `, `class ` at top level
  - Go: capitalized function signatures
  - Rust: `pub fn`, `pub struct`
  - Others: file listed without symbol extraction
- Applies a **token budget** (default: 800 tokens). If the map exceeds the budget, it
  truncates at directory boundaries, deepest subdirectories first, and appends
  `(+N files not shown — use /map <path> to zoom in)`.
- Rebuilt incrementally after each approved `write_file`, `create_dir`, or `delete_file`.

**Map commands:**

```
/map                 show current project map in terminal
/map <path>          zoom into a subdirectory (higher detail, same token budget)
/map off             disable map injection (for very large repos)
/map on              re-enable
/map budget <n>      set token budget (default 800)
/map rebuild         force full rescan
```

**Token budget reasoning:** At 800 tokens the map leaves ~90% of a 8K context window
free for conversation. Users with larger models (32K+ context) can raise the budget
with `/map budget 3000`.

### 4.7 Session Management

- Sessions auto-saved to `%APPDATA%\loca\sessions\` (Windows) or `~/.loca/sessions/`.
- `loca --resume` resumes the last session.
- `loca --history` lists past sessions.

### 4.8 In-Session Commands

```
/exit, Ctrl+C        end session
/connect             re-run connection + proxy wizard
/model <n>           switch Ollama model
/clear               clear conversation history (keep map)
/context <file>      add a file's content directly to conversation
/undo                revert last approved file action
/status              show model, host, proxy, token count, map status
/auto                toggle auto-approve mode (shown in banner when active)
/map [args]          context map commands (see §4.6)
/proxy [args]        proxy commands (see §4.5)
/help                list all commands
```

---

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        CLI Layer                             │
│   src/main.ts  —  args, REPL, /command dispatch             │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│                     Startup Wizard                           │
│   src/wizard.ts  —  host prompt → test → model pick → proxy │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│                     Agent Core                               │
│   src/agent.ts  —  ReAct loop, history, token mgmt,         │
│                    map injection, retry on bad tool calls    │
└──────┬──────────────────────────┬───────────────────────────┘
       │                          │
┌──────▼──────────┐    ┌──────────▼──────────────────────────┐
│  Ollama Client  │    │          Tool Registry               │
│  ollama.ts      │    │  tools/                              │
│  fetch streaming│    │  ├── fs.ts       (file ops)          │
│  proxy-aware    │    │  ├── shell.ts    (run_command)       │
└─────────────────┘    │  └── search.ts  (grep/glob)         │
                       └──────────┬──────────────────────────┘
                                  │
                    ┌─────────────▼──────────────────────────┐
                    │         Permission Gate                 │
                    │  permissions.ts                        │
                    │  — diff/command preview                │
                    │  — y/n/e/s prompt (inquirer)           │
                    │  — undo stack (file snapshots)         │
                    └────────────────────────────────────────┘

   src/context_map.ts  —  tree walk, symbol extraction, budgeting
   src/config.ts       —  TOML load/save, keytar bridge
   src/session.ts      —  session save/resume
   src/prompts.ts      —  system prompt templates
```

### Tool-Call Format

Rather than relying on Ollama's native function-calling (not universally supported
across models), the system prompt instructs the LLM to output tool calls as XML that
the agent parses reliably even with smaller models:

```xml
<tool>
  <n>write_file</n>
  <path>src/utils/parser.ts</path>
  <content>
export function parseJson(data: string): object {
  return JSON.parse(data);
}
  </content>
</tool>
```

For `edit_file`, the LLM produces a unified diff to keep token usage low:

```xml
<tool>
  <n>edit_file</n>
  <path>src/agent.ts</path>
  <diff>
--- a/src/agent.ts
+++ b/src/agent.ts
@@ -12,3 +12,4 @@
 export async function runLoop() {
+  buildMap();
   while (true) {
  </diff>
</tool>
```

---

## 6. System Prompt Design

The system prompt is loaded at session start and gives the LLM its identity, tools,
format rules, and examples. Key sections:

1. **Identity** — coding agent, local-first, permission-gated
2. **Project map** — injected block from `context_map.ts`
3. **Tool schema** — every tool with parameter descriptions
4. **Format rules** — output one `<tool>` block at a time, think step-by-step first,
   use `<done/>` when complete
5. **Worked example** — a full correct interaction showing read → think → write → done

Condensed example:

```
You are loca, a coding agent. You help users write, edit, and run code autonomously.

[PROJECT MAP]
src/
  agent.ts    exports: Agent, runLoop()
  ollama.ts   exports: OllamaClient
[/PROJECT MAP]

Available tools — output exactly one <tool> block, nothing else around it:

  read_file(path)               Read a file
  list_dir(path)                List directory
  write_file(path, content)     Write a file
  edit_file(path, diff)         Apply unified diff
  run_command(command)          Execute shell command
  search_files(pattern, path)   Search for pattern

Think step-by-step before each tool call. When the task is fully complete, output <done/>.
```

---

## 7. Implementation Plan

### Phase 1 — Foundation + Connection Wizard (Week 1)

**Goal:** Working agent that connects to any Ollama host and can read files.

- [ ] `npm init` · TypeScript config · `tsconfig.json` targeting Node 18
- [ ] Project scaffold: `src/` with `main.ts`, `agent.ts`, `ollama.ts`, `wizard.ts`, `config.ts`
- [ ] **Startup wizard** — host prompt (local vs remote) → `GET /api/tags` test → model picker
- [ ] `%APPDATA%\loca\config.toml` read/write (cross-platform path via `os` module)
- [ ] Ollama streaming client using built-in `fetch` + NDJSON parsing
- [ ] Basic REPL with `readline` (no extra deps)
- [ ] Tool call XML parser + validator
- [ ] `read_file` and `list_dir` tools
- [ ] System prompt v1
- [ ] Basic conversation history
- [ ] `/connect` in-session command

Deliverable: `npx loca` prompts for host, lists models, lets you discuss your codebase.

---

### Phase 2 — Proxy + Write Tools + Permissions (Week 2)

**Goal:** Works behind proxies; can propose and write code with approval gates.

- [ ] Proxy wizard step — auto-triggered on connection failure
- [ ] `HTTP_PROXY` / `HTTPS_PROXY` env var detection
- [ ] `keytar` integration — store/retrieve proxy password via OS keychain
- [ ] Proxy wired into `fetch` calls via `https-proxy-agent`
- [ ] `/proxy` in-session commands
- [ ] `write_file` tool + diff preview renderer (chalk-colored)
- [ ] `edit_file` tool — unified diff apply using `diff` npm package
- [ ] Permission gate — `y/n/e/s` prompt with `inquirer`
- [ ] Undo stack — file snapshots in `%APPDATA%\loca\undo\`
- [ ] `/undo` command
- [ ] Windows-aware dangerous pattern detection for `run_command`
- [ ] `run_command` tool with permission gate + `⚠ DESTRUCTIVE` badge

Deliverable: Agent works on local and corporate-proxy networks; can scaffold projects with approval.

---

### Phase 3 — Context Map + UX Polish (Week 3)

**Goal:** LLM has structural project awareness; smooth daily-driver UX.

- [ ] `context_map.ts` — directory walker with `.gitignore` parsing (`ignore` npm package)
- [ ] Symbol extractor — regex per language (TS, JS, Python, Go, Rust)
- [ ] Token budgeter — truncate at directory boundaries when over limit
- [ ] Map injected into system prompt on startup
- [ ] Incremental map rebuild after each approved write/create/delete
- [ ] `/map`, `/map <path>`, `/map off`, `/map budget <n>`, `/map rebuild` commands
- [ ] Session save/resume (`%APPDATA%\loca\sessions\`)
- [ ] `/model`, `/clear`, `/context`, `/status`, `/auto`, `/help` commands
- [ ] `--context-files` CLI flag
- [ ] Token counter + context window warning banner
- [ ] Context compression (summarize oldest messages when near limit)
- [ ] `search_files` tool (glob + regex, cross-platform — no `grep` dependency)
- [ ] `create_dir` and `delete_file` tools
- [ ] ASCII fallback for box-drawing in legacy CMD
- [ ] `NO_COLOR` / `TERM=dumb` detection

Deliverable: Agent knows your project on startup; works in all Windows terminals.

---

### Phase 4 — Robustness & Release (Week 4)

**Goal:** Reliable enough for real-world use; published and installable.

- [ ] Retry logic — on malformed tool calls, inject error + retry up to 3×
- [ ] Unit tests: tool parser, diff apply, permission gate, context map, proxy config
- [ ] Integration test: mock Ollama server (MSW or `nock`), end-to-end task
- [ ] Test matrix: Windows Terminal, PowerShell 7, CMD, VS Code terminal, WSL2
- [ ] `pkg` bundle — single `.exe` for Windows (no Node.js required)
- [ ] README with Windows-first install instructions + troubleshooting
- [ ] npm publish (`npm publish`)

Deliverable: `npm install -g loca` or `npx loca` — works on Windows out of the box.

---

## 8. File Structure

```
loca/
├── src/
│   ├── main.ts              Entry point · CLI args · REPL · /command dispatch
│   ├── wizard.ts            Startup wizard: host → test → model → proxy
│   ├── agent.ts             ReAct loop · history · token mgmt · map injection
│   ├── ollama.ts            Ollama HTTP client · fetch streaming · proxy-aware
│   ├── permissions.ts       Permission gate · diff renderer · undo stack
│   ├── parser.ts            Tool call XML parser + validator
│   ├── config.ts            TOML load/save · keytar bridge · cross-platform paths
│   ├── session.ts           Session save/resume
│   ├── prompts.ts           System prompt templates
│   ├── context_map.ts       Tree walk · symbol extraction · token budgeter
│   └── tools/
│       ├── index.ts         Tool registry
│       ├── fs.ts            read_file · write_file · edit_file · delete_file · create_dir
│       ├── shell.ts         run_command · danger detection · Windows/Unix aware
│       └── search.ts        search_files · cross-platform glob + regex
├── tests/
│   ├── parser.test.ts
│   ├── permissions.test.ts
│   ├── tools.test.ts
│   ├── wizard.test.ts
│   ├── proxy.test.ts
│   └── context_map.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 9. Technology Stack

| Component | Package | Why |
|---|---|---|
| Language | TypeScript 5 | Type safety; great DX; compiles to plain Node |
| HTTP client | Built-in `fetch` (Node 18+) | Zero extra deps; streaming NDJSON support |
| Proxy agent | `https-proxy-agent` | Routes `fetch` through HTTP/HTTPS proxies |
| Terminal UI | `chalk` | Rock-solid Windows color support |
| Interactive prompts | `@inquirer/prompts` | Works in all Windows terminals; y/n/select |
| Config format | TOML via `smol-toml` | Zero-dependency TOML parser |
| Credential storage | `keytar` | Windows Credential Manager · macOS Keychain |
| Diff apply | `diff` npm package | Parse + apply unified diffs cross-platform |
| Gitignore parsing | `ignore` | Respects `.gitignore` without shelling out |
| File glob | `glob` | Cross-platform; no `find`/`ls` shell dependency |
| Testing | `vitest` | Fast; native TypeScript; no compile step needed |

**Total production dependencies: 7** (`https-proxy-agent`, `chalk`, `@inquirer/prompts`,
`smol-toml`, `keytar`, `diff`, `ignore`, `glob`)

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Small models produce malformed tool calls | Lenient XML parser; retry loop with error injected into conversation (max 3×) |
| Context window overflow | Token counter with banner warning; automatic oldest-message summarization |
| Dangerous command approved by mistake | `/undo` reverts file changes; commands can't be undone — shown clearly before approval |
| Remote Ollama host unreachable | Wizard retries with backoff; clear error + hints (firewall, port, TLS, proxy); `/connect` always available |
| Proxy password leaked | Never written to disk; keychain only; fully masked in all UI; warning if env var fallback is used |
| Context map too large for small models | Hard token budget (default 800); `/map <path>` zoom-in; `/map off` escape hatch |
| AST/symbol extraction fails on unusual syntax | Per-file try/catch; fallback to filename-only entry; never crashes the agent |
| keytar fails on headless Windows servers | Detected at startup; falls back to session-only env var with printed warning |
| `pkg` bundle + `keytar` (native module) | `keytar` is a native addon; pkg config must include prebuilt binary for target OS |
| Legacy CMD code page breaks box drawing | Charset detection at startup; automatic ASCII fallback for box-drawing characters |

---

## 11. Success Metrics

- `npx loca` works on a fresh Windows machine with only Node.js 18+ installed — no admin,
  no extra setup, no PATH changes.
- Startup wizard completes and saves config in under 30 seconds on first launch.
- Connection wizard correctly identifies proxy requirement and completes auth flow.
- Agent completes "scaffold a FastAPI CRUD app" end-to-end with no crashes.
- Permission prompt appears within 200 ms of LLM finishing its response.
- Works with at least 5 Ollama models without code changes.
- Context map generates correctly for a 20-file project under 800 tokens.
- `/undo` reverts last file action correctly 100% of the time.
- Proxy password confirmed absent from `%APPDATA%\loca\config.toml` after setup.
- All tests pass on Windows 11, macOS 14, and Ubuntu 22.04.

---

## 12. Future Enhancements (Post-MVP)

- **Web UI** — browser-based interface with syntax-highlighted diff approval.
- **MCP server** — expose `loca` as an MCP server so other tools can drive it.
- **Git integration** — auto-commit after each approved batch with a generated message.
- **Plugin system** — user-registered custom tools (`run_tests`, `lint`, `deploy`).
- **Context map v2** — semantic search across the map using a local embedding model.
- **Full tree-sitter AST** — deeper symbol extraction across all languages.
- **SSO / Bearer token auth** — for hosted Ollama endpoints requiring API-key auth.
- **Voice input** — Whisper integration for hands-free task entry.
- **`.loca/` project config** — per-repo settings (excluded dirs, preferred model, tool allow-list).

---

*Version 2.0 · Node.js 18+ (TypeScript) · Windows / macOS / Linux · No admin required*
