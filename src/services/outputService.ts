import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function sanitizeOutput(value: string, secretValues: readonly string[]): string {
  let sanitized = value.replace(ANSI_PATTERN, "").replace(/\0/g, "");
  for (const secret of secretValues) {
    if (secret.length >= 4) sanitized = sanitized.split(secret).join("[REDACTED]");
  }
  return sanitized.trim();
}

export function makePreview(value: string, maxChars: number, fromEnd = false): string {
  if (!value) return "(No output returned.)";
  if (value.length <= maxChars) return value;
  const leadingMarker = "… output truncated …\n";
  const trailingMarker = "\n… output truncated …";
  if (fromEnd) return `${leadingMarker}${value.slice(-(maxChars - leadingMarker.length))}`;
  return `${value.slice(0, maxChars - trailingMarker.length)}${trailingMarker}`;
}

export interface TemporaryAttachment {
  filePath: string;
  cleanup(): void;
}

export function createTemporaryAttachment(content: string, jobId: string): TemporaryAttachment {
  const directory = mkdtempSync(path.join(os.tmpdir(), "telegram-codex-"));
  const filePath = path.join(directory, `codex-output-${jobId.slice(0, 8)}.txt`);
  writeFileSync(filePath, content || "(No output returned.)", { encoding: "utf8", mode: 0o600 });
  return { filePath, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
