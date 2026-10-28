import { ExternalIcon, LanguagesIcon, SettingsIcon } from "../../components/icons.tsx";
import type { HelperStatus } from "../../lib/helper.ts";
import { Lesson } from "../../components/Lesson.tsx";
import type { Lookup } from "../../shared/types.ts";
import { hostOf, timeAgo } from "./format.ts";

interface Props {
  lookup: Lookup | null;
  status: HelperStatus | null;
  hasKey: boolean;
  onRetry(id: string): void;
  onOpenSettings(): void;
}

export function LessonView({ lookup, status, hasKey, onRetry, onOpenSettings }: Props) {
  if (!lookup) {
    return (
      <div className="panel-empty">
        <span className="panel-empty-icon">
          <LanguagesIcon size={28} />
        </span>
        <h2>Select text on any page</h2>
        <p>Release the mouse, click Translate, and the lesson shows up here: the translation, the words worth learning, the grammar, and patterns you can reuse.</p>
        <p>In any text box, the round button checks the English you wrote.</p>
        {status && status.state !== "ready" && !hasKey ? (
          <button type="button" className="tl-button tl-button-primary" onClick={onOpenSettings}>
            <SettingsIcon size={14} /> {status.state === "signed-out" ? "Sign in to Claude to start" : "Connect Claude to start"}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="panel-lesson">
      <Lesson lookup={lookup} onRetry={() => onRetry(lookup.id)} onOpenSettings={onOpenSettings} />
      {lookup.url ? (
        <p className="panel-source">
          <a href={lookup.url} target="_blank" rel="noreferrer" title={lookup.title || lookup.url}>
            <ExternalIcon size={12} /> {hostOf(lookup.url)}
          </a>
          <span> · {timeAgo(lookup.createdAt)}</span>
        </p>
      ) : null}
    </div>
  );
}
