import { URL_TRANSFORM_LENGTH } from "./defaults.js";

/**
 * Weighted length follows X's twitter-text v3 rules:
 * - displayed length uses scale 100, so a weight of 100 is 1 and 200 is 2
 * - code points in the light ranges weigh 1; every other code point weighs 2
 * - CJK, Hangul, and most symbols fall outside the light ranges and weigh 2
 * - one emoji cluster weighs 2, including skin tones, flags, keycaps, and ZWJ sequences
 * - each http(s) URL weighs 23, whatever its raw length
 * - the text is normalized to NFC before weighing
 *
 * Light ranges (inclusive): U+0000–U+10FF, U+2000–U+200D, U+2010–U+201F, U+2032–U+2037.
 */
const LIGHT_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

const URL_RE_SOURCE = String.raw`(?<=^|[^\p{L}\p{N}])https?:\/\/[^\s<]+`;

const EMOJI_RE_SOURCE = [
  String.raw`(?:\p{Regional_Indicator}{2})`,
  String.raw`|(?:[#*0-9]\uFE0F?\u20E3)`,
  String.raw`|(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F\p{Emoji_Modifier}?|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F\p{Emoji_Modifier}?|\uFE0F)?)*)`,
].join("");

const SIMPLE_TRAILING = new Set<string>([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "'",
  '"',
  "`",
  ">",
  "…",
  "。",
  "、",
  "，",
  "．",
  "！",
  "？",
  "：",
  "；",
]);

export interface TextMeasure {
  text: string;
  weightedLength: number;
  urls: string[];
}

export interface UrlSpan {
  start: number;
  end: number;
  url: string;
}

export function codePointWeight(codePoint: number): number {
  for (const [start, end] of LIGHT_RANGES) {
    if (codePoint >= start && codePoint <= end) return 1;
  }
  return 2;
}

export function measureText(input: string): TextMeasure {
  const text = input.normalize("NFC");
  const spans = findUrlSpans(text);
  const urls: string[] = [];
  let weightedLength = 0;
  let cursor = 0;

  for (const span of spans) {
    if (span.start < cursor) continue;
    weightedLength += weightNonUrl(text.slice(cursor, span.start));
    weightedLength += URL_TRANSFORM_LENGTH;
    urls.push(span.url);
    cursor = span.end;
  }
  weightedLength += weightNonUrl(text.slice(cursor));

  return { text, weightedLength, urls };
}

export function findUrlSpans(text: string): UrlSpan[] {
  const re = new RegExp(URL_RE_SOURCE, "giu");
  const spans: UrlSpan[] = [];
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const url = trimUrlTail(raw);
    if (!/^https?:\/\/[^\s/?#]/i.test(url)) continue;
    spans.push({ start, end: start + url.length, url });
  }
  return spans;
}

function trimUrlTail(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1] ?? "";
    if (SIMPLE_TRAILING.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")" || last === "]" || last === "}") {
      const open = last === ")" ? "(" : last === "]" ? "[" : "{";
      let opens = 0;
      let closes = 0;
      for (const ch of url) {
        if (ch === open) opens += 1;
        else if (ch === last) closes += 1;
      }
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

function weightNonUrl(text: string): number {
  if (text.length === 0) return 0;
  const re = new RegExp(EMOJI_RE_SOURCE, "gu");
  let total = 0;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    total += weightCodePoints(text.slice(last, index));
    total += 2;
    last = index + match[0].length;
  }
  total += weightCodePoints(text.slice(last));
  return total;
}

function weightCodePoints(text: string): number {
  let total = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) continue;
    total += codePointWeight(codePoint);
  }
  return total;
}
