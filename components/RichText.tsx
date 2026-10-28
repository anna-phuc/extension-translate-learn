import { parseInline } from "../shared/rich-text.ts";

/** Text with `**bold**` and `` `code` `` rendered; everything else stays plain, so model output never becomes HTML. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((span, index) =>
        span.bold ? <strong key={index}>{span.text}</strong> : span.code ? <code key={index}>{span.text}</code> : <span key={index}>{span.text}</span>,
      )}
    </>
  );
}
