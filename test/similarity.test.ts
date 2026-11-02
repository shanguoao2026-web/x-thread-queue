import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findDuplicates,
  normalizeForSimilarity,
  textSimilarity,
} from "../src/similarity.js";

const LANTERNS_A =
  "The lanterns along Pier Street come on before the tide turns. I count them from the bakery window and always lose track at the blue one.";
const LANTERNS_B =
  "The lanterns along Pier Street come on before the tide turns. I count them from the bakery window and usually lose track at the blue one.";
const OTHER = "A brass pencil sits beside a cracked saucer in an empty workshop.";

test("normalization folds case, URLs, and punctuation", () => {
  assert.equal(normalizeForSimilarity("Hello!"), "hello");
  assert.equal(normalizeForSimilarity("  Hello   THERE "), "hello there");
  assert.equal(normalizeForSimilarity("See https://example.com/a now."), "see now");
  assert.equal(textSimilarity("Hello!", "hello"), 1);
});

test("near-copies pass 0.8 and unrelated drafts do not", () => {
  const similar = textSimilarity(LANTERNS_A, LANTERNS_B);
  assert.ok(similar >= 0.8, `expected a near copy, got ${similar}`);
  assert.ok(similar < 1);
  const distant = textSimilarity(LANTERNS_A, OTHER);
  assert.ok(distant < 0.5, `expected an unrelated draft, got ${distant}`);
});

test("findDuplicates groups pairs and respects the threshold", () => {
  const items = [
    { id: "a", text: LANTERNS_A },
    { id: "b", text: LANTERNS_B },
    { id: "c", text: OTHER },
  ];
  const found = findDuplicates(items, 0.8);
  assert.equal(found.pairs.length, 1);
  assert.equal(found.pairs[0]?.a, "a");
  assert.equal(found.pairs[0]?.b, "b");
  assert.deepEqual(found.groups, [["a", "b"]]);

  const strict = findDuplicates(items, 0.99);
  assert.deepEqual(strict.pairs, []);
  assert.deepEqual(strict.groups, []);
});

test("empty normalized text matches other empty text", () => {
  const found = findDuplicates(
    [
      { id: "a", text: "https://example.com/only" },
      { id: "b", text: "   " },
    ],
    0.8,
  );
  assert.equal(found.pairs.length, 1);
  assert.equal(found.pairs[0]?.similarity, 1);
});
