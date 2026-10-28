// `npm run install-helper`: installs the Claude helper for this user and registers it with Chrome (and the other
// Chromium browsers that are installed), so the extension can use the Claude Code that is signed in here.
// `npm run install-helper -- --uninstall` removes it again.
//
// Options for tests: --claude <path> (the claude to run), --home <dir> (where the helper goes), --browser-dir <dir>
// (register only in this NativeMessagingHosts folder, for a Chrome started with its own --user-data-dir).
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { frame, frameReader, type HelperConfig, type HostReply } from "./host.ts";

export const hostName = "io.translate_learn.claude";
const here = dirname(fileURLToPath(import.meta.url));
const { id: extensionId } = JSON.parse(readFileSync(join(here, "extension.json"), "utf8")) as { id: string };

const { values: options } = parseArgs({
  options: {
    uninstall: { type: "boolean", default: false },
    claude: { type: "string" },
    home: { type: "string" },
    "browser-dir": { type: "string" },
  },
});

const isMac = platform() === "darwin";
if (!isMac && platform() !== "linux") {
  console.error("The Claude helper supports macOS and Linux.");
  process.exit(1);
}

const helperHome = options.home ?? (isMac ? join(homedir(), "Library", "Application Support", "TranslateLearn") : join(homedir(), ".local", "share", "translate-learn"));

/** The NativeMessagingHosts folders of the Chromium browsers this user has (Chrome always). */
function browserDirs(): string[] {
  if (options["browser-dir"]) return [options["browser-dir"]];
  const base = isMac ? join(homedir(), "Library", "Application Support") : join(homedir(), ".config");
  const browsers = isMac
    ? ["Google/Chrome", "Google/Chrome Beta", "Google/Chrome Canary", "Chromium", "BraveSoftware/Brave-Browser", "Microsoft Edge", "Arc/User Data"]
    : ["google-chrome", "google-chrome-beta", "chromium", "BraveSoftware/Brave-Browser", "microsoft-edge"];
  const chrome = isMac ? "Google/Chrome" : "google-chrome";
  return browsers.filter(name => name === chrome || existsSync(join(base, name))).map(name => join(base, name, "NativeMessagingHosts"));
}

/** Runs `script` in the user's login shell and returns what it printed between two markers (rc files may print too). */
function fromLoginShell(script: string): string {
  const shell = process.env.SHELL || (isMac ? "/bin/zsh" : "/bin/bash");
  const result = spawnSync(shell, ["-lic", `printf '<<<%s>>>' "$(${script})"`], { encoding: "utf8", timeout: 15_000 });
  return /<<<([\s\S]*?)>>>/.exec(result.stdout ?? "")?.[1]?.trim() ?? "";
}

function findClaude(): string {
  if (options.claude) return options.claude;
  const found = fromLoginShell("command -v claude");
  if (found.startsWith("/")) return found;
  const fallback = join(homedir(), ".local", "bin", "claude");
  if (existsSync(fallback)) return fallback;
  console.error("Couldn't find Claude Code. Install it (https://claude.com/claude-code), sign in with `claude`, then run this again.");
  process.exit(1);
}

function uninstall() {
  for (const dir of browserDirs()) rmSync(join(dir, `${hostName}.json`), { force: true });
  rmSync(helperHome, { recursive: true, force: true });
  console.log("Removed the Claude helper.");
}

/** Starts the installed helper the way Chrome does and asks it for Claude Code's status. */
function selfTest(launcher: string): Promise<HostReply | null> {
  return new Promise(resolve => {
    const child = spawn(launcher, [`chrome-extension://${extensionId}/`], { stdio: ["pipe", "pipe", "inherit"] });
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 20_000);
    child.stdout.on(
      "data",
      frameReader(message => {
        clearTimeout(timer);
        child.stdin.end();
        resolve(message as HostReply);
      }),
    );
    child.stdin.write(frame({ type: "ping" }));
  });
}

async function install() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(`The helper needs Node.js 22.18 or later (this is ${process.version}).`);
    process.exit(1);
  }
  const claude = findClaude();
  const path = fromLoginShell('printf %s "$PATH"') || process.env.PATH || "";

  mkdirSync(helperHome, { recursive: true });
  copyFileSync(join(here, "host.ts"), join(helperHome, "host.ts"));
  writeFileSync(join(helperHome, "config.json"), JSON.stringify({ claude, path } satisfies HelperConfig, null, 2) + "\n");
  // Chrome starts the host with a bare environment, so the launcher names this Node.js by its absolute path.
  const launcher = join(helperHome, "translate-learn-helper");
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" --no-warnings "${join(helperHome, "host.ts")}" "$@"\n`);
  chmodSync(launcher, 0o755);

  const manifest = {
    name: hostName,
    description: "Runs your Claude Code for the Translate & Learn extension",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  const dirs = browserDirs();
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${hostName}.json`), JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(`Installed the Claude helper in ${helperHome}`);
  console.log(`Registered it for: ${dirs.map(dir => dirname(dir)).join(", ")}`);
  console.log(`Claude Code: ${claude}`);

  const pong = await selfTest(launcher);
  if (!pong || pong.type !== "pong") console.log("The helper did not answer its self-test. Check that Node.js and Claude Code run in a terminal.");
  else if (!pong.ok) console.log(pong.message);
  else if (!pong.loggedIn) console.log(`${pong.version}, but not signed in. Run \`claude auth login\` (or \`claude\`, then /login), then try the extension.`);
  else console.log(`${pong.version}, signed in${pong.account ? ` (${pong.account})` : ""}. Reload the extension in chrome://extensions and you're set.`);
}

if (options.uninstall) uninstall();
else await install();
