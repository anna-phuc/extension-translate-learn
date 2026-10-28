// The Claude helper: a Chrome native-messaging host that runs the user's own Claude Code (`claude -p`), signed in to
// their Claude account, for the extension. Chrome starts it when the extension connects and ends it when the port
// closes. `npm run install-helper` copies this file and registers it with Chrome; it runs on Node's type stripping.
//
// Messages (one JSON object each, framed by Chrome as a 4-byte length plus UTF-8):
//   extension → helper: {type:"ping"} | {type:"run", model, effort, system, prompt}
//   helper → extension: {type:"pong", ...status} | {type:"text", text} | {type:"done", text} | {type:"error", kind, message}
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface HelperConfig {
  /** Absolute path of the `claude` executable. */
  claude: string;
  /** The PATH of the user's login shell, which Chrome does not pass on. */
  path: string;
}

export type ErrorKind = "auth" | "rate-limit" | "other";

export type HostReply =
  | { type: "pong"; ok: true; version: string; loggedIn: boolean; account: string }
  | { type: "pong"; ok: false; message: string }
  | { type: "text"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; kind: ErrorKind; message: string };

export interface RunRequest {
  type: "run";
  model: string;
  effort?: string;
  system: string;
  prompt: string;
}

// A lookup is one short answer; a stuck process must not hold the extension forever.
const runTimeoutMs = 120_000;

/**
 * The command line of one lookup: print mode with streamed JSON events, no tools, no MCP servers, no slash commands, no
 * settings files and no saved session, so it starts fast and only writes the answer. The prompt goes on stdin.
 */
export function claudeArgs(request: Pick<RunRequest, "model" | "effort" | "system">): string[] {
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", request.model,
    ...(request.effort ? ["--effort", request.effort] : []),
    "--system-prompt", request.system,
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources", "",
    "--no-session-persistence",
  ];
}

/** What a Claude Code error means for the user: not signed in, out of usage, or anything else. */
export function errorKind(message: string): ErrorKind {
  if (/not logged in|\/login|invalid api key|oauth|authenticat|unauthori[sz]ed|credential/i.test(message)) return "auth";
  if (/usage limit|rate limit|limit reached|overloaded|too many requests|429/i.test(message)) return "rate-limit";
  return "other";
}

/** The reply for one line of `claude -p --output-format stream-json`, or null for a line that carries nothing for us. */
export function replyForLine(line: string): HostReply | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
    return { type: "text", text: String(event.event.delta.text ?? "") };
  }
  if (event?.type === "result") {
    const text = typeof event.result === "string" ? event.result : "";
    if (event.is_error || event.subtype !== "success") {
      const message = text || (Array.isArray(event.errors) ? event.errors.join(" ") : "") || `Claude Code stopped (${event.subtype ?? "error"}).`;
      return { type: "error", kind: errorKind(message), message };
    }
    return { type: "done", text };
  }
  return null;
}

/** Splits a byte stream into Chrome's native messages: a 4-byte little-endian length, then that many bytes of JSON. */
export function frameReader(onMessage: (message: unknown) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      const body = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      try {
        onMessage(JSON.parse(body));
      } catch {
        // A message that is not JSON is ignored; Chrome never sends one.
      }
    }
  };
}

export function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  let config: HelperConfig;
  try {
    config = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));
  } catch {
    config = { claude: "claude", path: process.env.PATH ?? "" };
  }
  const env = { ...process.env, PATH: config.path || process.env.PATH };
  // An empty folder, so a project's CLAUDE.md never joins the prompt.
  const cwd = join(tmpdir(), "translate-learn");
  mkdirSync(cwd, { recursive: true });

  const children = new Set<ReturnType<typeof spawn>>();
  const send = (message: HostReply) => process.stdout.write(frame(message));
  const end = () => {
    for (const child of children) child.kill("SIGTERM");
    process.exit(0);
  };

  /** Runs `claude` with `args` and resolves with its stdout, stderr and exit code. */
  const capture = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string; failed?: Error }>(resolve => {
      const child = spawn(config.claude, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", data => (stdout += data));
      child.stderr.on("data", data => (stderr += data));
      child.on("error", failed => resolve({ code: null, stdout, stderr, failed }));
      child.on("close", code => {
        children.delete(child);
        resolve({ code, stdout, stderr });
      });
    });

  async function ping() {
    const version = await capture(["--version"]);
    if (version.failed || version.code !== 0) {
      return send({ type: "pong", ok: false, message: `Couldn't run Claude Code at ${config.claude}: ${version.failed?.message ?? version.stderr.trim()}` });
    }
    const status = await capture(["auth", "status", "--json"]);
    let auth: { loggedIn?: boolean; email?: string; authMethod?: string; subscriptionType?: string } = {};
    try {
      auth = JSON.parse(status.stdout);
    } catch {
      // An older Claude Code without `auth status`: the first lookup will tell.
    }
    const account = [auth.email, auth.subscriptionType].filter(Boolean).join(" · ") || auth.authMethod || "";
    send({ type: "pong", ok: true, version: version.stdout.trim(), loggedIn: Boolean(auth.loggedIn), account });
  }

  function run(request: RunRequest) {
    const child = spawn(config.claude, claudeArgs(request), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    let finished = false;
    let stderr = "";
    let pending = "";
    const finish = (reply: HostReply) => {
      if (finished) return;
      finished = true;
      send(reply);
    };
    const timer = setTimeout(() => {
      finish({ type: "error", kind: "other", message: "Claude Code took too long to answer. Retry." });
      child.kill("SIGTERM");
    }, runTimeoutMs);
    child.stdout.on("data", (data: Buffer) => {
      pending += data.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const reply = replyForLine(line);
        if (!reply) continue;
        if (reply.type === "text") {
          if (!finished) send(reply);
        } else finish(reply);
      }
    });
    child.stderr.on("data", data => (stderr = (stderr + data).slice(-2000)));
    child.on("error", error => finish({ type: "error", kind: "other", message: `Couldn't run Claude Code at ${config.claude}: ${error.message}` }));
    child.on("close", code => {
      clearTimeout(timer);
      children.delete(child);
      const last = stderr.trim().split("\n").pop() ?? "";
      finish({ type: "error", kind: errorKind(last), message: last || `Claude Code exited with code ${code} without an answer.` });
    });
    child.stdin.end(request.prompt);
  }

  process.stdin.on(
    "data",
    frameReader(message => {
      const request = message as { type?: string };
      if (request.type === "ping") void ping();
      else if (request.type === "run") run(request as RunRequest);
    }),
  );
  // Chrome closes stdin when the extension disconnects; the lookup's process goes with it.
  process.stdin.on("end", end);
  process.on("SIGTERM", end);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
