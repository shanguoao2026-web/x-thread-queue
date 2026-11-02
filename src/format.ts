import type { Analysis, Draft, ScheduleReport } from "./types.js";

export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function formatCheck(analysis: Analysis): string {
  const lines: string[] = [];
  lines.push(
    `x-thread-queue check — ${analysis.summary.drafts} draft(s), ${analysis.summary.invalid} with issues`,
  );
  lines.push("Offline plan only. Nothing is posted and the network is not used.");
  lines.push("");
  if (analysis.drafts.length === 0) {
    lines.push("No drafts found.");
    lines.push("");
    return lines.join("\n");
  }
  for (const draft of analysis.drafts) {
    lines.push(draftHeading(draft));
    lines.push(`  ${draft.file}:${draft.line}`);
    for (const issue of draft.issues) {
      lines.push(`  - ${issue.code}: ${issue.message}`);
    }
    if (draft.images.length > 0) {
      for (const image of draft.images) {
        const state = image.remote ? "remote" : image.exists ? "ok" : "missing";
        lines.push(`  - image (${state}): ${image.source}`);
      }
    }
  }
  if (analysis.duplicates.length > 0) {
    lines.push("");
    lines.push("Near-duplicates:");
    for (const pair of analysis.duplicates) {
      lines.push(`- ${pair.b} ~ ${pair.a} (${pair.similarity.toFixed(4)})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function formatSchedule(report: ScheduleReport): string {
  const lines: string[] = [];
  lines.push("# Posting schedule");
  lines.push("");
  lines.push("Offline plan only. x-thread-queue does not post and does not contact the network.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Drafts: ${report.summary.drafts}`);
  lines.push(`- Valid: ${report.summary.valid}`);
  lines.push(`- Scheduled: ${report.schedule.length}`);
  lines.push(`- Skipped: ${report.skipped.length}`);
  lines.push(`- Per day: ${report.options.perDay}`);
  lines.push(`- Minimum gap: ${report.options.minGapHours} hours`);
  lines.push(`- Window (UTC): ${report.options.dayStart}–${report.options.dayEnd}`);
  lines.push(`- Earliest start (UTC): ${report.options.start}`);
  lines.push(`- Character limit: ${report.limit}`);
  lines.push(`- Near-duplicate threshold: ${report.threshold}`);
  lines.push("");

  lines.push("## Queue");
  lines.push("");
  if (report.schedule.length === 0) {
    lines.push("No posts were scheduled.");
    lines.push("");
  } else {
    lines.push("| # | When (UTC) | Chars | Title | Draft | File |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    report.schedule.forEach((entry, index) => {
      lines.push(
        `| ${index + 1} | ${humanUtc(entry.at)} | ${entry.weightedLength}/${report.limit} | ${cell(entry.title)} | ${cell(entry.draftId)} | ${cell(`${entry.file}:${entry.line}`)} |`,
      );
    });
    lines.push("");
    lines.push("## Slots");
    lines.push("");
    const byId = new Map(report.drafts.map((draft) => [draft.id, draft]));
    report.schedule.forEach((entry, index) => {
      lines.push(`### ${index + 1}. ${humanUtc(entry.at)} — ${entry.title}`);
      lines.push("");
      lines.push(`- Draft: \`${entry.draftId}\``);
      lines.push(`- File: ${entry.file}:${entry.line}`);
      lines.push(`- Weighted length: ${entry.weightedLength}/${report.limit}`);
      const draft = byId.get(entry.draftId);
      if (draft && draft.images.length > 0) {
        for (const image of draft.images) {
          lines.push(`- Image: ${image.source}`);
        }
      }
      lines.push("");
      lines.push(blockquote(draft?.text ?? ""));
      lines.push("");
    });
  }

  lines.push("## Skipped");
  lines.push("");
  if (report.skipped.length === 0) {
    lines.push("Nothing was skipped.");
    lines.push("");
  } else {
    for (const entry of report.skipped) {
      lines.push(`### ${entry.title}`);
      lines.push("");
      lines.push(`- Draft: \`${entry.draftId}\``);
      lines.push(`- File: ${entry.file}:${entry.line}`);
      lines.push(`- Weighted length: ${entry.weightedLength}/${report.limit}`);
      for (const issue of entry.issues) {
        lines.push(`- ${issue.code}: ${issue.message}`);
      }
      lines.push("");
    }
  }

  lines.push("## Near-duplicates");
  lines.push("");
  if (report.duplicates.length === 0) {
    lines.push("No near-duplicates.");
    lines.push("");
  } else {
    lines.push("| Draft | Matches | Similarity |");
    lines.push("| --- | --- | --- |");
    for (const pair of report.duplicates) {
      lines.push(`| ${cell(pair.b)} | ${cell(pair.a)} | ${pair.similarity.toFixed(4)} |`);
    }
    lines.push("");
  }

  if (report.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function draftHeading(draft: Draft): string {
  const mark = draft.valid ? "OK   " : "ISSUE";
  return `${mark}  ${draft.weightedLength}/${draft.limit}  ${draft.id}  ${draft.title}`;
}

function humanUtc(iso: string): string {
  const date = new Date(iso);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function blockquote(text: string): string {
  if (text.length === 0) return "> _(empty)_";
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}
