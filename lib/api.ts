// The fallback way to Claude: the Claude API with the user's own key, for a computer whose Claude Code is not set up
// or not signed in. Runs in the background worker, which is not subject to a page's CSP or CORS.
import Anthropic from "@anthropic-ai/sdk";
import { LookupError } from "./helper.ts";

interface ApiRequest {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  /** Called with the whole text received so far, on every delta. */
  onText?: (snapshot: string) => void;
  signal?: AbortSignal;
}

/** Streams one reply with the user's API key and returns its text. Throws a `LookupError` fit for the user. */
export async function requestWithApiKey({ apiKey, model, system, prompt, onText, signal }: ApiRequest): Promise<string> {
  // The key is the user's own and stays in this browser; the SDK's browser guard is meant for keys shipped to others.
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: prompt }],
        // A lookup is a short, well-specified task; low effort keeps the wait to a few seconds.
        output_config: { effort: "low" },
      },
      { signal },
    );
    if (onText) stream.on("text", (_delta, snapshot) => onText(snapshot));
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new LookupError("Claude declined to answer this one.", "other");
    if (message.stop_reason === "max_tokens") throw new LookupError("The answer was too long and got cut off. Try a shorter selection.", "other");
    return message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("");
  } catch (error) {
    throw apiError(error);
  }
}

function apiError(error: unknown): LookupError {
  if (error instanceof LookupError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new LookupError("Your Anthropic API key was rejected. Check it in Settings.", "auth");
  if (error instanceof Anthropic.PermissionDeniedError) return new LookupError("Your API key can't use this model. Pick another model in Settings.", "auth");
  if (error instanceof Anthropic.NotFoundError) return new LookupError("The selected model isn't available to your API key. Pick another model in Settings.", "other");
  if (error instanceof Anthropic.RateLimitError) return new LookupError("Too many requests on your API key right now. Wait a moment and retry.", "rate-limit");
  if (error instanceof Anthropic.APIUserAbortError) return new LookupError("Cancelled.", "other");
  if (error instanceof Anthropic.APIConnectionError) return new LookupError("Couldn't reach the Claude API. Check your connection and retry.", "other");
  if (error instanceof Anthropic.InternalServerError) return new LookupError("The Claude API had a problem. Retry in a moment.", "other");
  if (error instanceof Anthropic.APIError) return new LookupError(`Claude API error ${error.status ?? ""}: ${error.message}`.trim(), "other");
  return new LookupError(error instanceof Error ? error.message : String(error), "other");
}
