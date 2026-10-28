import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { claudeArgs, errorKind, frame, frameReader, replyForLine } from "../helper/host.ts";

const event = (value: object) => JSON.stringify(value);

test("a lookup runs Claude Code in print mode with streamed events and nothing it does not need", () => {
  const args = claudeArgs({ model: "claude-haiku-5-5", effort: "low", system: "Be brief." });
  const flag = (name: string) => args[args.indexOf(name) + 1];
  assert.equal(args[0], "-p");
  assert.equal(flag("--output-format"), "stream-json");
  assert.ok(args.includes("--verbose") && args.includes("--include-partial-messages"));
  assert.equal(flag("--model"), "claude-haiku-5-5");
  assert.equal(flag("--effort"), "low");
  assert.equal(flag("--system-prompt"), "Be brief.");
  assert.equal(flag("--tools"), "", "no tools");
  assert.equal(flag("--setting-sources"), "", "no settings files, so no hooks");
  for (const name of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) assert.ok(args.includes(name), name);
  assert.ok(!args.includes("--bare"), "--bare would turn off the Claude account sign-in");
  assert.ok(!claudeArgs({ model: "m", system: "s" }).includes("--effort"));
});

test("text deltas stream out, the result ends the run, and other events are ignored", () => {
  assert.deepEqual(replyForLine(event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"tra' } } })), { type: "text", text: '{"tra' });
  assert.equal(replyForLine(event({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } } })), null);
  assert.equal(replyForLine(event({ type: "system", subtype: "init" })), null);
  assert.equal(replyForLine("not json"), null);
  assert.deepEqual(replyForLine(event({ type: "result", subtype: "success", is_error: false, result: '{"translation":"x"}' })), { type: "done", text: '{"translation":"x"}' });
});

test("a failed result becomes an error with a kind the extension can explain", () => {
  // What Claude Code 2.1.153 prints when it is not signed in.
  assert.deepEqual(replyForLine(event({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" })), {
    type: "error", kind: "auth", message: "Not logged in · Please run /login",
  });
  assert.equal(errorKind("Claude AI usage limit reached|1761500000"), "rate-limit");
  assert.equal(errorKind("Something else broke"), "other");
  const maxTurns = replyForLine(event({ type: "result", subtype: "error_max_turns", is_error: true }));
  assert.equal(maxTurns?.type, "error");
});

test("native messages are framed with a 4-byte little-endian length and read back across chunk boundaries", () => {
  const messages: unknown[] = [];
  const read = frameReader(message => messages.push(message));
  const bytes = Buffer.concat([frame({ type: "ping" }), frame({ type: "run", prompt: "Xin chào, thế giới" })]);
  assert.equal(bytes.readUInt32LE(0), Buffer.byteLength(JSON.stringify({ type: "ping" })));
  for (let at = 0; at < bytes.length; at += 3) read(bytes.subarray(at, at + 3));
  assert.deepEqual(messages, [{ type: "ping" }, { type: "run", prompt: "Xin chào, thế giới" }]);
});

test("the extension and the installer name the same helper, and the manifest key matches the allowed ID", async () => {
  const name = /hostName = "([^"]+)"/.exec(readFileSync("helper/install.ts", "utf8"))?.[1];
  assert.equal(/helperHostName = "([^"]+)"/.exec(readFileSync("lib/helper.ts", "utf8"))?.[1], name);
  const { createHash } = await import("node:crypto");
  const { id, key } = JSON.parse(readFileSync("helper/extension.json", "utf8"));
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16).toString("hex");
  assert.equal([...digest].map(c => String.fromCharCode(97 + parseInt(c, 16))).join(""), id);
});

import { fallsBackToApiKey } from "../shared/connection.ts";

test("the API key is used only when Claude Code is not set up or signed in, and only when there is a key", () => {
  assert.equal(fallsBackToApiKey("setup", "sk-ant-x"), true);
  assert.equal(fallsBackToApiKey("auth", "sk-ant-x"), true);
  assert.equal(fallsBackToApiKey("auth", "  "), false);
  assert.equal(fallsBackToApiKey("rate-limit", "sk-ant-x"), false, "a usage limit does not start spending API credit");
  assert.equal(fallsBackToApiKey("other", "sk-ant-x"), false);
});
