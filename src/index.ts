import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SemverError, formatError } from "./errors.js";
import { type Version, compareVersions, formatVersion, parseVersion } from "./version.js";

export { SemverError, formatError } from "./errors.js";
export { type Version, compareVersions, formatVersion, parseVersion } from "./version.js";

export type Operator = "=" | ">=" | "<=" | "^" | "~" | ">" | "<";

// Longest prefixes first, so ">=" is not mistaken for ">" followed by "=1.2.3".
const OPERATORS: Operator[] = [">=", "<=", "^", "~", ">", "<", "="];

export interface Comparator {
  operator: Operator;
  version: Version;
}

export interface Query {
  version: Version;
  comparators: Comparator[];
}

export function parseComparator(input: string, baseOffset = 0): Comparator {
  if (input.length === 0) {
    throw new SemverError("expected a comparator, found empty string", baseOffset, 1);
  }
  for (const op of OPERATORS) {
    if (input.startsWith(op)) {
      const versionText = input.slice(op.length);
      if (versionText.length === 0) {
        throw new SemverError(`expected a version after '${op}'`, baseOffset + op.length, 1);
      }
      const version = parseVersion(versionText, baseOffset + op.length);
      return { operator: op, version };
    }
  }
  // No operator prefix: treat the whole token as an exact-match version.
  const version = parseVersion(input, baseOffset);
  return { operator: "=", version };
}

function satisfiesTilde(version: Version, base: Version): boolean {
  if (compareVersions(version, base) < 0) return false;
  return version.major === base.major && version.minor === base.minor;
}

function satisfiesCaret(version: Version, base: Version): boolean {
  if (compareVersions(version, base) < 0) return false;
  if (base.major > 0) return version.major === base.major;
  if (base.minor > 0) return version.major === 0 && version.minor === base.minor;
  return version.major === 0 && version.minor === 0 && version.patch === base.patch;
}

export function satisfiesComparator(version: Version, comparator: Comparator): boolean {
  const cmp = compareVersions(version, comparator.version);
  switch (comparator.operator) {
    case "=":
      return cmp === 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case "^":
      return satisfiesCaret(version, comparator.version);
    case "~":
      return satisfiesTilde(version, comparator.version);
  }
}

export function satisfies(version: Version, comparators: Comparator[]): boolean {
  return comparators.every((c) => satisfiesComparator(version, c));
}

interface Token {
  text: string;
  offset: number;
}

function tokenize(line: string, baseOffset: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === " " || line[i] === "\t") {
      i++;
      continue;
    }
    const start = i;
    while (i < line.length && line[i] !== " " && line[i] !== "\t") i++;
    tokens.push({ text: line.slice(start, i), offset: baseOffset + start });
  }
  return tokens;
}

// A query line is "<version> <comparator> [<comparator> ...]", e.g.
// "1.4.2 >=1.0.0 <2.0.0". All comparators on a line are AND'd together.
export function parseQueryLine(line: string, baseOffset = 0): Query {
  const tokens = tokenize(line, baseOffset);
  if (tokens.length === 0) {
    throw new SemverError("expected a version to query", baseOffset, 1);
  }
  const [first, ...rest] = tokens;
  const version = parseVersion(first.text, first.offset);
  if (rest.length === 0) {
    throw new SemverError("expected at least one comparator after the version", baseOffset + line.length, 1);
  }
  const comparators = rest.map((t) => parseComparator(t.text, t.offset));
  return { version, comparators };
}

function runFile(path: string): boolean {
  const source = readFileSync(path, "utf8");
  let offset = 0;
  let sawError = false;

  for (const rawLine of source.split("\n")) {
    const lineOffset = offset;
    offset += rawLine.length + 1;

    const line = rawLine.trimEnd();
    if (line.trimStart().length === 0 || line.trimStart().startsWith("#")) continue;

    try {
      const query = parseQueryLine(line, lineOffset);
      const ok = satisfies(query.version, query.comparators);
      const expression = line.slice(line.indexOf(" ") + 1);
      console.log(`${formatVersion(query.version)} ${ok ? "satisfies" : "does not satisfy"} ${expression}`);
    } catch (err) {
      if (!(err instanceof SemverError)) throw err;
      console.error(formatError(source, path, err));
      sawError = true;
    }
  }

  return sawError;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("usage: semver-query <queries-file>");
    process.exitCode = 1;
    return;
  }

  const sawError = runFile(args[0]);
  if (sawError) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  main();
}
