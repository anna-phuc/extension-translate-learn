import { defineConfig } from "wxt";
import extension from "./helper/extension.json" with { type: "json" };

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Translate & Learn",
    description: "Select text on any website for a translation and a short English lesson. Check the English you write.",
    // A fixed key keeps the extension's ID, which the Claude helper allows by name (helper/extension.json).
    key: extension.key,
    // nativeMessaging reaches the Claude helper, which runs the user's Claude Code.
    // tts speaks the pronunciation with the computer's own voices.
    permissions: ["storage", "sidePanel", "nativeMessaging", "tts"],
    // Only for the API key fallback, used when Claude Code is not available.
    host_permissions: ["https://api.anthropic.com/*"],
    action: { default_title: "Open Translate & Learn" },
  },
});
