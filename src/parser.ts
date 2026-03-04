// ─── Tool call parser ─────────────────────────────────────────────────────────
// Parses the XML tool-call blocks that the LLM emits.
// Lenient by design: copes with extra whitespace, missing closing tags, etc.
//
// Expected LLM output format:
//
//   <tool>
//     <n>write_file</n>
//     <path>src/main.ts</path>
//     <content>...</content>
//   </tool>
//
// The <done/> tag signals the agent loop to stop.

export type ToolName =
  | "read_file"
  | "list_dir"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "run_command"
  | "create_dir"
  | "search_files";

export interface ToolCall {
  name: ToolName;
  params: Record<string, string>;
}

// ─── Extract a tag's inner text (first match, trimmed) ────────────────────────

function extractTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
}

// ─── Extract tag content handling potential nested false-positives ────────────
// Finds the LAST closing tag to handle content that contains </tag> literally

function extractTagRobust(xml: string, tag: string): string | undefined {
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
  const closeRe = new RegExp(`</${tag}>`, "gi");
  
  const openMatch = openRe.exec(xml);
  if (!openMatch) return undefined;
  
  const openIndex = openMatch.index + openMatch[0].length;
  
  // Find all closing tags and use the last one
  let lastCloseIndex = -1;
  let closeMatch: RegExpExecArray | null;
  while ((closeMatch = closeRe.exec(xml)) !== null) {
    lastCloseIndex = closeMatch.index;
  }
  
  if (lastCloseIndex === -1 || lastCloseIndex <= openIndex) return undefined;
  
  return xml.slice(openIndex, lastCloseIndex).trim();
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseToolCall(text: string): ToolCall | "done" | null {
  // Check for <done/> or <done></done>
  if (/<done\s*\/?>/i.test(text)) return "done";

  // Find a <tool>...</tool> block
  const toolMatch = text.match(/<tool[^>]*>([\s\S]*?)<\/tool>/i);
  if (!toolMatch) return null;

  const inner = toolMatch[1];
  const name = extractTag(inner, "n");

  if (!name) return null;

  const validNames: ToolName[] = [
    "read_file",
    "list_dir",
    "write_file",
    "edit_file",
    "delete_file",
    "run_command",
    "create_dir",
    "search_files",
  ];

  if (!validNames.includes(name as ToolName)) {
    return null;
  }

  // Collect all other tags as params
  const params: Record<string, string> = {};
  const tagRe = /<(\w+)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(inner)) !== null) {
    const tagName = match[1].toLowerCase();
    if (tagName !== "n") {
      // For 'content' param, use robust extraction to handle </content> in content
      if (tagName === "content") {
        const robustContent = extractTagRobust(inner, "content");
        if (robustContent !== undefined) {
          params[tagName] = robustContent;
        } else {
          params[tagName] = match[2].trim();
        }
      } else {
        params[tagName] = match[2].trim();
      }
    }
  }

  return { name: name as ToolName, params };
}

// ─── Check if LLM text contains a complete tool call ──────────────────────────

export function hasToolCall(text: string): boolean {
  // Check for complete tool block with closing tag
  if (/<tool[^>]*>[\s\S]*?<\/tool>/i.test(text)) return true;
  // Check for self-closing tool tag (malformed but detectable)
  if (/<tool\s*\/>/i.test(text)) return true;
  // Check for done tag
  if (/<done\s*\/?>/i.test(text)) return true;
  return false;
}
