import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CodexRunner } from "../src/codexRunner.js";
import { WorkdirPolicy } from "../src/pathPolicy.js";

const temporary: string[] = [];
const mockCodex = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mock-codex.sh");

function fixture(timeoutMs = 2_000) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cloud-codex-runner-"));
  temporary.push(root);
  const project = path.join(root, "project");
  mkdirSync(project);
  return new CodexRunner(mockCodex, new WorkdirPolicy({ default: project }), timeoutMs, 4096);
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("cloud CodexRunner real-process smoke", () => {
  it("passes a hostile-looking prompt as one argument with no shell", async () => {
    const prompt = "inspect; touch /tmp/this-must-not-run && $(whoami)";
    const result = await fixture().run({ prompt, workdirKey: "default", filesystemPermission: "read_only" });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain(`arg[7]=${prompt}`);
    expect(result.stdout).toContain("arg[1]=never");
    expect(result.stdout).toContain("arg[5]=read-only");
  });

  it("captures a non-zero exit and diagnostics", async () => {
    const result = await fixture().run({ prompt: "__FAIL__", workdirKey: "default", filesystemPermission: "workspace_write" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(17);
    expect(result.stderr).toContain("mock diagnostic");
    expect(result.stdout).toContain("arg[5]=workspace-write");
  });

  it("terminates a timed-out process group", async () => {
    const result = await fixture(50).run({ prompt: "__HANG__", workdirKey: "default", filesystemPermission: "read_only" });
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain("timed out");
  });
});
