export class SemverError extends Error {
  readonly offset: number;
  readonly length: number;

  constructor(message: string, offset: number, length = 1) {
    super(message);
    this.name = "SemverError";
    this.offset = offset;
    this.length = Math.max(length, 1);
  }
}

interface Position {
  line: number;
  column: number;
  lineStart: number;
  lineEnd: number;
}

function locate(source: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;
  const clamped = Math.min(offset, source.length);
  for (let i = 0; i < clamped; i++) {
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  let lineEnd = source.indexOf("\n", lineStart);
  if (lineEnd === -1) lineEnd = source.length;
  const column = clamped - lineStart + 1;
  return { line, column, lineStart, lineEnd };
}

// Renders a compiler-style diagnostic: file:line:col, the offending line, and
// a caret pointing at exactly the characters that are wrong. Getting this
// right is the whole point of the tool, so it lives in its own module rather
// than being inlined wherever an error happens to be thrown.
export function formatError(source: string, filename: string, err: SemverError): string {
  const pos = locate(source, err.offset);
  const lineText = source.slice(pos.lineStart, pos.lineEnd);
  const gutter = " ".repeat(String(pos.line).length);
  const caretPad = " ".repeat(Math.max(pos.column - 1, 0));
  const caretLen = Math.max(Math.min(err.length, lineText.length - (pos.column - 1)), 1);
  const caret = "^".repeat(caretLen);

  return [
    `${filename}:${pos.line}:${pos.column}: error: ${err.message}`,
    `${gutter} |`,
    `${pos.line} | ${lineText}`,
    `${gutter} | ${caretPad}${caret}`,
  ].join("\n");
}
