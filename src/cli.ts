#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeFiles } from "./analyze.js";
import {
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  DEFAULT_LIMIT,
  DEFAULT_MIN_GAP_HOURS,
  DEFAULT_PER_DAY,
  DEFAULT_THRESHOLD,
  TOOL_NAME,
} from "./defaults.js";
import { collectMarkdownFiles } from "./files.js";
import { formatCheck, formatSchedule, toJson } from "./format.js";
import {
  defaultStart,
  formatUtc,
  parseClock,
  parseStart,
  plan,
  type PlanConfig,
} from "./schedule.js";

const BOOLEAN_FLAGS = new Set([
  "json",
  "strict",
  "include-invalid",
  "code-blocks-only",
  "help",
  "version",
]);
const VALUE_FLAGS = new Set([
  "per-day",
  "min-gap-hours",
  "start",
  "day-start",
  "day-end",
  "threshold",
  "limit",
  "out",
  "markdown",
]);
const SCHEDULE_ONLY = [
  "per-day",
  "min-gap-hours",
  "start",
  "day-start",
  "day-end",
  "include-invalid",
];

interface Argv {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

export function main(argv: string[]): number {
  try {
    return dispatch(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${TOOL_NAME}: ${message}\n`);
    return 2;
  }
}

function dispatch(argv: string[]): number {
  const parsed = parseArgv(argv);
  if (flagOn(parsed.flags, "help") || parsed.positionals[0] === "help") {
    process.stdout.write(helpText());
    return 0;
  }
  if (flagOn(parsed.flags, "version")) {
    process.stdout.write(`${packageVersion()}\n`);
    return 0;
  }

  const command = parsed.positionals[0];
  if (!command) {
    process.stderr.write(helpText());
    return 2;
  }
  if (command !== "check" && command !== "schedule") {
    throw new Error(`Unknown command "${command}". See --help.`);
  }
  if (command === "check") {
    for (const name of SCHEDULE_ONLY) {
      if (parsed.flags.has(name)) {
        throw new Error(`--${name} is only valid with schedule`);
      }
    }
  }

  const inputs = parsed.positionals.slice(1);
  const files = collectMarkdownFiles(inputs);
  const limit = readInt(parsed.flags, "limit", DEFAULT_LIMIT);
  const threshold = readNumber(parsed.flags, "threshold", DEFAULT_THRESHOLD);
  const analysis = analyzeFiles(files, {
    limit,
    threshold,
    codeBlocksOnly: flagOn(parsed.flags, "code-blocks-only"),
  });

  if (command === "check") {
    writeReport(parsed.flags, toJson(analysis), formatCheck(analysis));
    process.stderr.write(`${analysis.summary.drafts} draft(s), ${analysis.summary.invalid} with issues.\n`);
    if (analysis.drafts.length === 0) return 1;
    return analysis.summary.invalid === 0 ? 0 : 1;
  }

  if (analysis.drafts.length === 0) {
    process.stderr.write("No drafts found.\n");
    return 1;
  }

  const config = planConfig(parsed.flags);
  const report = plan(analysis, config);
  writeReport(parsed.flags, toJson(report), formatSchedule(report));
  process.stderr.write(`Scheduled ${report.schedule.length}, skipped ${report.skipped.length}.\n`);
  if (report.schedule.length === 0) return 1;
  if (flagOn(parsed.flags, "strict") && report.skipped.length > 0) return 1;
  return 0;
}

function planConfig(flags: Map<string, string | boolean>): PlanConfig {
  const perDay = readInt(flags, "per-day", DEFAULT_PER_DAY);
  const minGapHours = readNumber(flags, "min-gap-hours", DEFAULT_MIN_GAP_HOURS);
  const dayStart = flagString(flags, "day-start") ?? DEFAULT_DAY_START;
  const dayEnd = flagString(flags, "day-end") ?? DEFAULT_DAY_END;
  const dayStartMinutes = parseClock(dayStart, "--day-start");
  const dayEndMinutes = parseClock(dayEnd, "--day-end");
  const startRaw = flagString(flags, "start");
  const start = startRaw ? parseStart(startRaw) : defaultStart(new Date(), dayStartMinutes);
  return {
    perDay,
    minGapHours,
    start,
    dayStartMinutes,
    dayEndMinutes,
    includeInvalid: flagOn(flags, "include-invalid"),
  };
}

function writeReport(
  flags: Map<string, string | boolean>,
  json: string,
  markdown: string,
): void {
  const out = flagString(flags, "out");
  const markdownPath = flagString(flags, "markdown");
  if (out) writeFile(out, json);
  if (markdownPath) writeFile(markdownPath, markdown);
  if (flagOn(flags, "json")) {
    process.stdout.write(json);
    return;
  }
  if (out && markdownPath) {
    process.stdout.write(`Wrote ${out} and ${markdownPath}.\n`);
    return;
  }
  process.stdout.write(markdown);
}

function writeFile(file: string, contents: string): void {
  const absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf8");
}

function parseArgv(argv: string[]): Argv {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    if (body.length === 0) {
      throw new Error("Unknown option --");
    }
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    const inline = eq === -1 ? undefined : body.slice(eq + 1);
    if (!BOOLEAN_FLAGS.has(name) && !VALUE_FLAGS.has(name)) {
      throw new Error(`Unknown option --${name}`);
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (inline === undefined || inline === "true") flags.set(name, true);
      else if (inline === "false") flags.set(name, false);
      else throw new Error(`--${name} does not take a value`);
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for --${name}`);
      }
      value = next;
      i += 1;
    }
    flags.set(name, value);
  }
  return { positionals, flags };
}

function flagOn(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true;
}

function flagString(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Missing value for --${name}`);
  return value;
}

function readInt(flags: Map<string, string | boolean>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) {
    throw new Error(`--${name} must be an integer`);
  }
  return Number(raw);
}

function readNumber(flags: Map<string, string | boolean>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") throw new Error(`Missing value for --${name}`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

function packageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, "../../package.json");
  const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof (parsed as { version: unknown }).version !== "string"
  ) {
    throw new Error("Cannot read package version");
  }
  return (parsed as { version: string }).version;
}

function helpText(): string {
  return `${TOOL_NAME} — offline checker and scheduler for X post drafts

Usage:
  ${TOOL_NAME} check <file-or-dir>... [options]
  ${TOOL_NAME} schedule <file-or-dir>... [options]

check validates weighted length, local images, and near-duplicates.
schedule does that and writes a posting plan. Nothing is posted.
This program does not call the network.

Schedule options:
  --per-day <n>          Maximum posts per UTC day (default ${DEFAULT_PER_DAY})
  --min-gap-hours <n>    Minimum hours between posts (default ${DEFAULT_MIN_GAP_HOURS})
  --start <iso>          Earliest slot. Naive times are UTC.
                         Default: the next ${DEFAULT_DAY_START} UTC that is not already past
  --day-start <HH:MM>    First minute of the daily window (default ${DEFAULT_DAY_START})
  --day-end <HH:MM>      Last minute of the daily window, inclusive (default ${DEFAULT_DAY_END})
  --include-invalid      Also schedule drafts that have issues

Shared options:
  --limit <n>            Weighted character limit (default ${DEFAULT_LIMIT})
  --threshold <0-1>      Near-duplicate Jaccard threshold (default ${DEFAULT_THRESHOLD})
  --code-blocks-only     If a post has fenced code, weigh only the text inside it
  --json                 Print JSON on stdout
  --out <file>           Write JSON to a file
  --markdown <file>      Write Markdown to a file
  --strict               On schedule, exit 1 when any draft is skipped
  --help                 Show this help
  --version              Show the version

Exit codes:
  0  check found no issues, or schedule wrote a plan
  1  check found issues, nothing was queued, or --strict skipped drafts
  2  bad arguments or unreadable input

Example:
  ${TOOL_NAME} schedule fixtures/drafts --per-day 3 --min-gap-hours 4 --start ${formatUtc(parseStart("2026-11-03T09:00:00")).slice(0, 19)} --out schedule.json --markdown schedule.md
`;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  }
}

if (isMainModule()) {
  process.exit(main(process.argv.slice(2)));
}
