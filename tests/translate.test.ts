import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePartialJson } from "../shared/partial-json.ts";
import { parseInline } from "../shared/rich-text.ts";
import { defaultSettings, parseSettings, type Settings } from "../shared/settings.ts";
import {
  buildPrompt,
  candidateFromSelection,
  maxSelectionLength,
  parsePartialReply,
  parseReply,
  sentenceAround,
  sentenceRadius,
  wordEnd,
  wordStart,
} from "../shared/translate.ts";

const block = "The committee will deliberate on the proposal before the end of the week.";
const pick = (selected: string) => candidateFromSelection({ selected, block });

test("a word, a phrase and a whole sentence are accepted", () => {
  assert.equal(pick("deliberate")?.text, "deliberate");
  assert.equal(pick("end of")?.text, "end of");
  assert.equal(pick("The committee will deliberate on the proposal")?.text, "The committee will deliberate on the proposal");
});

test("surrounding whitespace and punctuation are trimmed, and line breaks collapse", () => {
  assert.equal(pick("  proposal.\n")?.text, "proposal");
  assert.equal(pick('"committee,"')?.text, "committee");
  assert.equal(pick("the proposal\n\n  before the end")?.text, "the proposal before the end");
});

test("selections with no letters are rejected", () => {
  for (const selected of ["", "   ", "12345", "=== ---", "3.14 / 2"]) assert.equal(pick(selected), null, selected);
});

test("a selection over the ceiling is rejected", () => {
  assert.ok(pick("a".repeat(maxSelectionLength)));
  assert.equal(pick("a".repeat(maxSelectionLength + 1)), null);
});

test("apostrophes, hyphens and accented letters are kept", () => {
  assert.equal(pick("don't")?.text, "don't");
  assert.equal(pick("well-known")?.text, "well-known");
  assert.equal(pick("café")?.text, "café");
});

test("the sentence is the text around the selection, bounded to the radius on each side", () => {
  assert.equal(pick("deliberate")?.sentence, block);
  const long = `${"x ".repeat(sentenceRadius)}target${" y".repeat(sentenceRadius)}`;
  const sentence = candidateFromSelection({ selected: "target", block: long })!.sentence;
  assert.ok(sentence.includes("target"));
  assert.ok(sentence.length <= 2 * sentenceRadius + "target".length, `${sentence.length}`);
  assert.ok(sentence.length > sentenceRadius);
});

test("a selection longer than the radius is its own context, and a missing one falls back to itself", () => {
  const passage = "word ".repeat(sentenceRadius);
  assert.equal(candidateFromSelection({ selected: passage, block: `before ${passage} after` })?.sentence, passage.trim().replace(/\s+/g, " "));
  assert.equal(sentenceAround("unrelated text", "missing"), "missing");
});

const candidate = { text: "deliberate", sentence: block };
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...patch });

test("the default prompt names the word, its sentence, the language, the level and every reply field", () => {
  const prompt = buildPrompt(candidate);
  for (const part of ['"deliberate"', block, "translation", "pronunciation", "breakdown", "grammar", "patterns", "examples", "Vietnamese", "B1", "English teacher"])
    assert.ok(prompt.includes(part), part);
  assert.ok(!prompt.includes("{{"), "every placeholder is filled");
  assert.ok(!prompt.includes("Additional instructions"));
});

test("the target language and level come from the settings", () => {
  const prompt = buildPrompt(candidate, settings({ targetLanguage: "Japanese", level: "C1" }));
  assert.ok(prompt.includes("Japanese"));
  assert.ok(prompt.includes("C1 (advanced)"));
  assert.ok(!prompt.includes("Vietnamese"));
});

test("a custom template replaces the default task and fills its placeholders; a blank one falls back", () => {
  const promptTemplate = "Explain {{text}} in {{language}}, from: {{sentence}}. Again: {{text}}";
  const prompt = buildPrompt(candidate, settings({ promptTemplate }));
  assert.ok(prompt.startsWith(`Explain deliberate in Vietnamese, from: ${block}. Again: deliberate`));
  assert.ok(prompt.includes("breakdown"), "the reply format stays");
  assert.equal(buildPrompt(candidate, settings({ promptTemplate: "   \n" })), buildPrompt(candidate));
});

test("placeholder values containing dollar signs or braces are inserted literally", () => {
  const prompt = buildPrompt({ text: "a", sentence: "cost $& {{text}} $1" }, settings({ promptTemplate: "{{sentence}}" }));
  assert.ok(prompt.startsWith("cost $& {{text}} $1"));
});

test("extra instructions are appended, with a custom template or the default", () => {
  for (const promptTemplate of ["", "Look up {{text}}"]) {
    const prompt = buildPrompt(candidate, settings({ promptTemplate, extraInstructions: "  prefer medical senses " }));
    assert.ok(prompt.endsWith("Additional instructions:\nprefer medical senses"));
  }
});

test("stored settings with missing or broken fields fall back to the defaults", () => {
  assert.deepEqual(parseSettings(undefined), defaultSettings);
  const parsed = parseSettings({ model: "gpt-x", level: "Z9", targetLanguage: "  ", showCheckButton: "yes", apiKey: 42 });
  assert.equal(parsed.model, "claude-haiku-5-5");
  assert.equal(parsed.level, "B1");
  assert.equal(parsed.targetLanguage, "Vietnamese");
  assert.equal(parsed.showCheckButton, true);
  assert.equal(parsed.apiKey, "", "a broken key falls back to none");
});

const reply = {
  translation: "Họ cân nhắc kỹ.",
  pronunciation: "/dɪˈlɪb.ər.ət/",
  breakdown: [{ term: "deliberate", partOfSpeech: "verb", meaning: "cân nhắc", note: "thường đi với **on**" }],
  grammar: [{ point: "Simple future", explanation: "`will` + động từ nguyên mẫu." }],
  patterns: [{ pattern: "deliberate on + noun", meaning: "cân nhắc về", example: "They deliberate on the plan." }],
  examples: ["The jury will deliberate for hours."],
};

test("a full reply parses, with or without a code fence or prose", () => {
  const json = JSON.stringify(reply);
  for (const text of [json, `\`\`\`json\n${json}\n\`\`\``, `Here you go: ${json} Done.`]) assert.deepEqual(parseReply(text), { ok: true, value: reply });
});

test("a reply that omits the empty fields still parses, with those fields empty", () => {
  assert.deepEqual(parseReply('{"translation":"Xin chào"}'), {
    ok: true,
    value: { translation: "Xin chào", pronunciation: "", breakdown: [], grammar: [], patterns: [], examples: [] },
  });
});

test("malformed replies report an error", () => {
  for (const text of [null, undefined, "", "no json here", '{"translation": ', '{"pronunciation":"x"}', JSON.stringify({ ...reply, translation: "" }),
    JSON.stringify({ ...reply, breakdown: [{ term: "", meaning: "x" }] })])
    assert.equal(parseReply(text).ok, false, String(text));
});

test("inline bold and code become spans, the rest stays plain", () => {
  assert.deepEqual(parseInline("dùng **will** hoặc `be going to` ở đây"), [
    { text: "dùng " }, { text: "will", bold: true }, { text: " hoặc " }, { text: "be going to", code: true }, { text: " ở đây" },
  ]);
  assert.deepEqual(parseInline("2 ** 3 and `open"), [{ text: "2 ** 3 and `open" }]);
  assert.deepEqual(parseInline(""), []);
});

const fullReply = JSON.stringify({
  translation: 'Bản sửa tài liệu "đã" commit',
  pronunciation: "",
  breakdown: [{ term: "doc fix", partOfSpeech: "noun phrase", meaning: "bản sửa tài liệu", note: "" }],
  grammar: [{ point: "Passive", explanation: "Bị động" }],
  patterns: [],
  examples: ["One", "Two"],
});

test("every prefix of a reply parses to an object or to nothing, never throws", () => {
  for (let end = 0; end <= fullReply.length; end++) {
    const value = parsePartialJson(fullReply.slice(0, end));
    assert.ok(value === undefined || (typeof value === "object" && value !== null), `prefix ${end}`);
  }
  assert.deepEqual(parsePartialJson(fullReply), JSON.parse(fullReply));
});

test("a string cut mid-way keeps the characters that arrived, and a key without a value is dropped", () => {
  assert.deepEqual(parsePartialJson('{"translation":"Bản sử'), { translation: "Bản sử" });
  assert.deepEqual(parsePartialJson('{"translation":"x","pronunciation"'), { translation: "x" });
  assert.deepEqual(parsePartialJson('{"translation":"a\\u00'), { translation: "a" });
  assert.equal(parsePartialJson("no object yet"), undefined);
});

test("a streaming reply shows nothing until the translation starts, then grows; the finished one equals the validated one", () => {
  assert.equal(parsePartialReply('{"translation":"'), null);
  assert.equal(parsePartialReply('{"translation":"B')?.translation, "B");
  const midway = parsePartialReply(fullReply.slice(0, fullReply.indexOf('"note"')))!;
  assert.equal(midway.breakdown.length, 1);
  assert.deepEqual(midway.grammar, []);
  assert.deepEqual(parsePartialReply('{"translation":"x","breakdown":[{"term":"')?.breakdown, []);
  const final = parseReply(fullReply);
  if (!final.ok) assert.fail(final.error);
  assert.deepEqual(parsePartialReply(fullReply), final.value);
});

test("a boundary inside a word moves to the edge of that word; joiners and long words are handled", () => {
  const text = "The committee will deliberate";
  assert.equal(wordStart(text, 7), 4);
  assert.equal(wordEnd(text, 7), 13);
  assert.equal(wordStart(text, 4), 4);
  assert.equal(wordEnd("they don't go", 7), 10);
  assert.equal(wordStart("a well-known fact", 8), 2);
  assert.equal(wordEnd("'quoted' word", 3), 7);
  assert.equal(wordEnd("Việt Nam", 2), 4);
  const hash = "a".repeat(60);
  assert.equal(wordStart(hash, 30), 30);
});

import { englishVoices, pickVoice, rateOf, speakableText, voiceQuality, type VoiceLike } from "../shared/speech.ts";

const voice = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService });

test("the most natural voice wins: Apple's neural ones, then Google's online ones, then the standard ones", () => {
  const mac = [voice("Albert", "en-US"), voice("Eddy (English (US))", "en-US"), voice("Samantha", "en-US"), voice("Daniel", "en-GB"), voice("Linh", "vi-VN")];
  const google = voice("Google US English", "en-US", false);
  assert.equal(pickVoice(mac, "en-US")?.name, "Samantha");
  assert.equal(pickVoice([...mac, google], "en-US")?.name, "Google US English");
  assert.equal(pickVoice([...mac, google, voice("Ava (Premium)", "en-US")], "en-US")?.name, "Ava (Premium)");
  assert.equal(pickVoice(mac, "en-GB")?.name, "Daniel");
  assert.equal(pickVoice([voice("Bubbles", "en-US"), voice("Samantha", "en_US")], "en-US")?.name, "Samantha");
});

test("a voice the user chose is used while it is installed", () => {
  const voices = [voice("Samantha", "en-US"), voice("Ava (Premium)", "en-US"), voice("Daniel", "en-GB")];
  assert.equal(pickVoice(voices, "en-US", "Daniel")?.name, "Daniel");
  assert.equal(pickVoice(voices, "en-US", "Zoe (Premium)")?.name, "Ava (Premium)", "a chosen voice that was removed falls back to automatic");
});

test("the voice list leaves out novelty voices and puts the natural ones first", () => {
  const list = englishVoices([voice("Zarvox", "en-US"), voice("Bad News", "en-US"), voice("Flo (English (US))", "en-US"), voice("Samantha", "en-US"), voice("Google US English", "en-US", false), voice("Evan (Enhanced)", "en-US")], "en-US");
  assert.deepEqual(list.map(v => v.name), ["Evan (Enhanced)", "Google US English", "Samantha", "Flo (English (US))"]);
  assert.deepEqual(list.map(voiceQuality), ["natural", "natural-online", "standard", "basic"]);
});

test("without the accent's voice any English one is used, and without English the browser chooses", () => {
  assert.equal(pickVoice([voice("Karen", "en-AU"), voice("Linh", "vi-VN")], "en-GB")?.name, "Karen");
  assert.equal(pickVoice([voice("Linh", "vi-VN")], "en-US"), null);
  assert.equal(pickVoice([], "en-US"), null);
});

test("inline marks are not read aloud, and speeds map to rates", () => {
  assert.equal(speakableText("They **deliberate** on `the plan`.\n Again"), "They deliberate on the plan. Again");
  assert.equal(rateOf("normal"), 1);
  assert.ok(rateOf("slower") < rateOf("slow") && rateOf("slow") < 1);
});

test("pronunciation settings default to American English at normal speed", () => {
  assert.equal(defaultSettings.speechAccent, "en-US");
  assert.equal(defaultSettings.speechRate, "normal");
  assert.equal(parseSettings({ speechAccent: "fr-FR", speechRate: "fast" }).speechAccent, "en-US");
});

import { expectedSpeechMs } from "../shared/speech.ts";

test("the longest a phrase can take grows with its length and with a slower speed", () => {
  assert.ok(expectedSpeechMs("weigh in on", "normal") >= 3000 && expectedSpeechMs("weigh in on", "normal") < 6000);
  assert.ok(expectedSpeechMs("word ".repeat(40), "normal") > expectedSpeechMs("weigh in on", "normal"));
  assert.ok(expectedSpeechMs("weigh in on", "slower") > expectedSpeechMs("weigh in on", "normal"));
});
