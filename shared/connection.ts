import type { ErrorKind } from "./types.ts";

/**
 * Whether a lookup that failed on Claude Code should run again with the user's API key: only when Claude Code is not
 * set up or not signed in (a usage limit or a bad answer is not a reason to start spending API credit), and only when
 * there is a key.
 */
export const fallsBackToApiKey = (kind: ErrorKind, apiKey: string) => (kind === "setup" || kind === "auth") && apiKey.trim() !== "";

/** Added to a Claude Code setup or sign-in error when there is no key to fall back to. */
export const apiKeyHint = "Or add an Anthropic API key in Settings.";
