// "Check my English": which texts are checked, the prompt, and the reply schema. Ported from paseo-translate's
// shared/feedback.ts and shared/feedback-rules.ts, for text the user writes in any text box instead of a chat.
import { z } from "zod";
import { defaultSettings, type Settings } from "./settings.ts";
import { levelLabel } from "./translate.ts";

const required = z.string().min(1);
export const issueTags = ["mistake", "unnatural", "tip"] as const;

export const issueSchema = z.object({
  original: required,
  replacement: z.string(),
  tag: z.enum(issueTags),
  explanation: required,
});
export type FeedbackIssue = z.infer<typeof issueSchema>;

export const feedbackReplySchema = z.object({
  ok: z.boolean(),
  corrected: z.string(),
  issues: z.array(issueSchema).default([]),
});
export type FeedbackReply = z.infer<typeof feedbackReplySchema>;

export const feedbackSystemPrompt =
  "You are an English teacher. Reply with one JSON object and nothing else: no code fence, no text before or after it. Never use tools.";

/**
 * Texts longer than this are checked only up to here, cut at a sentence end. About 600 words: room for a long email,
 * while a pasted document does not turn one check into a long and costly request.
 */
export const maxCheckedLength = 4000;
const minWords = 2;
// Share of the text that may be code, logs and links before it is no longer prose to check.
const maxCodeShare = 0.5;
// Share of letters outside A to Z above which the text is taken as not English (Vietnamese, Japanese, ...).
const maxForeignLetterShare = 0.1;

export type SkipReason = "no text" | "short" | "code" | "not-english";

export const skipMessages: Record<SkipReason, string> = {
  "no text": "There is no text to check yet.",
  short: "Write at least two words to check.",
  code: "This looks mostly like code, logs or links, so there is nothing to check.",
  "not-english": "This doesn't look like English, so there is nothing to check.",
};

const codePatterns = [
  /```[\s\S]*?(?:```|$)/g, // fenced block, also one left open
  /`[^`\n]*`/g, // inline code
  /\bhttps?:\/\/\S+/g, // link
  /^.*(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^\s+at\s+\S|\b[A-Z][A-Za-z]*(?:Error|Exception)\b).*$/gm, // log or stack line
  /\S*[/\\{}[\]<>=|$#;]\S*/g, // path, expression or other symbol-heavy token
];

/** The text with code, logs, links and paths taken out. */
function prose(text: string): string {
  return codePatterns.reduce((rest, pattern) => rest.replace(pattern, " "), text);
}

const words = (text: string) => text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

/** Why a text gets no feedback, or null when it should be checked. */
export function skipReason(text: string): SkipReason | null {
  const trimmed = text.trim();
  if (!trimmed) return "no text";
  const rest = prose(trimmed);
  const restLength = rest.replace(/\s+/g, "").length;
  if (restLength < (1 - maxCodeShare) * trimmed.replace(/\s+/g, "").length) return "code";
  // Before the word count: Japanese and Chinese have no spaces, so a whole sentence counts as one word.
  const letters = rest.match(/\p{L}/gu) ?? [];
  const foreign = letters.filter(letter => !/[A-Za-z]/.test(letter)).length;
  if (foreign > maxForeignLetterShare * letters.length) return "not-english";
  if (words(rest).length < minWords) return "short";
  return null;
}

/** The part of the text that is checked: all of it, or the start cut at a sentence end (else a space) before the limit. */
export function excerpt(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxCheckedLength) return { text: trimmed, truncated: false };
  const head = trimmed.slice(0, maxCheckedLength);
  const sentenceEnd = Math.max(...[". ", "! ", "? ", ".\n", "!\n", "?\n"].map(end => head.lastIndexOf(end)));
  const cut = sentenceEnd > maxCheckedLength / 2 ? sentenceEnd + 1 : head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : maxCheckedLength;
  return { text: head.slice(0, cut).trimEnd(), truncated: true };
}

export function buildFeedbackPrompt(text: string, settings: Settings = defaultSettings): string {
  return [
    `A learner of English whose native language is ${settings.targetLanguage}, around ${levelLabel(settings.level)} level, wrote this text in a box on a web page (an email, a chat message, a comment, a post or a form). Check its English.`,
    "",
    "Text:",
    "<<<",
    text,
    ">>>",
    "",
    "Rules:",
    "- Fix grammar, wrong words, and wording a native speaker would find unnatural. Keep the learner's meaning, tone and register (casual stays casual, formal stays formal); leave sentences that are already fine as they are.",
    "- Leave code, commands, file paths, URLs, names, identifiers, quoted logs and error messages exactly as written.",
    '- In casual chat, a missing full stop at the very end is fine. A lowercase "i", a sentence start without a capital, and a question without a question mark are tips.',
    "- If the text is not mainly English, or has nothing to fix, reply with ok true, corrected equal to the text, and no issues.",
    "",
    "Reply with only one JSON object, starting with {, with these fields:",
    "- ok: true when the text needs no change.",
    "- corrected: the whole text with every fix applied and nothing else changed, keeping its line breaks.",
    '- issues: one entry per fix, in order of appearance: { original, replacement, tag, explanation }. original is the text exactly as written and replacement its fixed form. tag is "mistake" for grammar or wording that is wrong, "unnatural" for text that is correct but a native speaker would say differently, and "tip" for capitals, punctuation and other small things. explanation is one short sentence in plain English that the learner can follow.',
  ].join("\n");
}

export type ParsedFeedback = { ok: true; value: FeedbackReply } | { ok: false; error: string };

/** Validates the final reply; tolerates a code fence or prose around the JSON object. */
export function parseFeedbackReply(final: string | null | undefined): ParsedFeedback {
  if (!final) return { ok: false, error: "Empty reply" };
  const start = final.indexOf("{");
  const end = final.lastIndexOf("}");
  if (start < 0 || end < start) return { ok: false, error: "Reply has no JSON object" };
  let json: unknown;
  try {
    json = JSON.parse(final.slice(start, end + 1));
  } catch {
    return { ok: false, error: "Reply is not valid JSON" };
  }
  const parsed = feedbackReplySchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

// More fixes than this do not help a learner.
export const maxShownIssues = 15;

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export type FeedbackResult =
  | { state: "fine" }
  | { state: "corrected"; original: string; corrected: string; truncated: boolean; issues: FeedbackIssue[] };

/** The result for a parsed reply: fine when there is nothing to show, else both texts and the reasons. */
export function resultFromReply(original: string, truncated: boolean, reply: FeedbackReply): FeedbackResult {
  if (reply.issues.length === 0 && (reply.ok || sameText(original, reply.corrected))) return { state: "fine" };
  return { state: "corrected", original, corrected: reply.corrected, truncated, issues: reply.issues.slice(0, maxShownIssues) };
}
