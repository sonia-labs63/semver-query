# semver-query

A small tool that answers one question: does this version satisfy this
constraint? You give it a file of queries, it tells you which ones pass and
which fail, and when a query is malformed it tells you exactly where, down to
the line and column.

I wanted something narrower than a full range parser you pull in as a
dependency. Most of the time I just want to check "is 2.4.1 allowed by
`>=2.0.0 <3.0.0`" without reading node-semver's source to remember what a
weird range string does. So: one job, no dependencies, and error messages
that don't make you guess which token was the problem.

## Usage

Write a queries file. Each line is a version followed by one or more
comparators; all comparators on a line are AND'd together. Blank lines and
lines starting with `#` are ignored.

```
# queries.txt
1.4.2 >=1.0.0 <2.0.0
2.0.0-alpha ^1.5.0
1.2.x >=1.0.0
```

Run it:

```
$ node dist/index.js queries.txt
1.4.2 satisfies >=1.0.0 <2.0.0
2.0.0-alpha does not satisfy ^1.5.0
queries.txt:4:5: error: patch version must be numeric, found 'x'
  |
4 | 1.2.x >=1.0.0
  |     ^
```

Wait, that file only has three query lines but the error points at line 4 —
the leading comment counts as line 1, so the bad query is really on line 4 of
the file. That's the point: the line number is the real line in the file you
wrote, not the index of the query.

The tool exits non-zero if any query line failed to parse.

## Comparators

| Operator | Meaning |
| --- | --- |
| `1.2.3` (no operator) | exact match |
| `=1.2.3` | exact match |
| `>1.2.3`, `>=1.2.3` | greater than / or equal |
| `<1.2.3`, `<=1.2.3` | less than / or equal |
| `^1.2.3` | compatible within the same major (or minor, if major is 0) |
| `~1.2.3` | compatible within the same minor |

Not supported yet: hyphen ranges (`1.2.3 - 2.3.4`), OR ranges (`||`), and
x-ranges (`1.2.x`, `1.x`). Those are next.

## As a library

```ts
import { parseVersion, parseComparator, satisfies } from "./src/index.js";

const version = parseVersion("2.4.1");
const range = [parseComparator(">=2.0.0"), parseComparator("<3.0.0")];

satisfies(version, range); // true
```

`parseVersion` and `parseComparator` both throw a `SemverError` with an
`offset` and `length` when the input is invalid. `formatError(source,
filename, error)` turns that into the same diagnostic format the CLI prints,
so you can reuse it if you're parsing versions that came from somewhere other
than a queries file.

## Building

There's no build step wired up for you to run blindly — compile with your
own TypeScript toolchain:

```
tsc -p tsconfig.json
```

That produces `dist/index.js`, which is also the CLI entry point named in
`package.json`.

## Design notes

- Version parsing is hand-written, not regex-in-one-shot, specifically so
  every failure mode (missing dot, leading zero, empty identifier, stray
  character) can report the exact byte range that's wrong.
- Comparators and query lines carry a `baseOffset` through parsing so that an
  error found deep inside a version string still points at the right column
  in the original file, not at the column inside the substring being parsed.
- Build metadata (`+build.1`) is parsed and validated but ignored for
  precedence comparisons, per the semver spec.

## License

MIT, see LICENSE.
