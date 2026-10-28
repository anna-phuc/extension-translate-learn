// Everything the extension draws on a page: the Translate button next to a selection, the translation popup, the
// Check button on the focused text box, and the English check card. All of it lives in one shadow root.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { browser, type Browser } from "wxt/browser";
import { useSettings } from "../../components/hooks.ts";
import { LanguagesIcon, SpellCheckIcon } from "../../components/icons.tsx";
import { skipMessages, skipReason, type FeedbackResult } from "../../shared/feedback.ts";
import type { CheckResponse, Lookup, LookupClientMessage, LookupServerMessage, PanelView, RuntimeMessage } from "../../shared/types.ts";
import { CheckCard, type CheckState } from "./CheckCard.tsx";
import { boxOf, findEditable, readSelection, readText, writeText, type Box, type EditableElement, type PageSelection } from "./dom.ts";
import { TranslatePopup } from "./TranslatePopup.tsx";

const staleExtension = "The extension was updated. Reload this page to keep using it.";
const fineCloseMs = 2500;
const buttonGap = 8;
const edge = 8;

/** Where a range is on screen now; a range whose nodes left the page keeps its last known place. */
function rangeBox(range: Range | null, last: Box): Box {
  const rect = range?.getBoundingClientRect();
  return rect && (rect.width > 0 || rect.height > 0) ? boxOf(rect) : last;
}

const send = (message: RuntimeMessage) => browser.runtime.sendMessage(message);

export function App({ host }: { host: HTMLElement }) {
  const settings = useSettings();
  // Scrolling, resizing and typing move what the UI is anchored to; a re-render reads the new positions.
  const [, relayout] = useReducer((count: number) => count + 1, 0);

  const [offer, setOffer] = useState<PageSelection | null>(null);
  const [popup, setPopup] = useState<{ range: Range; last: Box } | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [editable, setEditable] = useState<EditableElement | null>(null);
  const [check, setCheck] = useState<{ element: EditableElement; text: string; view: CheckState } | null>(null);
  const portRef = useRef<Browser.runtime.Port | null>(null);
  const checkSeq = useRef(0);

  const isOurs = useCallback((event: Event) => event.composedPath().includes(host), [host]);

  const lookupPort = useCallback((): Browser.runtime.Port | null => {
    if (portRef.current) return portRef.current;
    try {
      const port = browser.runtime.connect({ name: "lookup" });
      port.onMessage.addListener((message: LookupServerMessage) => setLookup(message.lookup));
      port.onDisconnect.addListener(() => {
        if (portRef.current === port) portRef.current = null;
      });
      portRef.current = port;
      return port;
    } catch {
      return null;
    }
  }, []);

  const post = useCallback(
    (message: LookupClientMessage) => {
      const port = lookupPort();
      if (!port) return false;
      try {
        port.postMessage(message);
        return true;
      } catch {
        // The worker restarted and dropped this port; one reconnect.
        portRef.current = null;
        try {
          lookupPort()?.postMessage(message);
          return true;
        } catch {
          return false;
        }
      }
    },
    [lookupPort],
  );

  const failLookup = (text: string) =>
    setLookup({ id: "local", text, sentence: text, url: location.href, title: document.title, createdAt: Date.now(), status: "error", result: null, error: staleExtension, errorKind: "other" });

  const translate = (selection: PageSelection) => {
    setOffer(null);
    setLookup(null);
    setPopup({ range: selection.range, last: boxOf(selection.range.getBoundingClientRect()) });
    const sent = post({ type: "start", candidate: selection.candidate, page: { url: location.href, title: document.title } });
    if (!sent) failLookup(selection.candidate.text);
  };

  const openPanel = (view: PanelView, lookupId?: string) => {
    send({ type: "open-panel", view, lookupId }).catch(() => {
      if (view === "lesson") failLookup(lookup?.text ?? "");
    });
  };

  // Selection: decide once the user has finished selecting, not on every selectionchange while dragging.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const decideSoon = () => {
      clearTimeout(timer);
      // The tick lets the browser settle the selection (a click inside a selection collapses it).
      timer = setTimeout(() => setOffer(readSelection(host)), 0);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (isOurs(event)) return;
      setOffer(null);
      setPopup(null);
      setCheck(current => (current && current.element.contains(event.target as Node) ? current : null));
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!isOurs(event)) decideSoon();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift" || event.shiftKey || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a")) decideSoon();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPopup(null);
      setCheck(null);
      setOffer(null);
    };
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) setOffer(null);
    };
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(relayout);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("input", onMove, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("input", onMove, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [host, isOurs]);

  // The focused text box, for the Check button. Focus moving into our own UI (the button) keeps it.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (isOurs(event)) return;
      setEditable(findEditable(event.target));
    };
    const onFocusOut = (event: FocusEvent) => {
      if (isOurs(event)) return;
      const next = event.relatedTarget;
      if (next === host) return;
      setEditable(findEditable(next));
    };
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    // A box that already has focus when the script loads.
    setEditable(findEditable(document.activeElement));
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [host, isOurs]);

  // A clean result closes itself after a moment.
  useEffect(() => {
    if (!check || !(check.view.state === "applied" || (check.view.state === "done" && check.view.result.state === "fine"))) return;
    const timer = setTimeout(() => setCheck(null), fineCloseMs);
    return () => clearTimeout(timer);
  }, [check]);

  const runCheck = async (element: EditableElement) => {
    const text = readText(element);
    const reason = skipReason(text);
    const seq = ++checkSeq.current;
    if (reason) return setCheck({ element, text, view: { state: "skipped", message: skipMessages[reason] } });
    setCheck({ element, text, view: { state: "loading" } });
    let response: CheckResponse;
    try {
      response = await send({ type: "check", text });
    } catch {
      response = { ok: false, error: staleExtension, errorKind: "other" };
    }
    if (seq !== checkSeq.current) return;
    setCheck({ element, text, view: response.ok ? { state: "done", result: response.result } : { state: "error", error: response.error, errorKind: response.errorKind } });
  };

  const withNotice = (notice: string) =>
    setCheck(current => (current && current.view.state === "done" ? { ...current, view: { ...current.view, notice } } : current));

  const applyCheck = (element: EditableElement, result: Extract<FeedbackResult, { state: "corrected" }>) => {
    const current = readText(element);
    if (!current.includes(result.original)) return withNotice("The text changed since the check. Check it again.");
    const next = current.replace(result.original, () => result.corrected);
    if (writeText(element, next)) setCheck(state => (state ? { ...state, view: { state: "applied" } } : state));
    else void copyCorrected(result.corrected, "This box can't be edited from here, so the corrected text was copied. Paste it in.");
  };

  const copyCorrected = async (text: string, done = "Copied the corrected text.") => {
    try {
      await navigator.clipboard.writeText(text);
      withNotice(done);
    } catch {
      withNotice("Couldn't copy. Select the text above and copy it by hand.");
    }
  };

  if (!settings) return null;

  const offerBox = offer ? rangeBox(offer.range, boxOf(offer.range.getBoundingClientRect())) : null;
  const popupBox = popup ? rangeBox(popup.range, popup.last) : null;
  const editableBox = editable?.isConnected ? boxOf(editable.getBoundingClientRect()) : null;
  const checkBox = check?.element.isConnected ? boxOf(check.element.getBoundingClientRect()) : null;
  const showCheckButton =
    settings.showCheckButton && editable && editableBox && editableBox.width >= 120 && skipReason(readText(editable)) !== "no text";

  return (
    <div className="tl-theme tl-layer">
      {settings.showTranslateButton && offer && offerBox && !popup ? (
        <button
          type="button"
          className="tl-pill"
          style={{
            left: Math.max(edge, Math.min(offerBox.left, window.innerWidth - 120 - edge)),
            top: offerBox.top - 32 - buttonGap >= edge ? offerBox.top - 32 - buttonGap : offerBox.bottom + buttonGap,
          }}
          // A press on the button must not collapse the selection it is about to translate.
          onMouseDown={event => event.preventDefault()}
          onClick={() => translate(offer)}
        >
          <LanguagesIcon size={15} /> Translate
        </button>
      ) : null}

      {popup && popupBox ? (
        <TranslatePopup
          anchor={popupBox}
          lookup={lookup}
          onClose={() => setPopup(null)}
          onRetry={() => post({ type: "retry" })}
          onOpenLesson={() => lookup && openPanel("lesson", lookup.id)}
          onOpenSettings={() => openPanel("settings")}
        />
      ) : null}

      {showCheckButton && editable && editableBox ? (
        <button
          type="button"
          className={`tl-check-button${check?.element === editable && check.view.state === "loading" ? " tl-busy" : ""}`}
          title="Check my English"
          aria-label="Check my English"
          style={{
            // Inside the box's bottom-right corner; a single-line input gets it centred on the right.
            left: editableBox.right - 30 - 6,
            top: editableBox.height < 48 ? editableBox.top + (editableBox.height - 30) / 2 : editableBox.bottom - 30 - 6,
          }}
          // Keeps focus (and the caret) in the text box.
          onMouseDown={event => event.preventDefault()}
          onClick={() => void runCheck(editable)}
        >
          <SpellCheckIcon size={16} />
        </button>
      ) : null}

      {check && checkBox ? (
        <CheckCard
          anchor={checkBox}
          check={check.view}
          onClose={() => setCheck(null)}
          onRetry={() => void runCheck(check.element)}
          onApply={() => check.view.state === "done" && check.view.result.state === "corrected" && applyCheck(check.element, check.view.result)}
          onCopy={() => check.view.state === "done" && check.view.result.state === "corrected" && void copyCorrected(check.view.result.corrected)}
          onOpenSettings={() => openPanel("settings")}
        />
      ) : null}
    </div>
  );
}
