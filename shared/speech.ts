// Pronunciation through the browser's own text-to-speech: which voice to use and what text to give it. Pure, so it is
// tested in Node; components/speech.ts does the speaking.

export const speechAccents = [
  { id: "en-US", label: "American English" },
  { id: "en-GB", label: "British English" },
] as const;
export type SpeechAccent = (typeof speechAccents)[number]["id"];

export const speechRates = [
  { id: "normal", label: "Normal", rate: 1 },
  { id: "slow", label: "Slow", rate: 0.75 },
  { id: "slower", label: "Very slow", rate: 0.55 },
] as const;
export type SpeechRate = (typeof speechRates)[number]["id"];

export const rateOf = (id: SpeechRate) => speechRates.find(rate => rate.id === id)?.rate ?? 1;

// About 14 characters a second at normal speed; twice that plus a margin is the longest a voice could need.
const charactersPerSecond = 14;

/** The longest `text` can take to read at `rate`, after which speaking is taken as done even without an end event. */
export const expectedSpeechMs = (text: string, rate: SpeechRate) => Math.round(((2 * text.length) / charactersPerSecond / rateOf(rate)) * 1000 + 3000);

/** The text to read aloud: inline `**bold**` and `` `code` `` marks are not spoken, and runs of white space become one. */
export const speakableText = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** The parts of a voice this module reads (from chrome.tts: remote voices have localService false). */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
}

// macOS's sound-effect and character voices: never a model for pronunciation, so never offered.
const novelty =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|wobble|good news|jester|organ|superstar|trinoids|whisper|zarvox|fred|junior|ralph|kathy)\b/i;
// Apple's downloadable neural voices ("Ava (Premium)", "Evan (Enhanced)") and Siri's.
const neural = /premium|enhanced|natural|neural|siri/i;
// The better of the voices macOS installs by default.
const decentLocal = /^(samantha|alex|daniel|karen|moira|tessa|rishi|serena|oliver|kate|victoria|allison|susan|tom)\b/i;

export type VoiceQuality = "natural" | "natural-online" | "standard" | "basic";

/**
 * How natural a voice sounds: Apple's neural voices first, then Chrome's online Google voices (natural, but they need
 * the network), then the standard voices macOS ships, then the robotic ones (Eddy, Flo, Grandma, ...).
 */
export function voiceQuality(voice: VoiceLike): VoiceQuality {
  if (voice.localService && neural.test(voice.name)) return "natural";
  if (!voice.localService) return "natural-online";
  if (decentLocal.test(voice.name)) return "standard";
  return "basic";
}

export const qualityLabels: Record<VoiceQuality, string> = {
  natural: "natural, on this computer",
  "natural-online": "natural, online",
  standard: "standard",
  basic: "basic",
};

const qualityOrder: VoiceQuality[] = ["natural", "natural-online", "standard", "basic"];
const norm = (lang: string) => lang.replace("_", "-").toLowerCase();

/**
 * The voices worth offering for `accent`, most natural first: its own region's (en-US) when there are any, else any
 * English one. Novelty voices are left out.
 */
export function englishVoices<V extends VoiceLike>(voices: readonly V[], accent: SpeechAccent): V[] {
  const usable = voices.filter(voice => norm(voice.lang).startsWith("en") && !novelty.test(voice.name));
  const exact = usable.filter(voice => norm(voice.lang) === accent.toLowerCase());
  const pool = exact.length > 0 ? exact : usable;
  const rank = (voice: V) => qualityOrder.indexOf(voiceQuality(voice));
  return [...pool].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * The voice to speak with: the one the user chose when it is still installed, else the most natural for `accent`.
 * Null when there is no English voice, in which case the browser picks one itself.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], accent: SpeechAccent, chosen = ""): V | null {
  const own = chosen ? voices.find(voice => voice.name === chosen) : undefined;
  return own ?? englishVoices(voices, accent)[0] ?? null;
}
