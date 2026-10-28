export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  for (const [unit, size] of units) if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  return "just now";
}

/** Case- and accent-insensitive match of `query` against any of `fields`. */
export function matches(query: string, ...fields: string[]): boolean {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = fold(query.trim());
  return !needle || fields.some(field => fold(field).includes(needle));
}
