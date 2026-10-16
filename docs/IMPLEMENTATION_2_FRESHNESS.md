# MP2-05 freshness implementation acceptance ledger

Status: implemented under the user-approved MP2-04 **on-demand verification** contract. This is software/test evidence only; it is not a matched-agent evaluation, a production latency claim, or completion of MP2-06/07.

## Approved observable contract

- Passive `before_agent_start` is advisory. Each regular prompt reports `not_built` when a cheap graph-path existence check finds no graph, otherwise `not_checked`. It performs **zero** source-tree walks, source reads, source hashes, graph-byte reads, graph parses, and ranking work. `PI_MINDPLACE_CONTEXT=off` contributes no guidance. `PI_MINDPLACE_CONTEXT=map` is deliberately cache-only/unavailable in passive context: it says graph content will not be read before explicit verification and does not render an unverified map.
- Explicit `/mindplace status`, `mindplace_query`, and `mindplace_explain` read and hash the graph generation and perform complete supported-source membership and content verification. Only `verified_current` returns query/explain results. `stale`, `unknown`, `verification_in_progress`, and `not_built` report status only. Legacy, malformed, incomplete, limited, unreadable, or unsupported metadata fails closed as `unknown` (load problem is included in detail).
- Status vocabulary: `verified_current | stale | unknown | verification_in_progress | not_built`; passive-only `not_checked`. The old `fresh` maps to `verified_current`; missing maps to `not_built`; old/corrupt/incompatible graph states map to `unknown` with detail. No TTL, mtime-only, size-only, cache hit, or historical successful check proves freshness.
- `mindplace_explain` does read and parse the graph through the common inspection path and follows the same verification gate as query.
- Each explicit verification brackets source hashing with two complete membership walks; each source file is statted before and after content read/hash. It also hashes graph bytes both before and after source verification and compares them to the same content generation. This supports a bounded read-interval claim, not an instantaneous whole-tree snapshot. Timestamps are inventoried but are not used as a freshness shortcut or as a blanket rejection condition.
- Build computes source inventory before extraction and after extraction; mismatches fail closed before graph publication. A completed graph JSON is written to a unique temporary file then atomically renamed over the target. A process-local, per-canonical-root active-build marker makes overlapping status/query/explain report `verification_in_progress`; it is reference-counted for overlapping builds and does not coordinate independent OS processes.
- Parsed graph cache is a single bounded entry keyed by canonical root, graph path, and full graph content hash. A different root or content generation replaces it. No old verification result is cached as proof.

### Truthful interval/refinement to the design proposal

The approved intent is complete content verification over a stated read interval, without claiming snapshot isolation. Implementation verifies membership before and after content reads, brackets every source content read with stat, and re-hashes graph bytes at the end. It does **not** reject a valid content-hash verification just because mtime is recent, and does not rely on timestamp granularity as proof. It does not persist or display start/end timestamps. A change observed while reading fails as `unknown`; a stable content mismatch or membership difference is `stale`. Double walks cannot detect every A→B→A mutation that occurs entirely between observations. Cross-process build locking, OS snapshots, watcher support, and a whole-tree atomic snapshot are not claimed.

## Acceptance cases and evidence locations

| Case | Regression evidence |
|---|---|
| Repeated passive prompts, existing/missing graph, default/map/off modes: zero source walks/reads/hashes, graph reads/parses, and ranking | `tests/tool-regressions.test.ts`, “keeps lifecycle guidance advisory…”; four passive events assert zero work; map does not render cached graph content |
| Explicit current status and status surface; legacy status remains unknown | same test exercises registered `/mindplace status`; after graph replaced with legacy JSON it reports `unknown` |
| Query verifies before ranking; per-query ranking counter and graph-generation reads | `tests/tool-regressions.test.ts`, root/explanation test: 3 queries => 3 rankings and 6 graph reads (2 per verification); root selection remains isolated |
| No graph, malformed JSON, old/legacy metadata | `tests/tool-regressions.test.ts` missing/corrupt tool case; `tests/freshness-quality.test.ts` legacy metadata case |
| Add, delete, rename and source change past former 200-file prefix | `tests/freshness-quality.test.ts`, membership test and 206-file fixture |
| Same-size source edit with preserved timestamps; same-size/same-time graph edit | `tests/freshness-quality.test.ts`, both dedicated cases |
| Incomplete generation | `tests/freshness-quality.test.ts`, explicitly incomplete `scanComplete` metadata remains `unknown` |
| Stale explicit query returns status only, never graph results | `tests/tool-regressions.test.ts`, “refuses stale graph results…” |
| Concurrent edit during extraction fails closed and publishes no graph; overlapping query sees in-progress | `tests/build-tool.test.ts`, build callback mutates source and starts a query during extraction |
| Cancellation/interruption and empty/missing graph behavior | `tests/build-tool.test.ts`, no-source and already-aborted build case; malformed graph is `unknown` |
| Root/cache isolation | `tests/tool-regressions.test.ts`, explicit/relative/implicit root query fixture; parsed cache is root+hash keyed |
| Build publication and preservation of earlier extraction/binding contracts | existing build, binding, extraction-cache, and schema compatibility tests all remain in focused/full suites |

No separate new test file was created; approved existing test files were extended.

## Deterministic operations and synthetic benchmark

Counters in `src/graph-file.ts` are resettable/readable test instrumentation: passive prompts, source walks/files/reads/bytes/hashes, graph reads/bytes/parses, and ranking operations. Timings are informational `performance.now()` measurements with no pass/fail threshold. The benchmark is generated by the test in `tests/freshness-quality.test.ts`; fixtures are 8 and 240 small TypeScript source files, not representative production repositories. A changed-source row stops on the changed final-sorted file; all source files may be read before reporting that mismatch.

Latest full-suite benchmark output (milliseconds are machine/run tolerant; graph read/byte counts include beginning and end generation hashes):

| Files | Phase | Result | Walks | Source files hashed/read | Source bytes | Graph reads/bytes | Parses | Rankings | ms |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 8 | cold explicit verify | verified_current | 2 | 8 | 200 | 2 / 2,448 | 1 | 0 | 18.794 |
| 8 | unchanged explicit verify | verified_current | 2 | 8 | 200 | 2 / 2,448 | 0 | 0 | 13.356 |
| 8 | changed source | stale | 1 | 8 | 212 | 1 / 1,224 | 0 | 0 | 13.297 |
| 8 | revalidate after new generation | verified_current | 2 | 8 | 212 | 2 / 2,444 | 1 | 0 | 16.546 |
| 240 | cold explicit verify | verified_current | 2 | 240 | 6,740 | 2 / 64,014 | 1 | 0 | 294.467 |
| 240 | unchanged explicit verify | verified_current | 2 | 240 | 6,740 | 2 / 64,014 | 0 | 0 | 293.292 |
| 240 | changed source | stale | 1 | 240 | 6,752 | 1 / 32,007 | 0 | 0 | 278.595 |
| 240 | revalidate after new generation | verified_current | 2 | 240 | 6,752 | 2 / 64,016 | 1 | 0 | 314.822 |

The unchanged **passive prompt** contrast is 0 walks, 0 source files/reads/bytes/hashes, 0 graph reads/bytes/parses, and 0 rankings, versus explicit unchanged verification above, which correctly repeats the complete content checks. Successful tool calls increment ranking counters; verification-only benchmark rows have 0 rankings. Timings are not a product/performance claim. The costs grow with supported-file count because explicit verification intentionally hashes content every time.

## Validation, preservation, and exact limits

- Focused tests, after the stale-result message correction: **35 tests, 35 pass, 0 fail** (5 suites).
- Full tests: **70 tests, 70 pass, 0 fail** (13 suites); coverage report generated. The test output also preserves MP2-02/03 regression fixtures.
- `mindplace-focused-tests`: **35 tests, 35 pass, 0 fail** (5 suites). `mindplace-full-tests`: **70 tests, 70 pass, 0 fail** (13 suites). The isolated `mindplace-dev-validate` passed fresh install, full-workspace strict typecheck, focused tests, and full tests; isolated full totals were **70/70**. The validator's first strict run exposed a discriminated-union assertion in the new build test; it was fixed with an explicit `"status" in details` guard before the passing run.
- `mindplace-diff-check` and `mindplace-staged-diff-check`: passed. Root `node_modules` remains unavailable for the SDK as previously documented; isolated validator is authoritative. No test suppressions, strictness changes, SDK/config/global edits, matched model runs, or new test files were introduced.
- Root `node_modules` remains unavailable for the SDK as previously documented; isolated validator is authoritative. No test suppressions, strictness changes, SDK/config/global edits, matched model runs, or new test files were introduced.
- Deferrals: MP2-06 ranking-index optimization, matched/controlled evaluation MP2-07, watcher support, cross-process locking, wall-clock interval persistence/reporting, filesystem snapshot isolation, and detection of completely unobserved A→B→A changes. Unreadable/incomplete/limited scan and malformed/legacy graph cases remain `unknown`. `verification_in_progress` coordinates active operations in this extension process only. These limits are deliberate, not evidence that those cases are fresh.
