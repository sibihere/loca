import chalk from "chalk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { stripVTControlCharacters } from "node:util";
import type { Config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
    try {
        const pkgPath = join(__dirname, "..", "package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return pkg.version || "0.0.0";
    } catch {
        return "0.3.5"; // Fallback to what was in main.ts
    }
}

export function printBanner(config?: Config): void {
    const version = getVersion();
    const host = config?.connection?.host ? chalk.cyan(config.connection.host) : chalk.dim("not connected");
    const model = config?.connection?.model ? chalk.cyan(config.connection.model) : chalk.dim("not connected");

    const logoLines = [
        chalk.cyan("            _                 "),
        chalk.cyan("  ┌─────┐  | | ___   ___ __ _ "),
        `${chalk.cyan("  │ >_")}${chalk.green.bold("█")}${chalk.cyan(" │  | |/ _ \\ / __/ _` |  ")}`,
        chalk.cyan("  │     │  | | (_) | (_| (_| |  "),
        `${chalk.cyan("  └─────┘  |_|\\___/ \\___\\__,_|")} ${chalk.yellow(`v${version}`)}`
    ];

    const contentLines = [
        "",
        ...logoLines,
        "",
        `   ${chalk.white.bold("loca")} ${chalk.dim("—")} ${chalk.dim("the local coding agent")}`,
        `   ${chalk.dim("host:")} ${host}`,
        `   ${chalk.dim("model:")} ${model}`,
        ""
    ];

    // Find the maximum width of the content lines (ignoring ANSI codes)
    const maxWidth = Math.max(...contentLines.map(line => stripVTControlCharacters(line).length)) + 15;

    const topBorder = chalk.cyan(`╭${"─".repeat(maxWidth)}╮`);
    const bottomBorder = chalk.cyan(`╰${"─".repeat(maxWidth)}╯`);

    console.log(topBorder);
    contentLines.forEach(line => {
        const lineLength = stripVTControlCharacters(line).length;
        const padding = " ".repeat(maxWidth - lineLength);
        console.log(`${chalk.cyan("│")}${line}${padding}${chalk.cyan("│")}`);
    });
    console.log(bottomBorder);
}
