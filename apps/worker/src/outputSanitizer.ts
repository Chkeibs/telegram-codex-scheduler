const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const TOKEN_PATTERNS = [
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g,
  /\b(?:sk-[A-Za-z0-9_-]{20,}|(?:gho|ghp)_[A-Za-z0-9_-]{20,})\b/g,
  /"(?:access_token|refresh_token|id_token|client_secret)"\s*:\s*"[^"]+"/gi,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

export function sanitizeOutput(value: string, knownSecrets: readonly string[] = []): string {
  let result = value.replace(ANSI_PATTERN, "").replace(/\0/g, "");
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, "[REDACTED]");
  for (const secret of [...knownSecrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 4) result = result.split(secret).join("[REDACTED]");
  }
  return result.trim();
}

export function preview(value: string, maximum: number, fromEnd = false): string {
  if (!value) return "(No output returned.)";
  if (value.length <= maximum) return value;
  const marker = "… output truncated …\n";
  return fromEnd ? `${marker}${value.slice(-(maximum - marker.length))}` : `${value.slice(0, maximum - marker.length)}\n${marker.trim()}`;
}
