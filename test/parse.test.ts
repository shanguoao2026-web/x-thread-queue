import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { measureText } from "../src/count.js";
import { parseMarkdown, splitSections } from "../src/parse.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(process.cwd(), ".tmp-test-"));
}

test("headings split posts and empty labels are skipped", () => {
  const markdown = [
    "Preamble is ignored",
    "",
    "# Harbor Notes",
    "",
    "<!-- label only -->",
    "",
    "## Lanterns",
    "",
    "The blue lantern.",
    "",
    "## Empty label",
    "",
    "## Second",
    "",
    "Another post.",
    "",
  ].join("\n");
  const drafts = parseMarkdown({
    absolutePath: path.join(process.cwd(), "harbor.md"),
    displayPath: "harbor.md",
    markdown,
    limit: 280,
    usedIds: new Set(),
  });
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    ["Lanterns", "Second"],
  );
  assert.equal(drafts[0]?.text, "The blue lantern.");
  assert.equal(drafts[0]?.id, "harbor--lanterns");
  assert.equal(drafts[0]?.weightedLength, "The blue lantern.".length);
  assert.equal(drafts[0]?.valid, true);
  assert.equal(splitSections(markdown).some((section) => section.title === "Harbor Notes"), true);
});

test("a file with no headings is one draft", () => {
  const markdown = "Just one post.\n\nhttps://example.com/note";
  const drafts = parseMarkdown({
    absolutePath: path.join(process.cwd(), "note.md"),
    displayPath: "note.md",
    markdown,
    limit: 280,
    usedIds: new Set(),
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.id, "note");
  assert.equal(drafts[0]?.title, "note");
  assert.deepEqual(drafts[0]?.urls, ["https://example.com/note"]);
  assert.equal(drafts[0]?.weightedLength, "Just one post.\n\n".length + 23);
});

test("code fences do not start new posts and CRLF headings still split", () => {
  const markdown = [
    "## Real",
    "",
    "before",
    "```",
    "## Not a new post",
    "inside",
    "```",
    "after",
  ].join("\r\n");
  const drafts = parseMarkdown({
    absolutePath: path.join(process.cwd(), "fences.md"),
    displayPath: "fences.md",
    markdown,
    limit: 280,
    usedIds: new Set(),
  });
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]?.text ?? "", /## Not a new post/);
  assert.match(drafts[0]?.text ?? "", /after/);
  assert.match(drafts[0]?.text ?? "", /before/);
});

test("images are attachments, comments are ignored, and length uses the limit", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "loaf.png"), "not really a photo");
    fs.writeFileSync(path.join(dir, "my photo.png"), "space");
    fs.mkdirSync(path.join(dir, "subdir"));
    const markdown = [
      "## Bakery",
      "",
      "<!-- secret -->",
      "![loaf](loaf.png)",
      "",
      "Two loaves.",
      "",
      "## Encoded",
      "",
      "![spaced](<my%20photo.png>)",
      "",
      "Named.",
      "",
      "## Remote",
      "",
      "![card](https://example.com/card.png)",
      "",
      "A card.",
      "",
      "## Missing",
      "",
      "![nope](nope.png)",
      "",
      "Gone.",
      "",
      "## Directory",
      "",
      "![dir](subdir)",
      "",
      "Not a file.",
      "",
      "## Only image",
      "",
      "![loaf again](loaf.png)",
      "",
      "## Too long",
      "",
      "a".repeat(281),
      "",
      "## Exact",
      "",
      "b".repeat(280),
      "",
    ].join("\n");
    const drafts = parseMarkdown({
      absolutePath: path.join(dir, "queue.md"),
      displayPath: "queue.md",
      markdown,
      limit: 280,
      usedIds: new Set(),
    });
    const byTitle = new Map(drafts.map((draft) => [draft.title, draft]));

    const bakery = byTitle.get("Bakery");
    assert.ok(bakery);
    assert.equal(bakery.text, "Two loaves.");
    assert.equal(bakery.images.length, 1);
    assert.equal(bakery.images[0]?.exists, true);
    assert.equal(bakery.images[0]?.remote, false);
    assert.equal(bakery.text.includes("secret"), false);
    assert.equal(bakery.text.includes("loaf.png"), false);

    const encoded = byTitle.get("Encoded");
    assert.equal(encoded?.images[0]?.exists, true);
    assert.match(encoded?.images[0]?.resolvedPath ?? "", /my photo\.png$/);

    const remote = byTitle.get("Remote");
    assert.equal(remote?.images[0]?.remote, true);
    assert.equal(remote?.images[0]?.exists, false);
    assert.equal(remote?.images[0]?.resolvedPath, null);
    assert.deepEqual(remote?.urls, []);
    assert.equal(remote?.valid, false);
    assert.equal(remote?.issues[0]?.code, "remote_image");

    assert.equal(byTitle.get("Missing")?.issues[0]?.code, "missing_image");
    assert.equal(byTitle.get("Directory")?.images[0]?.exists, false);
    assert.equal(byTitle.get("Directory")?.issues[0]?.code, "missing_image");

    const imageOnly = byTitle.get("Only image");
    assert.equal(imageOnly?.text, "");
    assert.equal(imageOnly?.weightedLength, 0);
    assert.equal(imageOnly?.valid, true);

    assert.equal(byTitle.get("Too long")?.overLimit, true);
    assert.equal(byTitle.get("Too long")?.valid, false);
    assert.equal(byTitle.get("Exact")?.overLimit, false);
    assert.equal(byTitle.get("Exact")?.weightedLength, 280);
    assert.equal(byTitle.get("Exact")?.valid, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ENGLISH = "The pier light stays on after the shops close.";

test("code-blocks-only weighs the fence and ignores a long translation", () => {
  const file = path.join(process.cwd(), "fixtures/code-blocks/bilingual.md");
  const markdown = fs.readFileSync(file, "utf8");
  const translation = markdown.split(/\r?\n/).find((line) => line.startsWith("中文："));
  assert.ok(translation);
  assert.ok(measureText(translation).weightedLength > 280);

  const input = {
    absolutePath: file,
    displayPath: "fixtures/code-blocks/bilingual.md",
    markdown,
    limit: 280,
    usedIds: new Set<string>(),
  };
  const plain = parseMarkdown(input);
  assert.equal(plain.length, 1);
  assert.equal(plain[0]?.id, "bilingual--pier-light");
  assert.match(plain[0]?.text ?? "", /```/);
  assert.match(plain[0]?.text ?? "", /The pier light stays on after the shops close\./);
  assert.match(plain[0]?.text ?? "", /中文：/);
  assert.equal(plain[0]?.overLimit, true);
  assert.equal(plain[0]?.valid, false);
  assert.equal(plain[0]?.issues.some((issue) => issue.code === "over_limit"), true);

  const fenced = parseMarkdown({ ...input, usedIds: new Set<string>(), codeBlocksOnly: true });
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0]?.text, ENGLISH);
  assert.equal(fenced[0]?.text.includes("中文"), false);
  assert.equal(fenced[0]?.weightedLength, ENGLISH.length);
  assert.equal(fenced[0]?.overLimit, false);
  assert.equal(fenced[0]?.valid, true);
  assert.deepEqual(fenced[0]?.issues, []);
});

test("code-blocks-only leaves posts without fences unchanged", () => {
  const markdown = ["## Plain", "", "Keep this prose.", ""].join("\n");
  const input = {
    absolutePath: path.join(process.cwd(), "plain.md"),
    displayPath: "plain.md",
    markdown,
    limit: 280,
    usedIds: new Set<string>(),
  };
  const plain = parseMarkdown(input);
  const fenced = parseMarkdown({ ...input, usedIds: new Set<string>(), codeBlocksOnly: true });
  assert.equal(fenced[0]?.text, "Keep this prose.");
  assert.equal(fenced[0]?.text, plain[0]?.text);
  assert.equal(fenced[0]?.weightedLength, plain[0]?.weightedLength);

  const whole = ["A file with no heading.", "", "Still one post."].join("\n");
  const asFile = parseMarkdown({
    absolutePath: path.join(process.cwd(), "whole.md"),
    displayPath: "whole.md",
    markdown: whole,
    limit: 280,
    usedIds: new Set(),
    codeBlocksOnly: true,
  });
  assert.equal(asFile.length, 1);
  assert.equal(asFile[0]?.text, "A file with no heading.\n\nStill one post.");
});

test("every fence is the post and surrounding notes are dropped", () => {
  const translation = `中文：${"文".repeat(150)}`;
  assert.ok(measureText(translation).weightedLength > 280);
  const markdown = [
    "## Real",
    "",
    "before",
    "```js",
    "## Not a new post",
    "Alpha",
    "```",
    "",
    translation,
    "",
    "~~~",
    "Beta",
    "~~~",
    "after",
    "",
    "## Empty",
    "",
    "```",
    "```",
    "",
    "Do not keep this sentence.",
    "",
    "## Plain",
    "",
    "Keep this prose.",
    "",
  ].join("\n");
  const drafts = parseMarkdown({
    absolutePath: path.join(process.cwd(), "notes.md"),
    displayPath: "notes.md",
    markdown,
    limit: 280,
    usedIds: new Set(),
    codeBlocksOnly: true,
  });
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    ["Real", "Plain"],
  );
  assert.equal(drafts[0]?.text, "## Not a new post\nAlpha\n\nBeta");
  assert.equal(drafts[0]?.text.includes("中文"), false);
  assert.equal(drafts[0]?.text.includes("before"), false);
  assert.equal(drafts[0]?.text.includes("after"), false);
  assert.equal(drafts[0]?.text.includes("```"), false);
  assert.equal(drafts[0]?.overLimit, false);
  assert.equal(drafts[0]?.valid, true);
  assert.equal(drafts[1]?.text, "Keep this prose.");

  const whole = ["```", "Whole file post.", "```", "", translation, ""].join("\n");
  const asFile = parseMarkdown({
    absolutePath: path.join(process.cwd(), "whole.md"),
    displayPath: "whole.md",
    markdown: whole,
    limit: 280,
    usedIds: new Set(),
    codeBlocksOnly: true,
  });
  assert.equal(asFile.length, 1);
  assert.equal(asFile[0]?.id, "whole");
  assert.equal(asFile[0]?.text, "Whole file post.");
  assert.equal(asFile[0]?.overLimit, false);
});

test("images inside a fence stay attachments and images outside do not", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "loaf.png"), "not really a photo");
    const translation = `中文：${"文".repeat(150)}`;
    const markdown = [
      "## Shot",
      "",
      "```",
      "![loaf](loaf.png)",
      "Inside.",
      "```",
      "",
      translation,
      "![out](missing.png)",
      "",
    ].join("\n");
    const drafts = parseMarkdown({
      absolutePath: path.join(dir, "shot.md"),
      displayPath: "shot.md",
      markdown,
      limit: 280,
      usedIds: new Set(),
      codeBlocksOnly: true,
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.text, "Inside.");
    assert.equal(drafts[0]?.overLimit, false);
    assert.equal(drafts[0]?.valid, true);
    assert.equal(drafts[0]?.images.length, 1);
    assert.equal(drafts[0]?.images[0]?.source, "loaf.png");
    assert.equal(drafts[0]?.images[0]?.exists, true);
    assert.equal(drafts[0]?.images[0]?.line, 4);

    const plain = parseMarkdown({
      absolutePath: path.join(dir, "shot.md"),
      displayPath: "shot.md",
      markdown,
      limit: 280,
      usedIds: new Set(),
    });
    assert.equal(plain[0]?.overLimit, true);
    assert.equal(plain[0]?.images.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
