import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scriptsDirectory = path.resolve("infra/gcloud");
const scripts = readdirSync(scriptsDirectory).filter((name) => name.endsWith(".sh")).map((name) => path.join(scriptsDirectory, name));

describe("Google Cloud provisioning safety", () => {
  it("keeps every provisioning script syntactically valid", () => {
    for (const script of [...scripts, path.resolve("infra/vm/install-worker.sh")]) {
      expect(spawnSync("bash", ["-n", script], { encoding: "utf8" }).status, script).toBe(0);
    }
  });

  it("refuses to run without an explicit new-project confirmation", () => {
    const result = spawnSync("bash", [path.join(scriptsDirectory, "create-vm.sh")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PROJECT_ID");
  });

  it("never changes the global gcloud project or uses Firebase aliases", () => {
    const content = scripts.map((script) => readFileSync(script, "utf8")).join("\n");
    expect(content).not.toMatch(/gcloud\s+config\s+set\s+project/);
    expect(content).not.toMatch(/firebase\s+use/);
    expect(content).toContain('--project="$PROJECT_ID"');
  });
});
