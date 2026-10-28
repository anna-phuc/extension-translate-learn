// Page DOM access for the content script: what the user selected, which text box has focus, and reading or replacing
// that box's text. The selection rules are ported from paseo-translate's client/web.ts.
import { candidateFromSelection, sentenceRadius, wordEnd, wordStart, type Candidate } from "../../shared/translate.ts";

const blockSearchDepth = 6;
const editableSelector = "input, textarea, [contenteditable]:not([contenteditable='false'])";

const elementOf = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);

/** Text of the smallest ancestor that holds the selection plus some surrounding words. */
function blockText(container: Element, selected: string): string {
  let element: Element = container;
  for (let depth = 0; depth < blockSearchDepth && element.parentElement; depth++) {
    if (((element as HTMLElement).innerText ?? "").length >= selected.length + 2 * sentenceRadius) break;
    element = element.parentElement;
  }
  return (element as HTMLElement).innerText ?? selected;
}

/** The selected text widened to whole words when the range starts or ends inside one. The selection itself is left as the user made it. */
function wholeWords(range: Range, selected: string): string {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const head = startContainer.nodeType === Node.TEXT_NODE ? (startContainer as Text).data.slice(wordStart((startContainer as Text).data, startOffset), startOffset) : "";
  const tail = endContainer.nodeType === Node.TEXT_NODE ? (endContainer as Text).data.slice(endOffset, wordEnd((endContainer as Text).data, endOffset)) : "";
  return head + selected + tail;
}

export interface PageSelection {
  candidate: Candidate;
  range: Range;
}

/** The current selection when it is worth offering for translation: page text, not a text box or our own UI. */
export function readSelection(host: Element): PageSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const container = elementOf(range.commonAncestorContainer);
  if (!container || container === host || host.contains(container) || container.closest(editableSelector)) return null;
  const selected = wholeWords(range, selection.toString());
  const candidate = candidateFromSelection({ selected, block: blockText(container, selected) });
  const rect = range.getBoundingClientRect();
  if (!candidate || (rect.width === 0 && rect.height === 0)) return null;
  return { candidate, range: range.cloneRange() };
}

export type EditableElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

const textInputTypes = new Set(["", "text", "search"]);

/** The text box `target` belongs to: a textarea, a text input, or the root of a contenteditable region. */
export function findEditable(target: EventTarget | null): EditableElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target instanceof HTMLTextAreaElement) return target.readOnly || target.disabled ? null : target;
  if (target instanceof HTMLInputElement) {
    return textInputTypes.has(target.type.toLowerCase()) && !target.readOnly && !target.disabled ? target : null;
  }
  if (!target.isContentEditable) return null;
  let root = target;
  while (root.parentElement?.isContentEditable) root = root.parentElement;
  return root;
}

const isField = (element: EditableElement): element is HTMLTextAreaElement | HTMLInputElement =>
  element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;

export const readText = (element: EditableElement): string => (isField(element) ? element.value : element.innerText);

/**
 * Replaces the box's whole text, the way typing would, so the page's own editor (React, Slack, Gmail...) sees the change.
 * Returns false when the page refused it; a rich editor also loses its formatting, which is why the card offers Copy too.
 */
export function writeText(element: EditableElement, text: string): boolean {
  element.focus();
  if (isField(element)) {
    // The prototype's setter, not the element's own: frameworks that track the value would otherwise ignore the change.
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
    return element.value === text;
  }
  const selection = window.getSelection();
  selection?.selectAllChildren(element);
  // execCommand is deprecated but is still the one way to edit a contenteditable that its editor will notice.
  return document.execCommand("insertText", false, text);
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export const boxOf = (rect: DOMRect): Box => ({ top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right });

const margin = 8;

/** Fixed-position coordinates for a card of `width` next to `anchor`: below it when it fits, else above. */
export function placeCard(anchor: Box, width: number, maxHeight: number): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
  const below = window.innerHeight - anchor.bottom - 2 * margin;
  const above = anchor.top - 2 * margin;
  if (below >= Math.min(maxHeight, 240) || below >= above) return { left, top: anchor.bottom + margin, maxHeight: Math.max(160, Math.min(maxHeight, below)) };
  return { left, bottom: window.innerHeight - anchor.top + margin, maxHeight: Math.max(160, Math.min(maxHeight, above)) };
}
