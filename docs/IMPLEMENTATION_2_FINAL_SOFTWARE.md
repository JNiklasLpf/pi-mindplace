# Implementation plan 2 — final software acceptance ledger

Status: **MP2-06 software acceptance passed**. The software work in MP2-01/02/03/05 remains preserved and accepted per the preceding reviews. This ledger closes the MP2-06 ranking, explain, budget, and MP2-05 fault-injection gaps. It does **not** close the separately gated model-backed MP2-07 evaluation.

## MP2-06 acceptance cases

| Case | Evidence | Result |
|---|---|---|
| Ranking does not scan all graph nodes once per selected file | `tests/graph.test.ts`, `reuses one generation-scoped file-to-symbol index across rankings`: synthetic graph has 240 file nodes and 480 symbols (720 nodes). First `fileRanking(40)` visits exactly 720 nodes once to build its O(V) instance-local file-to-symbol index; another `fileRanking(80)` visits zero additional graph nodes. A new `KnowledgeGraph` generation builds an independent index in exactly one pass. The index is stored only on its graph instance and is discarded with it; a replaced node map or changed map size forces a rebuild. | **Pass.** This is deterministic operation evidence, not a production performance/savings claim. |
| `Article` vs `ArticleSettingsReferences` | Exact explain fixture asserts `Article` is ambiguous only between exact `Article` nodes and never includes `ArticleSettingsReferences`; a separate exact request resolves that longer symbol. | **Pass.** |
| `TkUpdateSession` vs `TkUpdateSessionEvent` | Exact requests independently resolve to their respective node IDs. | **Pass.** |
| Exact symbol vs exact filepath | `src/query.ts` resolves to the file node ID; `query` resolves to the symbol node ID. | **Pass.** |
| Duplicate qualified names and insertion order | Two `Demo.Article` candidates return explicit ambiguity in sorted ID order. Reversing graph insertion order produces the identical candidate ID list. | **Pass.** |
| Final lifecycle/tool response budget | Regression invokes the registered `before_agent_start` hook, then executes the real query tool with a long question and a long nested root. At requested budget `1`, normalization is `160`; the final returned text (including the graph status/path notice) is independently passed to `estimateQueryTokens` and equals `details.tokensUsed`, stays ≤160, and retains a file-only `deploy.sh` hit. The status remains visible while the long path/question are abbreviated. | **Pass.** The lifecycle hook is system-prompt guidance, not additional tool-result content; the actual tool content and its displayed status/path notice are counted. Tool details are metadata, not visible content. |
| Minimum and invalid budgets | The same real-tool test proves positive budget `1` normalizes to `160`; `Infinity` returns `execution_error` with the finite-positive-budget diagnostic. Existing retrieval regression covers `NaN` and invalid `minScore`. | **Pass.** |
| MP2-05 unreadable source, changed-during-read, and post-detect errors | `tests/freshness-quality.test.ts` injects read/detect failures via `inspectGraph` dependencies. Unreadable and changed-while-reading source failures, plus a throw on the second (post-verification) scan, all return `unknown` with specific detail. This is deterministic and does not depend on `chmod` or host permissions. | **Pass.** |

### Index generation contract and bound

A `KnowledgeGraph` instance is one in-memory graph generation. It owns at most one lazily built O(V) index containing file nodes and symbol references grouped by `sourceFile`; selected-file ranking then visits only that file's symbols. The per-instance index has no process-global retention and is rebuilt when the graph's node map identity or size changes. Graph publication/loading constructs a new instance for a new generation. As before, callers should not mutate an already-indexed node's `type` or `sourceFile` in place; there is no supported graph mutation API. Centrality values remain read from the referenced nodes at ranking time. The deterministic fixture proves index work, not wall-time benefit on production graphs.

## Validation evidence and commands

All validators were run by their approved names after the implementation changes:

- `mindplace-dev-validate` — **ok**: isolated fresh install, guarded SDK declaration workaround, strict full-workspace typecheck, focused tests, and full tests. Full result: **75 tests / 75 passed / 0 failed / 13 suites**. The validator transferred its generated snapshot lockfile; it did not install or test against checkout `node_modules`.
- `mindplace-focused-tests` — **39 tests / 39 passed / 0 failed / 5 suites**.
- `mindplace-full-tests` — **75 tests / 75 passed / 0 failed / 13 suites**.
- `mindplace-diff-check` — **ok**; only the existing LF-to-CRLF working-copy warnings were emitted.
- `mindplace-staged-diff-check` — **ok**; this is only a whitespace check, not a claim about staged contents.
- Strict typechecking used the isolated validator's pinned SDK 1.2.0 / TypeScript 5.9.3 setup and guarded declaration-only `pi-ai` 1.2.0 workaround. The root `node_modules` remains unsuitable/missing the local SDK and is not authoritative. The required one-shot `build` tool attempt failed in that root environment (`tsc exited 1`, only an npm notice and no compiler diagnostics); changed-file language-server diagnostics likewise report only the missing Pi SDK imports when package-lock is excluded. This is superseded by the successful isolated strict typecheck, not hidden or counted as a validator pass.

The full and focused tests include the previously accepted first-pass binding/extraction and MP2-05 suites. No model-backed evaluation was run. No staging, reset, or commit was performed. The baseline archive remains `C:/Users/jnikla/AppData/Local/Temp/pi-mindplace-mp2-baseline-20261016-092614`; index/baseline bookkeeping remains the parent coordinator's responsibility.

## Findings, preservation, and deferrals

- **No open MP2-06 acceptance finding.** All named collision, insertion-order, hook-level budget, ranking-index, and fault-injection cases above have direct regressions.
- **Preserved MP2-01:** strict isolated validation and the maintenance-bound guarded declaration-only SDK workaround remain in place; no suppression, strictness/module relaxation, or root dependency install was made.
- **Preserved MP2-02/03:** existing conservative C# project binding, nested callable ownership, unsupported diagnostics, relation behavior, and their fixtures remain unchanged.
- **Preserved MP2-05:** passive-hook zero source/graph work, explicit verified-current gate, atomic build, complete source verification, process-local concurrency markers, and freshness states remain unchanged. Counters remain verification-operation evidence and do not include build fixture/hash work.
- **Deferred MP2-05 F3 (minor build-path cost):** extraction still invokes `runExtraction(cacheDir)` per file, which reloads/saves the whole extraction cache and can be O(n²) in file count. This is outside MP2-06 ranking scope; it was not changed or relabeled as a passive prompt defect.
- Existing explicit limits remain: no cross-process lock, no A→B→A detection, no whole-tree snapshot isolation, and synthetic 8/240-file freshness benchmarks are not production latency claims.
- **MP2-07 remains CLOSED / not evaluated.** No model-backed task runs, usefulness, or savings claim is made.

## Changed paths in this handoff

- `src/graph.ts` — generation-scoped file-to-symbol ranking index.
- `src/graph-file.ts` — explicit dependency injection seam for deterministic inspect-fault regression.
- `src/tools/mindplace-query.ts` — keep verified status at the front of long scope annotations.
- `tests/graph.test.ts`, `tests/tool-regressions.test.ts`, `tests/freshness-quality.test.ts` — operation, explain, lifecycle-budget, and error-path acceptance regressions.
- `docs/IMPLEMENTATION_2_FINAL_SOFTWARE.md` — this ledger.
