import type { FeedbackResult } from "./feedback.ts";
import type { SpeechAccent, SpeechRate } from "./speech.ts";
import type { Candidate, Translation } from "./translate.ts";

/** setup: the Claude helper is not installed; auth: Claude Code is not signed in to the Claude account. */
export type ErrorKind = "setup" | "auth" | "rate-limit" | "other";

export interface Lookup {
  id: string;
  text: string;
  sentence: string;
  url: string;
  title: string;
  createdAt: number;
  status: "loading" | "done" | "error";
  /** The partial reply while loading, the validated reply when done. */
  result: Translation | null;
  error?: string;
  errorKind?: ErrorKind;
}

export interface VocabItem {
  id: string;
  term: string;
  meaning: string;
  partOfSpeech: string;
  note: string;
  pronunciation: string;
  /** The text around the term where it was found. */
  context: string;
  url: string;
  addedAt: number;
}

export interface PageInfo {
  url: string;
  title: string;
}

export type PanelView = "lesson" | "history" | "vocab" | "settings";

/** Written to chrome.storage.session by the background; the side panel switches to it. */
export interface PanelRequest {
  view: PanelView;
  lookupId?: string;
  at: number;
}

// Port "lookup": the page's popup asks for a lookup and receives its progress.
export type LookupClientMessage = { type: "start"; candidate: Candidate; page: PageInfo } | { type: "retry" };
// Port "panel": the side panel receives the latest lookup as it changes.
export type PanelClientMessage = { type: "retry"; id: string };
export type LookupServerMessage = { type: "update"; lookup: Lookup | null };

export type CheckResponse =
  | { ok: true; result: FeedbackResult }
  | { ok: false; error: string; errorKind: ErrorKind };

/** How a "speak" request ended: played to the end, stopped by the user or a newer request, or failed. */
export type SpeakResponse = { ok: true; voice: string; stopped?: boolean } | { ok: false; error: string };

// One-off runtime messages.
export type RuntimeMessage =
  | { type: "open-panel"; view: PanelView; lookupId?: string }
  | { type: "check"; text: string }
  | { type: "speak"; text: string; accent: SpeechAccent; rate: SpeechRate; voice?: string }
  | { type: "stop-speech" };
