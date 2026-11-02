import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { analyzeFiles } from "../src/analyze.js";
import { collectMarkdownFiles } from "../src/files.js";
import { parseStart, plan } from "../src/schedule.js";

const cli = path.resolve("dist/src/cli.js");

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(process.cwd(), ".tmp-test-"));
}

test("package is private, local, and has no runtime dependencies", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
    private?: boolean;
    dependencies?: unknown;
    engines?: { node?: string };
  };
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.engines?.node, ">=20");
});

test("source and build do not call the network or spawn processes", () => {
  const roots = ["src", "dist/src"];
  for (const root of roots) {
    assert.equal(fs.existsSync(root), true, `${root} should exist after the build`);
  }
  const files = roots.flatMap((root) => listFiles(root)).filter((file) => /\.(ts|js|mjs|cjs)$/.test(file));
  assert.ok(files.length > 0);
  const banned = [
    /\bnode:http\b/,
    /\bnode:https\b/,
    /\bnode:http2\b/,
    /\bnode:net\b/,
    /\bnode:tls\b/,
    /\bnode:dns\b/,
    /\bnode:dgram\b/,
    /\bnode:child_process\b/,
    /\bchild_process\b/,
    /\bundici\b/,
    /\baxios\b/,
    /\bnode-fetch\b/,
    /\bXMLHttpRequest\b/,
    /\bfetch\s*\(/,
    /\bhttps?\.(?:request|get)\s*\(/,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
    }
  }
});

test("help and version", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /does not call the network/);
  assert.match(help.stdout, /--per-day/);
  assert.match(help.stdout, /--min-gap-hours/);
  assert.match(help.stdout, /--code-blocks-only/);
  assert.match(help.stdout, /per tweet/);
  assert.match(help.stdout, /check/);
  assert.match(help.stdout, /schedule/);

  const version = run(["--version"]);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
});

test("check exits 1 for the mixed fixtures and 0 for the clean file", () => {
  const mixed = run(["check", "fixtures/drafts", "--json"]);
  assert.equal(mixed.status, 1);
  const parsed: unknown = JSON.parse(mixed.stdout);
  const expected = analyzeFiles(collectMarkdownFiles(["fixtures/drafts"]), {
    limit: 280,
    threshold: 0.8,
  });
  assert.deepEqual(parsed, expected);
  assert.match(mixed.stderr, /with issues/);

  const clean = run(["check", "fixtures/drafts/workshop.md"]);
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /workshop--pencil-tray/);
  assert.match(clean.stdout, /Nothing is posted/);
});

test("schedule writes JSON and Markdown that match the library plan", () => {
  const dir = tempDir();
  try {
    const jsonPath = path.join(dir, "plan.json");
    const mdPath = path.join(dir, "plan.md");
    const args = [
      "schedule",
      "fixtures/drafts",
      "--per-day",
      "3",
      "--min-gap-hours",
      "4",
      "--start",
      "2026-11-03T09:00:00",
      "--out",
      jsonPath,
      "--markdown",
      mdPath,
    ];
    const strict = run([...args, "--strict"]);
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /Wrote /);

    const open = run(args);
    assert.equal(open.status, 0);

    const expected = plan(
      analyzeFiles(collectMarkdownFiles(["fixtures/drafts"]), { limit: 280, threshold: 0.8 }),
      {
        perDay: 3,
        minGapHours: 4,
        start: parseStart("2026-11-03T09:00:00"),
        dayStartMinutes: 9 * 60,
        dayEndMinutes: 21 * 60,
        includeInvalid: false,
      },
    );
    const written = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { posted?: boolean; network?: boolean };
    assert.deepEqual(written, expected);
    assert.equal(written.posted, false);
    assert.equal(written.network, false);

    const markdown = fs.readFileSync(mdPath, "utf8");
    assert.match(markdown, /# Posting schedule/);
    assert.match(markdown, /does not post/);
    assert.match(markdown, /2026-11-03 09:00 UTC/);
    assert.match(markdown, /harbor--fog-on-the-breakwater/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("code-blocks-only ignores a translation outside the fence", () => {
  const file = "fixtures/code-blocks/bilingual.md";
  const english = "The pier light stays on after the shops close.";
  const off = run(["check", file, "--json"]);
  assert.equal(off.status, 1);
  const offJson = JSON.parse(off.stdout) as {
    drafts: { text: string; overLimit: boolean; valid: boolean }[];
  };
  assert.equal(offJson.drafts[0]?.overLimit, true);
  assert.match(offJson.drafts[0]?.text ?? "", /中文：/);
  assert.deepEqual(
    offJson,
    analyzeFiles(collectMarkdownFiles([file]), { limit: 280, threshold: 0.8 }),
  );

  const disabled = run(["check", file, "--code-blocks-only=false", "--json"]);
  assert.equal(disabled.status, 1);
  assert.match(disabled.stdout, /中文：/);

  const on = run(["check", file, "--code-blocks-only", "--json"]);
  assert.equal(on.status, 0);
  const onJson = JSON.parse(on.stdout) as {
    drafts: { text: string; overLimit: boolean; valid: boolean; weightedLength: number }[];
    summary: { invalid: number };
  };
  assert.deepEqual(
    onJson,
    analyzeFiles(collectMarkdownFiles([file]), {
      limit: 280,
      threshold: 0.8,
      codeBlocksOnly: true,
    }),
  );
  assert.equal(onJson.drafts[0]?.text, english);
  assert.equal(onJson.drafts[0]?.text.includes("中文"), false);
  assert.equal(onJson.drafts[0]?.weightedLength, english.length);
  assert.equal(onJson.drafts[0]?.overLimit, false);
  assert.equal(onJson.drafts[0]?.valid, true);
  assert.equal(onJson.summary.invalid, 0);

  const skipped = run(["schedule", file, "--start", "2026-11-03T09:00:00"]);
  assert.equal(skipped.status, 1);
  assert.match(skipped.stdout, /over_limit/);

  const scheduled = run([
    "schedule",
    file,
    "--code-blocks-only",
    "--start",
    "2026-11-03T09:00:00",
  ]);
  assert.equal(scheduled.status, 0);
  assert.match(scheduled.stdout, /bilingual--pier-light/);
  assert.match(scheduled.stdout, /The pier light stays on after the shops close\./);
  assert.equal(scheduled.stdout.includes("中文"), false);
});

test("a thread is checked per tweet", () => {
  const under = run(["check", "fixtures/threads/five-short.md"]);
  assert.equal(under.status, 0);
  assert.match(under.stdout, /tweet 1: /);
  assert.match(under.stdout, /tweet 5: /);
  assert.equal(under.stdout.includes("over_limit"), false);

  const over = run(["check", "fixtures/threads/third-over.md", "--json"]);
  assert.equal(over.status, 1);
  const parsed = JSON.parse(over.stdout) as {
    drafts: {
      text: string;
      overLimit: boolean;
      tweets?: { index: number; text: string; overLimit: boolean }[];
      issues: { code: string; message: string; tweet?: number }[];
    }[];
  };
  const draft = parsed.drafts[0];
  assert.ok(draft);
  assert.equal(draft.overLimit, true);
  assert.equal(draft.tweets?.[2]?.index, 3);
  assert.equal(draft.tweets?.[2]?.overLimit, true);
  assert.equal(draft.issues[0]?.tweet, 3);
  assert.match(draft.issues[0]?.message ?? "", /Tweet 3 weighted length/);
  assert.equal(draft.text.includes("中文"), false);

  const same = run(["check", "fixtures/threads/third-over.md", "--code-blocks-only", "--json"]);
  assert.equal(same.status, 1);
  const fenced = JSON.parse(same.stdout) as {
    drafts: { text: string; tweets?: { text: string }[] }[];
  };
  assert.equal(fenced.drafts[0]?.text, draft.text);
  assert.deepEqual(
    fenced.drafts[0]?.tweets?.map((tweet) => tweet.text),
    draft.tweets?.map((tweet) => tweet.text),
  );
  assert.equal(fenced.drafts[0]?.text.includes("中文"), false);
});

test("bad arguments exit 2 and do not write a plan", () => {
  assert.equal(run(["nope", "fixtures/drafts"]).status, 2);
  assert.equal(run(["check", "fixtures/does-not-exist"]).status, 2);
  assert.equal(run(["check", "package.json"]).status, 2);
  assert.equal(run(["check", "--per-day", "3", "fixtures/drafts/workshop.md"]).status, 2);
  assert.equal(run(["schedule", "fixtures/drafts/workshop.md", "--per-day", "0"]).status, 2);
  assert.equal(run(["schedule", "fixtures/drafts/workshop.md", "--threshold", "2"]).status, 2);
  assert.match(run(["--mystery"]).stderr, /Unknown option/);
});

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}
