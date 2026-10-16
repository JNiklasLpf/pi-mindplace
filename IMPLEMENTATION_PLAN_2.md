# Mind Place second implementation plan

Status: proposed and filed; implementation has not started.

## Purpose and evidence

Close the remaining gaps from [the first implementation plan](IMPLEMENTATION_PLAN.md) and [Haiku's final review](IMPLEMENTATION_REVIEW.md). Preserve the working behavior established by the first pass rather than restarting that implementation.

The latest delegated results were 54/54 full-suite tests and 19/19 focused tests passing. Those results do not establish clean type checking, complete relationship extraction, acceptable per-prompt performance, or net workflow benefit. This plan is based on the delegated review and [quality evaluation protocol](docs/QUALITY_EVALUATION.md), not a new parent-led source audit.

Remaining work:

- MP-06: C# cross-file/project-local binding and nested callable ownership remain incomplete. Some namespace import edges are discarded because their endpoints do not exist.
- MP-07: every prompt still inventories and hashes supported source files and reads/hashes graph bytes.
- Type validation: the worktree cannot resolve the Pi SDK package; a clean, reproducible type-check result is missing.
- Minor review gaps: representative explain collisions, final hook-visible budgets, and ranking lookup costs need direct acceptance evidence.
- MP-10: synthetic regressions exist, but matched agent runs have not measured actual usefulness or savings.

## Ownership and constraints

Retain the requested division of work when this plan is authorized: Luna implements and runs checks; Haiku independently reviews, fixes/refactors within the approved scope, and reruns checks. The parent plans, coordinates, and reports only. Planning this work does not authorize implementation or paid/model-backed evaluation runs.

Before implementation, save the complete current worktree and index baseline, including first-pass new files. The original README/build-tool baseline alone is no longer sufficient. Preserve existing user edits and first-pass behavior. Do not reset, commit, or change private session stores, unrelated repositories, or their graphs.

Use small, serial handoffs. Each writer group must return a substantive issue ledger and test evidence before the configured timeout. The currently approved validators explicitly name test files; adding a new test file requires updating both package test coverage and the approved validator list, with permission and configuration refresh where needed.

Existing tool calls and older graph files must continue to load safely. A semantic extraction change must invalidate incompatible caches. New freshness states or graph metadata need compatibility tests. Keep graph navigation advisory throughout.

## Phase 1: make validation reproducible

### MP2-01: resolve the type-check blocker

Implementation owner: Luna. Review owner: Haiku.

1. Establish which Pi SDK version the extension is intended to support and how its types should resolve during local development and packaging. Inspect package metadata and installed Pi documentation rather than assuming the globally installed CLI supplies local module types.
2. Reproduce the type-check failure through an approved delegated validator with complete workspace diagnostics, not only changed-file diagnostics.
3. Provide a reproducible local development dependency/type-resolution setup compatible with the existing package. Prefer supported SDK declarations and normal module resolution. Do not add ambient stubs, suppress errors, or disable strict checking merely to obtain a pass.
4. Add a named type-check script and a narrow approved validator if necessary. Record exact SDK/compiler versions and the command in contributor-facing documentation.
5. Run a clean dependency-install/type-check/test sequence in an isolated validation environment containing the intended implementation snapshot. Do not validate only HEAD when implementation changes are uncommitted.

Acceptance:

- The documented type-check command exits successfully with full-workspace diagnostics.
- A fresh development setup resolves the supported SDK without a global-install dependency or handwritten API stubs.
- Existing full and focused tests pass. Packaging/runtime dependencies remain appropriate.
- If SDK compatibility requires a public contract or major dependency change, stop for a decision rather than silently adopting it.

## Phase 2: finish practical relationship binding

### MP2-02: C# same-project cross-file calls, imports, and inheritance

1. Collect declarations and unresolved references across the detected graph root before resolving references. Retain source identity, namespace/type scope, call owner, and a structured unresolved reason.
2. Define conservative candidate rules for explicit qualified/static calls, partial types, and unique project-local types. Bind references only when the available declarations establish one defensible target.
3. Resolve same-project base types and namespace imports to real graph entities. Deduplicate namespace entities or represent import relationships with another explicit, tested model. A phantom endpoint that graph construction later drops is not successful binding.
4. Account for namespace aliases, duplicate short names, partial types, and ambiguous overloads. Preserve diagnostic outcomes for external libraries, dynamic receivers, and cases requiring unavailable type information.
5. Validate against the finished `KnowledgeGraph`, not just extractor output, so tests catch discarded edges.
6. Version extraction caches and any persisted schema affected by the representation change. Preserve old-graph loading with truthful compatibility/freshness status.

Acceptance fixtures:

- Two C# source files in one project with an explicit, uniquely resolvable static/qualified call retain the expected call edge.
- A unique cross-file base type retains its inheritance edge.
- A supported namespace import points to an existing entity and survives graph construction.
- Partial declarations resolve conservatively without accidental duplicate callable identities.
- Duplicate type names, ambiguous overloads, external types, and unknown receivers produce diagnostics rather than guessed edges.
- Moving a declaration between files does not leave a cached old edge in the rebuilt graph.

Scope boundary: this phase is project-local structural resolution, not complete C# semantics. Compiler-backed resolution, cross-project assembly analysis, virtual dispatch, and runtime data flow require a separate architectural decision. If a listed acceptance case cannot be supported safely without that expansion, report it explicitly for a scope decision.

### MP2-03: nested callable ownership and extraction provenance

1. Give nested functions/local functions, lambdas, arrow functions, and class methods stable owner-aware identities where the language extractor supports them.
2. Attribute each invocation to its innermost supported callable owner. Avoid recursively counting a nested body's calls again against its enclosing method/function.
3. Apply the fix consistently to supported TS/JS and C# cases. Record unsupported callable forms rather than implying complete coverage.
4. Preserve edge direction and distinct relation kinds when selecting/formatting a subgraph; do not collapse different relationships merely because endpoints match.

Acceptance:

- Nested functions with the same short name under different owners remain distinct.
- A call inside an inner function/lambda is not also reported as a direct call of the outer callable.
- Method, arrow-function, local-function, and ordinary-function fixtures retain expected resolved edges.
- Ambiguous references remain unresolved and visible in diagnostics.
- Same-endpoint distinct relations and opposite-direction calls remain distinguishable where supported.

## Phase 3: remove unnecessary prompt work without false freshness

### MP2-04: choose an explicit freshness contract

Before implementation, Luna proposes and Haiku reviews a short design note covering these alternatives:

- On-demand full verification: prompt guidance reports freshness as unknown/not checked, while an explicit status/query/build path performs content verification.
- Watcher-assisted dirty tracking: filesystem events invalidate cached state, with initial full verification and conservative unknown state after watcher errors, overflow, restart, or incomplete coverage.
- Retain full verification per prompt if measurements show its cost is acceptable; document that evidence rather than claiming the overhead is removed.

Recommend on-demand prompt verification as the simplest first option to evaluate. A watcher is an optimization candidate, not an assumed reliable source of truth.

Decision gate: obtain approval for the verification timing and observable freshness states before adopting a changed contract. A timestamp, TTL, or lack of watcher events must not be presented as proof of content equality. The choice must cover explicit graph use as well as passive prompt context.

### MP2-05: implement and measure the approved freshness strategy

1. Separate passive prompt context from expensive verification and graph loading. Avoid source-tree walks, source hashing, and graph-byte reads on unchanged prompts where the approved contract permits it.
2. Keep the authoritative full verification path. Preserve complete membership and content checks, including same-size changes with preserved timestamps.
3. Make uncertainty explicit for legacy metadata, detection limits, invalidation failures, concurrent writes, and interrupted verification. Never promote an unverified cached state to fresh.
4. Bound graph/map/index caches by root and content generation. Release them when appropriate and prevent one root's results from leaking into another.
5. Measure filesystem operations, bytes read, graph parsing/ranking calls, and elapsed time. Use deterministic counters for regression assertions; keep timing thresholds tolerant of machine variance.

Acceptance:

- Under the chosen contract, repeated unchanged passive hooks avoid full source rereads or clearly justify retaining them with measurements.
- Query/status output distinguishes verified freshness from cached/unknown status.
- Tests cover additions, deletions, renames, changes beyond the old 200-file prefix, preserved timestamps, same-size graph edits, concurrent build edits, and root isolation.
- If watchers are adopted, tests also cover missed-event recovery, overflow, shutdown, symlinks, and Windows path normalization.
- Benchmark output compares cold verification, unchanged prompts, changed sources, and explicit revalidation on small and large synthetic repositories. No production latency claims are inferred from synthetic timing alone.

## Phase 4: close minor review and acceptance gaps

### MP2-06: ranking/indexing and targeted regression evidence

1. Measure and eliminate unnecessary repeated node scans in file ranking using a reusable file-to-symbol index or another simple bounded approach. Invalidate it with the graph generation; avoid a second inconsistent representation.
2. Add explicit explain cases for `Article` versus `ArticleSettingsReferences`, `TkUpdateSession` versus `TkUpdateSessionEvent`, exact symbol versus file path, duplicate qualified names, and insertion-order independence.
3. Test the final tool response through the lifecycle hook, not only `formatQueryResult`. Include root/status notices and annotations in estimated-budget assertions, plus long paths/questions, file-only results, and minimum/invalid budgets.
4. Ensure the test suite and approved validators include all new acceptance tests. Keep relevance, centrality, graph coverage, estimated output size, and correctness distinct.

Acceptance:

- Representative explain collisions cannot silently select a neighboring symbol/file.
- The final hook-visible response respects the documented normalized estimated budget.
- File ranking avoids repeated whole-node scans for each selected file, with deterministic operation-count evidence or a documented justified bound.
- Full tests, focused regressions, clean type checking, and working/staged diff checks pass after Haiku's final changes.

## Phase 5: measure whether optional navigation earns its place

### MP2-07: executable matched-agent evaluation

1. Turn the existing protocol into a runnable task manifest and result format. Use pinned public repositories or checked-in synthetic repositories, never private session transcripts.
2. Include small TS/shell navigation, large C# navigation, cross-file callers, ambiguity, implementation/debugging, review/diff, and unsupported/empty-project tasks. Hand-author expected targets or independent correctness rubrics.
3. Compare two treatments with the same task, repository commit, model/provider/settings, context, time limit, and ordinary tools: advisory graph tools available versus concise repository map plus ordinary symbol/text search and reads. Do not force graph calls.
4. Run isolated fresh sessions/worktrees for each treatment, randomize order, and repeat a predeclared number of times. Keep outcome scoring blind to treatment where possible.
5. Record correctness, target retrieval, wrong-target detours, calls, wall time, actual input/output usage, prompt/tool-declaration overhead, and whether graph building was charged. Separate cold-build and reusable-graph scenarios; report cache accounting consistently.
6. Report task-level and paired distributions, uncertainty, and failures. Unmatched provider/model runs must not be pooled as controlled comparisons.

Execution gate: approve the task manifest, models, repetition count, environment, and decision rubric before launching model-backed runs. This filed plan does not authorize those runs.

Acceptance:

- A small end-to-end smoke evaluation produces valid artifacts and exercises both treatments without leaking history between them.
- The approved matched run set is executed and independently scored, or its execution is explicitly marked blocked rather than represented as completed.
- Evidence supports one documented decision: retain optional navigation, restrict it to demonstrated task categories, or retire the graph query workflow in favor of simpler navigation.
- No savings claim is published before the measured results support it. An unfavorable result is a valid outcome, not a reason to retune the benchmark after seeing results.

## Delivery order and completion checklist

1. MP2-01 establishes a reliable validation baseline.
2. MP2-02/03 form one bounded relationship-binding group, followed by Haiku review.
3. MP2-04 obtains the freshness decision; MP2-05 implements and measures it, followed by Haiku review.
4. MP2-06 closes focused acceptance gaps and runs final software validation.
5. MP2-07 runs only after its separate execution gate and produces the keep/restrict/retire decision.

Every handoff records addressed/deferred IDs, changed paths, executed commands and totals, remaining findings by severity, and preservation of the dirty baseline. A passing suite alone does not close an untested requirement.

Plan completion requires:

- [ ] Reproducible clean type checking and full test execution.
- [ ] Finished-graph evidence for the approved C# cross-file and nested-ownership cases, with explicit unresolved boundaries.
- [ ] An approved freshness contract, tested invalidation, and measured prompt cost.
- [ ] Direct explain/budget/ranking acceptance evidence.
- [ ] Independent Haiku review of the final implementation, with no undispositioned major correctness findings.
- [ ] Matched evaluation artifacts and an evidence-backed keep/restrict/retire decision, or a clearly recorded execution blocker that leaves this item open.

Software implementation and empirical usefulness evaluation have separate completion states. Do not mark this entire plan complete while either remains unverified.
