import { SemverError } from "./errors.js";

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

const IDENT = /^[0-9A-Za-z-]+$/;

function isDigits(s: string): boolean {
  return s.length > 0 && /^[0-9]+$/.test(s);
}

export function parseNumericField(field: string, offset: number, name: string): number {
  if (field.length === 0) {
    throw new SemverError(`missing ${name} version number`, offset, 1);
  }
  if (!isDigits(field)) {
    throw new SemverError(`${name} version must be numeric, found '${field}'`, offset, field.length);
  }
  if (field.length > 1 && field[0] === "0") {
    throw new SemverError(`${name} version must not have leading zeros`, offset, field.length);
  }
  return Number(field);
}

function splitIdentifiers(text: string, start: number, checkLeadingZero: boolean): string[] {
  const parts = text.split(".");
  const result: string[] = [];
  let offset = start;
  for (const part of parts) {
    if (part.length === 0) {
      throw new SemverError("identifier must not be empty", offset, 1);
    }
    if (!IDENT.test(part)) {
      throw new SemverError(
        `identifier '${part}' contains invalid characters (only [0-9A-Za-z-] allowed)`,
        offset,
        part.length
      );
    }
    if (checkLeadingZero && isDigits(part) && part.length > 1 && part[0] === "0") {
      throw new SemverError(`numeric identifier '${part}' must not have leading zeros`, offset, part.length);
    }
    result.push(part);
    offset += part.length + 1;
  }
  return result;
}

// baseOffset lets callers embed a version string inside a larger source
// (a comparator like ">=1.2.3", a line in a query file) and still get error
// positions relative to the original file rather than to this substring.
export function parseVersion(input: string, baseOffset = 0): Version {
  if (input.length === 0) {
    throw new SemverError("expected a version, found empty string", baseOffset, 1);
  }

  const dot1 = input.indexOf(".");
  if (dot1 === -1) {
    throw new SemverError(
      `expected 'major.minor.patch', missing '.' after major version in '${input}'`,
      baseOffset,
      input.length
    );
  }
  const majorStr = input.slice(0, dot1);
  const major = parseNumericField(majorStr, baseOffset, "major");

  const dot2 = input.indexOf(".", dot1 + 1);
  if (dot2 === -1) {
    throw new SemverError(
      `expected 'major.minor.patch', missing '.' after minor version in '${input}'`,
      baseOffset,
      input.length
    );
  }
  const minorStr = input.slice(dot1 + 1, dot2);
  const minor = parseNumericField(minorStr, baseOffset + dot1 + 1, "minor");

  const dashIndex = input.indexOf("-", dot2 + 1);
  const plusSearchIndex = input.indexOf("+", dot2 + 1);
  let patchEnd = input.length;
  if (dashIndex !== -1) patchEnd = dashIndex;
  if (plusSearchIndex !== -1 && plusSearchIndex < patchEnd) patchEnd = plusSearchIndex;
  const patchStr = input.slice(dot2 + 1, patchEnd);
  const patch = parseNumericField(patchStr, baseOffset + dot2 + 1, "patch");

  let cursor = patchEnd;
  let prerelease: string[] = [];
  let build: string[] = [];

  if (input[cursor] === "-") {
    const plusIndex = input.indexOf("+", cursor + 1);
    const preEnd = plusIndex === -1 ? input.length : plusIndex;
    const preText = input.slice(cursor + 1, preEnd);
    if (preText.length === 0) {
      throw new SemverError("prerelease after '-' must not be empty", baseOffset + cursor + 1, 1);
    }
    prerelease = splitIdentifiers(preText, baseOffset + cursor + 1, true);
    cursor = preEnd;
  }

  if (input[cursor] === "+") {
    const buildText = input.slice(cursor + 1);
    if (buildText.length === 0) {
      throw new SemverError("build metadata after '+' must not be empty", baseOffset + cursor + 1, 1);
    }
    build = splitIdentifiers(buildText, baseOffset + cursor + 1, false);
    cursor = input.length;
  }

  if (cursor !== input.length) {
    throw new SemverError(`unexpected character '${input[cursor]}'`, baseOffset + cursor, 1);
  }

  return { major, minor, patch, prerelease, build };
}

export function formatVersion(v: Version): string {
  let s = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length > 0) s += `-${v.prerelease.join(".")}`;
  if (v.build.length > 0) s += `+${v.build.join(".")}`;
  return s;
}

function compareIdentifier(a: string, b: string): -1 | 0 | 1 {
  const aNum = isDigits(a);
  const bNum = isDigits(b);
  if (aNum && bNum) {
    const an = Number(a);
    const bn = Number(b);
    return an === bn ? 0 : an < bn ? -1 : 1;
  }
  if (aNum) return -1; // numeric identifiers always have lower precedence than alphanumeric ones
  if (bNum) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function comparePrerelease(a: string[], b: string[]): -1 | 0 | 1 {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a release version outranks any prerelease of the same core
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const cmp = compareIdentifier(a[i], b[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

// Build metadata is deliberately ignored: the spec says it must not affect
// precedence, only equality of the exact string.
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}
