import type { DuplicatePair } from "./types.js";

export interface DuplicateResult {
  pairs: DuplicatePair[];
  groups: string[][];
}

export function normalizeForSimilarity(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/https?:\/\/[^\s<]+/gi, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shingles(text: string): Set<string> {
  const grams = new Set<string>();
  if (text.length === 0) return grams;
  if (text.length < 3) {
    grams.add(text);
    return grams;
  }
  for (let i = 0; i <= text.length - 3; i += 1) {
    grams.add(text.slice(i, i + 3));
  }
  return grams;
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let intersection = 0;
  for (const item of small) {
    if (large.has(item)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function textSimilarity(left: string, right: string): number {
  return round4(
    jaccard(
      shingles(normalizeForSimilarity(left)),
      shingles(normalizeForSimilarity(right)),
    ),
  );
}

export function findDuplicates(
  items: ReadonlyArray<{ id: string; text: string }>,
  threshold: number,
): DuplicateResult {
  const parent = items.map((_, index) => index);

  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      const next = parent[current] ?? current;
      parent[current] = parent[next] ?? next;
      current = parent[current] ?? next;
    }
    return current;
  };

  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) parent[rightRoot] = leftRoot;
    else parent[leftRoot] = rightRoot;
  };

  const grams = items.map((item) => shingles(normalizeForSimilarity(item.text)));
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const similarity = round4(jaccard(grams[i] ?? new Set(), grams[j] ?? new Set()));
      if (similarity < threshold) continue;
      const left = items[i];
      const right = items[j];
      if (!left || !right) continue;
      pairs.push({ a: left.id, b: right.id, similarity });
      union(i, j);
    }
  }

  pairs.sort(
    (left, right) =>
      left.a.localeCompare(right.a, "en") ||
      left.b.localeCompare(right.b, "en") ||
      left.similarity - right.similarity,
  );

  const groups: string[][] = [];
  const seenRoots = new Set<number>();
  for (let i = 0; i < items.length; i += 1) {
    const root = find(i);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    const members: string[] = [];
    for (let j = 0; j < items.length; j += 1) {
      if (find(j) !== root) continue;
      const item = items[j];
      if (item) members.push(item.id);
    }
    if (members.length > 1) groups.push(members);
  }

  return { pairs, groups };
}
