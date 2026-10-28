// browser.storage access shared by the background, the side panel and the content script. Settings, history and
// vocabulary live in `local` (this device only, so the API key never syncs); the panel's routing lives in `session`.
import { browser, type Browser } from "wxt/browser";
import { parseSettings, type Settings } from "../shared/settings.ts";
import type { Lookup, PanelRequest, VocabItem } from "../shared/types.ts";
import { addVocab } from "../shared/vocab.ts";

const keys = { settings: "settings", history: "history", vocab: "vocab", panelRequest: "panelRequest", latestLookupId: "latestLookupId" } as const;

export const maxHistory = 300;

async function read<T>(area: Browser.storage.StorageArea, key: string, fallback: T): Promise<T> {
  const stored = await area.get(key);
  return (stored[key] as T | undefined) ?? fallback;
}

/** Calls `listener` with the new value whenever `key` changes in `area`. Returns the unsubscribe. */
function watch<T>(areaName: "local" | "session", key: string, listener: (value: T | undefined) => void): () => void {
  const onChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if (area === areaName && key in changes) listener(changes[key].newValue as T | undefined);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

export const getSettings = async (): Promise<Settings> => parseSettings(await read(browser.storage.local, keys.settings, {}));
export const saveSettings = (settings: Settings) => browser.storage.local.set({ [keys.settings]: settings });
export const watchSettings = (listener: (settings: Settings) => void) => watch("local", keys.settings, value => listener(parseSettings(value)));

export const getHistory = () => read<Lookup[]>(browser.storage.local, keys.history, []);
export const watchHistory = (listener: (history: Lookup[]) => void) => watch<Lookup[]>("local", keys.history, value => listener(value ?? []));

/** Adds a finished lookup at the front of the history, replacing an earlier copy of it. */
export async function saveToHistory(lookup: Lookup): Promise<void> {
  const history = await getHistory();
  const next = [lookup, ...history.filter(entry => entry.id !== lookup.id)].slice(0, maxHistory);
  await browser.storage.local.set({ [keys.history]: next });
}

export async function removeFromHistory(id: string): Promise<void> {
  const history = await getHistory();
  await browser.storage.local.set({ [keys.history]: history.filter(entry => entry.id !== id) });
}

export const clearHistory = () => browser.storage.local.set({ [keys.history]: [] });

export const getVocab = () => read<VocabItem[]>(browser.storage.local, keys.vocab, []);
export const watchVocab = (listener: (vocab: VocabItem[]) => void) => watch<VocabItem[]>("local", keys.vocab, value => listener(value ?? []));

export async function saveVocab(item: VocabItem): Promise<void> {
  await browser.storage.local.set({ [keys.vocab]: addVocab(await getVocab(), item) });
}

export async function removeVocab(id: string): Promise<void> {
  const vocab = await getVocab();
  await browser.storage.local.set({ [keys.vocab]: vocab.filter(item => item.id !== id) });
}

export const getPanelRequest = () => read<PanelRequest | null>(browser.storage.session, keys.panelRequest, null);
export const setPanelRequest = (request: PanelRequest) => browser.storage.session.set({ [keys.panelRequest]: request });
export const watchPanelRequest = (listener: (request: PanelRequest | undefined) => void) => watch<PanelRequest>("session", keys.panelRequest, listener);

// The latest lookup's id survives a service-worker restart, so the panel can still find it in the history.
export const getLatestLookupId = () => read<string | null>(browser.storage.session, keys.latestLookupId, null);
export const setLatestLookupId = (id: string) => browser.storage.session.set({ [keys.latestLookupId]: id });
