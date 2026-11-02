import * as fs from "node:fs";
import { POSTS_TO_NETWORK, TOOL_NAME } from "./defaults.js";
import { toDisplayPath } from "./files.js";
import { hasBlockingIssue, refreshDraft } from "./issues.js";
import { parseMarkdown } from "./parse.js";
import { findDuplicates, textSimilarity } from "./similarity.js";
import type { Analysis, Draft, Summary } from "./types.js";

export interface AnalyzeOptions {
  limit: number;
  threshold: number;
  cwd?: string;
  /** When true, a section that contains fences uses only the text inside them as the post. */
  codeBlocksOnly?: boolean;
}

export function analyzeFiles(files: readonly string[], options: AnalyzeOptions): Analysis {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("--limit must be an integer of at least 1");
  }
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1) {
    throw new Error("--threshold must be a number from 0 to 1");
  }
  const cwd = options.cwd ?? process.cwd();
  const usedIds = new Set<string>();
  const drafts: Draft[] = [];
  for (const file of files) {
    const markdown = fs.readFileSync(file, "utf8");
    drafts.push(
      ...parseMarkdown({
        absolutePath: file,
        displayPath: toDisplayPath(file, cwd),
        markdown,
        limit: options.limit,
        usedIds,
        codeBlocksOnly: options.codeBlocksOnly,
      }),
    );
  }
  return analyzeDrafts(drafts, options.limit, options.threshold);
}

export function analyzeDrafts(drafts: Draft[], limit: number, threshold: number): Analysis {
  const found = findDuplicates(
    drafts.map((draft) => ({ id: draft.id, text: draft.text })),
    threshold,
  );
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  for (const group of found.groups) {
    const members = group.map((id) => {
      const draft = byId.get(id);
      if (!draft) throw new Error(`Internal error: missing draft ${id}`);
      return draft;
    });
    const keeper = members.find((draft) => !hasBlockingIssue(draft)) ?? members[0];
    if (!keeper) continue;
    for (const member of members) {
      if (member.id === keeper.id) continue;
      member.duplicateOf = keeper.id;
      member.similarity = textSimilarity(member.text, keeper.text);
    }
  }
  for (const draft of drafts) refreshDraft(draft);

  return {
    tool: TOOL_NAME,
    posted: POSTS_TO_NETWORK,
    network: POSTS_TO_NETWORK,
    limit,
    threshold,
    summary: summarize(drafts, found.pairs.length),
    drafts,
    duplicates: found.pairs,
    duplicateGroups: found.groups,
  };
}

function summarize(drafts: readonly Draft[], duplicatePairs: number): Summary {
  let invalid = 0;
  let overLimit = 0;
  let missingImages = 0;
  let remoteImages = 0;
  let nearDuplicateDrafts = 0;
  for (const draft of drafts) {
    if (!draft.valid) invalid += 1;
    if (draft.overLimit) overLimit += 1;
    if (draft.duplicateOf) nearDuplicateDrafts += 1;
    for (const image of draft.images) {
      if (image.remote) remoteImages += 1;
      else if (!image.exists) missingImages += 1;
    }
  }
  return {
    drafts: drafts.length,
    valid: drafts.length - invalid,
    invalid,
    overLimit,
    missingImages,
    remoteImages,
    nearDuplicateDrafts,
    duplicatePairs,
  };
}
