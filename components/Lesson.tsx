// One lookup as a lesson. The page popup shows the compact form (translation and a few terms); the side panel shows
// all of it: translation, breakdown, grammar, patterns and examples.
import type { ReactNode } from "react";
import type { BreakdownEntry } from "../shared/translate.ts";
import type { Lookup } from "../shared/types.ts";
import { vocabFromEntry, vocabFromLookup } from "../shared/vocab.ts";
import { useSettings, useVocabToggle } from "./hooks.ts";
import { RetryIcon, SettingsIcon, StarIcon } from "./icons.tsx";
import { RichText } from "./RichText.tsx";
import { SpeakButton, type Voice } from "./SpeakButton.tsx";
import { useStopSpeechWith } from "./speech.ts";

interface LessonProps {
  lookup: Lookup;
  compact?: boolean;
  onRetry(): void;
  onOpenSettings(): void;
}

const compactTerms = 3;
// The selection is shown in full in the panel; in the popup, a paragraph is cut so the translation stays in view.
const compactSourceLength = 220;

export function Lesson({ lookup, compact = false, onRetry, onOpenSettings }: LessonProps) {
  const { isSaved, toggle } = useVocabToggle();
  const { result } = lookup;
  const loading = lookup.status === "loading";
  const source = compact && lookup.text.length > compactSourceLength ? `${lookup.text.slice(0, compactSourceLength).trimEnd()}…` : lookup.text;
  const terms = compact ? result?.breakdown.slice(0, compactTerms) : result?.breakdown;
  const wholeSaved = isSaved(lookup.text);
  const settings = useSettings();
  const voice: Voice = { accent: settings?.speechAccent ?? "en-US", rate: settings?.speechRate ?? "normal", name: settings?.speechVoice ?? "" };
  // Speaker ids start with the lookup's, so speech stops when this lesson closes or shows another lookup.
  const scope = `${compact ? "popup" : "panel"}:${lookup.id}`;
  useStopSpeechWith(scope);
  const speak = (part: string, text: string, label?: string) => <SpeakButton id={`${scope}:${part}`} text={text} voice={voice} label={label} />;

  // While Claude writes, a term is final once the reply has moved on to the next term or the next section.
  const movedOn = Boolean(result && result.grammar.length + result.patterns.length + result.examples.length > 0);
  const termReady = (index: number) => !loading || movedOn || index < (result?.breakdown.length ?? 0) - 1;

  const star = (term: string, make: () => ReturnType<typeof vocabFromLookup>, label: string, ready = !loading) => (
    <button
      type="button"
      className={`tl-icon-button tl-star${isSaved(term) ? " tl-star-on" : ""}`}
      title={!ready ? "Available when Claude finishes this word" : isSaved(term) ? `Remove "${term}" from vocabulary` : `Save "${term}" to vocabulary`}
      aria-label={label}
      aria-pressed={isSaved(term)}
      disabled={!ready}
      onClick={() => toggle(term, make)}
    >
      <StarIcon size={15} filled={isSaved(term)} />
    </button>
  );

  return (
    <div className={`tl-lesson${compact ? " tl-lesson-compact" : ""}`}>
      <div className="tl-source-row">
        <div className="tl-source">
          <p className="tl-source-text">{source}</p>
          {result?.pronunciation ? <p className="tl-pronunciation">{result.pronunciation}</p> : null}
        </div>
        {speak("source", lookup.text)}
        {result && lookup.status === "done"
          ? star(lookup.text, () => vocabFromLookup(lookup, result), wholeSaved ? "Remove from vocabulary" : "Save to vocabulary")
          : null}
      </div>

      {lookup.status === "error" ? (
        <div className="tl-error" role="alert">
          <p>
            <RichText text={lookup.error ?? ""} />
          </p>
          <div className="tl-actions">
            {lookup.errorKind === "setup" || lookup.errorKind === "auth" ? (
              <button type="button" className="tl-button tl-button-primary" onClick={onOpenSettings}>
                <SettingsIcon size={14} /> Open settings
              </button>
            ) : null}
            {lookup.errorKind !== "setup" ? (
              <button type="button" className="tl-button" onClick={onRetry}>
                <RetryIcon size={14} /> Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {result ? (
        <p className="tl-translation">
          <RichText text={result.translation} />
        </p>
      ) : lookup.status === "loading" ? (
        <div className="tl-loading" aria-live="polite">
          <span className="tl-shimmer" />
          <span className="tl-shimmer tl-shimmer-short" />
          <span className="tl-sr">Translating…</span>
        </div>
      ) : null}

      {terms && terms.length > 0 ? (
        <section className="tl-section">
          {compact ? null : <h3>Words and phrases</h3>}
          <ul className="tl-terms">
            {terms.map((entry, index) => (
              <Term key={`${entry.term}-${index}`} entry={entry} compact={compact}>
                {speak(`term:${index}`, entry.term)}
                {star(entry.term, () => vocabFromEntry(entry, lookup, terms.length === 1 ? result?.pronunciation : ""), `Save "${entry.term}"`, termReady(index))}
              </Term>
            ))}
          </ul>
          {compact && result && result.breakdown.length > compactTerms ? (
            <p className="tl-more">+{result.breakdown.length - compactTerms} more in the full lesson</p>
          ) : null}
        </section>
      ) : null}

      {!compact && result && result.grammar.length > 0 ? (
        <section className="tl-section">
          <h3>Grammar</h3>
          <ul className="tl-cards">
            {result.grammar.map((item, index) => (
              <li key={index}>
                <p className="tl-card-title">
                  <RichText text={item.point} />
                </p>
                <p>
                  <RichText text={item.explanation} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!compact && result && result.patterns.length > 0 ? (
        <section className="tl-section">
          <h3>Patterns</h3>
          <ul className="tl-cards">
            {result.patterns.map((item, index) => (
              <li key={index}>
                <p className="tl-card-title">
                  <RichText text={item.pattern} />
                </p>
                {item.meaning ? (
                  <p>
                    <RichText text={item.meaning} />
                  </p>
                ) : null}
                {item.example ? (
                  <div className="tl-speak-row">
                    <p className="tl-example">
                      <RichText text={item.example} />
                    </p>
                    {speak(`pattern:${index}`, item.example)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!compact && result && result.examples.length > 0 ? (
        <section className="tl-section">
          <h3>Examples</h3>
          <ul className="tl-examples">
            {result.examples.map((example, index) => (
              <li key={index} className="tl-speak-row">
                <p className="tl-example">
                  <RichText text={example} />
                </p>
                {speak(`example:${index}`, example)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading && result ? (
        <p className="tl-more tl-writing" aria-live="polite">
          Still writing{compact ? " the full lesson" : ""}…
        </p>
      ) : null}
    </div>
  );
}

function Term({ entry, compact, children }: { entry: BreakdownEntry; compact: boolean; children: ReactNode }) {
  return (
    <li className="tl-term">
      <div className="tl-term-body">
        <p>
          <span className="tl-term-name">{entry.term}</span>
          {entry.partOfSpeech ? <span className="tl-tag">{entry.partOfSpeech}</span> : null}
        </p>
        <p className="tl-term-meaning">
          <RichText text={entry.meaning} />
        </p>
        {!compact && entry.note ? (
          <p className="tl-note">
            <RichText text={entry.note} />
          </p>
        ) : null}
      </div>
      {children}
    </li>
  );
}
