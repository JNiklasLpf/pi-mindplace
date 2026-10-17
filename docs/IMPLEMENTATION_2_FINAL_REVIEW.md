# Implementation plan 2 — independent final software review

Status: **software review complete for MP2-01 through MP2-06 (no major open finding recorded in this pass)**. The model-backed **MP2-07 empirical gate remains CLOSED**. No model-backed runs, usefulness claims, savings claims, or production latency claims are made here.

Scope of this review: read `docs/IMPLEMENTATION_2_FINAL_SOFTWARE.md`, inspected the MP2-06 implementation in `src/graph.ts`, `src/query.ts`, `src/graph-file.ts`, and the test names/results in `tests/`, then ran the approved validators. No source or test edits were made in this pass; the review found no high-confidence scoped defect requiring a code change.

## Acceptance table

| Item | Evidence | Disposition |
|---|---|---|
| MP2-01 strict isolated SDK/TS workflow | `mindplace-dev-validate` ok: fresh isolated install, guarded declaration-only `pi-ai` 1.2.0 workaround, strict full-workspace typecheck, focused and full tests. Root `node_modules` not used and not authoritative. | Accepted (preserved). Raw unpatched `npm ci` + typecheck is **not** claimed to pass; use the documented validator. |
| MP2-02/03 conservative C# binding, nested callable ownership, unsupported diagnostics | Focused suite `conservative call binding` 15/15 (overload non-guessing, qualifier/namespace/alias limits, nested local-function/lambda/TS callback owner attribution, dynamic receiver diagnostics). | Accepted (preserved). Explicit limits remain (non-exhaustive unsupported syntax, no compiler semantics, global:: and inherited lookup not expanded). |
| MP2-05 passive zero work, explicit verify, atomic build, bounded cache, freshness seam | Freshness suite 10/10 incl. same-size changes with preserved mtime, >200-file detection, injected unreadable/changed-during-read and post-verify detect throw → `unknown`. Build fail-closed tests pass. | Accepted (preserved). Injected seam is platform-neutral (no chmod). |
| MP2-06 generation-scoped file/symbol ranking index | `src/graph.ts` `fileRanking`: one lazy O(V) index per `KnowledgeGraph` instance, rebuilt only when node-map identity or size changes; `fromExtraction` copies nodes so caller-held extraction objects do not alias graph nodes. Test `reuses one generation-scoped file-to-symbol index across rankings` passes. | Accepted with minor limit (below). |
| MP2-06 `Article` vs `ArticleSettingsReferences`; `TkUpdateSession` vs `…Event`; filepath vs symbol | Test `reports exact duplicate symbols as ambiguous and supports file disambiguation` passes (tool regressions 7/7). | Accepted. |
| MP2-06 duplicate `Demo.Article`, reversed insertion order | Test `returns duplicate qualified-name ambiguity in the same order regardless of insertion order` passes; candidates are sorted by ID. | Accepted. |
| MP2-06 lifecycle-hook then real tool budget | Test `budgets the actual query tool response after the lifecycle hook` passes. `query.ts` clamps requested budget to ≥160, reports `tokensUsed` as estimate of the formatted text, trims nodes until the formatted text (including status/path line) fits, and the regression asserts final text estimate ≤160 with file-only `deploy.sh` retained. | Accepted (see minor risk on `tokensUsed` digit-length fixed point). |
| MP2-06 minimum/invalid budget | `Infinity`/non-positive budget → `execution_error`; positive budget `1` → normalized 160; `NaN`/invalid `minScore` rejected in `query` (`RangeError`). Test `keeps empty responses within the normalized minimum for long questions and roots` and retrieval regressions pass. | Accepted. |
| Backward tool / old graph safety | Tests `loads legacy graph files without new extraction metadata`, `marks additions, deletions, and legacy graphs as stale or unknown`, `distinguishes missing and corrupt graph tool states`, `refuses stale graph results from explicit queries` pass. | Accepted. |
| Nested binding diagnostics / approved on-demand semantics | Tests `keeps lifecycle guidance advisory and supports an explicit off mode`, `attributes TS/JS callbacks…`, extraction cache versioning tests pass. | Accepted. |

## Validation evidence (this pass, after no source edits)

- `mindplace-dev-validate` — **ok** (isolated strict full-workspace typecheck + focused + full). Full: **75 tests / 75 passed / 0 failed / 13 suites**. Coverage report emitted (all files ~86.6% lines). Validator transferred its generated snapshot lockfile to `package-lock.json`; no checkout `node_modules` used.
- `mindplace-full-tests` — not re-run separately; the full totals above come from the dev-validate run (which executes the full suite).
- `mindplace-focused-tests` — **ok**: **39 tests / 39 passed / 0 failed / 5 suites**.
- `mindplace-diff-check` — **ok** (only existing LF→CRLF working-copy warnings).
- `mindplace-staged-diff-check` — **ok** (whitespace check only; it does not describe staged contents).
- `build` (root one-shot) was **not** run in this pass; prior ledger records that the root environment lacks the local SDK and fails without compiler diagnostics, superseded by the isolated strict typecheck. The parent must not treat that as a pass or fail of the root build.
- No staging, reset, commit, or private store/graph use. Baseline archive `C:/Users/jnikla/AppData/Local/Temp/pi-mindplace-mp2-baseline-20261016-092614` untouched by this job; parent owns index/baseline bookkeeping.

## Major findings and disposition

No **major** correctness finding was identified in this review. Items examined and considered:

1. Ranking index consistency under caller mutation — **minor, documented limit**. The index is invalidated on node-map identity or size change only. A same-size in-place replacement of a node's `type`/`sourceFile` via the public `nodes` map, or replacing a node object under an existing ID, is not detected. There is no supported graph mutation API in `src/`, and `fromExtraction` copies inputs. Not changed (a detecting check would require O(V) per ranking, defeating the bound).
2. Explain ambiguity / insertion order — **accepted** via the passing duplicate/insertion-order regression.
3. Budget loop (`src/query.ts` lines ~136–155) — **minor, not a failure**. The final trim loop recomputes `tokensUsed` from text containing the previous `tokensUsed` value, so `tokensUsed` is guaranteed only to be a fixed-point estimate in tested cases; a digit-count change at a budget boundary could leave the reported figure off by one estimated token while the returned text is still ≤ budget. The regression asserts equality for the tested long-input case. Left as-is (scoped, not a correctness violation of the budget).
4. Freshness error injection seam — **accepted**: read/detect/post-verify failures return `unknown` with detail; no platform-specific permission reliance.
5. Build-path per-file extraction-cache load/save (O(n²)) — **deferred minor**, outside ranking scope, as previously recorded.

## Remaining minor risks (explicit limits)

- Index invalidation does not detect same-size in-place mutation of node fields (see 1).
- `tokensUsed` reporting is a bounded estimate and may differ from a re-estimate by one token at a digit boundary (see 3).
- Synthetic freshness/ranking timings are deterministic operation evidence only, not production latency.
- No cross-process lock, no A→B→A detection, no whole-tree snapshot isolation (MP2-05 limits unchanged).
- C# / TS binding remains conservative and non-exhaustive for unsupported syntax; no compiler semantics.

## Changed paths (this review pass)

- `docs/IMPLEMENTATION_2_FINAL_REVIEW.md` (new; this file).
- No source, test, package, or lock edits were made by this pass. (The validator transferred its generated snapshot lockfile to `package-lock.json`, as documented for the isolated validator.)

## Authoritative summary

- **Software completion:** MP2-01 through MP2-06 software acceptance is supported by the validator evidence above (75/75 full, 39/39 focused, strict isolated typecheck, both diff checks ok).
- **Empirical gate (MP2-07):** **still CLOSED / not evaluated.** Manifest, smoke, and model-backed evaluation remain next. No empirical usefulness or savings claim is allowed.
- **Baseline:** preserved; no reset/stage/commit performed by this job.
