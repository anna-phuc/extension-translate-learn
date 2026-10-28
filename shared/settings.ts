import { z } from "zod";
import { speechAccents, speechRates, type SpeechAccent, type SpeechRate } from "./speech.ts";

export const models = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fast, light on your usage)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (better lessons, slower)" },
] as const;
export type ModelId = (typeof models)[number]["id"];

export const levels = [
  { id: "A2", label: "A2 (elementary)" },
  { id: "B1", label: "B1 (intermediate)" },
  { id: "B2", label: "B2 (upper intermediate)" },
  { id: "C1", label: "C1 (advanced)" },
] as const;
export type Level = (typeof levels)[number]["id"];

export const maxPromptTemplateLength = 4000;
export const maxExtraInstructionsLength = 2000;

export const settingsSchema = z.object({
  // Used only when Claude Code is not set up or signed in. Stored in chrome.storage.local only, never synced.
  apiKey: z.string().max(500).catch(""),
  model: z.enum(models.map(model => model.id) as [ModelId, ...ModelId[]]).catch("claude-haiku-5-5"),
  targetLanguage: z.string().trim().max(60).catch("Vietnamese").transform(value => value || "Vietnamese"),
  level: z.enum(levels.map(level => level.id) as [Level, ...Level[]]).catch("B1"),
  // Empty means the built-in template.
  promptTemplate: z.string().max(maxPromptTemplateLength).catch(""),
  extraInstructions: z.string().max(maxExtraInstructionsLength).catch(""),
  showTranslateButton: z.boolean().catch(true),
  showCheckButton: z.boolean().catch(true),
  speechAccent: z.enum(speechAccents.map(accent => accent.id) as [SpeechAccent, ...SpeechAccent[]]).catch("en-US"),
  speechRate: z.enum(speechRates.map(rate => rate.id) as [SpeechRate, ...SpeechRate[]]).catch("normal"),
  // A voice name from chrome.tts; empty means the most natural one for the accent.
  speechVoice: z.string().max(200).catch(""),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Parses whatever is stored; a missing or broken field falls back to its default, so no migration is needed. */
export const parseSettings = (stored: unknown): Settings => settingsSchema.parse(stored && typeof stored === "object" ? stored : {});

export const defaultSettings: Settings = parseSettings({});
