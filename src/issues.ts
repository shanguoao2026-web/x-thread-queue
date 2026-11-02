import type { Draft, Issue } from "./types.js";

export function issuesFor(
  draft: Pick<
    Draft,
    "overLimit" | "weightedLength" | "limit" | "images" | "duplicateOf" | "similarity"
  >,
): Issue[] {
  const issues: Issue[] = [];
  if (draft.overLimit) {
    issues.push({
      code: "over_limit",
      message: `Weighted length ${draft.weightedLength} exceeds the limit of ${draft.limit}`,
    });
  }
  for (const image of draft.images) {
    if (image.remote) {
      issues.push({
        code: "remote_image",
        message: `Remote image is not fetched: ${image.source}`,
      });
    } else if (!image.exists) {
      issues.push({
        code: "missing_image",
        message: `Missing image file: ${image.source}`,
      });
    }
  }
  if (draft.duplicateOf) {
    const score =
      draft.similarity === null ? "" : ` (similarity ${draft.similarity.toFixed(4)})`;
    issues.push({
      code: "near_duplicate",
      message: `Near-duplicate of ${draft.duplicateOf}${score}`,
    });
  }
  return issues;
}

export function hasBlockingIssue(draft: Draft): boolean {
  if (draft.overLimit) return true;
  return draft.images.some((image) => image.remote || !image.exists);
}

export function refreshDraft(draft: Draft): void {
  draft.issues = issuesFor(draft);
  draft.valid = draft.issues.length === 0;
}
