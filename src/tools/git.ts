// ─── Git tools ───────────────────────────────────────────────────────────────
// Provides version control capabilities to the agent.
// Uses the shell tool's runCommand for actual execution.

import { runCommand } from "./shell.js";

export async function gitStatus(): Promise<string> {
    const res = await runCommand("git status --short");
    if (res === "(command exited with no output)") return "Working tree clean. No uncommitted changes.";
    return res;
}

export async function gitDiff(staged = false, filePaths = ""): Promise<string> {
    const flags = staged ? "--staged" : "";
    const res = await runCommand(`git diff ${flags} ${filePaths}`);
    if (res === "(command exited with no output)") return "No changes found.";
    if (res.length > 15000) {
        return res.slice(0, 15000) + "\n\n...[DIFF TRUNCATED BECAUSE IT IS TOO LARGE. USE 'path' ARGUMENT TO VIEW SPECIFIC FILES]...";
    }
    return res;
}

export async function gitCommit(message: string): Promise<string> {
    if (!message) return "Error: Commit message is required.";
    // We don't use 'git commit -m' directly with runCommand to avoid shell escape issues
    // for complex messages, but simple ones are usually fine.
    // For robustness, we'll try to stage everything first if nothing is staged? 
    // No, let the agent decide what to stage.
    return await runCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`);
}

export async function gitAdd(path = "."): Promise<string> {
    return await runCommand(`git add ${path}`);
}

export async function gitBranch(name?: string): Promise<string> {
    if (name) {
        return await runCommand(`git checkout -b ${name}`);
    }
    return await runCommand("git branch");
}

export async function gitLog(n = 5): Promise<string> {
    return await runCommand(`git log -n ${n} --oneline`);
}
