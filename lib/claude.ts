// Every Claude request goes through here: the user's Claude account through Claude Code (the helper) first, and the
// user's API key when Claude Code is not set up or not signed in on this computer.
import { apiKeyHint, fallsBackToApiKey } from "../shared/connection.ts";
import type { Settings } from "../shared/settings.ts";
import { requestWithApiKey } from "./api.ts";
import { LookupError, requestJson as requestWithHelper } from "./helper.ts";

export { LookupError };

interface JsonRequest {
  settings: Settings;
  system: string;
  prompt: string;
  /** Called with the whole text received so far, on every delta. */
  onText?: (snapshot: string) => void;
  signal?: AbortSignal;
}

/** Runs one prompt and returns the reply's text. Throws a `LookupError` fit for the user. */
export async function requestJson(request: JsonRequest): Promise<string> {
  try {
    return await requestWithHelper(request);
  } catch (error) {
    if (!(error instanceof LookupError) || request.signal?.aborted) throw error;
    if (fallsBackToApiKey(error.kind, request.settings.apiKey)) {
      return requestWithApiKey({ ...request, apiKey: request.settings.apiKey, model: request.settings.model });
    }
    if (error.kind === "setup" || error.kind === "auth") throw new LookupError(`${error.message} ${apiKeyHint}`, error.kind);
    throw error;
  }
}
