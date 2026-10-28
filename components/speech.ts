// The speaker buttons' side of pronunciation: the background worker speaks (lib/tts.ts); this keeps track of which
// button is speaking, one at a time across the whole UI, and of the last error to show on its button.
import { useEffect, useSyncExternalStore } from "react";
import { browser } from "wxt/browser";
import type { SpeechAccent, SpeechRate } from "../shared/speech.ts";
import type { RuntimeMessage, SpeakResponse } from "../shared/types.ts";

let speakingKey: string | null = null;
let failure: { key: string; message: string } | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

const send = (message: RuntimeMessage) => browser.runtime.sendMessage(message) as Promise<SpeakResponse | undefined>;

// Long enough to read the reason on the button, short enough not to linger.
const failureShownMs = 4000;
const replyTimeoutMs = 30_000;
const noReply: SpeakResponse = { ok: false, error: "The extension didn't answer. Reload it in chrome://extensions, then this page." };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Reads `text` aloud, or stops it when `key` is the one already speaking. */
export async function toggleSpeech(key: string, text: string, accent: SpeechAccent, rate: SpeechRate, voice = "") {
  if (speakingKey === key) {
    speakingKey = null;
    changed();
    await send({ type: "stop-speech" }).catch(() => {});
    return;
  }
  speakingKey = key;
  failure = null;
  changed();
  let response: SpeakResponse | undefined;
  try {
    // The worker always answers well before this; it guards the button against a worker that died mid-request.
    response = await Promise.race([send({ type: "speak", text, accent, rate, voice }), sleep(replyTimeoutMs).then(() => noReply)]);
  } catch {
    response = { ok: false, error: "The extension was updated. Reload this page to keep using it." };
  }
  if (response && !response.ok) {
    failure = { key, message: response.error };
    setTimeout(() => {
      if (failure?.key === key) {
        failure = null;
        changed();
      }
    }, failureShownMs);
  }
  // Another button may have started meanwhile; it owns the state now.
  if (speakingKey === key) speakingKey = null;
  changed();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether `key` is speaking now, and why its last try failed; re-renders when either changes. */
export function useSpeech(key: string): { speaking: boolean; error: string | null } {
  const speaking = useSyncExternalStore(subscribe, () => speakingKey === key);
  const error = useSyncExternalStore(subscribe, () => (failure?.key === key ? failure.message : null));
  return { speaking, error };
}

/** Stops speech when the view that started it goes away or shows something else (`scope` changes). */
export function useStopSpeechWith(scope: string) {
  useEffect(
    () => () => {
      if (speakingKey?.startsWith(`${scope}:`)) {
        speakingKey = null;
        changed();
        send({ type: "stop-speech" }).catch(() => {});
      }
    },
    [scope],
  );
}
