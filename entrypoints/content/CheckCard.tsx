import { DiffText } from "../../components/DiffText.tsx";
import { CheckIcon, CloseIcon, CopyIcon, RetryIcon, SettingsIcon } from "../../components/icons.tsx";
import { RichText } from "../../components/RichText.tsx";
import type { FeedbackResult } from "../../shared/feedback.ts";
import type { ErrorKind } from "../../shared/types.ts";
import { placeCard, type Box } from "./dom.ts";

export type CheckState =
  | { state: "loading" }
  | { state: "skipped"; message: string }
  | { state: "error"; error: string; errorKind: ErrorKind }
  | { state: "done"; result: FeedbackResult; notice?: string }
  | { state: "applied" };

const maxWidth = 440;
const maxHeight = 460;

interface Props {
  anchor: Box;
  check: CheckState;
  onClose(): void;
  onRetry(): void;
  onApply(): void;
  onCopy(): void;
  onOpenSettings(): void;
}

const tagLabels = { mistake: "Mistake", unnatural: "Unnatural", tip: "Tip" } as const;

export function CheckCard({ anchor, check, onClose, onRetry, onApply, onCopy, onOpenSettings }: Props) {
  const width = Math.min(maxWidth, Math.max(300, anchor.width));
  const place = placeCard(anchor, width, maxHeight);
  const corrected = check.state === "done" && check.result.state === "corrected" ? check.result : null;

  return (
    <div className="tl-card tl-check" role="dialog" aria-label="English check" style={{ ...place, width }}>
      <div className="tl-card-scroll">
        {check.state === "loading" ? (
          <div className="tl-loading" aria-live="polite">
            <p className="tl-more">Checking your English…</p>
            <span className="tl-shimmer" />
            <span className="tl-shimmer tl-shimmer-short" />
          </div>
        ) : null}

        {check.state === "skipped" ? <p className="tl-more">{check.message}</p> : null}

        {check.state === "error" ? (
          <div className="tl-error" role="alert">
            <p>
              <RichText text={check.error} />
            </p>
            <div className="tl-actions">
              {check.errorKind === "setup" || check.errorKind === "auth" ? (
                <button type="button" className="tl-button tl-button-primary" onClick={onOpenSettings}>
                  <SettingsIcon size={14} /> Open settings
                </button>
              ) : (
                <button type="button" className="tl-button" onClick={onRetry}>
                  <RetryIcon size={14} /> Retry
                </button>
              )}
            </div>
          </div>
        ) : null}

        {check.state === "done" && check.result.state === "fine" ? (
          <p className="tl-fine">
            <CheckIcon size={16} /> Looks good. Nothing to fix.
          </p>
        ) : null}

        {check.state === "applied" ? (
          <p className="tl-fine">
            <CheckIcon size={16} /> Corrections applied.
          </p>
        ) : null}

        {corrected ? (
          <div className="tl-lesson">
            <DiffText original={corrected.original} corrected={corrected.corrected} />
            {corrected.truncated ? <p className="tl-more">The text was long, so only its first part was checked.</p> : null}
            {corrected.issues.length > 0 ? (
              <ul className="tl-issues">
                {corrected.issues.map((issue, index) => (
                  <li key={index} className="tl-issue">
                    <span className={`tl-issue-tag tl-issue-tag-${issue.tag}`}>{tagLabels[issue.tag]}</span>
                    <p className="tl-issue-change">
                      <del>{issue.original}</del> → <ins>{issue.replacement || "(remove)"}</ins>
                    </p>
                    <p className="tl-issue-why">{issue.explanation}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {check.state === "done" && check.notice ? (
              <p className="tl-notice" role="status">
                {check.notice}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="tl-card-footer">
        {corrected ? (
          <div className="tl-actions">
            <button type="button" className="tl-button tl-button-primary" onClick={onApply} title="Replace the text in the box with the corrected text">
              <CheckIcon size={14} /> Apply
            </button>
            <button type="button" className="tl-button" onClick={onCopy}>
              <CopyIcon size={14} /> Copy
            </button>
          </div>
        ) : (
          <span />
        )}
        <button type="button" className="tl-icon-button" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
