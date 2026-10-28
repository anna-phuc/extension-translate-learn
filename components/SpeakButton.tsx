import type { SpeechAccent, SpeechRate } from "../shared/speech.ts";
import { StopIcon, VolumeIcon } from "./icons.tsx";
import { toggleSpeech, useSpeech } from "./speech.ts";

export interface Voice {
  accent: SpeechAccent;
  rate: SpeechRate;
  /** A chrome.tts voice name; empty for the most natural one for the accent. */
  name?: string;
}

interface Props {
  /** Tells this button apart from the others, so only the one speaking shows Stop. */
  id: string;
  text: string;
  voice: Voice;
  label?: string;
  size?: number;
  disabled?: boolean;
}

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

/** Reads `text` aloud in English; a second click stops it. A failure shows on the button for a moment. */
export function SpeakButton({ id, text, voice, label = text, size = 15, disabled = false }: Props) {
  const { speaking, error } = useSpeech(id);
  const title = error ? `Couldn't play: ${error}` : speaking ? "Stop" : `Listen: ${short(label)}`;
  return (
    <button
      type="button"
      className={`tl-icon-button tl-speak${speaking ? " tl-speak-on" : ""}${error ? " tl-speak-failed" : ""}`}
      title={title}
      aria-label={error ? title : speaking ? "Stop" : `Listen to "${short(label)}"`}
      aria-pressed={speaking}
      disabled={disabled || !text.trim()}
      onClick={() => void toggleSpeech(id, text, voice.accent, voice.rate, voice.name)}
    >
      {speaking ? <StopIcon size={size - 2} /> : <VolumeIcon size={size} />}
    </button>
  );
}
