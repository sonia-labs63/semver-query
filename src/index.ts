import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SemverError, formatError } from "./errors.js";
import { type Version, compareVersions, formatVersion, parseNumericField, parseVersion } from "./version.js";

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

const FIELD_NAMES = ["major", "minor", "patch"] as const;

function isWildcardToken(s: string): boolean {
  return s === "x" || s === "X" || s === "*";
}

export interface XRangeBounds {
  lower: Version;
  // null means "no upper bound" (a bare `x` or `*` matches anything).
  upper: Version | null;
}

// Recognizes 1.2.x, 1.x (== 1.x.x), and bare x / * — but only when a
// wildcard is actually present, so plain versions and other malformed
// input fall straight through to parseVersion's error reporting.
export function parseXRange(input: string, baseOffset = 0): XRangeBounds | null {
  const parts = input.split(".");
  if (parts.length > 3) return null;

  const wildcardIndex = parts.findIndex(isWildcardToken);
  if (wildcardIndex === -1) return null;

  let cursor = baseOffset;
  const fields = [0, 0];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i < wildcardIndex) {
      fields[i] = parseNumericField(part, cursor, FIELD_NAMES[i]);
    } else if (!isWildcardToken(part)) {
      throw new SemverError(`expected 'x' after wildcard in x-range, found '${part}'`, cursor, part.length);
    }
    cursor += part.length + 1;
  }

  const base: Version = { major: fields[0], minor: fields[1], patch: 0, prerelease: [], build: [] };

  if (wildcardIndex === 0) return { lower: base, upper: null }; // "x" / "*": any version
  if (wildcardIndex === 1) return { lower: base, upper: { ...base, major: base.major + 1, minor: 0 } }; // "1.x"
  return { lower: base, upper: { ...base, minor: base.minor + 1 } }; // "1.2.x"
}

// Expands a comparator token into one or more AND'd comparators. Most tokens
// are a single comparator, but an x-range like `1.2.x` is really shorthand
// for `>=1.2.0 <1.3.0`.
export function parseComparators(input: string, baseOffset = 0): Comparator[] {
  if (input.length === 0) {
    throw new SemverError("expected a comparator, found empty string", baseOffset, 1);
  }
  const hasOperatorPrefix = OPERATORS.some((op) => input.startsWith(op));
  if (!hasOperatorPrefix) {
    const range = parseXRange(input, baseOffset);
    if (range !== null) {
      const comparators: Comparator[] = [{ operator: ">=", version: range.lower }];
      if (range.upper !== null) comparators.push({ operator: "<", version: range.upper });
      return comparators;
    }
  }
  return [parseComparator(input, baseOffset)];
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
  const comparators = rest.flatMap((t) => parseComparators(t.text, t.offset));
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
