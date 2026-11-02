import assert from "node:assert/strict";
import { test } from "node:test";
import { codePointWeight, measureText } from "../src/count.js";

test("ASCII characters weigh 1 and the limit edges are exact", () => {
  assert.equal(measureText("hello").weightedLength, 5);
  assert.equal(measureText("").weightedLength, 0);
  assert.equal(measureText("a".repeat(280)).weightedLength, 280);
  assert.equal(measureText("a".repeat(281)).weightedLength, 281);
  assert.equal(measureText("a\nb").weightedLength, 3);
});

test("http and https URLs weigh 23 and trailing punctuation stays outside", () => {
  const longUrl = "https://example.com/this/is/a/very/long/path?q=1";
  assert.ok(longUrl.length > 23);
  assert.deepEqual(measureText(longUrl).urls, [longUrl]);
  assert.equal(measureText(longUrl).weightedLength, 23);
  assert.equal(measureText("https://a.co").weightedLength, 23);
  assert.equal("https://a.co".length < 23, true);

  const sentence = measureText("See https://example.com/a.");
  assert.deepEqual(sentence.urls, ["https://example.com/a"]);
  assert.equal(sentence.weightedLength, 4 + 23 + 1);

  const wrapped = measureText("Go (https://example.com/a) now");
  assert.deepEqual(wrapped.urls, ["https://example.com/a"]);
  assert.equal(wrapped.weightedLength, 4 + 23 + 5);

  const balanced = "https://en.wikipedia.org/wiki/Example_(disambiguation)";
  assert.deepEqual(measureText(balanced).urls, [balanced]);
  assert.equal(measureText(balanced).weightedLength, 23);

  const two = measureText("two https://example.com/a and https://example.com/b end");
  assert.deepEqual(two.urls, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(two.weightedLength, "two ".length + 23 + " and ".length + 23 + " end".length);

  assert.equal(measureText("ftp://example.com").weightedLength, "ftp://example.com".length);
  assert.deepEqual(measureText("seehttps://example.com").urls, []);
  assert.equal(measureText("Is it https://example.com?").urls[0], "https://example.com");
});

test("CJK and Hangul weigh 2, and NFC composes combining marks", () => {
  assert.equal(measureText("你好").weightedLength, 4);
  assert.equal(measureText("こんにちは").weightedLength, 10);
  assert.equal(measureText("안녕").weightedLength, 4);
  assert.equal(measureText("你".repeat(140)).weightedLength, 280);
  assert.equal(measureText("你".repeat(141)).weightedLength, 282);
  assert.equal(measureText("A你B").weightedLength, 4);
  assert.equal(measureText("看 https://example.com/a 呀").weightedLength, 29);

  const composed = measureText("e\u0301");
  assert.equal(composed.text, "\u00e9");
  assert.equal(composed.weightedLength, 1);
});

test("emoji clusters weigh 2 even when they use several code points", () => {
  assert.equal(measureText("\u{1F600}").weightedLength, 2);
  assert.equal(measureText("\u{1F44D}\u{1F3FB}").weightedLength, 2);
  assert.equal(measureText("\u{1F1FA}\u{1F1F8}").weightedLength, 2);
  assert.equal(measureText("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}").weightedLength, 2);
  assert.equal(measureText("1\uFE0F\u20E3").weightedLength, 2);
  assert.equal(measureText("\u2615\uFE0F").weightedLength, 2);
  assert.equal(measureText("A\u{1F600}B").weightedLength, 4);
  assert.equal(measureText("\u{1F600}!").weightedLength, 3);
  assert.equal(measureText("\u{1F469}\u200D\u{1F4BB}").weightedLength, 2);
});

test("light-range boundaries match twitter-text v3", () => {
  assert.equal(codePointWeight(0x10ff), 1);
  assert.equal(codePointWeight(0x1100), 2);
  assert.equal(measureText("\u200D").weightedLength, 1);
  assert.equal(measureText("\u200E").weightedLength, 2);
  assert.equal(measureText("\u2014").weightedLength, 1);
  assert.equal(measureText("\u2010").weightedLength, 1);
  assert.equal(measureText("\u2026").weightedLength, 2);
  assert.equal(measureText("\u2020").weightedLength, 2);
  assert.equal(measureText("\u2032").weightedLength, 1);
  assert.equal(measureText("\u2038").weightedLength, 2);
  assert.equal(measureText("...").weightedLength, 3);
});
