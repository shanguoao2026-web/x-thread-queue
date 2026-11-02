import * as fs from "node:fs";
import * as path from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);

export function collectMarkdownFiles(inputs: readonly string[], cwd = process.cwd()): string[] {
  if (inputs.length === 0) {
    throw new Error("Pass at least one Markdown file or directory");
  }
  const files: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const absolute = path.resolve(cwd, input);
    if (!fs.existsSync(absolute)) {
      throw new Error(`No such file or directory: ${input}`);
    }
    walk(absolute, files, seen, true);
  }
  files.sort((left, right) => left.localeCompare(right, "en"));
  return files;
}

export function toDisplayPath(absolute: string, cwd = process.cwd()): string {
  const relative = path.relative(cwd, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolute.split(path.sep).join("/");
  }
  if (relative.length === 0) return ".";
  return relative.split(path.sep).join("/");
}

function walk(absolute: string, files: string[], seen: Set<string>, explicit: boolean): void {
  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    throw new Error(`Cannot read ${absolute}`);
  }
  if (seen.has(real)) return;
  seen.add(real);

  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    const names = fs.readdirSync(real).sort((left, right) => left.localeCompare(right, "en"));
    for (const name of names) {
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
      walk(path.join(real, name), files, seen, false);
    }
    return;
  }
  if (!stat.isFile()) return;
  if (real.toLowerCase().endsWith(".md")) {
    files.push(real);
    return;
  }
  if (explicit) {
    throw new Error(`Not a Markdown file: ${absolute}`);
  }
}
