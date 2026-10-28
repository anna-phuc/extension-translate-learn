import { useEffect, useMemo, useState } from "react";
import { browser, type Browser } from "wxt/browser";
import { useHistory, useSettings } from "../../components/hooks.ts";
import { SettingsIcon } from "../../components/icons.tsx";
import { getPanelRequest, watchPanelRequest } from "../../lib/store.ts";
import type { Lookup, LookupServerMessage, PanelClientMessage, PanelRequest, PanelView } from "../../shared/types.ts";
import { useHelperStatus } from "./ConnectionStatus.tsx";
import { HistoryView } from "./HistoryView.tsx";
import { LessonView } from "./LessonView.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { VocabView } from "./VocabView.tsx";

// A request older than this was for an earlier opening of the panel.
const requestFreshMs = 15_000;
const reconnectMs = 1000;

const tabs: { view: Exclude<PanelView, "settings">; label: string }[] = [
  { view: "lesson", label: "Lesson" },
  { view: "history", label: "History" },
  { view: "vocab", label: "Vocabulary" },
];

/** The latest lookup from the background, kept connected across service-worker restarts. */
function useLiveLookup() {
  const [live, setLive] = useState<Lookup | null>(null);
  const [port, setPort] = useState<Browser.runtime.Port | null>(null);
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Browser.runtime.Port | null = null;
    const connect = () => {
      const next = browser.runtime.connect({ name: "panel" });
      next.onMessage.addListener((message: LookupServerMessage) => setLive(message.lookup));
      // Fires when the worker restarts; our own disconnect() below does not trigger it.
      next.onDisconnect.addListener(() => {
        current = null;
        setPort(null);
        if (!closed) timer = setTimeout(connect, reconnectMs);
      });
      current = next;
      setPort(next);
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      current?.disconnect();
    };
  }, []);
  const retry = (id: string) => port?.postMessage({ type: "retry", id } satisfies PanelClientMessage);
  return { live, retry };
}

export function Panel() {
  const settings = useSettings();
  const history = useHistory();
  const { live, retry } = useLiveLookup();
  const helper = useHelperStatus();
  const [view, setView] = useState<PanelView>("lesson");
  // A history entry the user opened; cleared when a new lookup starts, so the panel follows the latest one.
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  useEffect(() => {
    const apply = (request: PanelRequest | null | undefined) => {
      if (!request || Date.now() - request.at > requestFreshMs) return;
      setView(request.view);
      if (request.lookupId) setPinnedId(request.lookupId);
    };
    getPanelRequest().then(apply);
    return watchPanelRequest(apply);
  }, []);

  useEffect(() => {
    if (live && live.status === "loading") setPinnedId(current => (current === live.id ? current : null));
  }, [live?.id, live?.status]);

  const shown = useMemo(() => {
    if (!pinnedId) return live;
    if (live?.id === pinnedId) return live;
    return history.find(entry => entry.id === pinnedId) ?? live;
  }, [pinnedId, live, history]);

  const openLookup = (id: string) => {
    setPinnedId(id);
    setView("lesson");
  };

  return (
    <div className="panel">
      <header className="panel-header">
        <nav className="panel-tabs" aria-label="Views">
          {tabs.map(tab => (
            <button
              key={tab.view}
              type="button"
              className={`panel-tab${view === tab.view ? " panel-tab-on" : ""}`}
              aria-current={view === tab.view ? "page" : undefined}
              onClick={() => setView(tab.view)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={`tl-icon-button${view === "settings" ? " panel-gear-on" : ""}`}
          title="Settings"
          aria-label="Settings"
          aria-pressed={view === "settings"}
          onClick={() => setView(view === "settings" ? "lesson" : "settings")}
        >
          <SettingsIcon size={17} />
        </button>
      </header>
      <main className="panel-body">
        {view === "lesson" ? (
          <LessonView lookup={shown} status={helper.status} hasKey={Boolean(settings?.apiKey.trim())} onRetry={retry} onOpenSettings={() => setView("settings")} />
        ) : null}
        {view === "history" ? <HistoryView history={history} onOpen={openLookup} /> : null}
        {view === "vocab" ? <VocabView /> : null}
        {view === "settings" && settings ? <SettingsView settings={settings} status={helper.status} onRefreshStatus={helper.refresh} onDone={() => setView("lesson")} /> : null}
      </main>
    </div>
  );
}
