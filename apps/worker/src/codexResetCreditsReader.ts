import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseResetCreditsResponse, type CodexResetCreditsSnapshot } from "@telegram-codex/shared";

interface AuthFile {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

export interface CodexResetCreditsReaderOptions {
  mode: "disabled" | "private_endpoint_details";
  endpoint: string;
  timeoutMs: number;
  codexHome?: string;
  fetchImpl?: typeof fetch;
}

export class CodexResetCreditsReader {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CodexResetCreditsReaderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async read(): Promise<CodexResetCreditsSnapshot> {
    if (this.options.mode === "disabled") {
      throw new Error("Reset-credit details are disabled. Set CODEX_RESET_CREDIT_DETAILS_MODE=private_endpoint_details on the worker.");
    }
    const endpoint = this.safeEndpoint();
    const auth = await this.readAuth();
    const accessToken = auth.tokens?.access_token;
    const accountId = auth.tokens?.account_id;
    if (!accessToken || !accountId) {
      throw new Error("Codex auth is missing access_token or account_id. Run codex login on the worker.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    timeout.unref();
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": accountId,
          "user-agent": "telegram-codex-scheduler",
        },
      });
      if (!response.ok) throw new Error(`Reset-credit request failed with HTTP ${response.status}`);
      return parseResetCreditsResponse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  private safeEndpoint(): URL {
    const url = new URL(this.options.endpoint);
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") {
      throw new Error("Reset-credit endpoint must be an HTTPS chatgpt.com URL");
    }
    return url;
  }

  private async readAuth(): Promise<AuthFile> {
    const codexHome = this.options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    return JSON.parse(await readFile(path.join(codexHome, "auth.json"), "utf8")) as AuthFile;
  }
}
