import { useState } from "react";
import { useSettings, useVocab } from "../../components/hooks.ts";
import { DownloadIcon, ExternalIcon, TrashIcon } from "../../components/icons.tsx";
import { RichText } from "../../components/RichText.tsx";
import { SpeakButton } from "../../components/SpeakButton.tsx";
import { useStopSpeechWith } from "../../components/speech.ts";
import { removeVocab } from "../../lib/store.ts";
import { vocabToCsv } from "../../shared/vocab.ts";
import { hostOf, matches } from "./format.ts";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function VocabView() {
  const vocab = useVocab();
  const settings = useSettings();
  const voice = { accent: settings?.speechAccent ?? "en-US", rate: settings?.speechRate ?? "normal", name: settings?.speechVoice ?? "" } as const;
  useStopSpeechWith("vocab");
  const [query, setQuery] = useState("");
  const shown = vocab.filter(item => matches(query, item.term, item.meaning, item.note));

  if (vocab.length === 0) {
    return (
      <div className="panel-empty">
        <h2>Your vocabulary is empty</h2>
        <p>Click the star next to a word or phrase in a lesson to save it here. You can export the list as CSV, which Anki can import.</p>
      </div>
    );
  }

  return (
    <div className="panel-list">
      <div className="panel-toolbar">
        <input className="panel-search" type="search" placeholder={`Search ${vocab.length} saved`} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" className="tl-button" onClick={() => download(`vocabulary-${new Date().toISOString().slice(0, 10)}.csv`, vocabToCsv(vocab))}>
          <DownloadIcon size={14} /> CSV
        </button>
      </div>
      {shown.length === 0 ? <p className="tl-more">Nothing matches "{query}".</p> : null}
      <ul className="panel-items">
        {shown.map(item => (
          <li key={item.id} className="panel-item panel-vocab">
            <div className="panel-item-main">
              <p>
                <span className="tl-term-name">{item.term}</span>
                {item.partOfSpeech ? <span className="tl-tag">{item.partOfSpeech}</span> : null}
                {item.pronunciation ? <span className="tl-pronunciation"> {item.pronunciation}</span> : null}
              </p>
              <p className="tl-term-meaning">
                <RichText text={item.meaning} />
              </p>
              {item.note ? (
                <p className="tl-note">
                  <RichText text={item.note} />
                </p>
              ) : null}
              {item.context && item.context !== item.term ? (
                <details className="panel-context">
                  <summary>Context</summary>
                  <p>{item.context}</p>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <ExternalIcon size={12} /> {hostOf(item.url)}
                    </a>
                  ) : null}
                </details>
              ) : null}
            </div>
            <SpeakButton id={`vocab:${item.id}`} text={item.term} voice={voice} />
            <button type="button" className="tl-icon-button" title="Remove" aria-label={`Remove "${item.term}"`} onClick={() => void removeVocab(item.id)}>
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
