import { describe, expect, it } from "vitest";
import { preview, sanitizeOutput } from "../src/outputSanitizer.js";

describe("worker output sanitization", () => {
  it("redacts known and token-shaped secrets", () => {
    const value = sanitizeOutput('secret-value 1234567890:abcdefghijklmnopqrstuvwxyzABCDEFGHIJ sk-proj-abcdefghijklmnopqrstuvwxyz "access_token":"eyJabcdefghijklmnopqrstuvwxyz"', ["secret-value"]);
    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("1234567890:");
    expect(value).not.toContain("sk-proj-");
    expect(value).not.toContain("eyJabcdefghijklmnopqrstuvwxyz");
    expect(value).toContain("[REDACTED]");
  });

  it("bounds previews", () => {
    expect(preview("a".repeat(100), 40)).toHaveLength(40);
    expect(preview("a".repeat(100), 40)).toContain("truncated");
  });
});
