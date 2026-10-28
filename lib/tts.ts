// Speaking, in the background worker, through the extension text-to-speech API. Unlike the page's speechSynthesis, it
// plays from the browser itself, so a page, its CSP or a closed popup can't silence it, and it reports errors.
import { browser } from "wxt/browser";
import { expectedSpeechMs, pickVoice, rateOf, speakableText, type SpeechAccent, type SpeechRate } from "../shared/speech.ts";
import type { SpeakResponse } from "../shared/types.ts";

/** Ends the request that is speaking now, when another starts or Stop is pressed. */
let finishCurrent: ((response: SpeakResponse) => void) | null = null;

// Chrome fills its voice list a moment after the worker starts; the first lookup waits this long for it.
const voicesWaitMs = 1500;

async function loadVoices() {
  const voices = await browser.tts.getVoices();
  if (voices.length > 0) return voices;
  await new Promise<void>(resolve => {
    const done = () => {
      browser.tts.onVoicesChanged.removeListener(done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, voicesWaitMs);
    browser.tts.onVoicesChanged.addListener(done);
  });
  return browser.tts.getVoices();
}

/** Asks Chrome for its voices early, so the first speaker click finds them ready. */
export const warmUpVoices = () => void loadVoices().catch(() => {});

async function voiceFor(accent: SpeechAccent, chosen: string): Promise<string | undefined> {
  const voices = await loadVoices();
  const usable = voices.flatMap(voice => (voice.voiceName && voice.lang ? [{ name: voice.voiceName, lang: voice.lang, localService: !voice.remote }] : []));
  return pickVoice(usable, accent, chosen)?.name;
}

// A voice that has not started by now is not going to; the next try lets Chrome pick its default voice.
const startTimeoutMs = 3000;

const noVoice =
  "No voice started speaking. Restart Chrome; if it stays silent, check that `say hello` speaks in Terminal and that a voice is set in System Settings → Accessibility → Spoken Content.";

/**
 * Reads `text` aloud and resolves when it ends, is interrupted or fails, and never later than it could take: a voice
 * that does not start within 3 s is retried once with Chrome's default voice, and a voice that never reports its end
 * is taken as done after the longest the text could take.
 */
export async function speak(text: string, accent: SpeechAccent, rate: SpeechRate, voice = ""): Promise<SpeakResponse> {
  stopSpeaking();
  const chosen = await voiceFor(accent, voice);
  const utterance = speakableText(text);
  return new Promise<SpeakResponse>(resolve => {
    let settled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (response: SpeakResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (finishCurrent === finish) finishCurrent = null;
      resolve(response);
    };
    finishCurrent = finish;

    const play = (voiceName: string | undefined) => {
      // Events of an earlier try (its "interrupted" after the retry stops it) are not this try's.
      const mine = ++attempt;
      let started = false;
      const fallBack = (reason: string) => {
        if (voiceName) play(undefined);
        else finish({ ok: false, error: reason });
      };
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (mine !== attempt || started) return;
        browser.tts.stop();
        fallBack(noVoice);
      }, startTimeoutMs);
      browser.tts
        .speak(utterance, {
          lang: accent,
          rate: rateOf(rate),
          voiceName,
          enqueue: false,
          onEvent: event => {
            if (mine !== attempt || settled) return;
            const voice = voiceName ?? "default voice";
            if (event.type === "start") {
              started = true;
              clearTimeout(timer);
              timer = setTimeout(() => finish({ ok: true, voice }), expectedSpeechMs(utterance, rate));
            } else if (event.type === "end") finish({ ok: true, voice });
            else if (event.type === "interrupted" || event.type === "cancelled") finish({ ok: true, voice, stopped: true });
            else if (event.type === "error") {
              const reason = event.errorMessage || "The voice couldn't play this text.";
              if (started) finish({ ok: false, error: reason });
              else fallBack(reason);
            }
          },
        })
        .catch((error: unknown) => {
          if (mine === attempt) fallBack(error instanceof Error ? error.message : String(error));
        });
    };
    play(chosen);
  });
}

export function stopSpeaking() {
  finishCurrent?.({ ok: true, voice: "", stopped: true });
  finishCurrent = null;
  browser.tts.stop();
}
