import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export class WorkdirPolicy {
  private readonly resolved: ReadonlyMap<string, string>;
  readonly roots: readonly string[];

  constructor(workdirs: Readonly<Record<string, string>>) {
    const entries = Object.entries(workdirs).map(([key, value]) => [key, this.realDirectory(value)] as const);
    if (entries.length === 0) throw new Error("At least one workdir is required");
    this.resolved = new Map(entries);
    this.roots = [...new Set(entries.map(([, value]) => value))];
  }

  resolveKey(key: string): string {
    const configured = this.resolved.get(key);
    if (!configured) throw new Error(`Unknown working-directory key: ${key}`);
    const current = this.realDirectory(configured);
    const allowed = this.roots.some((root) => {
      const relative = path.relative(root, current);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    if (!allowed) throw new Error("Resolved working directory escaped the configured roots");
    return current;
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
    if (!path.isAbsolute(value)) throw new Error(`Configured working directory must be absolute: ${value}`);
    if (!existsSync(value)) throw new Error(`Working directory does not exist: ${value}`);
    const real = realpathSync(value);
    if (!statSync(real).isDirectory()) throw new Error(`Working directory is not a directory: ${value}`);
    return real;
  }
}
