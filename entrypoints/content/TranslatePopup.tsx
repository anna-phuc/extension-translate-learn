import { CloseIcon, PanelIcon } from "../../components/icons.tsx";
import { Lesson } from "../../components/Lesson.tsx";
import type { Lookup } from "../../shared/types.ts";
import { placeCard, type Box } from "./dom.ts";

const width = 360;
const maxHeight = 440;

interface Props {
  anchor: Box;
  lookup: Lookup | null;
  onClose(): void;
  onRetry(): void;
  onOpenLesson(): void;
  onOpenSettings(): void;
}

export function TranslatePopup({ anchor, lookup, onClose, onRetry, onOpenLesson, onOpenSettings }: Props) {
  const place = placeCard(anchor, width, maxHeight);
  return (
    <div className="tl-card tl-popup" role="dialog" aria-label="Translation" style={{ ...place, width }}>
      <div className="tl-card-scroll">
        {lookup ? (
          <Lesson lookup={lookup} compact onRetry={onRetry} onOpenSettings={onOpenSettings} />
        ) : (
          <div className="tl-loading">
            <span className="tl-shimmer" />
            <span className="tl-shimmer tl-shimmer-short" />
          </div>
        )}
      </div>
      <div className="tl-card-footer">
        <button type="button" className="tl-button" onClick={onOpenLesson} disabled={!lookup}>
          <PanelIcon size={14} /> Full lesson
        </button>
        <button type="button" className="tl-icon-button" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
