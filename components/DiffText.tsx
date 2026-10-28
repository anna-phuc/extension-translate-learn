import { useMemo } from "react";
import { wordDiff } from "../shared/word-diff.ts";

/** The learner's text against the corrected one: removed words struck through in red, added words in green. */
export function DiffText({ original, corrected }: { original: string; corrected: string }) {
  const segments = useMemo(() => wordDiff(original, corrected), [original, corrected]);
  return (
    <p className="tl-diff">
      {segments.map((segment, index) =>
        segment.kind === "del" ? (
          <del key={index}>{segment.text}</del>
        ) : segment.kind === "ins" ? (
          <ins key={index}>{segment.text}</ins>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
