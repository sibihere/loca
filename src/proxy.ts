// ─── Proxy configuration ──────────────────────────────────────────────────────
// Manages HTTP/HTTPS proxy settings for all outbound Ollama requests.
//
// Password storage note:
//   Phase 2 uses session-only in-memory password storage.
//   Phase 4 will add OS keychain via `keytar` (requires native build tools,
//   so intentionally deferred to avoid setup friction on Windows).
//
// Proxy is applied globally to Node's fetch via undici ProxyAgent.
// This means ALL fetch() calls in the process go through the proxy automatically.

import { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher, Agent, type Dispatcher } from "undici";
import chalk from "chalk";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProxyConfig {
  enabled: boolean;
  url: string;
  username?: string;
  // Password is never saved to disk — session memory only
  password?: string;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let _activeProxy: ProxyConfig | null = null;
let _allowInsecure = false;

// ─── Apply proxy to global fetch dispatcher ───────────────────────────────────

export function applyProxy(cfg: ProxyConfig): void {
  const connect = { rejectUnauthorized: !_allowInsecure };
  if (!cfg.enabled || !cfg.url) {
    clearProxy();
    return;
  }

  let uri = cfg.url;

  // Embed basic-auth credentials into the proxy URL if provided
  if (cfg.username) {
    const password = cfg.password ?? "";
    try {
      const parsed = new URL(uri);
      parsed.username = encodeURIComponent(cfg.username);
      parsed.password = encodeURIComponent(password);
      uri = parsed.toString();
    } catch {
      // URL parse failed — use as-is, auth may fail but at least we tried
    }
  }

  try {
    const agent = new ProxyAgent({ uri, connect });
    setGlobalDispatcher(agent);
    _activeProxy = cfg;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`  ✗ Failed to configure proxy: ${msg}`));
  }
}

// ─── Remove proxy — revert to direct connections ─────────────────────────────

export function clearProxy(): void {
  // Reset to undici's default Agent (direct connections)
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: !_allowInsecure } }));
  _activeProxy = null;
}

/**
 * Toggles global SSL certificate verification.
 */
export function setAllowInsecure(value: boolean): void {
  _allowInsecure = value;

  // Belt-and-suspenders: set the process-level env var so Node's native TLS
  // layer also skips certificate verification. This is essential in restricted
  // environments (corporate proxies, SEA builds) where the undici dispatcher
  // alone may not control the TLS handshake.
  if (value) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  } else {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }

  // Refresh the dispatcher (proxy agent or direct agent)
  if (_activeProxy) {
    applyProxy(_activeProxy);
  } else {
    clearProxy();
  }
}

/**
 * Returns the current global undici dispatcher.
 * Use this to explicitly pass `dispatcher` to fetch() calls, ensuring
 * the insecure/proxy agent is actually used regardless of the Node runtime.
 */
export function getDispatcher(): Dispatcher {
  return getGlobalDispatcher();
}

// ─── Get current proxy state (for /status and /proxy commands) ───────────────

export function getActiveProxy(): ProxyConfig | null {
  return _activeProxy;
}

// ─── Load proxy from environment variables ───────────────────────────────────
// Respects HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy (case-insensitive)
// as set by the OS or shell environment.

export function proxyFromEnv(): ProxyConfig | null {
  const raw =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    null;

  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    return {
      enabled: true,
      url: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch {
    return { enabled: true, url: raw };
  }
}

// ─── NO_PROXY check ───────────────────────────────────────────────────────────
// Returns true if the given host should bypass the proxy.

export function isNoProxy(host: string): boolean {
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  if (!noProxy || noProxy === "*") return noProxy === "*";
  return noProxy
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .some((entry) => host.toLowerCase().includes(entry));
}

// ─── Print proxy status (for /proxy command) ──────────────────────────────────

export function printProxyStatus(): void {
  const envProxy = proxyFromEnv();
  console.log();
  console.log(chalk.bold("  Proxy"));

  if (!_activeProxy) {
    console.log(`  Status:  ${chalk.dim("disabled")}`);
    if (envProxy) {
      console.log(`  Env var: ${chalk.yellow(envProxy.url)} ${chalk.dim("(detected but not applied)")}`);
    }
  } else {
    console.log(`  Status:   ${chalk.green("enabled")}`);
    console.log(`  URL:      ${chalk.cyan(_activeProxy.url)}`);
    if (_activeProxy.username) {
      console.log(`  Username: ${_activeProxy.username}`);
      console.log(`  Password: ${_activeProxy.password ? chalk.dim("••••••••") : chalk.dim("(not set)")}`);
    }
    if (envProxy) {
      console.log(chalk.dim(`  (overrides env proxy: ${envProxy.url})`));
    }
  }

  console.log(`  SSL Verify: ${!_allowInsecure ? chalk.green("enabled") : chalk.yellow("disabled (insecure)")}`);
  console.log();
}
