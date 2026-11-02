export interface ImageRef {
  alt: string;
  source: string;
  resolvedPath: string | null;
  exists: boolean;
  remote: boolean;
  line: number;
}

export type IssueCode = "over_limit" | "missing_image" | "remote_image" | "near_duplicate";

export interface Issue {
  code: IssueCode;
  message: string;
  /** 1-based tweet number when this issue is about one tweet in a thread. */
  tweet?: number;
}

/** One tweet inside a thread draft. Absent on a single post. */
export interface TweetPart {
  /** 1-based position. An `n/N` or short `n/` marker uses `n`; a `---` thread numbers in order. */
  index: number;
  text: string;
  weightedLength: number;
  overLimit: boolean;
}

export interface Draft {
  id: string;
  title: string;
  file: string;
  line: number;
  text: string;
  /**
   * Weight of `text` for a single post.
   * For a thread, the longest tweet. That is the length compared with `limit`.
   */
  weightedLength: number;
  limit: number;
  overLimit: boolean;
  /** Set for a thread. Each tweet is weighed on its own. Omitted for a single post. */
  tweets?: TweetPart[];
  urls: string[];
  images: ImageRef[];
  duplicateOf: string | null;
  similarity: number | null;
  issues: Issue[];
  valid: boolean;
}

export interface DuplicatePair {
  a: string;
  b: string;
  similarity: number;
}

export interface Summary {
  drafts: number;
  valid: number;
  invalid: number;
  overLimit: number;
  missingImages: number;
  remoteImages: number;
  nearDuplicateDrafts: number;
  duplicatePairs: number;
}

export interface Analysis {
  tool: "x-thread-queue";
  posted: false;
  network: false;
  limit: number;
  threshold: number;
  summary: Summary;
  drafts: Draft[];
  duplicates: DuplicatePair[];
  duplicateGroups: string[][];
}

export interface ScheduleEntry {
  at: string;
  draftId: string;
  title: string;
  file: string;
  line: number;
  weightedLength: number;
}

export interface SkippedDraft {
  draftId: string;
  title: string;
  file: string;
  line: number;
  weightedLength: number;
  issues: Issue[];
}

export interface ScheduleOptions {
  perDay: number;
  minGapHours: number;
  start: string;
  dayStart: string;
  dayEnd: string;
  includeInvalid: boolean;
}

export interface ScheduleReport extends Analysis {
  options: ScheduleOptions;
  notes: string[];
  schedule: ScheduleEntry[];
  skipped: SkippedDraft[];
}
