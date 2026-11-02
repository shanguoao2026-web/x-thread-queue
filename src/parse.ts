import * as fs from "node:fs";
import * as path from "node:path";
import { measureText } from "./count.js";
import { toDisplayPath } from "./files.js";
import { refreshDraft } from "./issues.js";
import type { Draft, ImageRef } from "./types.js";

export interface Section {
  title: string;
  headingLine: number;
  body: string;
}

export interface ParseInput {
  absolutePath: string;
  displayPath: string;
  markdown: string;
  limit: number;
  usedIds: Set<string>;
  /** When true, a section that contains fences uses only the text inside them as the post. */
  codeBlocksOnly?: boolean;
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(\S.*?)\s*$/;
const IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

export function parseMarkdown(input: ParseInput): Draft[] {
  const markdown = input.markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const fileSlug =
    slugify(path.basename(input.absolutePath, path.extname(input.absolutePath))) || "draft";
  const fileDir = path.dirname(input.absolutePath);
  let sections = splitSections(markdown);
  let wholeFile = false;
  if (sections.length === 0) {
    wholeFile = true;
    const title = path.basename(input.absolutePath, path.extname(input.absolutePath));
    sections = [{ title, headingLine: 1, body: markdown }];
  }

  const codeBlocksOnly = input.codeBlocksOnly === true;
  const drafts: Draft[] = [];
  sections.forEach((section, index) => {
    const source = codeBlocksOnly
      ? (codeBlocksOnlyBody(section.body) ?? section.body)
      : section.body;
    const extracted = extractBody(source, fileDir, section.headingLine);
    if (extracted.text.length === 0 && extracted.images.length === 0) return;
    const measured = measureText(extracted.text);
    const titleSlug = slugify(section.title) || `draft-${index + 1}`;
    const id = wholeFile
      ? uniqueId(fileSlug, input.usedIds)
      : uniqueId(`${fileSlug}--${titleSlug}`, input.usedIds);
    const draft: Draft = {
      id,
      title: section.title,
      file: input.displayPath,
      line: section.headingLine,
      text: measured.text,
      weightedLength: measured.weightedLength,
      limit: input.limit,
      overLimit: measured.weightedLength > input.limit,
      urls: measured.urls,
      images: extracted.images,
      duplicateOf: null,
      similarity: null,
      issues: [],
      valid: false,
    };
    refreshDraft(draft);
    drafts.push(draft);
  });
  return drafts;
}

export function splitSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let current: { title: string; headingLine: number; lines: string[] } | null = null;
  let fence: string | null = null;

  const flush = (): void => {
    if (!current) return;
    sections.push({
      title: current.title,
      headingLine: current.headingLine,
      body: current.lines.join("\n"),
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNo = index + 1;
    if (fence) {
      if (current) current.lines.push(line);
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }
    const opened = openFenceMarker(line);
    if (opened) {
      fence = opened;
      if (current) current.lines.push(line);
      continue;
    }
    const heading = parseHeading(line);
    if (heading) {
      flush();
      current = { title: heading, headingLine: lineNo, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections;
}

export function slugify(input: string): string {
  return input
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseHeading(line: string): string | null {
  const match = HEADING_RE.exec(line);
  if (!match) return null;
  const raw = match[2] ?? "";
  const cleaned = raw.replace(/[ \t]+#+\s*$/u, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function openFenceMarker(line: string): string | null {
  const ticks = /^ {0,3}(`{3,})[^`]*$/u.exec(line);
  if (ticks) return ticks[1] ?? null;
  const tildes = /^ {0,3}(~{3,}).*$/u.exec(line);
  if (tildes) return tildes[1] ?? null;
  return null;
}

function isClosingFence(line: string, marker: string): boolean {
  const char = marker[0] === "~" ? "~" : "`";
  const re = new RegExp(`^ {0,3}${char}{${marker.length},}\\s*$`, "u");
  return re.test(line);
}

/**
 * Null when `body` has no fence. Otherwise fence markers and every line outside
 * a fence are blanked. Newlines stay in place so image line numbers still match
 * the source file. An empty string means the fences were empty.
 */
function codeBlocksOnlyBody(body: string): string | null {
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

function extractBody(
  body: string,
  fileDir: string,
  headingLine: number,
): { text: string; images: ImageRef[] } {
  const images: ImageRef[] = [];
  const imageRe = new RegExp(IMAGE_RE.source, "g");
  let text = "";
  let cursor = 0;
  for (const match of body.matchAll(imageRe)) {
    const index = match.index ?? 0;
    text += body.slice(cursor, index);
    const alt = match[1] ?? "";
    const src = cleanImageSource(match[2] ?? "");
    images.push(resolveImage(alt, src, fileDir, lineNumberAt(body, index, headingLine)));
    cursor = index + match[0].length;
  }
  text += body.slice(cursor);
  const cleaned = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: cleaned, images };
}

function cleanImageSource(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function resolveImage(alt: string, source: string, fileDir: string, line: number): ImageRef {
  if (/^(https?:)?\/\//i.test(source)) {
    return {
      alt,
      source,
      resolvedPath: null,
      exists: false,
      remote: true,
      line,
    };
  }
  if (/^file:/i.test(source)) {
    const local = fileUrlToLocal(source);
    if (local) {
      return {
        alt,
        source,
        resolvedPath: toDisplayPath(local),
        exists: isFile(local),
        remote: false,
        line,
      };
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    return {
      alt,
      source,
      resolvedPath: null,
      exists: false,
      remote: false,
      line,
    };
  }
  const resolved = resolveLocal(fileDir, source);
  return {
    alt,
    source,
    resolvedPath: resolved.resolvedPath,
    exists: resolved.exists,
    remote: false,
    line,
  };
}

function resolveLocal(fileDir: string, source: string): { resolvedPath: string; exists: boolean } {
  const candidates: string[] = [];
  try {
    const decoded = decodeURIComponent(source);
    if (decoded !== source) candidates.push(decoded);
  } catch {
    // Keep the raw source when it is not valid percent-encoding.
  }
  candidates.push(source);
  const preferred = path.resolve(fileDir, candidates[0] ?? source);
  for (const candidate of candidates) {
    const resolved = path.resolve(fileDir, candidate);
    if (isFile(resolved)) {
      return { resolvedPath: toDisplayPath(resolved), exists: true };
    }
  }
  return { resolvedPath: toDisplayPath(preferred), exists: false };
}

function fileUrlToLocal(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function lineNumberAt(body: string, offset: number, headingLine: number): number {
  let line = headingLine + 1;
  const stop = Math.min(offset, body.length);
  for (let i = 0; i < stop; i += 1) {
    if (body[i] === "\n") line += 1;
  }
  return line;
}

function uniqueId(base: string, used: Set<string>): string {
  const root = base || "draft";
  if (!used.has(root)) {
    used.add(root);
    return root;
  }
  let n = 2;
  while (used.has(`${root}-${n}`)) n += 1;
  const id = `${root}-${n}`;
  used.add(id);
  return id;
}
