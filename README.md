# x-thread-queue

Offline checker and scheduler for X post drafts.

It reads Markdown files, weighs each draft with X's character rules, flags near-duplicates and missing images, and writes a posting schedule as JSON and Markdown. It does not post, upload, authenticate, or contact the network.

The sample drafts under `fixtures/` are fictional. `example.com` links are placeholders. The pictures are 1×1 stand-ins, not photographs.

## Requirements

- Node.js 20 or newer
- No runtime dependencies

## Setup

```bash
npm install
npm test
```

`npm test` compiles TypeScript and runs the `node:test` suite.

## Usage

```bash
node dist/src/cli.js check fixtures/drafts/workshop.md
node dist/src/cli.js check fixtures/drafts
node dist/src/cli.js schedule fixtures/drafts \
  --per-day 3 \
  --min-gap-hours 4 \
  --start 2026-11-03T09:00:00 \
  --out schedule.json \
  --markdown schedule.md
```

`check` prints a text report. `--json` prints JSON on stdout instead. `schedule` prints Markdown on stdout unless you name files with `--out` and `--markdown`.

The bundled `fixtures/drafts` directory includes bad drafts on purpose (too long, near-duplicate, missing image, remote image). `check fixtures/drafts` exits 1. `check fixtures/drafts/workshop.md` exits 0.

```bash
node dist/src/cli.js --help
node dist/src/cli.js --version
```

### Schedule options

| Flag | Meaning | Default |
| --- | --- | --- |
| `--per-day <n>` | Maximum posts on one UTC day | `3` |
| `--min-gap-hours <n>` | Minimum hours between posts. Decimals are allowed. | `4` |
| `--start <iso>` | Earliest instant. A value without a zone is UTC. | The next `--day-start` that is not already past |
| `--day-start <HH:MM>` | First minute of the daily window, UTC | `09:00` |
| `--day-end <HH:MM>` | Last minute of the window, inclusive | `21:00` |
| `--include-invalid` | Also place drafts that have issues | off |

### Shared options

| Flag | Meaning | Default |
| --- | --- | --- |
| `--limit <n>` | Weighted character limit | `280` |
| `--threshold <0-1>` | Near-duplicate Jaccard threshold | `0.8` |
| `--code-blocks-only` | If a post contains fenced code, weigh only the text inside the fences | off |
| `--json` | Print JSON on stdout | off |
| `--out <file>` | Write JSON to a file | — |
| `--markdown <file>` | Write Markdown to a file | — |
| `--strict` | For `schedule`, exit 1 if any draft was skipped | off |

Pass files, directories, or both. Directories are walked for `.md` files. `node_modules`, `dist`, and hidden entries are skipped. Files are read in path order, then top to bottom.

## Draft format

ATX headings (`#` through `######`, optional closing hashes, up to three leading spaces) separate posts. The heading is the title. It is not part of the post and it is not weighed. The body under the heading is the post text. With `--code-blocks-only`, a section that contains fenced code uses only the text inside the fences.

A heading with an empty body is only a label. Text before the first heading is ignored. A file with no headings is one draft, titled from the file name.

Fenced code blocks are not scanned for headings. HTML comments are removed before weighing. Markdown images are attachments: they are removed from the text, then the local file is checked.

```markdown
# Pier notes

<!-- This heading has no post body, so it is not queued. -->

## Lanterns

The lanterns along Pier Street come on before the tide turns.

## Bakery

![Rye loaves](../images/rye-loaves.png)

Two rye loaves cool on the rack.

https://example.com/bakery/rye
```

`--code-blocks-only` is for a draft whose post sits in a fence and whose other lines are notes. When a section contains one or more fenced code blocks, the post body is the text inside those blocks, in order. Fence markers and the info string are left out. HTML comments inside the fences are still removed, and Markdown images inside the fences are still attachments. Lines outside the fences are ignored for length and issue checks, so a translation can run past the limit without making the draft invalid. A section with no fence is unchanged.

Put an image that belongs to the post inside the fence. An image outside the fence is not part of that post.

`fixtures/code-blocks/bilingual.md` is one fenced English post followed by a `中文：` line that weighs more than 280. `check` on that file exits 1. `check --code-blocks-only` exits 0.

Library callers pass `codeBlocksOnly: true` to `parseMarkdown` or `analyzeFiles`. The default is off.

````markdown
## Pier light

```
The pier light stays on after the shops close.
```

中文：码头的灯在店铺打烊之后仍然亮着。
````

Image paths are resolved from the Markdown file's directory. Angle-bracket destinations and percent-encoded names are accepted. `http://`, `https://`, and protocol-relative sources are remote: they are reported and not downloaded. A path that is missing, or that is a directory, is a missing image. `data:` sources are missing local files.

## Character counting

Weighing follows X's twitter-text v3 rules. The text is normalized to NFC first. The default limit is 280. A draft at exactly 280 is valid.

- Code points in the light ranges weigh **1**. Those ranges are U+0000–U+10FF, U+2000–U+200D, U+2010–U+201F, and U+2032–U+2037. That covers ASCII, most Latin, and a few punctuation marks such as the em dash.
- Every other code point weighs **2**. CJK ideographs, hiragana, katakana, hangul, fullwidth letters, and many symbols (including the ellipsis `…`) are in this group.
- An emoji cluster weighs **2** as a whole, not per code point. That includes skin tones, flags, keycaps, and ZWJ sequences.
- Each `http://` or `https://` URL weighs **23**, however long it is. Trailing sentence punctuation is not part of the URL. Other schemes, including `ftp://` and bare `www.` hosts, are weighed as ordinary text.

| Text | Weight |
| --- | --- |
| `hello` | 5 |
| `https://a.co` | 23 |
| `https://example.com/very/long?x=1` | 23 |
| `你好` | 4 |
| `こんにちは` | 10 |
| `안녕` | 4 |
| `😀` | 2 |
| `👍🏻` | 2 |
| `🇺🇸` | 2 |
| `👨‍👩‍👧` | 2 |
| em dash `—` | 1 |
| ellipsis `…` | 2 |

## Near-duplicates

Drafts are compared after this normalization: NFC, lowercase, URLs removed, punctuation removed, whitespace collapsed. Similarity is the Jaccard index of character trigrams (the whole string when it is shorter than three characters). Pairs at or above `--threshold` are near-duplicates.

Connected drafts form one group. The keeper is the earliest draft in that group that is otherwise postable (not over the limit, and every image is a local file). The others are marked `near_duplicate` and left out of the schedule. Pass `--include-invalid` to place them anyway.

Two drafts whose normalized text is empty (for example two posts that are only a URL) match each other.

## Schedule

Slots are placed in UTC.

1. The first slot is `--start`, moved forward into the next open window if it falls outside `--day-start`–`--day-end`.
2. At most `--per-day` posts are placed on a UTC day.
3. Each post is at least `--min-gap-hours` after the previous one.
4. A slot that would land after `--day-end`, or on the next calendar day, waits for the next window. The gap is still honored, so the next day can open later than `--day-start`.
5. If the window cannot hold `--per-day` posts at that gap, the extra posts move to later days and the report says so.

Drafts with issues are skipped unless `--include-invalid` is set. Order is file path, then position in the file. This is a plan on disk. The JSON report sets `"posted": false` and `"network": false`.

## Output

JSON from `check` is an analysis: drafts, weighted lengths, URLs, images, issues, and duplicate pairs. JSON from `schedule` adds `options`, `notes`, `schedule`, and `skipped`.

Markdown from `schedule` is a queue table, the text of each slot, skipped drafts, and duplicate pairs.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | `check` found no issues, or `schedule` wrote a plan |
| 1 | `check` found issues, no drafts were queued, or `--strict` skipped at least one draft |
| 2 | Bad arguments, or an input path could not be read |

## Offline guarantee

The program reads and writes local files only. It does not import an HTTP client, open a socket, or shell out. Remote images are recorded as `remote_image` and left untouched. There is no command that posts.

`package.json` is `"private": true` and has no runtime dependencies. Do not publish it.

## Tests

```bash
npm test
```

The suite covers weighing, Markdown splitting, `--code-blocks-only`, image checks, near-duplicates, the UTC schedule, both output formats, and the CLI. It also scans `src/` for network and process APIs.
