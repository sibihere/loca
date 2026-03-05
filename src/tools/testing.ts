// ─── Testing tool ─────────────────────────────────────────────────────────────
// run_tests: auto-detects and runs the project's test suite.
// Returns the test output to the agent for structured feedback.

import fs from "fs";
import path from "path";
import { runCommand } from "./shell.js";
import { ensureInsideWorkspace } from "../utils/paths.js";

interface TestRunner {
    name: string;
    command: string;
    detector: string; // file to look for
}

const RUNNERS: TestRunner[] = [
    { name: "Vitest/Jest (npm)", command: "npm test", detector: "package.json" },
    { name: "Pytest", command: "pytest", detector: "pytest.ini" },
    { name: "Pytest (toml)", command: "pytest", detector: "pyproject.toml" },
    { name: "Go Test", command: "go test ./...", detector: "go.mod" },
    { name: "Cargo Test", command: "cargo test", detector: "Cargo.toml" },
    { name: "Maven (Java)", command: "./mvnw test", detector: "pom.xml" },
    { name: "Maven (Java Global)", command: "mvn test", detector: "pom.xml" },
    { name: "Gradle (Java)", command: "./gradlew test", detector: "build.gradle" },
    { name: "Gradle (Java KTS)", command: "./gradlew test", detector: "build.gradle.kts" },
    { name: "Composer Test", command: "composer test", detector: "composer.json" },
];

export async function runTests(filter?: string, workingDirectory?: string): Promise<string> {
    const runner = detectRunner(workingDirectory);

    if (!runner) {
        return "Error: Could not auto-detect a test runner. Ensure your project has a common test configuration file (e.g. package.json, pytest.ini, go.mod).";
    }

    let fullCommand = runner.command;
    if (filter) {
        // Basic filtering support - append to command
        if (runner.command === "npm test") {
            fullCommand += ` -- ${filter}`;
        } else {
            fullCommand += ` ${filter}`;
        }
    }

    const output = await runCommand(fullCommand, workingDirectory);
    return `Runner: ${runner.name}\nCommand: ${fullCommand}\n\n${output}`;
}

function detectRunner(workingDirectory?: string): TestRunner | null {
    if (workingDirectory) {
        try {
            ensureInsideWorkspace(workingDirectory);
        } catch {
            return null; // Invalid path
        }
    }
    const cwd = workingDirectory ? path.resolve(workingDirectory) : process.cwd();

    for (const r of RUNNERS) {
        if (fs.existsSync(path.join(cwd, r.detector))) {
            // For package.json, also verify there's a "test" script
            if (r.detector === "package.json") {
                try {
                    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, r.detector), "utf-8"));
                    if (pkg.scripts && pkg.scripts.test) return r;
                    continue;
                } catch {
                    continue;
                }
            }
            // For Maven/Gradle, check for wrapper first
            if (r.name.includes("Global")) {
                // Only run global mvn if wrapper isn't there
                if (!fs.existsSync(path.join(cwd, "mvnw")) && !fs.existsSync(path.join(cwd, "mvnw.cmd"))) return r;
                continue;
            }
            if (r.command.startsWith("./grad") || r.command.startsWith("./mvn")) {
                const wrapper = process.platform === "win32" ? r.command.slice(2) + ".cmd" : r.command.slice(2);
                if (fs.existsSync(path.join(cwd, wrapper))) return r;
                continue;
            }

            return r;
        }
    }

    return null;
}
