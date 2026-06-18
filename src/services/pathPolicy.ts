import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export class PathPolicy {
  readonly roots: readonly string[];

  constructor(roots: readonly string[]) {
    if (roots.length === 0) throw new Error("At least one allowed working-directory root is required");
    this.roots = [...new Set(roots.map((root) => this.realDirectory(root)))];
  }

  resolveDirectory(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Please enter a working directory.");
    const expanded = trimmed === "~" ? os.homedir()
      : trimmed.startsWith(`~${path.sep}`) ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
    if (!path.isAbsolute(expanded)) throw new Error("Please enter an absolute working-directory path.");
    const resolved = this.realDirectory(path.resolve(expanded));
    const allowed = this.roots.some((root) => {
      const relative = path.relative(root, resolved);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    if (!allowed) {
      throw new Error("That directory is outside the allowed working-directory roots.");
    }
    return resolved;
  }

  isGitRepository(directory: string): boolean {
    let current = directory;
    while (true) {
      if (existsSync(path.join(current, ".git"))) return true;
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }

  private realDirectory(value: string): string {
    if (!existsSync(value)) throw new Error(`Working directory does not exist: ${value}`);
    const real = realpathSync(value);
    if (!statSync(real).isDirectory()) throw new Error(`Working directory is not a directory: ${value}`);
    return real;
  }
}
