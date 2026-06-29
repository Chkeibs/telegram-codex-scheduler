import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexResetCreditsReader } from "../src/codexResetCreditsReader.js";

const tempDirs: string[] = [];

async function codexHomeWithAuth(auth: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-reset-auth-"));
  tempDirs.push(root);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "auth.json"), JSON.stringify(auth), "utf8");
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodexResetCreditsReader", () => {
  it("reads reset credits through the private ChatGPT endpoint without returning token data", async () => {
    const codexHome = await codexHomeWithAuth({ tokens: { access_token: "access-secret", account_id: "account-id" } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      available_count: 1,
      credits: [{ id: "credit-id", status: "available", expires_at: "2026-07-18T00:13:00.000Z" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const reader = new CodexResetCreditsReader({
      mode: "private_endpoint_details",
      endpoint: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
      timeoutMs: 1000,
      codexHome,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(reader.read()).resolves.toEqual({
      availableCount: 1,
      availableCredits: [{ status: "available", expiresAt: "2026-07-18T00:13:00.000Z" }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer access-secret",
        "chatgpt-account-id": "account-id",
      }),
    }));
  });

  it("rejects non-chatgpt endpoints", async () => {
    const codexHome = await codexHomeWithAuth({ tokens: { access_token: "access-secret", account_id: "account-id" } });
    const reader = new CodexResetCreditsReader({
      mode: "private_endpoint_details",
      endpoint: "https://example.com/steal",
      timeoutMs: 1000,
      codexHome,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(reader.read()).rejects.toThrow("chatgpt.com");
  });
});
