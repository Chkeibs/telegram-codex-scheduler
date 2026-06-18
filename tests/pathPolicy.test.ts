import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathPolicy } from "../src/services/pathPolicy.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("working-directory policy", () => {
  it("allows existing directories under configured roots", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "path-policy-"));
    directories.push(root);
    const child = path.join(root, "project");
    mkdirSync(child);
    expect(new PathPolicy([root]).resolveDirectory(child)).toBe(realpathSync(child));
  });

  it("rejects missing paths and symlink escapes", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "path-policy-root-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "path-policy-outside-"));
    directories.push(root, outside);
    const link = path.join(root, "escape");
    symlinkSync(outside, link, "dir");
    const policy = new PathPolicy([root]);
    expect(() => policy.resolveDirectory(link)).toThrow(/outside/);
    expect(() => policy.resolveDirectory(path.join(root, "missing"))).toThrow(/does not exist/);
    expect(() => policy.resolveDirectory("relative/project")).toThrow(/absolute/);
  });
});
