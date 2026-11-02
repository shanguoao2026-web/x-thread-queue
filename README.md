# x-thread-queue

Offline checker and scheduler for X post drafts.

It reads Markdown files, weighs each draft with X's character rules, checks every tweet in a thread on its own, flags near-duplicates and missing images, and writes a posting schedule as JSON and Markdown. It does not post, upload, authenticate, or contact the network.

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

ATX headings (`#` through `######`, optional closing hashes, up to three leading spaces) separate posts. The heading is the title. It is not part of the post and it is not weighed. The body under the heading is the post text. With `--code-blocks-only`, a section that contains fenced code uses only the text inside the fences. A section that is a thread is split into tweets before weighing. See [Threads](#threads).

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

Weighing follows X's twitter-text v3 rules. The text is normalized to NFC first. The default limit is 280. A draft at exactly 280 is valid, and so is a tweet at exactly 280. The same limit applies to each tweet in a thread. See [Threads](#threads).

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

## Threads

A section is one post unless it is a thread. Each tweet is weighed on its own against `--limit`. The section is over the limit only when at least one tweet is over the limit. A thread whose tweets are each under the limit is valid even when the tweets together weigh more than the limit. The report names the tweet, for example `Tweet 3 weighted length 301 exceeds the limit of 280`. The issue's `tweet` field is that number.

A section is a thread in any of these cases:

- The heading contains the word `thread` or `threads`, in any case, and the body separates tweets with a full `1/N` … `N/N` run or with a line that is exactly `---`.
- The body has a complete marker run `1/N`, `2/N`, … `N/N` for an `N` of at least 2. The heading does not have to say thread. A marker is a whole line, or the start of a line with the tweet after it (`1/5 The pier is dark.`). The marker is not weighed. Text before `1/N` is a note and is not a tweet. A partial run, such as only `1/5` and `2/5`, stays one post.
- Lines start with `1/ `, `2/ `, `3/ `, and so on: a number, a slash, and a space, and no total. This can be the section body or the only fenced code block. Numbering must be consecutive and start at 1, with at least two tweets. The heading does not have to say thread. The marker stays in the tweet and is weighed, because that line is published as-is. Text on the following lines belongs to that tweet, including text after the last numbered tweet. Text before `1/` is a note and is not a tweet. A gap, a run that does not start at 1, or a lone `1/` stays one post. An `n/N` line is not this style. A thread already split by `---` is unchanged.
- One fenced code block has tweets separated by a line that is exactly `---`. Fence markers are not part of a tweet. Text outside that fence is not part of the thread, with or without `--code-blocks-only`. Put notes outside the fence.

A line of `---` in ordinary prose does not split a post. A heading such as `Threaded needle` is not a thread heading, because `thread` is not a whole word there. A single post is still weighed as one block. `--code-blocks-only` is unchanged for a post that is not a thread: fence text is the post, and lines outside the fence are ignored.

A thread stays one draft and one schedule slot. `tweets` lists each tweet's text, 1-based index, weighted length, and `overLimit` flag. `weightedLength` on the draft is the longest tweet, which is what the limit uses. `text` is the tweets joined by a blank line, so the weighed length of `text` can be over the limit while `overLimit` is false.

`fixtures/threads/five-short.md` is five numbered tweets under a heading that contains `Thread`. Each tweet is under 280 and together they weigh more than 280, so `check` exits 0. `fixtures/threads/third-over.md` is five tweets inside one code block, separated by `---`, and tweet 3 is over 280. `check` exits 1 and names tweet 3. Notes under that fence are not tweets. `fixtures/threads/short-slash.md` is five tweets in the short `1/ ` style inside one code block, under a heading that contains `Thread`. The markers stay in the tweets. The line under `5/ ` belongs to tweet 5. Each tweet is under 280 and together they weigh more than 280, so `check` exits 0. The note under that fence is not a tweet.

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

JSON from `check` is an analysis: drafts, weighted lengths, per-tweet lengths when the draft is a thread, URLs, images, issues, and duplicate pairs. JSON from `schedule` adds `options`, `notes`, `schedule`, and `skipped`.

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

The suite covers weighing, Markdown splitting, `--code-blocks-only`, threads (a 5-tweet `1/N` thread whose total is over the limit, a thread whose third tweet is over, and a short `1/` `2/` `3/` thread whose markers stay in the text), image checks, near-duplicates, the UTC schedule, both output formats, and the CLI. It also scans `src/` for network and process APIs.
