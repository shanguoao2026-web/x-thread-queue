import { POSTS_TO_NETWORK, TOOL_NAME } from "./defaults.js";
import type { Analysis, ScheduleEntry, ScheduleReport, SkippedDraft } from "./types.js";

export interface PlanConfig {
  perDay: number;
  minGapHours: number;
  start: Date;
  dayStartMinutes: number;
  dayEndMinutes: number;
  includeInvalid: boolean;
}

const DAY_MS = 86_400_000;

export function plan(analysis: Analysis, config: PlanConfig): ScheduleReport {
  validatePlanConfig(config);
  const chosen = analysis.drafts.filter((draft) => config.includeInvalid || draft.valid);
  const skipped: SkippedDraft[] = config.includeInvalid
    ? []
    : analysis.drafts
        .filter((draft) => !draft.valid)
        .map((draft) => ({
          draftId: draft.id,
          title: draft.title,
          file: draft.file,
          line: draft.line,
          weightedLength: draft.weightedLength,
          issues: draft.issues,
        }));
  const slots = buildSlots(chosen.length, config);
  const schedule: ScheduleEntry[] = chosen.map((draft, index) => {
    const at = slots[index];
    if (!at) {
      throw new Error("Internal error: a schedule slot is missing");
    }
    return {
      at: formatUtc(at),
      draftId: draft.id,
      title: draft.title,
      file: draft.file,
      line: draft.line,
      weightedLength: draft.weightedLength,
    };
  });

  const notes: string[] = [];
  const fit = maxPostsInWindow(config.dayStartMinutes, config.dayEndMinutes, config.minGapHours);
  if (config.perDay > fit) {
    const posts = fit === 1 ? "1 post fits" : `${fit} posts fit`;
    notes.push(
      `Only ${posts} in the ${formatClock(config.dayStartMinutes)}–${formatClock(config.dayEndMinutes)} UTC window with a ${config.minGapHours} hour gap. --per-day ${config.perDay} is higher, so later posts move to following days.`,
    );
  }
  if (config.includeInvalid) {
    notes.push("Invalid drafts are included because --include-invalid was set.");
  } else if (skipped.length > 0) {
    const label = skipped.length === 1 ? "draft was" : "drafts were";
    notes.push(
      `${skipped.length} ${label} skipped because of length, image, or duplicate issues.`,
    );
  }

  return {
    tool: TOOL_NAME,
    posted: POSTS_TO_NETWORK,
    network: POSTS_TO_NETWORK,
    limit: analysis.limit,
    threshold: analysis.threshold,
    summary: analysis.summary,
    options: {
      perDay: config.perDay,
      minGapHours: config.minGapHours,
      start: formatUtc(config.start),
      dayStart: formatClock(config.dayStartMinutes),
      dayEnd: formatClock(config.dayEndMinutes),
      includeInvalid: config.includeInvalid,
    },
    notes,
    schedule,
    skipped,
    duplicates: analysis.duplicates,
    duplicateGroups: analysis.duplicateGroups,
    drafts: analysis.drafts,
  };
}

export function buildSlots(count: number, config: PlanConfig): Date[] {
  validatePlanConfig(config);
  if (count === 0) return [];
  const gapMs = Math.round(config.minGapHours * 3_600_000);
  const slots: Date[] = [];
  let midnight = utcMidnight(config.start);
  const gapDays = Math.ceil(config.minGapHours / 24);
  const safety = count * (gapDays + 2) + 5;
  let days = 0;
  let last: Date | null = null;

  while (slots.length < count) {
    days += 1;
    if (days > safety) {
      throw new Error(
        "Could not fit the posts into the daily window. Widen --day-end or lower --min-gap-hours.",
      );
    }
    const open = addMs(midnight, config.dayStartMinutes * 60_000);
    const close = addMs(midnight, config.dayEndMinutes * 60_000);
    let cursor =
      open.getTime() < config.start.getTime() ? new Date(config.start.getTime()) : new Date(open.getTime());
    if (last && cursor.getTime() < last.getTime() + gapMs) {
      cursor = new Date(last.getTime() + gapMs);
    }

    let placedToday = 0;
    while (placedToday < config.perDay && slots.length < count) {
      if (cursor.getTime() > close.getTime()) break;
      if (!sameUtcDay(cursor, midnight)) break;
      slots.push(new Date(cursor.getTime()));
      last = new Date(cursor.getTime());
      placedToday += 1;
      if (slots.length >= count) break;
      cursor = new Date(cursor.getTime() + gapMs);
    }

    midnight = addMs(midnight, DAY_MS);
  }

  return slots;
}

export function maxPostsInWindow(
  dayStartMinutes: number,
  dayEndMinutes: number,
  minGapHours: number,
): number {
  if (minGapHours === 0) return Number.POSITIVE_INFINITY;
  const windowMin = dayEndMinutes - dayStartMinutes;
  const gapMin = minGapHours * 60;
  return Math.floor(windowMin / gapMin) + 1;
}

export function validatePlanConfig(config: PlanConfig): void {
  if (!Number.isInteger(config.perDay) || config.perDay < 1) {
    throw new Error("--per-day must be an integer of at least 1");
  }
  if (!Number.isFinite(config.minGapHours) || config.minGapHours < 0) {
    throw new Error("--min-gap-hours must be a number of at least 0");
  }
  if (
    !Number.isInteger(config.dayStartMinutes) ||
    config.dayStartMinutes < 0 ||
    config.dayStartMinutes >= 24 * 60
  ) {
    throw new Error("--day-start must be a valid HH:MM time");
  }
  if (
    !Number.isInteger(config.dayEndMinutes) ||
    config.dayEndMinutes < config.dayStartMinutes ||
    config.dayEndMinutes >= 24 * 60
  ) {
    throw new Error("--day-end must be a valid HH:MM time at or after --day-start");
  }
  if (Number.isNaN(config.start.getTime())) {
    throw new Error("Invalid --start value");
  }
}

export function parseStart(input: string): Date {
  if (/(?:z|Z|[+-]\d{2}:\d{2})$/.test(input)) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid --start value: ${input}`);
    }
    return date;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(input);
  if (!match) {
    throw new Error(
      `Invalid --start value: ${input}. Use YYYY-MM-DDTHH:MM:SS (UTC) or an ISO time with a zone.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid --start value: ${input}`);
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new Error(`Invalid --start value: ${input}`);
  }
  return date;
}

export function parseClock(input: string, flag: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input);
  if (!match) {
    throw new Error(`Invalid ${flag} value: ${input}. Use HH:MM.`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid ${flag} value: ${input}. Use HH:MM.`);
  }
  return hour * 60 + minute;
}

export function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function defaultStart(now: Date, dayStartMinutes: number): Date {
  const midnight = utcMidnight(now);
  const todayOpen = addMs(midnight, dayStartMinutes * 60_000);
  if (now.getTime() <= todayOpen.getTime()) return todayOpen;
  return addMs(todayOpen, DAY_MS);
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function sameUtcDay(date: Date, midnight: Date): boolean {
  return (
    date.getUTCFullYear() === midnight.getUTCFullYear() &&
    date.getUTCMonth() === midnight.getUTCMonth() &&
    date.getUTCDate() === midnight.getUTCDate()
  );
}
