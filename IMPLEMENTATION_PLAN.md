# Mind Place implementation plan

## Ownership and scope

The user requested implementation by Luna and a review/refactor pass by Haiku. The parent drafts this plan, coordinates work, and reports results. The parent does not implement, review implementation correctness, or refactor code.

Approved call-binding scope: practical repair. Resolve unambiguous C# same-class and straightforward project-local calls, plus TypeScript/JavaScript local calls and named/default/aliased imports where supportable. Report unsupported/unresolved relationships. No compiler-service dependency, runtime data-flow engine, or speculative architecture rewrite.

Baseline commit: `d66e68c71f79dbb070e4285ecb5ca27e1e8af9ba`. The checkout already contains user modifications to `README.md` and `src/tools/mindplace-build.ts`; these modifications are part of the baseline and must be preserved. In particular, preserve the user's current automatic graph-output ignore behavior and documentation unless a newly necessary change is explicitly reported. No commits, resets, cleanup of user files, or changes to private repository/session data.

The audit is at `C:/Users/jnikla/AppData/Local/Temp/mindplace-audit-20261015/REPORT.md`. Its census is historical evidence, not a benchmark proving savings. Use synthetic/public fixtures for tests and tracked quality reports; do not copy private session text into the repository.

## Delivery sequence

1. Luna reads project guidance, uses the graph for initial orientation when available, and reads relevant installed Pi extension/tool/lifecycle documentation before changing integration code. Implement the coherent groups below with regression tests.
2. Luna runs the named validators, reports each issue ID as addressed or deferred, and releases write ownership. Every deferral needs a reason and remaining risk.
3. Haiku reviews the entire implementation against this plan and the preserved baseline. Haiku may directly fix findings and perform behavior-preserving, high-confidence refactors. Use at most three coherent review/fix rounds and stop before speculative redesign.
4. Haiku runs validators after its changes and writes `IMPLEMENTATION_REVIEW.md` containing findings, dispositions, changed paths, evidence, and remaining limitations. The parent reports the delegated results without independently auditing the code.

## Issue plans and acceptance criteria

### MP-01: Mandatory graph-first workflow and unsupported savings claims

Files: `index.ts`, tool descriptions/guidelines, `README.md`, package metadata where relevant.

- Replace mandatory build/query-first instructions with advisory guidance. A missing graph must not require an immediate build or block source inspection.
- Permit direct source/symbol search, git diff, runtime evidence, documentation, and external-data inspection according to task needs.
- Reduce always-on context. Use a compact, bounded repository map or an opt-in map rather than an unconditional large map. Support an explicit off mode using an appropriately documented Pi-compatible mechanism.
- Remove unverified 20–100x and guaranteed per-session savings claims, including misleading claims that graphs replace implementation inspection. Describe measured/estimated output honestly.
- Keep build/query/explain available without enforcing use. Avoid worktree changes merely because an agent asks a codebase question.

Acceptance: hook tests prove no forced build/query instructions with and without a graph; context-off mode contributes no graph prompt/map; docs/tool guidance agree. Existing explicit build behavior remains available.

### MP-02: Explain ambiguity, wrong targets, and ineffective failed lookup

Files: `src/tools/mindplace-explain.ts`, reusable lookup helpers if useful, tool tests.

- Prefer exact node ID and exact qualified label, then exact unqualified symbol label. Rank non-file symbols ahead of incidental path matches.
- Add optional file/type filters or equivalent explicit disambiguation. Preserve existing calls supplying only `name`.
- Return a bounded candidate list with identities, types, paths, and line locations when a target is genuinely ambiguous. Do not silently choose insertion order.
- Distinguish no match, ambiguity, graph absence, and execution failure in tool details. Give actionable next steps without treating ordinary ambiguity as a crash.
- Make connection truncation clear and keep descriptions consistent with returned coverage.

Acceptance: tests for `query` versus `src/query.ts`, `Article` versus `ArticleSettingsReferences`, `TkUpdateSession` versus `TkUpdateSessionEvent`, duplicate names across files, qualified names, explicit file lookup, filters, and no matches. Chosen target is independent of insertion order.

### MP-03: Build/query/explain graph-root mismatch

Files: all three tools, graph-loading/root helpers, extension command integration, tool tests/docs.

- Add consistent optional project-root/path selection to query/explain, matching build's interpretation. Default remains current working directory.
- Centralize root normalization and graph path construction; handle relative and absolute paths on Windows and POSIX.
- Echo the effective root and graph identity/status in tool details and concise output. Building another root must not imply that later default queries silently change scope.
- Make missing, corrupt, and incompatible graphs produce structured, actionable responses.

Acceptance: build at root B then explicit query/explain at B succeeds from cwd A; default query still targets A with its scope visible; relative/absolute roots and corrupt/missing graphs are covered. No process-wide cwd mutation.

### MP-04: Broad-query noise and hidden useful file hits

Files: `src/query.ts`, types/tool parameters, query-quality fixtures/tests.

- Improve lexical scoring for concrete/qualified symbols and paths. Make query relevance available independently from centrality.
- Avoid generic test/attribute/vendor/generated nodes overwhelming concrete source targets; use justified ranking penalties or explicit filters without making tests undiscoverable.
- Render useful file matches with paths even when the selected graph contains only file nodes. Return a truthful no-useful-match result where appropriate instead of padding with generic nodes.
- Preserve relevant structural neighbors and mark whether entries are query matches or connected context where feasible.
- Replace needless quadratic ranked-score lookups and avoid rebuilding/reloading unchanged query state if a small, invalidation-safe cache is appropriate. Favor simple correctness over introducing a complex cache.

Acceptance: synthetic large C#-shaped corpora and small TS/shell fixtures place named targets ahead of generic attributes/tests; explicit test-oriented queries still locate tests; file-only results remain actionable; irrelevant queries do not manufacture confidence. Record fixture-based quality, not claims about historical accuracy.

### MP-05: Misleading scores, budgets, coverage, and additional-node hints

Files: `src/query.ts`, `src/types.ts`, query tool/hook, tests.

- Label real retrieval relevance as relevance and PageRank as centrality, if centrality is shown at all.
- Budget the actual formatted response, including headings, paths, relationships, notices, scope/status, and any hook annotation. The character-based estimate may remain if clearly labeled estimated; an optional tokenizer is not required.
- Keep output within the documented estimated budget for valid normal budgets. Define tiny/invalid budget behavior and validate minScore/budget inputs.
- Keep graph coverage distinct from answer accuracy. Fix the remaining-node hint using a genuinely measured count or omit it.
- Preserve useful structural information within budget, and state truncation explicitly.

Acceptance: tests compare final formatted/hook-visible output estimation to the requested budget, including long paths/descriptions/questions, relationships, empty/file-only graphs, tiny budgets, and invalid parameters. Displayed relevance is derived from the scorer, not centrality; hint counts are truthful.

### MP-06: Broken practical call/import/inheritance binding

Files: `src/extract.ts`, extraction/binding types/helpers, graph construction, language tests.

- Separate collecting declarations/references from unambiguous binding where that improves correctness. Preserve unresolved references as diagnostics rather than silently claiming complete coverage.
- C#: resolve same-class unqualified and `this` calls to qualified members. Support straightforward unique project-local qualified/static references and inheritance/import associations where declaration information is sufficient. Avoid guessing overloads, dynamic receivers, external libraries, or ambiguous targets.
- TS/JS: bind local calls and supported named/default/aliased imports to declarations in resolved local modules. Cover namespace import/member access if unambiguous; otherwise report limitations.
- Recover nested function declarations and method/arrow-function calls that existing traversal omits, without double counting or attaching nested-body calls to the wrong owner.
- Preserve relation direction and distinct valid edges. Do not introduce phantom nodes to make an unresolved call look resolved.
- Keep graphs for other supported languages functional; identify unsupported semantic binding honestly in documentation and build diagnostics.

Acceptance: reproduce the audit's C# `Run -> Helper` and two-file TS `run -> imported helper` examples as regression tests whose finished graphs retain the expected edges. Include alias/default imports, method/nested ownership, ambiguous names/overloads, and external unresolved references. Existing language/extraction/graph tests pass. No blanket whole-project data-flow guarantee.

### MP-07: Incomplete freshness and repeated hook work

Files: `index.ts`, detection/build metadata, graph loader/cache helpers, tests.

- Replace the first-200-file heuristic with complete supported-file membership/fingerprint coverage or another justified reliable strategy.
- Detect modifications, additions, and deletions, including paths beyond the previous sorted prefix. Surface uncertainty, scan caps, and metadata compatibility instead of assuming fresh on errors.
- Persist reusable graph/source metadata as needed with backward-compatible loading of old graph files. Define older graphs as unknown or requiring a controlled refresh, not silently fresh.
- Avoid scanning, parsing the whole graph, and recomputing rankings on every prompt when safe invalidation can reuse results. Query/status must not present cached stale data as fresh.
- Report stale/unknown status without forcing unsolicited builds.

Acceptance: tests change a file after position 200, add/delete files, exercise old graphs and detection failure, and prove invalidation of any cached map/query state. Tests verify unchanged repeated hooks avoid unnecessary work without false freshness claims.

### MP-08: Version-blind extraction cache and silent extraction limits

Files: `src/extract.ts`, `src/detect.ts`, build tool/report/types, tests.

- Include extraction/schema/grammar compatibility identity in cache validity. A content-identical file must re-extract after a relevant version change.
- Check file size before full read/hash where possible. Report oversized, unsupported, parser-failed, unreadable, and otherwise skipped files separately from successfully extracted files.
- Expose the file-scan cap and JSON key truncation, or replace silent truncation with documented configurable/bounded behavior.
- Ensure incremental extraction handles deletions and invalidated cache records. Do not describe incremental extraction as incremental graph analysis if the full graph is rebuilt.
- Keep build output concise while providing structured diagnostics and useful detail in reports.

Acceptance: tests cover cache version invalidation, unchanged-file cache hits, deleted files, oversized input, parser/read failures, scan cap, and JSON truncation. Metrics reconcile supported/detected/extracted/cached/skipped counts; an empty or partial graph is not presented as complete.

### MP-09: Build side effects, cancellation, and workflow failure statuses

Files: build tool, gitignore integration, tool details/tests/docs.

- Preserve the user's existing automatic `.gitignore` behavior for explicit builds, but document it and provide an additive opt-out for read-only/review contexts.
- No auto-build side effect from prompt hooks. No graph/report/viz writes for an empty/no-supported-source build unless clearly required and reported.
- Distinguish no supported source, cancellation, partial extraction, graph absence, no entity match, and actual execution error with stable statuses. Do not rely on `isError` as the only quality indicator.
- Honor cancellation at appropriate boundaries and report rather than hiding failed extraction. Retain current visualization/report switches.

Acceptance: tests show ignore opt-out preserves files, defaults preserve the user's current explicit-build behavior, no-source and cancellation statuses are actionable, and existing build/gitignore behavior tests remain green.

### MP-10: Missing representative quality tests and baseline evaluation

Files: tests/fixtures, test scripts as needed, a concise tracked evaluation document or script.

- Add tool-level regression tests in addition to isolated graph/query tests so root selection, lifecycle prompts, annotation budgets, and explain resolution are actually exercised.
- Build a deterministic synthetic quality suite representing large C# noise, small TS/shell navigation, ambiguity, unsupported/empty projects, and freshness.
- Provide a reproducible evaluation protocol or lightweight runner comparing advisory graph navigation against concise repo-map plus search/read. Measure target retrieval and output size where locally testable. Reserve end-to-end correctness/time/model-context comparisons for actual matched agent runs.
- Record actual executed results and clearly mark unexecuted agent trials. Do not claim savings from estimated query output alone.

Acceptance: the package test command includes new regression files; fixture-based checks run and report results; the evaluation document describes fair task/model/branch pairing and the decision to keep or retire optional graph navigation based on evidence. Historical private session text is not included.

## Named validators owned by the children

- `baseline-test-suite`: Luna runs the current prescribed `npm test` before or at the beginning of implementation and reports preexisting failures. This is evidence collection by the implementer, not the parent.
- `focused-regressions`: run Node's prescribed test runner for every added/modified test group, including tool lifecycle/root/budget tests and C#/TS binding characterizations.
- `full-test-suite`: run `npm test` after implementation and after Haiku's changes. Include new files in the command/script so they are not accidentally skipped.
- `diff-hygiene`: run `git diff --check`; report generated-file/dependency changes and confirm no private data or unrelated user edits were lost. Do not commit. Stage only owned deliverable changes if repository guidance calls for staging, without resetting any existing index content.
- `type-validation`: run the project's existing type-check command if present; otherwise inspect tsconfig and use an available local compiler without downloading tools. Report explicitly if unavailable or preexisting failures prevent a clean result.

Tests and validators are child-owned. The parent does not rerun them or independently review implementation code. If a child cannot execute a required validator, report that limitation and request a capable delegated validator rather than assigning implementation/review to the parent.

## Delegation handoff status

Luna implementation jobs `2c413a97` and `f3b36de8` produced the initial changes. After the user-approved validator configuration was reloaded, Haiku job `374114b4` reviewed and repaired regressions. Luna follow-up `30e0b051` addressed extraction-cache invalidation and content-fingerprint freshness; Haiku final pass `a350fdc1` checked those changes and repaired a build fingerprint race.

The parent has not reviewed implementation code or executed validation. Final child-reported evidence is in `IMPLEMENTATION_REVIEW.md`: full suite 54/54 passing, focused suite 19/19 passing, working and staged diff checks passing. Type checking remains inconclusive because the worktree cannot resolve the Pi SDK package.

MP-06 remains partial: C# cross-file/project-local binding and nested-owner semantics are not fully implemented. This is a remaining scope gap, not an assertion that every original acceptance criterion was met. MP-07 now uses complete-membership content fingerprints and caches parsed graph/map work, but source-tree walking and hashing remain per prompt. MP-10 has synthetic regressions and an evaluation protocol; matched-agent trials remain unexecuted and savings are unproven. Consult Haiku's final ledger for all limitations and minor review gaps.

Narrow delegated validators are active: `mindplace-full-tests`, `mindplace-focused-tests`, `mindplace-diff-check`, and `mindplace-staged-diff-check`, enabled for `engineer` and `reviewer-anthropic`. The commands are pinned to this repository and grant no unrestricted shell. All child jobs have completed. The delegated review cycle is complete with the explicit open items above; the implementation is not claimed to satisfy every original requirement.

Configuration backup: `C:/Users/jnikla/AppData/Local/Temp/mindplace-implementation-20261015/subagents-config-before-validators.json`. User baseline patch and index snapshot are in the same directory. Preserve them for Haiku's comparison.

## Haiku review/refactor checklist

- Trace every MP issue ID to changes, regression evidence, or an explicit deferral.
- Check public parameter compatibility and old graph/cache handling.
- Check exact-match/ambiguity behavior and graph-root isolation under concurrency.
- Check conservative binding, nested ownership, unresolved diagnostics, and graph integrity.
- Check actual formatted/annotated budget accounting and truthful labels/counts.
- Check cache/freshness invalidation, additions/deletions, bounded scan reporting, cancellation, and side effects.
- Confirm existing README/build-tool user changes survived; review implementation additions relative to the complete dirty baseline, not HEAD alone.
- Refactor duplicated root/status/formatting logic and misleading names only where the improvement is clear. Avoid unrelated style churn, speculative frameworks, and external dependencies without approval.
- Run validators, record open findings by severity, and stop after at most three review/fix rounds. Escalate changes beyond the approved binding scope instead of adopting them silently.
