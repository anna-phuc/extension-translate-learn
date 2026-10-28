import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFeedbackPrompt,
  excerpt,
  maxCheckedLength,
  parseFeedbackReply,
  resultFromReply,
  skipReason,
} from "../shared/feedback.ts";
import { defaultSettings } from "../shared/settings.ts";
import type { VocabItem } from "../shared/types.ts";
import { addVocab, vocabFromLookup, vocabKey, vocabToCsv } from "../shared/vocab.ts";
import { wordDiff, type DiffSegment } from "../shared/word-diff.ts";

// [-deleted-] and {+inserted+}, so an expected diff reads as one line.
const show = (segments: DiffSegment[]) => segments.map(({ kind, text }) => (kind === "del" ? `[-${text}-]` : kind === "ins" ? `{+${text}+}` : text)).join("");

test("the word diff marks each changed word, joins changes one space apart, and keeps outer spaces unmarked", () => {
  assert.equal(
    show(wordDiff(
      "i want to know why the build are failing since yesterday, can you checking it",
      "I want to know why the build has been failing since yesterday. Can you check it?",
    )),
    "[-i-]{+I+} want to know why the build [-are-]{+has been+} failing since yesterday[-, can-]{+. Can+} you [-checking-]{+check+} it{+?+}",
  );
});

test("joining the unchanged and inserted segments gives the corrected text, the unchanged and deleted ones the original", () => {
  const original = "it don't work when i run the tests , and the log say nothing";
  const corrected = "It doesn't work when I run the tests, and the log says nothing.";
  const segments = wordDiff(original, corrected);
  assert.equal(segments.filter(s => s.kind !== "del").map(s => s.text).join(""), corrected);
  assert.equal(segments.filter(s => s.kind !== "ins").map(s => s.text).join(""), original);
  assert.equal(show(wordDiff("first line\nsecond lines", "first line\nsecond line")), "first line\nsecond [-lines-]{+line+}");
});

test("normal English text is checked", () => {
  for (const text of ["i want to know why the build are failing since yesterday, can you checking it", "Dear John, thanks for you reply.", "look good"])
    assert.equal(skipReason(text), null, text);
});

test("empty, one-word, code-heavy and non-English texts are skipped with a reason", () => {
  assert.equal(skipReason("  \n"), "no text");
  assert.equal(skipReason("ok"), "short");
  assert.equal(skipReason("https://gitlab.example.com/group/project/-/jobs/123456 https://gitlab.example.com/group/project/-/jobs/123457"), "code");
  for (const text of ["Tôi muốn biết tại sao build bị lỗi từ hôm qua", "この関数が動かない理由を教えてください"]) assert.equal(skipReason(text), "not-english", text);
  assert.equal(skipReason("Can you rename the café table to cafe_orders?"), null);
});

test("a long text is cut at a sentence end before the limit and marked as cut", () => {
  const sentence = "The upload step fails when the file is large. ";
  const cut = excerpt(sentence.repeat(Math.ceil((maxCheckedLength * 2) / sentence.length)));
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length <= maxCheckedLength, `${cut.text.length}`);
  assert.ok(cut.text.endsWith("large."));
  assert.deepEqual(excerpt("  Short message here.  "), { text: "Short message here.", truncated: false });
});

test("the prompt carries the text, the learner's language and level, and every reply field", () => {
  const prompt = buildFeedbackPrompt("can you checking it");
  for (const part of ["can you checking it", "Vietnamese", "B1", "ok", "corrected", "issues", "original", "replacement", "mistake", "unnatural", "tip", "explanation"])
    assert.ok(prompt.includes(part), part);
  assert.ok(buildFeedbackPrompt("x", { ...defaultSettings, targetLanguage: "Thai", level: "B2" }).includes("Thai, around B2"));
});

const reply = {
  ok: false,
  corrected: "Can you check it?",
  issues: [{ original: "can you checking", replacement: "Can you check", tag: "mistake" as const, explanation: 'After "can you", use the base verb.' }],
};

test("a reply parses, malformed replies report an error", () => {
  assert.deepEqual(parseFeedbackReply(`Here: ${JSON.stringify(reply)}`), { ok: true, value: reply });
  for (const text of [null, "", '{"ok": false, "corrected": ', '{"ok": "no"}', JSON.stringify({ ...reply, issues: [{ ...reply.issues[0], tag: "style" }] })])
    assert.equal(parseFeedbackReply(text).ok, false, String(text));
});

test("a reply with nothing to fix is fine; one with fixes carries both texts", () => {
  const text = "Can you add a retry to the upload step?";
  assert.deepEqual(resultFromReply(text, false, { ok: false, corrected: ` ${text}\n`, issues: [] }), { state: "fine" });
  assert.deepEqual(resultFromReply("can you checking it", false, reply), {
    state: "corrected", original: "can you checking it", corrected: "Can you check it?", truncated: false, issues: reply.issues,
  });
});

const item = (term: string, extra: Partial<VocabItem> = {}): VocabItem => ({
  id: term, term, meaning: "m", partOfSpeech: "", note: "", pronunciation: "", context: "", url: "", addedAt: 0, ...extra,
});

test("saving a term again replaces the old entry and moves it to the front", () => {
  assert.equal(vocabKey('  "Look Up"! '), "look up");
  const list = addVocab([item("look up"), item("deliberate")], item("Deliberate", { meaning: "new" }));
  assert.deepEqual(list.map(entry => [entry.term, entry.meaning]), [["Deliberate", "new"], ["look up", "m"]]);
});

test("the whole selection keeps its breakdown details when it is the only term", () => {
  const result = { translation: "cân nhắc", pronunciation: "/x/", breakdown: [{ term: "Deliberate", partOfSpeech: "verb", meaning: "cân nhắc", note: "n" }], grammar: [], patterns: [], examples: [] };
  const saved = vocabFromLookup({ text: "deliberate", sentence: "s", url: "u" }, result);
  assert.equal(saved.partOfSpeech, "verb");
  assert.equal(saved.meaning, "cân nhắc");
  assert.equal(saved.pronunciation, "/x/");
});

test("CSV export quotes cells with commas, quotes and line breaks", () => {
  const csv = vocabToCsv([item('say "hi", then\nleave', { addedAt: Date.UTC(2026, 0, 2) })]);
  assert.equal(csv, 'term,meaning,partOfSpeech,pronunciation,note,context,url,added\n"say ""hi"", then\nleave",m,,,,,,2026-01-02T00:00:00.000Z\n');
});
