import { describe, expect, it, vi } from "vitest";
import { createResultDelivery } from "../src/deliverResult.js";

describe("result delivery", () => {
  it("sends a completion without rerunning work", async () => {
    const repository = {
      claim: vi.fn(async () => ({ jobId: "job", kind: "immediate" as const, telegramChatId: "1", status: "completed" as const, outputPreview: "done", errorPreview: null, resultObjectName: null, outputMode: "preview" as const, maxOutputChars: 3500, attempt: 1 })),
      markSent: vi.fn(async () => undefined),
      releaseForRetry: vi.fn(async () => undefined),
    };
    const telegram = { sendMessage: vi.fn(async () => ({ message_id: 42 })), sendDocument: vi.fn(async () => ({ message_id: 43 })) };
    const artifacts = { read: vi.fn(async () => Buffer.from("full")), delete: vi.fn(async () => undefined) };
    await expect(createResultDelivery(repository as never, telegram, artifacts)("job")).resolves.toBe("sent");
    expect(telegram.sendMessage).toHaveBeenCalledWith("1", expect.stringContaining("done"));
    expect(repository.markSent).toHaveBeenCalledWith("job", 42);
  });

  it("releases delivery for retry after Telegram failure", async () => {
    const repository = {
      claim: vi.fn(async () => ({ jobId: "job", kind: "immediate" as const, telegramChatId: "1", status: "failed" as const, outputPreview: null, errorPreview: "bad", resultObjectName: null, outputMode: "preview" as const, maxOutputChars: 3500, attempt: 1 })),
      markSent: vi.fn(async () => undefined),
      releaseForRetry: vi.fn(async () => undefined),
    };
    const telegram = { sendMessage: vi.fn(async () => { throw new Error("offline"); }), sendDocument: vi.fn(async () => ({ message_id: 43 })) };
    const artifacts = { read: vi.fn(async () => Buffer.from("full")), delete: vi.fn(async () => undefined) };
    await expect(createResultDelivery(repository as never, telegram, artifacts)("job")).rejects.toThrow("offline");
    expect(repository.releaseForRetry).toHaveBeenCalledWith("job", "offline");
  });

  it("sends full mode as a temporary attachment and cleans the object", async () => {
    const repository = {
      claim: vi.fn(async () => ({ jobId: "job", kind: "immediate" as const, telegramChatId: "1", status: "completed" as const, outputPreview: "preview", errorPreview: null, resultObjectName: "result-artifacts/job.txt", outputMode: "full" as const, maxOutputChars: 3500, attempt: 1 })),
      markSent: vi.fn(async () => undefined),
      releaseForRetry: vi.fn(async () => undefined),
    };
    const telegram = { sendMessage: vi.fn(async () => ({ message_id: 42 })), sendDocument: vi.fn(async () => ({ message_id: 43 })) };
    const artifacts = { read: vi.fn(async () => Buffer.from("full output")), delete: vi.fn(async () => undefined) };
    await expect(createResultDelivery(repository as never, telegram, artifacts)("job")).resolves.toBe("sent");
    expect(telegram.sendDocument).toHaveBeenCalledOnce();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(artifacts.delete).toHaveBeenCalledWith("result-artifacts/job.txt");
  });

  it("sends Codex usage results as the only Telegram text without a Codex wrapper", async () => {
    const repository = {
      claim: vi.fn(async () => ({ jobId: "job", kind: "reset_credit_status" as const, telegramChatId: "1", status: "completed" as const, outputPreview: "Codex usage & resets\n\n5-hour limit: 43% used (57% left)\nResets: 01 Sep 2026, 01:37 (America/New_York)", errorPreview: null, resultObjectName: "ignored.txt", outputMode: "full" as const, maxOutputChars: 3500, attempt: 1 })),
      markSent: vi.fn(async () => undefined),
      releaseForRetry: vi.fn(async () => undefined),
    };
    const telegram = { sendMessage: vi.fn(async () => ({ message_id: 42 })), sendDocument: vi.fn(async () => ({ message_id: 43 })) };
    const artifacts = { read: vi.fn(async () => Buffer.from("full")), delete: vi.fn(async () => undefined) };
    await expect(createResultDelivery(repository as never, telegram, artifacts)("job")).resolves.toBe("sent");
    expect(telegram.sendMessage).toHaveBeenCalledWith("1", "Codex usage & resets\n\n5-hour limit: 43% used (57% left)\nResets: 01 Sep 2026, 01:37 (America/New_York)");
    expect(telegram.sendDocument).not.toHaveBeenCalled();
    expect(artifacts.read).not.toHaveBeenCalled();
  });
});
