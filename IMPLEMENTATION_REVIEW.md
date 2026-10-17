# Implementation review — final ledger (supersedes earlier Haiku review 374114b4 and follow-up findings)

Baseline: HEAD d66e68c plus the user's dirty baseline (README.md, src/tools/mindplace-build.ts automatic graph-output ignore behavior). Those user changes were preserved; no commits, resets, or private data were touched.

## Final validation (this pass)

| Check | Result |
|---|---|
| mindplace-focused-tests | **19 tests, 19 pass, 0 fail** (5 suites) |
| mindplace-full-tests (`npm test`) | **54 tests, 54 pass, 0 fail** (13 suites); coverage report emitted |
| mindplace-diff-check | ok (only CRLF/LF working-copy warnings) |
| mindplace-staged-diff-check | ok (nothing staged; empty output) |
| diagnostics (changed) | No diagnostics |
| build (tsc) | **Inconclusive.** Tool reports exit 1 with "No diagnostics" for changed files. Workspace diagnostics show only: `Cannot find module '@earendil-works/pi-coding-agent'` (TS2307) in index.ts and src/tools/*.ts, which cascades into implicit-any (TS7006) at index.ts:60/66, plus one info-level unused-variable note in a fixture. These are environment resolution errors in this worktree, not defects in changed logic. Parent should run the type check where the pi package is installed to get a clean result. |

Earlier counts are superseded: the previous focused count of 17 and full count of 52 predate the follow-up's added regression tests.

## Follow-up correctness review (cache, fingerprints, graph/map caching)

- **Extraction cache identity (resolved).** `EXTRACTION_CACHE_VERSION` is now `extract-schema-4/tree-sitter-0.21-grammars-lock-1`. The earlier "version not bumped / stale phantom C# edges reused" finding is stale and is resolved. A cache entry is reused only when both version and content hash match. `tests/extraction-cache.test.ts` verifies that an unchanged file re-extracts when the stored identity differs.
- **Source freshness (reliable, no regression found).** `src/graph-file.ts` stores SHA-256 for every detected supported file (metadata v2). `inspectGraph` checks membership, size, mtime, and content hash for every file. Same-size, same-mtime edits are detected. Older or malformed metadata is `unknown`, never `fresh`.
- **Parsed graph and map caching (no regression found).** The parsed-JSON cache is keyed by the SHA-256 of the full graph bytes, which is read and hashed on every call. Same-size, same-time graph edits invalidate it (tested). `KnowledgeGraph.fromExtraction` copies nodes and edges, so cached parsed objects are not mutated. The opt-in map cache is keyed by cwd plus graph hash, so it is invalidated with graph content.
- **Defect fixed this pass: fingerprint race in build.** `src/tools/mindplace-build.ts` computed `makeGraphMetadata` after extraction and persistence. A source edit during a build could therefore be recorded as "fresh" for a graph built from older content. The fingerprint is now captured immediately after detection and before extraction. Any race now yields `stale` on the next check. Validated by focused/full runs above.

## Per-prompt cost (not zero; do not describe as "no per-prompt work")

Each `before_agent_start` hook still:
1. walks the source tree (`detect`);
2. reads and SHA-256 hashes every supported source file (`inspectGraph`);
3. reads and hashes the graph JSON bytes.

It reuses only the parsed graph object and the opt-in ranked map, and only while graph bytes are identical. Timestamp-only caching of source results was rejected because it would miss same-size edits with preserved mtimes. This is the deliberate safe tradeoff: parse and ranking are avoided, but source walk and hash are O(files + source bytes) per prompt. No benchmark was run.

## Per-MP ledger

- **MP-01 advisory guidance: addressed.** Guidance is advisory and does not block source inspection. `PI_MINDPLACE_CONTEXT=off` disables it. The map is opt-in via `=map`. Tool-level lifecycle tests pass.
- **MP-02 ambiguity/explain: addressed.** Exact-match and duplicate-candidate handling, plus file disambiguation, pass in tool regressions. Named examples from the plan (`Article` vs `ArticleSettingsReferences`, `TkUpdateSession` vs `TkUpdateSessionEvent`) were not each re-verified in this pass. Minor.
- **MP-03 root selection: addressed.** Explicit-root and cwd-default scope tests, plus missing and corrupt graph states, pass.
- **MP-04 query noise/file hits: addressed for fixture scope.** Synthetic noise and file-only fixtures pass. Still open (minor): `fileRanking` scans all nodes per ranked file (bounded by the limit, not fully indexed), so the quadratic-lookup cleanup is only partial.
- **MP-05 budgets/labels: addressed.** Final formatted-output estimation and minimum-budget normalization are tested. Invalid parameters throw. Hook-visible annotation accounting was not separately re-measured. Minor.
- **MP-06 binding: partial (deliberately bounded).** Implemented: C# same-class unqualified and `this` calls to unique members; overloaded/ambiguous calls become diagnostics, not guessed edges; C# `using` imports; C# base-type inheritance bound only to a unique same-file type; TS named/default/aliased/namespace imports. **Deferred:** cross-project and cross-file C# binding, nested-owner binding beyond method scope, receiver-typed calls (`user.Name`, `Changed?.Invoke`), and external libraries, which stay unresolved diagnostics. Cross-namespace `using` edges target a namespace node that does not exist, and graph construction drops them. This matches the plan's "no compiler-backed resolution" boundary but is not complete project-wide C# semantics.
- **MP-07 freshness/repeated work: partial, safe.** Complete-membership detection beyond prefix 200, add/delete detection, legacy `unknown`, scan-cap/incomplete `unknown`, and build-race fix are implemented and tested. Per-prompt source walk and hashing remain (see cost section). This is the ongoing cost, not zero.
- **MP-08 cache/limits: addressed.** Version identity bump (schema-4), unchanged-file hits, deleted-file pruning, oversized, malformed JSON, and bounded JSON key omission are tested. Counts of extracted/cached/skipped are reported. The file-scan cap is reported through `scanComplete`/`scanLimited`.
- **MP-09 build side effects/statuses: addressed.** Automatic `.gitignore` default preserved with a read-only opt-out. No-source, cancellation, and empty-extraction statuses are structured and do not write a graph. Tests pass.
- **MP-10 quality tests/evaluation: addressed for synthetic scope; matched agent trials not executed.** New regression files are in `npm test`. `docs/QUALITY_EVALUATION.md` documents the fixture protocol and the matched-run protocol. No matched agent trials were run. No savings, token, or latency claims are made.

## Open issues and risks

- MAJOR (accepted tradeoff, not a defect): per-prompt source walk and hash cost (MP-07). Measure before optimizing.
- MAJOR (scope boundary): C# binding remains same-file/same-class for calls, inheritance, and imports. Cross-project, nested-owner, and receiver-typed resolution are deferred and reported as diagnostics.
- MAJOR (evidence gap): no matched agent trials executed (MP-10). Keep or retire decisions require the protocol in `docs/QUALITY_EVALUATION.md`.
- MINOR: `fileRanking` lookup is not fully indexed (MP-04).
- MINOR: type-check result inconclusive due to unresolved `@earendil-works/pi-coding-agent` in this worktree. Parent must run a type check where the package is installed.

## Changed paths (this pass)

- src/tools/mindplace-build.ts: moved the source fingerprint capture before extraction (race fix).
- IMPLEMENTATION_REVIEW.md: this final ledger.
