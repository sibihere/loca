// ─── Unified LLM client ───────────────────────────────────────────────────────
// Supports two server types, selected by the user in the wizard:
//
//   "ollama"           — Ollama native API  (/api/tags, /api/chat)
//   "openai-compatible"— OpenAI-style API   (/v1/models, /v1/chat/completions)
//                        Works with: LM Studio, llama.cpp, Jan, Msty, vLLM, etc.

import { fetch } from "undici";
import type { ServerType } from "./config.js";
import { getDispatcher } from "./proxy.js";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaOptions {
  host: string;
  model: string;
  serverType: ServerType;
  apiKey?: string;
  basePath?: string;
}

// ─── List models ──────────────────────────────────────────────────────────────

export async function listModels(
  host: string,
  serverType: ServerType,
  apiKey?: string,
  basePath?: string
): Promise<string[]> {
  const base = host.replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  if (serverType === "ollama") {
    const res = await fetch(`${base}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(8000),
      dispatcher: getDispatcher(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  }

  // openai-compatible
  const v1Path = basePath || "/v1";
  const res = await fetch(`${base}${v1Path}/models`, {
    headers,
    signal: AbortSignal.timeout(8000),
    dispatcher: getDispatcher(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { data: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

// ─── Test connectivity ────────────────────────────────────────────────────────

export async function testConnection(
  host: string,
  serverType: ServerType
): Promise<boolean> {
  try {
    await listModels(host, serverType);
    return true;
  } catch {
    return false;
  }
}

// ─── Stream chat ──────────────────────────────────────────────────────────────

export async function streamChat(
  opts: OllamaOptions,
  messages: Message[],
  onToken: (token: string) => void
): Promise<string> {
  return opts.serverType === "ollama"
    ? streamOllama(opts, messages, onToken)
    : streamOpenAI(opts, messages, onToken);
}

export async function chat(
  opts: OllamaOptions,
  messages: Message[]
): Promise<string> {
  const url = opts.serverType === "ollama"
    ? `${opts.host.replace(/\/$/, "")}/api/chat`
    : `${opts.host.replace(/\/$/, "")}${opts.basePath || "/v1"}/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: opts.model, messages, stream: false }),
    signal: AbortSignal.timeout(60_000),
    dispatcher: getDispatcher(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  if (opts.serverType === "ollama") {
    return data.message?.content ?? "";
  } else {
    return data.choices?.[0]?.message?.content ?? "";
  }
}

// ─── Ollama streaming (/api/chat — NDJSON) ────────────────────────────────────

async function streamOllama(
  opts: OllamaOptions,
  messages: Message[],
  onToken: (token: string) => void
): Promise<string> {
  const url = `${opts.host.replace(/\/$/, "")}/api/chat`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: opts.model, messages, stream: true }),
    signal: AbortSignal.timeout(120_000),
    dispatcher: getDispatcher(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }
  if (!res.body) throw new Error("No response body from Ollama");

  return readNDJSON(res.body as unknown as ReadableStream<Uint8Array>, onToken, (line) => {
    const parsed = JSON.parse(line) as {
      message?: { content?: string };
      done?: boolean;
    };
    return parsed.message?.content ?? "";
  });
}

// ─── OpenAI-compatible streaming (/v1/chat/completions — SSE) ─────────────────

async function streamOpenAI(
  opts: OllamaOptions,
  messages: Message[],
  onToken: (token: string) => void
): Promise<string> {
  const v1Path = opts.basePath || "/v1";
  const url = `${opts.host.replace(/\/$/, "")}${v1Path}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: opts.model, messages, stream: true }),
    signal: AbortSignal.timeout(12000_000),
    dispatcher: getDispatcher(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }
  if (!res.body) throw new Error("No response body from server");

  return readSSE(res.body as unknown as ReadableStream<Uint8Array>, onToken, (line) => {
    // SSE lines look like:  data: {...json...}
    // End-of-stream marker: data: [DONE]
    if (!line.startsWith("data:")) return "";
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return "";
    try {
      const parsed = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[];
      };
      return parsed.choices?.[0]?.delta?.content ?? "";
    } catch {
      return "";
    }
  });
}

// ─── Stream readers ───────────────────────────────────────────────────────────

/** Read a stream of newline-delimited JSON, extract text via extractor fn. */
async function readNDJSON(
  body: ReadableStream<Uint8Array>,
  onToken: (t: string) => void,
  extractor: (line: string) => string
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const token = extractor(line);
        if (token) { onToken(token); full += token; }
      } catch { /* skip malformed lines */ }
    }
  }
  return full;
}

/** Read a Server-Sent Events stream, extract text via extractor fn. */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onToken: (t: string) => void,
  extractor: (line: string) => string
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE events are separated by double newlines; lines within an event by single
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const token = extractor(line);
        if (token) { onToken(token); full += token; }
      } catch { /* skip */ }
    }
  }
  return full;
}
