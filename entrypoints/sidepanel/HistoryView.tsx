import { useState } from "react";
import { TrashIcon } from "../../components/icons.tsx";
import { clearHistory, maxHistory, removeFromHistory } from "../../lib/store.ts";
import type { Lookup } from "../../shared/types.ts";
import { hostOf, matches, timeAgo } from "./format.ts";

interface Props {
  history: Lookup[];
  onOpen(id: string): void;
}

export function HistoryView({ history, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const shown = history.filter(entry => matches(query, entry.text, entry.result?.translation ?? "", entry.url));

  if (history.length === 0) {
    return (
      <div className="panel-empty">
        <h2>No lookups yet</h2>
        <p>Every finished translation is kept here (the last {maxHistory}), so you can come back to it.</p>
      </div>
    );
  }

  return (
    <div className="panel-list">
      <div className="panel-toolbar">
        <input className="panel-search" type="search" placeholder="Search history" value={query} onChange={event => setQuery(event.target.value)} />
        {confirming ? (
          <>
            <button type="button" className="tl-button tl-button-danger" onClick={() => void clearHistory().then(() => setConfirming(false))}>
              Clear all
            </button>
            <button type="button" className="tl-button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="tl-button" onClick={() => setConfirming(true)}>
            Clear
          </button>
        )}
      </div>
      {shown.length === 0 ? <p className="tl-more">Nothing matches "{query}".</p> : null}
      <ul className="panel-items">
        {shown.map(entry => (
          <li key={entry.id} className="panel-item">
            <button type="button" className="panel-item-main" onClick={() => onOpen(entry.id)}>
              <span className="panel-item-title">{entry.text}</span>
              {entry.result ? <span className="panel-item-sub">{entry.result.translation}</span> : null}
              <span className="panel-item-meta">
                {hostOf(entry.url)} · {timeAgo(entry.createdAt)}
              </span>
            </button>
            <button type="button" className="tl-icon-button" title="Delete" aria-label={`Delete "${entry.text}"`} onClick={() => void removeFromHistory(entry.id)}>
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
