import type { BreakdownEntry, Translation } from "./translate.ts";
import type { Lookup, VocabItem } from "./types.ts";

/** Two saved terms are the same entry when they differ only in case, spacing or edge punctuation. */
export const vocabKey = (term: string) =>
  term
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’.,;:!?()]+|[\s"'“”‘’.,;:!?()]+$/g, "");

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A vocabulary entry for one breakdown term of a lookup. */
export function vocabFromEntry(entry: BreakdownEntry, lookup: Pick<Lookup, "sentence" | "url">, pronunciation = ""): VocabItem {
  return {
    id: newId(),
    term: entry.term,
    meaning: entry.meaning,
    partOfSpeech: entry.partOfSpeech,
    note: entry.note,
    pronunciation,
    context: lookup.sentence,
    url: lookup.url,
    addedAt: Date.now(),
  };
}

/** A vocabulary entry for the whole selection of a lookup. */
export function vocabFromLookup(lookup: Pick<Lookup, "text" | "sentence" | "url">, result: Translation): VocabItem {
  const only = result.breakdown.length === 1 && vocabKey(result.breakdown[0].term) === vocabKey(lookup.text) ? result.breakdown[0] : null;
  return {
    id: newId(),
    term: lookup.text,
    meaning: result.translation,
    partOfSpeech: only?.partOfSpeech ?? "",
    note: only?.note ?? "",
    pronunciation: result.pronunciation,
    context: lookup.sentence,
    url: lookup.url,
    addedAt: Date.now(),
  };
}

/** The list with `item` added at the front, replacing an entry for the same term. */
export function addVocab(list: readonly VocabItem[], item: VocabItem): VocabItem[] {
  const key = vocabKey(item.term);
  return [item, ...list.filter(existing => vocabKey(existing.term) !== key)];
}

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** CSV with a header row: term, meaning, part of speech, pronunciation, note, context, url, added. Anki imports it. */
export function vocabToCsv(list: readonly VocabItem[]): string {
  const header = ["term", "meaning", "partOfSpeech", "pronunciation", "note", "context", "url", "added"];
  const rows = list.map(item => [item.term, item.meaning, item.partOfSpeech, item.pronunciation, item.note, item.context, item.url, new Date(item.addedAt).toISOString()]);
  return [header, ...rows].map(row => row.map(csvCell).join(",")).join("\n") + "\n";
}
