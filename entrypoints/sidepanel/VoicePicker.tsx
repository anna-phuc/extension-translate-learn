import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { SpeakButton } from "../../components/SpeakButton.tsx";
import { englishVoices, qualityLabels, voiceQuality, type SpeechAccent, type SpeechRate, type VoiceLike } from "../../shared/speech.ts";

const sample = "The committee will deliberate on the proposal before the end of the week.";

/** Chrome's voices, kept current when the user installs one while the panel is open. */
function useTtsVoices(): VoiceLike[] | null {
  const [voices, setVoices] = useState<VoiceLike[] | null>(null);
  useEffect(() => {
    const load = () =>
      browser.tts
        .getVoices()
        .then(list => setVoices(list.flatMap(voice => (voice.voiceName && voice.lang ? [{ name: voice.voiceName, lang: voice.lang, localService: !voice.remote }] : []))));
    void load();
    browser.tts.onVoicesChanged.addListener(load);
    return () => browser.tts.onVoicesChanged.removeListener(load);
  }, []);
  return voices;
}

interface Props {
  accent: SpeechAccent;
  rate: SpeechRate;
  value: string;
  onChange(name: string): void;
}

/** The voice select, most natural first, with a sample to compare them by ear. */
export function VoicePicker({ accent, rate, value, onChange }: Props) {
  const voices = useTtsVoices();
  const list = voices ? englishVoices(voices, accent) : [];
  const best = list[0];
  const hasNatural = list.some(voice => voiceQuality(voice) === "natural");
  // A chosen voice of the other accent stays listed, so the select never shows a value it lacks.
  const chosen = value && !list.some(voice => voice.name === value) ? voices?.find(voice => voice.name === value) : undefined;
  const shown = chosen ? [chosen, ...list] : list;
  return (
    <label className="field">
      <span>Voice</span>
      <div className="field-row">
        <select value={value} onChange={event => onChange(event.target.value)} disabled={!voices}>
          <option value="">{best ? `Automatic: ${best.name}` : "Automatic"}</option>
          {shown.map(voice => (
            <option key={voice.name} value={voice.name}>
              {voice.name} ({qualityLabels[voiceQuality(voice)]})
            </option>
          ))}
        </select>
        <SpeakButton id="settings:sample" text={sample} voice={{ accent, rate, name: value }} label="a sample with this voice" />
      </div>
      {hasNatural ? (
        <small>Voices marked natural sound the most like a native speaker. Online ones need an internet connection.</small>
      ) : (
        <small>
          For the most native-sounding voice, add Apple's free natural voices: System Settings → Accessibility → Spoken Content → System voice → Manage
          Voices… → English (United States) → <strong>Ava (Premium)</strong>, <strong>Zoe (Premium)</strong> or <strong>Evan (Enhanced)</strong>. Then
          restart Chrome; Automatic picks it, or choose it here.
        </small>
      )}
    </label>
  );
}
