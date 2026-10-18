# Task: utilities for text reports

The project is the `orca-pod-sandbox` training sandbox (Node.js >= 20, ESM, no
dependencies). The working rules are in `AGENTS.md`.

## Requirements

1. `truncate(text, max, ellipsis = '…')` in `src/text/truncate.js`.
   - **AC-A1.** A string of at most `max` Unicode characters (code points, not UTF-16
     units) is returned unchanged.
   - **AC-A2.** Otherwise the result, including `ellipsis`, is no longer than `max` characters;
     emoji and surrogate pairs are not split.
   - **AC-A3.** `max` is an integer ≥ 1, otherwise `RangeError`; a `text` that is not a string — `TypeError`.
2. `formatDuration(ms)` in `src/time/duration.js`.
   - **AC-B1.** `3723000` → `"1h 2m 3s"`; zero leading units are omitted:
     `65000` → `"1m 5s"`; `0` → `"0s"`.
   - **AC-B2.** Milliseconds are discarded (rounded down to seconds); days:
     `90061000` → `"1d 1h 1m 1s"`.
   - **AC-B3.** A negative or non-finite number — `RangeError`.
3. `chunk(array, size)` in `src/data/chunk.js`.
   - **AC-C1.** Splits the array into parts of `size`, the last one may be shorter;
     the source array is not changed.
   - **AC-C2.** `size` is an integer ≥ 1, otherwise `RangeError` (including `0`, `-1`,
     `2.5`, `NaN`).
   - **AC-C3.** Not an array — `TypeError`.
4. `buildReport(entries, { width = 40 } = {})` in `src/report.js`, uses
   `truncate` and `formatDuration`; `entries` is `[{ title: string, durationMs: number }]`.
   - **AC-D1.** One line per entry: `<title, truncated to width> — <formatDuration>`;
     the last line is `Total: <formatDuration of the sum>`; lines are joined with `\n`.
   - **AC-D2.** An empty array → exactly `Total: 0s`.
5. `src/index.js` exports `truncate`, `formatDuration`, `chunk`, `buildReport`
   and the existing `slugify`.
6. `node:test` tests for each new module — `test/<module>.test.js`;
   `node --test` passes.

## Constraints

- No new dependencies; the existing `slugify` is not changed.
- Check: `node --test`.
