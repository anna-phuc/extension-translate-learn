import { useCallback, useEffect, useMemo, useState } from "react";
import { getHistory, getSettings, getVocab, removeVocab, saveVocab, watchHistory, watchSettings, watchVocab } from "../lib/store.ts";
import type { Settings } from "../shared/settings.ts";
import type { Lookup, VocabItem } from "../shared/types.ts";
import { vocabKey } from "../shared/vocab.ts";

function useStored<T>(get: () => Promise<T>, watch: (listener: (value: T) => void) => () => void, initial: T): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let alive = true;
    get().then(stored => alive && setValue(stored));
    const unwatch = watch(setValue);
    return () => {
      alive = false;
      unwatch();
    };
  }, [get, watch]);
  return value;
}

/** Null until the stored settings have loaded. */
export const useSettings = () => useStored<Settings | null>(getSettings, watchSettings, null);
export const useHistory = () => useStored<Lookup[]>(getHistory, watchHistory, []);
export const useVocab = () => useStored<VocabItem[]>(getVocab, watchVocab, []);

/** Whether a term is in the vocabulary, and a toggle that saves `make()` or removes the saved entry. */
export function useVocabToggle() {
  const vocab = useVocab();
  const byKey = useMemo(() => new Map(vocab.map(item => [vocabKey(item.term), item])), [vocab]);
  const isSaved = useCallback((term: string) => byKey.has(vocabKey(term)), [byKey]);
  const toggle = useCallback(
    (term: string, make: () => VocabItem) => {
      const saved = byKey.get(vocabKey(term));
      void (saved ? removeVocab(saved.id) : saveVocab(make()));
    },
    [byKey],
  );
  return { isSaved, toggle };
}
