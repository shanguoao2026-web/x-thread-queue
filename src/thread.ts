/**
 * Splits a thread section into tweets.
 *
 * A section is a thread when the heading contains the word "thread", when the
 * body has a complete 1/N … N/N marker run, or when a single fenced code block
 * is divided by a line that is exactly `---`. Single posts are left untouched:
 * a `---` line in ordinary prose is not a separator.
 */

export interface TweetSlice {
  /** 1-based tweet number. Taken from an `n/N` marker when the thread uses one. */
  index: number;
  /** Raw tweet text, without the marker line or the `---` separator. */
  text: string;
  /** 0-based line index of this slice inside the section body. */
  bodyLine: number;
}

const TWEET_MARKER_RE = /^[ \t]*(\d+)[ \t]*\/[ \t]*(\d+)[ \t]*(.*)$/u;
const DASH_RE = /^[ \t]*---[ \t]*$/u;

export function findThreadSlices(
  title: string,
  body: string,
  codeBlocksOnly: boolean,
): TweetSlice[] | null {
  const threadHeading = isThreadHeading(title);
  const fences = locateFences(body);

  // One fenced block that itself contains the thread. Notes outside the fence
  // are not tweets, whether or not --code-blocks-only is set.
  if (fences.length === 1) {
    const fence = fences[0];
    if (fence) {
      const fromFence =
        splitNumbered(fence.inner, fence.innerBodyLine) ??
        splitDashed(fence.inner, fence.innerBodyLine);
      if (fromFence) return fromFence;
    }
  }

  const source =
    codeBlocksOnly && fences.length > 0 ? (codeBlocksOnlyBody(body) ?? body) : body;
  const numbered = splitNumbered(source, 0);
  if (numbered) return numbered;
  // A heading that contains "thread" may separate tweets with `---` in the
  // prose. Without that heading, a prose rule stays part of a single post.
  if (threadHeading) {
    const dashed = splitDashed(source, 0);
    if (dashed) return dashed;
  }
  return null;
}

function isThreadHeading(title: string): boolean {
  return /\bthreads?\b/i.test(title);
}

export function openFenceMarker(line: string): string | null {
  const ticks = /^ {0,3}(`{3,})[^`]*$/u.exec(line);
  if (ticks) return ticks[1] ?? null;
  const tildes = /^ {0,3}(~{3,}).*$/u.exec(line);
  if (tildes) return tildes[1] ?? null;
  return null;
}

export function isClosingFence(line: string, marker: string): boolean {
  const char = marker[0] === "~" ? "~" : "`";
  const re = new RegExp(`^ {0,3}${char}{${marker.length},}\\s*$`, "u");
  return re.test(line);
}

/**
 * Null when `body` has no fence. Otherwise fence markers and every line outside
 * a fence are blanked. Newlines stay in place so image line numbers still match
 * the source file. An empty string means the fences were empty.
 */
export function codeBlocksOnlyBody(body: string): string | null {
  const lines = body.split("\n");
  const kept: string[] = [];
  let fence: string | null = null;
  let found = false;

  for (const line of lines) {
    if (fence) {
      if (isClosingFence(line, fence)) {
        fence = null;
        kept.push("");
      } else {
        kept.push(line);
      }
      continue;
    }
    const opened = openFenceMarker(line);
    if (opened) {
      found = true;
      fence = opened;
      kept.push("");
      continue;
    }
    kept.push("");
  }

  if (!found) return null;
  return kept.join("\n");
}

interface LocatedFence {
  inner: string;
  /** 0-based line index in the section body of the first inner line. */
  innerBodyLine: number;
}

function locateFences(body: string): LocatedFence[] {
  const lines = body.split("\n");
  const fences: LocatedFence[] = [];
  let marker: string | null = null;
  let start = 0;
  let buf: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (marker) {
      if (isClosingFence(line, marker)) {
        fences.push({ inner: buf.join("\n"), innerBodyLine: start });
        marker = null;
        buf = [];
      } else {
        buf.push(line);
      }
      continue;
    }
    const opened = openFenceMarker(line);
    if (opened) {
      marker = opened;
      start = index + 1;
      buf = [];
    }
  }
  if (marker) fences.push({ inner: buf.join("\n"), innerBodyLine: start });
  return fences;
}

interface Marker {
  line: number;
  index: number;
  total: number;
  rest: string;
}

/**
 * A complete run of `1/N` … `N/N`, in order. The marker is a label: it is not
 * part of the tweet. Text before `1/N` is a note and is not a tweet.
 * Returns null when the run is missing or incomplete, so a mention of `1/5`
 * does not split a single post.
 */
function splitNumbered(source: string, baseBodyLine: number): TweetSlice[] | null {
  const lines = source.split("\n");
  const markers: Marker[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const match = TWEET_MARKER_RE.exec(lines[line] ?? "");
    if (!match) continue;
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isInteger(index) || !Number.isInteger(total)) continue;
    if (total < 2 || index < 1 || index > total) continue;
    markers.push({ line, index, total, rest: (match[3] ?? "").trim() });
  }
  if (markers.length < 2) return null;
  const total = markers[0]?.total;
  if (total === undefined || markers.length !== total) return null;
  if (!markers.every((marker) => marker.total === total)) return null;
  for (let i = 0; i < markers.length; i += 1) {
    if (markers[i]?.index !== i + 1) return null;
  }

  const slices: TweetSlice[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    if (!marker) continue;
    const nextLine = markers[i + 1]?.line ?? lines.length;
    const following = lines.slice(marker.line + 1, nextLine);
    const text =
      marker.rest.length > 0 ? [marker.rest, ...following].join("\n") : following.join("\n");
    const contentLine = marker.rest.length > 0 ? marker.line : marker.line + 1;
    slices.push({
      index: marker.index,
      text,
      bodyLine: baseBodyLine + contentLine,
    });
  }
  return slices.length >= 2 ? slices : null;
}

/** Splits on a line that is exactly `---`. Empty segments are dropped. */
function splitDashed(source: string, baseBodyLine: number): TweetSlice[] | null {
  const lines = source.split("\n");
  let saw = false;
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!DASH_RE.test(lines[index] ?? "")) continue;
    saw = true;
    ranges.push({ start, end: index });
    start = index + 1;
  }
  if (!saw) return null;
  ranges.push({ start, end: lines.length });

  const slices: TweetSlice[] = [];
  for (const range of ranges) {
    const text = lines.slice(range.start, range.end).join("\n");
    if (text.trim().length === 0) continue;
    slices.push({
      index: slices.length + 1,
      text,
      bodyLine: baseBodyLine + range.start,
    });
  }
  return slices.length >= 2 ? slices : null;
}
