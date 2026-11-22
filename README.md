# makefun-csv-20261123

A drop-in replacement for make.fun's csv-reader 1.0.0 for the make.fun bounty
[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

[![competition](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/shinshoma02-bot/makefun-csv-20261123/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/shinshoma02-bot/makefun-csv-20261123/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

## Layout

- `main.ts`: the program the harness runs with `node /bot/main.ts` (Node 22). It reads `/input/cases.json`, answers each case with `run()`, and writes `/output/answers.json`.
- `solve.js`: an ES module with no dependencies. `run({text, header})` returns `{columns, rows, errors}`.
- `LICENSE`: MIT.

## Approach

- Text with no `"` and no `\r` takes a fast path: each line is one record and is split on commas.
- Other text takes a general path that follows the reader's rules exactly (BOM, LF/CRLF records, stray CR, quoted fields with `""`, quote junk, unterminated quotes, padding and cutting to the first record's width, and error order and line numbers).
- Each run keeps its state in module-level variables and does not cache anything between cases.

## Testing

- Compared with csv-reader 1.0.0 on the practice set and on several million random inputs (short and long, with quotes, CRs, LFs and BOMs): no differences.
- The output of `main.ts` on the practice set is byte-identical to the house baseline's output.
- The CPU time of `main.ts` is measured on the practice set in the same environment as the house baseline; see the results on make.fun.
