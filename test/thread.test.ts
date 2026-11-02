import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { analyzeFiles } from "../src/analyze.js";
import { measureText } from "../src/count.js";
import { collectMarkdownFiles } from "../src/files.js";
import { formatCheck, formatSchedule } from "../src/format.js";
import { parseMarkdown } from "../src/parse.js";
import { parseStart, plan } from "../src/schedule.js";

function parse(markdown: string, limit = 280, codeBlocksOnly = false) {
  return parseMarkdown({
    absolutePath: path.join(process.cwd(), "notes.md"),
    displayPath: "notes.md",
    markdown,
    limit,
    usedIds: new Set(),
    codeBlocksOnly,
  });
}

function readFixture(name: string) {
  const file = path.join(process.cwd(), "fixtures/threads", name);
  return parseMarkdown({
    absolutePath: file,
    displayPath: `fixtures/threads/${name}`,
    markdown: fs.readFileSync(file, "utf8"),
    limit: 280,
    usedIds: new Set(),
  });
}

test("five short tweets stay valid when the total is over the limit", () => {
  const drafts = readFixture("five-short.md");
  assert.equal(drafts.length, 1);
  const draft = drafts[0];
  assert.ok(draft);
  assert.equal(draft.title, "Thread: five short notes");
  assert.equal(draft.tweets?.length, 5);
  assert.deepEqual(
    draft.tweets?.map((tweet) => tweet.index),
    [1, 2, 3, 4, 5],
  );
  const tweets = draft.tweets ?? [];
  const total = tweets.reduce((sum, tweet) => sum + tweet.weightedLength, 0);
  assert.ok(total > 280);
  assert.ok(measureText(draft.text).weightedLength > 280);
  for (const tweet of tweets) {
    assert.ok(tweet.weightedLength > 0);
    assert.ok(tweet.weightedLength <= 280);
    assert.equal(tweet.overLimit, false);
    assert.equal(/^\d+\s*\//u.test(tweet.text), false);
  }
  assert.equal(draft.text.includes("1/5"), false);
  assert.equal(draft.weightedLength, Math.max(...tweets.map((tweet) => tweet.weightedLength)));
  assert.ok(draft.weightedLength <= 280);
  assert.equal(draft.overLimit, false);
  assert.equal(draft.valid, true);
  assert.deepEqual(draft.issues, []);

  const report = formatCheck(
    analyzeFiles(collectMarkdownFiles(["fixtures/threads/five-short.md"]), {
      limit: 280,
      threshold: 0.8,
    }),
  );
  assert.match(report, /tweet 1: /);
  assert.match(report, /tweet 5: /);
  assert.equal(report.includes("over_limit"), false);
});

test("tweet 3 over the limit is named and the outside note is not a tweet", () => {
  const file = path.join(process.cwd(), "fixtures/threads/third-over.md");
  const markdown = fs.readFileSync(file, "utf8");
  const note = markdown.split("\n").find((line) => line.startsWith("中文："));
  assert.ok(note);
  assert.ok(measureText(note).weightedLength > 280);

  const plain = readFixture("third-over.md");
  const fenced = parseMarkdown({
    absolutePath: file,
    displayPath: "fixtures/threads/third-over.md",
    markdown,
    limit: 280,
    usedIds: new Set(),
    codeBlocksOnly: true,
  });
  assert.equal(plain.length, 1);
  assert.equal(fenced.length, 1);
  const draft = plain[0];
  assert.ok(draft);
  assert.deepEqual(fenced[0]?.tweets, draft.tweets);
  assert.equal(fenced[0]?.text, draft.text);
  assert.equal(fenced[0]?.overLimit, draft.overLimit);

  assert.equal(draft.tweets?.length, 5);
  assert.equal(draft.tweets?.[0]?.text, "First batch comes out pale and cool enough to hold.");
  assert.equal(draft.tweets?.[1]?.text, "Second batch keeps a darker rim along the foot.");
  assert.equal(draft.tweets?.[2]?.text, "a".repeat(281));
  assert.equal(draft.tweets?.[2]?.index, 3);
  assert.equal(draft.tweets?.[2]?.weightedLength, 281);
  assert.equal(draft.tweets?.[2]?.overLimit, true);
  assert.equal(draft.tweets?.[3]?.text, "Fourth batch sits under a cloth until the room cools.");
  assert.equal(draft.tweets?.[4]?.text, "Fifth batch is stacked by the door for the evening count.");
  for (const tweet of draft.tweets ?? []) {
    if (tweet.index === 3) continue;
    assert.equal(tweet.overLimit, false);
    assert.ok(tweet.weightedLength <= 280);
  }
  assert.equal(draft.text.includes("中文"), false);
  assert.equal(draft.text.includes("```"), false);
  assert.equal(draft.text.includes("---"), false);
  assert.equal(draft.weightedLength, 281);
  assert.equal(draft.overLimit, true);
  assert.equal(draft.valid, false);
  assert.deepEqual(draft.issues, [
    {
      code: "over_limit",
      message: "Tweet 3 weighted length 281 exceeds the limit of 280",
      tweet: 3,
    },
  ]);
});

test("numbered markers name tweet 3 when only that tweet is over", () => {
  const long = "你".repeat(141);
  assert.equal(measureText(long).weightedLength, 282);
  assert.ok(long.length < 280);
  const markdown = [
    "## Market notes",
    "",
    "1/5",
    "one",
    "",
    "2/5",
    "two",
    "",
    "3/5",
    long,
    "",
    "4/5",
    "four",
    "",
    "5/5",
    "five",
    "",
  ].join("\n");
  const drafts = parse(markdown);
  assert.equal(drafts.length, 1);
  const draft = drafts[0];
  assert.ok(draft?.tweets);
  assert.equal(draft.tweets[2]?.weightedLength, 282);
  assert.equal(draft.tweets[2]?.overLimit, true);
  assert.equal(draft.overLimit, true);
  assert.equal(draft.weightedLength, 282);
  const total = draft.tweets.reduce((sum, tweet) => sum + tweet.weightedLength, 0);
  assert.ok(total > 280);
  assert.deepEqual(
    draft.issues.map((issue) => issue.message),
    ["Tweet 3 weighted length 282 exceeds the limit of 280"],
  );
  assert.equal(draft.issues[0]?.tweet, 3);
  assert.equal(
    draft.issues.some((issue) => issue.message.startsWith("Weighted length ")),
    false,
  );
});

test("a same-line 1/n run splits without a thread heading", () => {
  const markdown = ["## Dispatch", "", "1/3 Alpha line", "2/3 Beta line", "3/3 Gamma line", ""].join("\n");
  const drafts = parse(markdown);
  assert.equal(drafts[0]?.tweets?.length, 3);
  assert.deepEqual(
    drafts[0]?.tweets?.map((tweet) => tweet.text),
    ["Alpha line", "Beta line", "Gamma line"],
  );
  assert.equal(drafts[0]?.overLimit, false);
  assert.equal(drafts[0]?.valid, true);
});

test("a thread heading splits on a prose rule and a partial marker run does not", () => {
  const dashed = [
    "## THREADS from the bench",
    "",
    "a".repeat(200),
    "",
    "---",
    "",
    "b".repeat(200),
    "",
  ].join("\n");
  const thread = parse(dashed);
  assert.equal(thread[0]?.tweets?.length, 2);
  assert.equal(thread[0]?.tweets?.[0]?.weightedLength, 200);
  assert.equal(thread[0]?.tweets?.[1]?.weightedLength, 200);
  assert.equal(thread[0]?.overLimit, false);
  assert.ok(measureText(thread[0]?.text ?? "").weightedLength > 280);

  const partial = ["## Notes", "", "1/5", "c".repeat(200), "", "2/5", "d".repeat(200), ""].join("\n");
  const single = parse(partial);
  assert.equal(single[0]?.tweets, undefined);
  assert.equal(single[0]?.overLimit, true);
  assert.match(single[0]?.issues[0]?.message ?? "", /^Weighted length /);

  const proseRule = ["## Notes", "", "e".repeat(200), "", "---", "", "f".repeat(200), ""].join("\n");
  const kept = parse(proseRule);
  assert.equal(kept[0]?.tweets, undefined);
  assert.equal(kept[0]?.overLimit, true);

  const threaded = ["## Threaded needle", "", "g".repeat(200), "", "---", "", "h".repeat(200), ""].join(
    "\n",
  );
  const word = parse(threaded);
  assert.equal(word[0]?.tweets, undefined);
  assert.equal(word[0]?.overLimit, true);
});

test("notes before 1/N are not a tweet and an exact 280 tweet is valid", () => {
  const preamble = "i".repeat(300);
  const markdown = [
    "## Thread: quay",
    "",
    preamble,
    "",
    "1/2",
    "j".repeat(280),
    "",
    "2/2",
    "short",
    "",
  ].join("\n");
  const drafts = parse(markdown);
  const draft = drafts[0];
  assert.ok(draft?.tweets);
  assert.equal(draft.tweets.length, 2);
  assert.equal(draft.tweets[0]?.weightedLength, 280);
  assert.equal(draft.tweets[0]?.overLimit, false);
  assert.equal(draft.tweets[1]?.text, "short");
  assert.equal(draft.text.includes(preamble), false);
  assert.equal(draft.overLimit, false);
  assert.equal(draft.valid, true);
  assert.ok(measureText(`${preamble}\n\n${draft.text}`).weightedLength > 280);
});

test("a long URL is weighed inside its own tweet", () => {
  const url = `https://example.com/${"p".repeat(300)}`;
  const markdown = ["## Thread", "", "1/2", `See ${url}`, "", "2/2", "Hi", ""].join("\n");
  const drafts = parse(markdown);
  const draft = drafts[0];
  assert.ok(draft?.tweets);
  assert.equal(draft.tweets[0]?.weightedLength, 4 + 23);
  assert.equal(draft.tweets[1]?.weightedLength, 2);
  assert.deepEqual(draft.urls, [url]);
  assert.equal(draft.overLimit, false);
  assert.ok(url.length > 280);
});

test("every tweet that is over the limit is reported with that limit", () => {
  const markdown = [
    "## Thread",
    "",
    "1/3",
    "a".repeat(11),
    "",
    "2/3",
    "ok",
    "",
    "3/3",
    "b".repeat(12),
    "",
  ].join("\n");
  const drafts = parse(markdown, 10);
  const draft = drafts[0];
  assert.ok(draft);
  assert.equal(draft.limit, 10);
  assert.deepEqual(
    draft.issues.map((issue) => [issue.tweet, issue.message]),
    [
      [1, "Tweet 1 weighted length 11 exceeds the limit of 10"],
      [3, "Tweet 3 weighted length 12 exceeds the limit of 10"],
    ],
  );
  assert.equal(draft.weightedLength, 12);
  assert.equal(draft.tweets?.[1]?.overLimit, false);
});

test("CRLF markers still split and a single post is unchanged", () => {
  const thread = ["## Count thread", "", "1/2", "Alpha", "", "2/2", "Beta"].join("\r\n");
  const drafts = parse(thread);
  assert.deepEqual(
    drafts[0]?.tweets?.map((tweet) => tweet.text),
    ["Alpha", "Beta"],
  );

  const single = parse(["## Fog", "", "d".repeat(281), ""].join("\n"));
  assert.equal(single[0]?.tweets, undefined);
  assert.equal(single[0]?.weightedLength, 281);
  assert.equal(single[0]?.overLimit, true);
  assert.equal(single[0]?.issues[0]?.message, "Weighted length 281 exceeds the limit of 280");
  assert.equal(single[0]?.issues[0]?.tweet, undefined);

  const unfenced = readFixture("five-short.md");
  const flagged = parseMarkdown({
    absolutePath: path.join(process.cwd(), "fixtures/threads/five-short.md"),
    displayPath: "fixtures/threads/five-short.md",
    markdown: fs.readFileSync("fixtures/threads/five-short.md", "utf8"),
    limit: 280,
    usedIds: new Set(),
    codeBlocksOnly: true,
  });
  assert.deepEqual(flagged, unfenced);
});

test("the valid thread is one schedule slot and the long tweet is skipped", () => {
  const analysis = analyzeFiles(collectMarkdownFiles(["fixtures/threads"]), {
    limit: 280,
    threshold: 0.8,
  });
  assert.equal(analysis.drafts.length, 2);
  assert.equal(analysis.summary.drafts, 2);
  assert.equal(analysis.summary.valid, 1);
  assert.equal(analysis.summary.invalid, 1);
  assert.equal(analysis.summary.overLimit, 1);
  assert.equal(analysis.duplicates.length, 0);

  const report = plan(analysis, {
    perDay: 3,
    minGapHours: 4,
    start: parseStart("2026-11-03T09:00:00"),
    dayStartMinutes: 9 * 60,
    dayEndMinutes: 21 * 60,
    includeInvalid: false,
  });
  assert.deepEqual(
    report.schedule.map((entry) => entry.draftId),
    ["five-short--thread-five-short-notes"],
  );
  assert.deepEqual(
    report.skipped.map((entry) => entry.draftId),
    ["third-over--afternoon-batches"],
  );
  assert.match(report.skipped[0]?.issues[0]?.message ?? "", /Tweet 3/);
  const markdown = formatSchedule(report);
  assert.match(markdown, /Tweet 1: /);
  assert.match(markdown, /Tweet 3 weighted length/);
  assert.match(markdown, /five-short--thread-five-short-notes/);
});
