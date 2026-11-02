import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { analyzeDrafts, analyzeFiles } from "../src/analyze.js";
import { codePointWeight, measureText } from "../src/count.js";
import { collectMarkdownFiles } from "../src/files.js";
import { formatSchedule } from "../src/format.js";
import { parseMarkdown } from "../src/parse.js";
import { parseStart, plan } from "../src/schedule.js";

const FIXTURES = ["fixtures/drafts"];

function loadFixtures() {
  return analyzeFiles(collectMarkdownFiles(FIXTURES), { limit: 280, threshold: 0.8 });
}

test("sample fixtures separate fictional drafts and skip the document title", () => {
  const analysis = loadFixtures();
  const titles = analysis.drafts.map((draft) => draft.title);
  assert.equal(titles.includes("Harbor Notes"), false);
  assert.equal(titles.includes("Workshop Notes"), false);
  assert.equal(analysis.drafts.length, 12);
  assert.equal(analysis.posted, false);
  assert.equal(analysis.network, false);
  assert.deepEqual(analysis.summary, {
    drafts: 12,
    valid: 8,
    invalid: 4,
    overLimit: 1,
    missingImages: 1,
    remoteImages: 1,
    nearDuplicateDrafts: 1,
    duplicatePairs: 1,
  });
  assert.deepEqual(analysis.duplicateGroups, [
    ["harbor--lanterns-on-the-quay", "harbor--lanterns-again"],
  ]);
});

test("fixture issues cover length, images, URLs, emoji, and the near-copy", () => {
  const analysis = loadFixtures();
  const byId = new Map(analysis.drafts.map((draft) => [draft.id, draft]));

  const lanterns = byId.get("harbor--lanterns-on-the-quay");
  const again = byId.get("harbor--lanterns-again");
  assert.equal(lanterns?.valid, true);
  assert.equal(again?.duplicateOf, "harbor--lanterns-on-the-quay");
  assert.ok((again?.similarity ?? 0) >= 0.8);
  assert.equal(again?.issues.some((issue) => issue.code === "near_duplicate"), true);

  const ferry = byId.get("harbor--ferry-timetable");
  const url = "https://example.com/ferry/dusk-crossing";
  assert.ok(ferry);
  assert.deepEqual(ferry.urls, [url]);
  assert.equal(ferry.weightedLength, ferry.text.length - url.length + 23);
  assert.equal(ferry.valid, true);

  const bakery = byId.get("harbor--bakery-window");
  assert.equal(bakery?.images[0]?.exists, true);
  assert.equal(bakery?.images[0]?.resolvedPath, "fixtures/images/rye-loaves.png");
  assert.equal(bakery?.text.includes("rye-loaves"), false);
  assert.equal(bakery?.valid, true);

  const fog = byId.get("harbor--fog-on-the-breakwater");
  assert.equal(fog?.text.length, 291);
  assert.equal(fog?.weightedLength, 291);
  assert.equal(fog?.overLimit, true);

  const cat = byId.get("harbor--shop-cat");
  assert.equal(cat?.images[0]?.exists, false);
  assert.equal(cat?.issues.some((issue) => issue.code === "missing_image"), true);

  const quiet = byId.get("harbor--quiet-harbor");
  assert.ok(quiet && quiet.text.length > 0);
  for (const ch of quiet.text) {
    const codePoint = ch.codePointAt(0);
    assert.ok(codePoint !== undefined);
    assert.equal(codePointWeight(codePoint), 2);
  }
  assert.equal(quiet.weightedLength, [...quiet.text].length * 2);

  const kettle = byId.get("harbor--kettle");
  assert.ok(kettle);
  assert.match(kettle.text, /\u2615\uFE0F/u);
  const stripped = kettle.text.replace("\u2615\uFE0F", "");
  assert.equal(kettle.weightedLength, measureText(stripped).weightedLength + 2);
  assert.equal(kettle.valid, true);

  const postcard = byId.get("harbor--postcard");
  assert.equal(postcard?.images[0]?.remote, true);
  assert.equal(postcard?.text.includes("example.com"), false);
  assert.deepEqual(postcard?.urls, []);

  const alley = byId.get("workshop--alley-window");
  assert.equal(alley?.images[0]?.resolvedPath, "fixtures/images/alley-window.png");
  assert.equal(alley?.valid, true);
});

test("the keeper is the earliest postable copy, not a broken earlier copy", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-test-"));
  try {
    const file = path.join(dir, "copies.md");
    const text = "The lanterns along Pier Street come on before the tide turns.";
    fs.writeFileSync(
      file,
      ["## First", "", "![missing](nope.png)", "", text, "", "## Second", "", text, ""].join("\n"),
    );
    const drafts = parseMarkdown({
      absolutePath: file,
      displayPath: "copies.md",
      markdown: fs.readFileSync(file, "utf8"),
      limit: 280,
      usedIds: new Set(),
    });
    const analysis = analyzeDrafts(drafts, 280, 0.8);
    const first = analysis.drafts[0];
    const second = analysis.drafts[1];
    assert.equal(second?.valid, true);
    assert.equal(second?.duplicateOf, null);
    assert.equal(first?.duplicateOf, second?.id);
    assert.equal(first?.issues.some((issue) => issue.code === "missing_image"), true);
    assert.equal(first?.issues.some((issue) => issue.code === "near_duplicate"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("schedule skips invalid fixture drafts and emits Markdown", () => {
  const analysis = loadFixtures();
  const report = plan(analysis, {
    perDay: 3,
    minGapHours: 4,
    start: parseStart("2026-11-03T09:00:00"),
    dayStartMinutes: 9 * 60,
    dayEndMinutes: 21 * 60,
    includeInvalid: false,
  });
  assert.deepEqual(
    report.schedule.map((entry) => [entry.at, entry.draftId]),
    [
      ["2026-11-03T09:00:00Z", "harbor--lanterns-on-the-quay"],
      ["2026-11-03T13:00:00Z", "harbor--ferry-timetable"],
      ["2026-11-03T17:00:00Z", "harbor--bakery-window"],
      ["2026-11-04T09:00:00Z", "harbor--quiet-harbor"],
      ["2026-11-04T13:00:00Z", "harbor--kettle"],
      ["2026-11-04T17:00:00Z", "workshop--pencil-tray"],
      ["2026-11-05T09:00:00Z", "workshop--alley-window"],
      ["2026-11-05T13:00:00Z", "workshop--night-kiln"],
    ],
  );
  assert.deepEqual(
    report.skipped.map((entry) => entry.draftId),
    [
      "harbor--lanterns-again",
      "harbor--fog-on-the-breakwater",
      "harbor--shop-cat",
      "harbor--postcard",
    ],
  );
  assert.match(report.notes.join("\n"), /4 drafts were skipped/);

  const crowded = plan(analysis, {
    perDay: 5,
    minGapHours: 4,
    start: parseStart("2026-11-03T09:00:00"),
    dayStartMinutes: 9 * 60,
    dayEndMinutes: 21 * 60,
    includeInvalid: true,
  });
  assert.equal(crowded.schedule.length, 12);
  assert.equal(crowded.skipped.length, 0);
  assert.match(crowded.notes.join("\n"), /Only 4 posts fit/);
  assert.match(crowded.notes.join("\n"), /--include-invalid/);

  const markdown = formatSchedule(report);
  assert.match(markdown, /does not post/);
  assert.match(markdown, /2026-11-03 09:00 UTC/);
  assert.match(markdown, /harbor--lanterns-again/);
  assert.match(markdown, /## Queue/);
});

test("code-blocks-only does not change drafts that have no fences", () => {
  const files = collectMarkdownFiles(FIXTURES);
  const plain = analyzeFiles(files, { limit: 280, threshold: 0.8 });
  const fenced = analyzeFiles(files, { limit: 280, threshold: 0.8, codeBlocksOnly: true });
  assert.deepEqual(fenced, plain);
});
