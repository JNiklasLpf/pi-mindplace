# MP2-05 independent freshness review

Scope: independent review of the MP2-05 on-demand freshness implementation (`docs/IMPLEMENTATION_2_FRESHNESS.md`) against the user-approved on-demand contract. Review performed by a Haiku subagent after Luna's ownership release. Only one code defect was found and fixed; no contract change was made.

## Verdict

**Accepted**, with the residual limits listed below. No undispositioned major false-fresh, performance, or compatibility defect remains in the reviewed scope. One major *truthfulness* defect (unreadable/changed-while-reading source escaped as an exception instead of `unknown`) was found and fixed in this pass.

## Checklist and evidence

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Passive `before_agent_start` does zero source walk/read/hash, graph read/parse, ranking | Verified by code read. `index.ts` `graphGuidance` calls only `recordPassivePrompt()` and `existsSync` on the graph path; `off` skips it entirely; `map` adds a note and renders nothing. No `detect`, `readFileSync`, or `inspectGraph` on that path. | `index.ts`; `tests/tool-regressions.test.ts` "keeps lifecycle guidance advisory…" (four passive events, zero counters) |
| 2 | Explicit query/explain/status gate: only `verified_current` returns graph results | Verified by code read. `mindplace-query.ts` and `mindplace-explain.ts` return status only unless `inspected.status === "verified_current"`. `/mindplace status` calls `inspectGraph` directly. | `tests/tool-regressions.test.ts` "refuses stale graph results…" |
| 3 | Full membership + content verification on every explicit call | Verified. Membership walk → per-file stat/read/hash/stat → second membership walk → graph bytes re-hashed. Two walks per verified call; graph read twice. | `tests/freshness-quality.test.ts`; dev-validate benchmark rows (walks 2, reads = file count) |
| 4 | Legacy, malformed, incomplete, limited, unreadable, unsupported metadata fails closed | Legacy/missing `scanComplete`/wrong schema/malformed inventory/root mismatch → `unknown`. Bad JSON → `unknown`. Incomplete/limited detect → `unknown`. **Fixed:** an unreadable or changed-while-reading source file, and a failing post-verification `detect`, previously threw out of `inspectGraph` (tool error, `/mindplace status` crash). They now return `unknown` with detail. | `src/graph-file.ts`; no new test (see residual risks) |
| 5 | Content mismatch vs. observed change | Stable content/size mismatch → `stale`. Stat change during read or unreadable file → `unknown`. Membership change → `stale` (first pass) or `unknown` (second pass). | `src/graph-file.ts` |
| 6 | Root/cache bounds | Single parsed-graph cache entry keyed by root + graph path + graph SHA-256. Different root or content replaces it. Cache hit only reuses parsed bytes that match the current hash; verification is never cached. | `src/graph-file.ts`; freshness-quality "reuses parsed graph data…" |
| 7 | Build atomic publication, cancel/error paths | Pre-build inventory (before extraction) and post-build inventory (after extraction) must match, or the build throws before publication. Temp file + `renameSync`; temp removed in `finally`. Build marker is set before `try` and cleared in `finally` (reference-counted). Cancel after extraction returns without writing. | `src/tools/mindplace-build.ts`; build-tool "fails closed when a source changes during extraction…" and "reports no supported source and cancellation…" |
| 8 | Process-local marker cleanup | `markBuildInProgress`/`clearBuildInProgress` balanced per `root`; `inspectGraph` reports `verification_in_progress` for both active builds and active verifications. Process-local only. | `src/graph-file.ts`; build-tool concurrent-query test |
| 9 | Deterministic counters vs. real work | Counters are incremented adjacent to the real operations: `sourceWalks` before each `detect`, `sourceReads`/`sourceBytes`/`sourceHashes` after each successful `readFileSync` in `readAndHashSource`, `graphReads`/`graphBytes` after each graph read, `graphParses` only on a cache miss, `rankings` in the tool success path. Zeros for passive rows are real (no calls reach the counted functions). Counters do **not** cover build-time hashing (`makeGraphMetadata` inside `mindplace-build.ts`) or test fixture generation. | `src/graph-file.ts`; benchmark rows |
| 10 | Per-call verified-file attribution | **Fixed:** a stale result reported `verifiedFiles: counters.sourceReads`, a cumulative global counter. It now reports the per-call verified count. Covered by a new assertion. | `tests/freshness-quality.test.ts` "detects same-size content changes…" |
| 11 | Public state mapping | `verified_current | stale | unknown | verification_in_progress | not_built`, plus passive `not_checked`. Query/explain set `isError` for `unknown` and `verification_in_progress` only; `stale` and `not_built` are status results with no graph data. This matches the approved contract. | `src/tools/mindplace-query.ts`, `mindplace-explain.ts` |
| 12 | Command parsing / backward tool-call compatibility | `/mindplace status` is a reserved token. Previously it would have steered a query on the literal text "status"; this is an intentional, documented change. Tool parameters for `mindplace_query`/`mindplace_explain` are unchanged. | `index.ts`; tool-regressions |
| 13 | No graph results on stale/unknown/in-progress | Verified by code read and test; the `inspected.graphData` is only passed to `KnowledgeGraph.fromJSON` after the `verified_current` gate. | `src/tools/mindplace-query.ts` |
| 14 | Preservation of MP2-01/02/03 contracts | Full suite and focused suite pass unchanged apart from the two additions above. | dev-validate output (see Validation) |

## Findings and dispositions

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | major (truthfulness) | `inspectGraph` could throw on unreadable or changed-while-reading source files and on post-verification `detect` failure, escaping the tool and `/mindplace status`. | **Fixed** in `src/graph-file.ts`: these now return `unknown` with detail. |
| F2 | minor | Stale-result `verifiedFiles` reported a cumulative global read counter. | **Fixed** in `src/graph-file.ts`; asserted in `tests/freshness-quality.test.ts`. |
| F3 | minor (performance, build path) | `extractAsync` calls `runExtraction` once per file with the cache directory, so each file loads and saves the whole extraction cache. Build cost is O(n²) in file count. This is in the build path, not the verification path, and is not an MP2-05 freshness defect. | Open. Record for MP2-06 performance work; no change in this pass. |
| F4 | minor | Post-build inventory compares mtime as well as size/hash, so a touch-only change during a build fails the build closed. This is conservative, not a false-fresh. | Accepted (fail-closed). |
| F5 | minor | Counters do not cover build hashing or fixture generation. Benchmark rows are verification-only and labelled as such. | Accepted; documented here. |
| F6 | nit | The "changed" benchmark row reads all files because the changed file is last in sorted order; the loop stops at the first mismatch. | Accepted; already documented in the handoff. |

## Residual risks and explicit open items

- **Unreadable-file test not added.** Making a file unreadable (`chmod`) is not reliable on Windows; the new `unknown` path is covered by code review only. Open for a platform-specific test.
- **No cross-process locking.** `verification_in_progress` covers only this process. Two separate OS processes can still verify or build concurrently.
- **No A→B→A detection.** A change fully contained between observations, with the same final content and size, is not detected. Documented limit.
- **No snapshot isolation.** The verification is a bounded read interval, not an atomic whole-tree snapshot.
- **Benchmarks are synthetic (8 and 240 small files).** They are informational, not production latency claims. Explicit verification cost grows with file count because content is re-hashed every call.
- **Model-backed evaluation gate remains CLOSED.** MP2-06 (ranking/explain/budget) and MP2-07 (matched evaluation) are not part of this review.

## Validation

Validation was run after the fixes, with the approved validators by name:

- `mindplace-dev-validate`: **ok**. Fresh isolated install, strict full-workspace typecheck, focused tests, full tests. Full totals **70 tests / 70 pass / 0 fail / 13 suites**.
- `mindplace-focused-tests`: **35 tests / 35 pass / 0 fail / 5 suites**.
- `mindplace-full-tests`: not run separately; the full total above comes from `mindplace-dev-validate`, which runs the full suite after the edits.
- `mindplace-diff-check`: **ok** (CRLF working-copy warnings only, pre-existing).
- `mindplace-staged-diff-check`: **ok**.

The root `node_modules` is still missing the SDK; the isolated validator is authoritative. No suppressions, strictness changes, model-backed runs, or new test files were introduced. Only `src/graph-file.ts`, `tests/freshness-quality.test.ts`, and this document changed.

## Acceptance

MP2-05 is accepted as implemented under the approved on-demand contract, with F1 and F2 fixed and F3 to F6 dispositioned as above. The residual limits (no cross-process locks, no A→B→A detection, no snapshot isolation, no watchers, synthetic-only performance numbers) are stated and not claimed as guarantees. MP2-06 remains next; the model-backed evaluation gate remains CLOSED.
