import path from "path";

/**
 * Ensures that the given file path is within the current working directory.
 * Throws an error if the path escapes the workspace.
 */
export function ensureInsideWorkspace(filePath: string): string {
    const workspaceRoot = process.cwd();
    const resolvedPath = path.resolve(filePath);

    // path.relative returns a relative path from the first arg to the second.
    // If the result starts with '..', it's outside.
    const relative = path.relative(workspaceRoot, resolvedPath);

    const isOutside = relative.startsWith("..") || path.isAbsolute(relative);

    if (isOutside && resolvedPath !== workspaceRoot) {
        throw new Error(`Access denied: Path is outside the workspace: ${filePath}`);
    }

    return resolvedPath;
}
