import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTemporaryAttachment } from "../src/services/outputService.js";

describe("full output attachment", () => {
  it("creates a private temporary file and removes it after delivery cleanup", () => {
    const attachment = createTemporaryAttachment("sanitized output", "12345678-1234-1234-1234-123456789012");
    expect(existsSync(attachment.filePath)).toBe(true);
    attachment.cleanup();
    expect(existsSync(attachment.filePath)).toBe(false);
  });
});
