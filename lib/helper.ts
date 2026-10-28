// The extension's first way to Claude (lib/claude.ts picks): the Claude helper (helper/host.ts), a native-messaging
// host that runs the user's own Claude Code, signed in to their Claude account. One port per request; Chrome starts the helper for it and
// ends it when the port closes.
import { browser } from "wxt/browser";
import type { Settings } from "../shared/settings.ts";
import type { ErrorKind } from "../shared/types.ts";

/** Must match `hostName` in helper/install.ts. */
export const helperHostName = "io.translate_learn.claude";

export const setupCommand = "npm run install-helper";
export const signInCommand = "claude auth login";

export class LookupError extends Error {
  readonly kind: ErrorKind;
  constructor(message: string, kind: ErrorKind) {
    super(message);
    this.kind = kind;
  }
}

type HostReply =
  | { type: "pong"; ok: true; version: string; loggedIn: boolean; account: string }
  | { type: "pong"; ok: false; message: string }
  | { type: "text"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; kind: "auth" | "rate-limit" | "other"; message: string };

const missingHelper = `The Claude helper isn't set up yet. In the extension's folder, run \`${setupCommand}\`, then try again.`;

/** Why the port closed before an answer, for the user: Chrome's own messages are not meant for them. */
function disconnectError(): LookupError {
  const reason = browser.runtime.lastError?.message ?? "";
  if (/not found|forbidden|access to the specified native messaging host/i.test(reason)) return new LookupError(missingHelper, "setup");
  return new LookupError(`The Claude helper stopped unexpectedly${reason ? ` (${reason})` : ""}. Run \`${setupCommand}\` again if this keeps happening.`, "setup");
}

function friendly(reply: Extract<HostReply, { type: "error" }>): LookupError {
  if (reply.kind === "auth") return new LookupError(`Claude Code isn't signed in to your Claude account. Run \`${signInCommand}\` in Terminal, then retry.`, "auth");
  if (reply.kind === "rate-limit") return new LookupError(`Claude says: ${reply.message}`, "rate-limit");
  return new LookupError(reply.message, "other");
}

/** Opens a port to the helper, sends `message`, and settles on the first reply `settle` accepts. */
function talk<T>(message: object, settle: (reply: HostReply) => { value: T } | { error: LookupError } | null, signal?: AbortSignal, onReply?: (reply: HostReply) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let port: ReturnType<typeof browser.runtime.connectNative>;
    const finish = (outcome: { value: T } | { error: LookupError }) => {
      if (done) return;
      done = true;
      port.disconnect();
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.value);
    };
    try {
      port = browser.runtime.connectNative(helperHostName);
    } catch {
      reject(new LookupError(missingHelper, "setup"));
      return;
    }
    port.onMessage.addListener((reply: HostReply) => {
      onReply?.(reply);
      const outcome = settle(reply);
      if (outcome) finish(outcome);
    });
    port.onDisconnect.addListener(() => {
      if (!done) {
        done = true;
        reject(disconnectError());
      }
    });
    signal?.addEventListener("abort", () => finish({ error: new LookupError("Cancelled.", "other") }), { once: true });
    port.postMessage(message);
  });
}

interface JsonRequest {
  settings: Settings;
  system: string;
  prompt: string;
  /** Called with the whole text received so far, on every delta. */
  onText?: (snapshot: string) => void;
  signal?: AbortSignal;
}

/** Runs one prompt on the user's Claude Code and returns the reply's text. Throws a `LookupError` fit for the user. */
export function requestJson({ settings, system, prompt, onText, signal }: JsonRequest): Promise<string> {
  let snapshot = "";
  return talk<string>(
    // A lookup is a short, well-specified task; low effort keeps the wait down.
    { type: "run", model: settings.model, effort: "low", system, prompt },
    reply => (reply.type === "done" ? { value: reply.text || snapshot } : reply.type === "error" ? { error: friendly(reply) } : null),
    signal,
    reply => {
      if (reply.type !== "text") return;
      snapshot += reply.text;
      onText?.(snapshot);
    },
  );
}

export type HelperStatus =
  | { state: "ready"; version: string; account: string }
  | { state: "signed-out"; version: string; message: string }
  | { state: "missing"; message: string };

/** Whether the helper is installed and Claude Code is signed in, for the settings and the empty lesson view. */
export async function helperStatus(): Promise<HelperStatus> {
  try {
    const pong = await talk<Extract<HostReply, { type: "pong" }>>({ type: "ping" }, reply => (reply.type === "pong" ? { value: reply } : null));
    if (!pong.ok) return { state: "missing", message: pong.message };
    if (!pong.loggedIn) return { state: "signed-out", version: pong.version, message: `Run \`${signInCommand}\` in Terminal to sign in to your Claude account.` };
    return { state: "ready", version: pong.version, account: pong.account };
  } catch (error) {
    return { state: "missing", message: error instanceof Error ? error.message : String(error) };
  }
}
