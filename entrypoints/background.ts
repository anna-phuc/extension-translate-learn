// Runs every Claude request (Claude Code through the helper, or the API key as a fallback), keeps the latest lookup, and streams its progress to the page's popup (port "lookup")
// and the side panel (port "panel").
import { browser, type Browser } from "wxt/browser";
import { LookupError, requestJson } from "../lib/claude.ts";
import { speak, stopSpeaking, warmUpVoices } from "../lib/tts.ts";
import { getHistory, getLatestLookupId, getSettings, saveToHistory, setLatestLookupId, setPanelRequest } from "../lib/store.ts";
import { buildFeedbackPrompt, excerpt, feedbackSystemPrompt, parseFeedbackReply, resultFromReply } from "../shared/feedback.ts";
import { buildPrompt, parsePartialReply, parseReply, systemPrompt } from "../shared/translate.ts";
import type {
  CheckResponse,
  Lookup,
  LookupClientMessage,
  LookupServerMessage,
  PageInfo,
  PanelClientMessage,
  RuntimeMessage,
} from "../shared/types.ts";
import type { Candidate } from "../shared/translate.ts";

type Port = Browser.runtime.Port;

// Partial replies arrive per token; the popup and panel only need a few frames a second.
const publishIntervalMs = 100;

export default defineBackground(() => {
  // The toolbar icon opens the side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  warmUpVoices();

  let latest: Lookup | null = null;
  const running = new Map<string, AbortController>();
  const popupPorts = new Map<string, Set<Port>>();
  const panelPorts = new Set<Port>();
  const lastPublish = new Map<string, number>();

  const send = (port: Port, lookup: Lookup | null) => {
    try {
      port.postMessage({ type: "update", lookup } satisfies LookupServerMessage);
    } catch {
      // The port closed between the check and the post.
    }
  };

  const publish = (lookup: Lookup, force = false) => {
    const now = Date.now();
    if (!force && now - (lastPublish.get(lookup.id) ?? 0) < publishIntervalMs) return;
    lastPublish.set(lookup.id, now);
    for (const port of popupPorts.get(lookup.id) ?? []) send(port, lookup);
    if (latest?.id === lookup.id) for (const port of panelPorts) send(port, lookup);
  };

  const update = (lookup: Lookup, patch: Partial<Lookup>, force = false) => {
    Object.assign(lookup, patch);
    publish(lookup, force);
  };

  async function run(lookup: Lookup) {
    running.get(lookup.id)?.abort();
    const controller = new AbortController();
    running.set(lookup.id, controller);
    update(lookup, { status: "loading", result: null, error: undefined, errorKind: undefined }, true);
    try {
      const settings = await getSettings();
      const prompt = buildPrompt({ text: lookup.text, sentence: lookup.sentence }, settings);
      // A reply that streams but fails validation gets one more try before the error shows.
      for (let attempt = 0; ; attempt++) {
        const text = await requestJson({
          settings,
          system: systemPrompt,
          prompt,
          signal: controller.signal,
          onText: snapshot => {
            const partial = parsePartialReply(snapshot);
            if (partial) update(lookup, { result: partial });
          },
        });
        const parsed = parseReply(text);
        if (parsed.ok) {
          update(lookup, { status: "done", result: parsed.value }, true);
          await saveToHistory(lookup);
          return;
        }
        if (attempt >= 1) throw new LookupError("Claude's answer couldn't be read. Retry.", "other");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = error instanceof LookupError ? error : new LookupError(String(error), "other");
      update(lookup, { status: "error", error: failure.message, errorKind: failure.kind }, true);
    } finally {
      if (running.get(lookup.id) === controller) running.delete(lookup.id);
      lastPublish.delete(lookup.id);
    }
  }

  function startLookup(candidate: Candidate, page: PageInfo): Lookup {
    const lookup: Lookup = {
      id: crypto.randomUUID(),
      text: candidate.text,
      sentence: candidate.sentence,
      url: page.url,
      title: page.title,
      createdAt: Date.now(),
      status: "loading",
      result: null,
    };
    latest = lookup;
    setLatestLookupId(lookup.id).catch(() => {});
    void run(lookup);
    return lookup;
  }

  /** The latest lookup, from memory or, after a worker restart, from the history. */
  async function findLatest(): Promise<Lookup | null> {
    if (latest) return latest;
    const id = await getLatestLookupId();
    const history = await getHistory();
    latest = (id ? history.find(entry => entry.id === id) : history[0]) ?? null;
    return latest;
  }

  async function findLookup(id: string): Promise<Lookup | null> {
    if (latest?.id === id) return latest;
    return (await getHistory()).find(entry => entry.id === id) ?? null;
  }

  function onPopupPort(port: Port) {
    let current: Lookup | null = null;
    const detach = () => {
      if (current) popupPorts.get(current.id)?.delete(port);
    };
    port.onMessage.addListener((message: LookupClientMessage) => {
      if (message.type === "start") {
        // A new selection from the same popup replaces the one it showed.
        if (current?.status === "loading") running.get(current.id)?.abort();
        detach();
        current = startLookup(message.candidate, message.page);
        popupPorts.set(current.id, new Set([...(popupPorts.get(current.id) ?? []), port]));
        send(port, current);
      } else if (message.type === "retry" && current) {
        latest = current;
        void run(current);
      }
    });
    port.onDisconnect.addListener(detach);
  }

  function onPanelPort(port: Port) {
    panelPorts.add(port);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    findLatest().then(lookup => send(port, lookup));
    port.onMessage.addListener(async (message: PanelClientMessage) => {
      if (message.type !== "retry") return;
      const lookup = await findLookup(message.id);
      if (!lookup) return;
      latest = lookup;
      setLatestLookupId(lookup.id).catch(() => {});
      void run(lookup);
    });
  }

  browser.runtime.onConnect.addListener(port => {
    if (port.name === "lookup") onPopupPort(port);
    else if (port.name === "panel") onPanelPort(port);
  });

  async function check(text: string): Promise<CheckResponse> {
    try {
      const settings = await getSettings();
      const cut = excerpt(text);
      const prompt = buildFeedbackPrompt(cut.text, settings);
      for (let attempt = 0; ; attempt++) {
        const reply = await requestJson({ settings, system: feedbackSystemPrompt, prompt });
        const parsed = parseFeedbackReply(reply);
        if (parsed.ok) return { ok: true, result: resultFromReply(cut.text, cut.truncated, parsed.value) };
        if (attempt >= 1) throw new LookupError("Claude's answer couldn't be read. Retry.", "other");
      }
    } catch (error) {
      const failure = error instanceof LookupError ? error : new LookupError(String(error), "other");
      return { ok: false, error: failure.message, errorKind: failure.kind };
    }
  }

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "open-panel") {
      // sidePanel.open must run while the click's user gesture is still active, so before any await.
      const tabId = sender.tab?.id;
      const opening = tabId !== undefined ? browser.sidePanel.open({ tabId }) : Promise.resolve();
      setPanelRequest({ view: message.view, lookupId: message.lookupId, at: Date.now() }).catch(() => {});
      opening.then(
        () => sendResponse({ ok: true }),
        (error: unknown) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;
    }
    if (message.type === "check") {
      check(message.text).then(sendResponse);
      return true;
    }
    if (message.type === "speak") {
      speak(message.text, message.accent, message.rate, message.voice).then(sendResponse);
      return true;
    }
    if (message.type === "stop-speech") {
      stopSpeaking();
      sendResponse({ ok: true, voice: "", stopped: true });
      return false;
    }
    return false;
  });
});
