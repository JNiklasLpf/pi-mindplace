# MP2-02/03 independent review (Luna group, ff2b645a + review fixes)

Scope: MP2-02 (C# same-project binding, imports, inheritance) and MP2-03 (nested callable ownership, provenance), plus an MP2-04 design-only note; no freshness runtime implementation. Reviewer: independent subagent pass over `src/extract.ts`, `src/types.ts`, and the binding/cache tests, against `IMPLEMENTATION_PLAN_2.md` and `docs/IMPLEMENTATION_2_BINDING.md`.

## Issue ledger

| # | Severity | Finding | Location | Disposition |
| --- | --- | --- | --- | --- |
| 1 | major | Cached TS/JS edges were mutated in place by project binding (`edge.target = targetId`), and `saveCache` persisted the bound target. A later rebuild kept that binding even when the import became ambiguous (stale guessed edge). | `runExtraction` / `bindProjectLocalCalls` | **Fixed.** Edges are copied before binding; cache stores unbound extractor output. Regression: "does not reuse a cached TS/JS import binding after the target becomes ambiguous". |
| 2 | major | C# qualified-call fallback suffix-matched any method ending in `.Type.Member` even when the qualifier was not a project namespace/type (e.g. `Other.Worker.Go()` bound to `A.Worker.Go`). Guessed edge. | `bindCSharpProjectReferences` (call branch) | **Fixed and adversarially tightened.** Fallback now requires the complete qualifier to identify a project type, or a single-segment unique type short name; a known head alone is insufficient. Regression also covers `A.Nonexistent.Worker.Go()` when `A` is known. |
| 3 | major | Unqualified C# call fallback bound to any same-namespace method of the same name in an unrelated class (`Helper()` in `N.Runner` bound to `N.Other.Helper`). Guessed edge; inherited members are not modeled. | `bindCSharpProjectReferences` (unqualified branch) | **Fixed by removal.** Unqualified calls bind only to current-type members, same-file local callables, or static-imported types. Inherited unqualified calls are now honestly unresolved (see residuals). Regression: "does not bind unqualified C# calls to a same-namespace member of an unrelated class". |
| 4 | major | Plan requires per-instance diagnostics for unsupported callable forms; none existed. Object-literal methods and class/generator expressions silently lost their calls; `abstract class` declarations were silently dropped from the owner model. | `extractTsJs` | **Fixed for enumerated forms and follow-up callback gap.** `abstract_class_declaration` is modeled; supported inline callbacks get distinct innermost owners; encountered object-literal methods/class/generator expressions receive per-instance `unsupported_callable` diagnostics, and unsupported generator/class bodies are excluded from enclosing call extraction. Diagnostics do not inflate `skippedFiles`. Regressions cover inline arrow/function callbacks with no parent double-attribution. |
| 5 | minor | Extraction cache version bump needed for the changed TS/JS extraction (new diagnostics, abstract classes, unbound-edge storage). | `EXTRACTION_CACHE_VERSION` | **Fixed.** Now `extract-schema-7/...`; older caches are misses. |
| 6 | minor | `skippedFiles` counted every per-file diagnostic (including unresolved-callable style diagnostics), so unsupported-callable notes would have been reported as skipped files. | `runExtraction` | **Fixed.** Only non-`unsupported_callable` diagnostics count, preserving the existing `extraction-cache` expectation (`skippedFiles === 3`). |
| 7 | nit | The earlier handoff said every C# binding was "pending validator"; the ledger table is stale. | `docs/IMPLEMENTATION_2_BINDING.md` | Status line updated to point here; table rows left as historical record. |
| 8 | minor (open) | `using` directives written as `using global::X;` or with unusual trivia are not matched by the regex and fall back to the tree child name; not exercised by fixtures. | `extractCSharp` using loop | **Not fixed; residual.** Unresolved import remains without phantom endpoint. Needs a fixture if the parent wants coverage. |
| 9 | minor (open) | `skippedFiles` still counts other per-file diagnostics (`truncated_json`, `parser_failed`) as before. Pre-existing semantics, preserved intentionally. | `runExtraction` | Preserved; not changed by this review. |

Verified with no change needed (adversarial reading, not exhaustive):
- Partial C# types share one `csharp_type_*` identity across files; member IDs include owner label and location, so partial members do not collide with each other.
- Namespace identity is shared by qualified name (`csharp_namespace_*`); file-scoped namespaces are handled. Source-file provenance of shared namespace entities is the first declaring file (`sourceFile` on first insertion). This is a known representation limit, not a correctness error for edges.
- Overloads with the same label produce ambiguity and no edge (existing overload test).
- Duplicate type short names (`A.Worker` vs `B.Worker`) with a bare `Worker.Go()` remain ambiguous.
- Namespace alias (`using Alias = A;`) expands before binding; static imports bind only to project types.
- Relation kind and direction preserved in `query` edge keys (existing test).
- Legacy `{nodes, edges}` graphs still load through `KnowledgeGraph.fromJSON` (existing test).

## Per-requirement acceptance (plan MP2-02/03)

| Requirement | Status | Evidence / explicit limit |
| --- | --- | --- |
| MP2-02.1 collect declarations and unresolved references across root before resolving; structured reason | Met | Project-wide binder after all file nodes; `ExtractionDiagnostic.referenceStatus` (ambiguous/external/dynamic/unknown). |
| MP2-02.2 conservative candidate rules | Met for listed syntax | Unique-candidate rule; suffix fallback restricted (issue 2); unqualified same-namespace heuristic removed (issue 3). |
| MP2-02.3 base types and namespace imports to real entities; no phantom endpoint | Met | Finished-graph tests assert endpoints exist; unresolved imports produce diagnostics only. |
| MP2-02.4 aliases, duplicate short names, partial types, ambiguous overloads, external/dynamic diagnostics | Met for listed cases | Tests cover alias+static import, `Worker.Go` ambiguity, overload ambiguity, dynamic receiver `unknown.Go`. Not claimed: nested aliases, generic/escaped identifiers, global:: forms. |
| MP2-02.5 validate against finished `KnowledgeGraph` | Met | Binding tests use `KnowledgeGraph.fromExtraction`. |
| MP2-02.6 version caches, keep legacy graph loading | Met | Schema 7; legacy load test. |
| MP2-02 fixture: two C# files, unique qualified/static call | Met | "binds C# qualified calls, unique bases, and namespace imports across files". |
| MP2-02 fixture: unique cross-file base edge | Met | Same test (`inherits`). |
| MP2-02 fixture: supported namespace import survives | Met | Same test (`imports` to `Shared`). |
| MP2-02 fixture: partial declarations without duplicate callable identities | Met | "coalesces partial type identity..." |
| MP2-02 fixture: duplicate names/overloads/external/unknown produce diagnostics not guessed edges | Met (with issues 2/3 fixed) | Regressions above. |
| MP2-02 fixture: moved declaration leaves no stale cached edge | Met for C# partial move; **now also for TS/JS** (issue 1) | Existing C# move test + new TS/JS cache ambiguity test. |
| MP2-03.1 owner-aware identities for nested functions, local functions, lambdas, arrows, methods | Met for supported forms | TS/JS and C# tests; ID includes owner path and location. |
| MP2-03.2 innermost owner, no double-counting | Met for supported forms | Nested TS/JS and C# tests. |
| MP2-03.3 supported TS/JS and C# consistently; record unsupported forms | **Bounded coverage; no claim of exhaustive grammar enumeration** | TS/JS inline arrow/function callbacks and C# method expression bodies are owned; known unsupported TS/JS class/generator expressions and object methods plus C# property/event accessors, field-initializer callbacks, destructors, operators, conversion operators, indexers and accessor nodes emit per-instance diagnostics when they contain invocations. Unsupported bodies are not attributed to an enclosing callable. Other grammar forms remain a stated boundary. |
| MP2-03.4 preserve direction and relation kind in subgraph selection | Met | Query relation/direction test. |
| MP2-03 acceptance: same-short-name nested functions distinct | Met | Nested TS/JS test. |

## Historical validation evidence (prior Haiku review snapshot; superseded below)

- `mindplace-focused-tests`: **30 tests, 30 passed, 0 failed, 5 suites** (was 26 before this pass; +4 adversarial regressions in `tests/binding-regressions.test.ts`).
- `mindplace-full-tests` / `mindplace-dev-validate`: **65 tests, 65 passed, 0 failed, 13 suites** (was 61). Dev-validate reported `[success]` for fresh install, full-workspace strict typecheck, focused, and full; the captured output did not print the package count line, so the 531-package figure from the handoff is not re-confirmed here.
- `mindplace-diff-check`: **ok** (only the existing LF→CRLF working-copy warnings).
- `build` (root): reports `tsc exited 1` with no diagnostics; this is the known root-checkout limitation (missing local Pi SDK). Not used as evidence; the isolated validator is authoritative.
- Not run by this pass: `mindplace-staged-diff-check` (parent to run if needed).
- Regressions were added and pass on the fixed code. I did not run them against the pre-fix code, so "fails before fix" is asserted from code reading, not demonstrated.

## Residuals and out-of-scope limits (explicit)

- Inherited unqualified calls (`Helper()` where `Helper` is on a base class) are now unresolved, not bound. Modeling inheritance-aware member lookup is a scope expansion.
- C# compiler-backed semantics, cross-project/assembly resolution, virtual dispatch, runtime dataflow: out of scope per plan.
- Unsupported-callable diagnostics are deliberately bounded, not exhaustive over every grammar node. TS/JS inline arrow and function-expression callbacks in call arguments are now walked as owners; object-literal methods, class expressions, and generator function expressions are diagnosed and their bodies are not attributed to an enclosing owner. C# ordinary expression-bodied methods are handled by the existing method visitor; property/event accessor, destructor, operator, conversion-operator, indexer, and accessor forms with calls now receive `unsupported_callable` diagnostics. Decorators, JSX-specific callback grammar, and any unenumerated callable node kinds remain outside this explicit list; verify new reachable forms with fixtures before claiming coverage.
- Issue 8 (`global::` using forms) is unfixed and untested.
- MP2-01 review docs with stale contradictory appendices were not edited in this pass.
- Freshness approval and matched-model evaluation remain closed; MP2-04+ not implemented.

## Follow-up: callback owners, C# unsupported callables, and qualifier adversary

This follow-up addresses the specifically reported remaining silent cases without expanding to compiler/inheritance semantics:

- TS/JS arrow and ordinary function-expression callbacks passed directly as call arguments receive unique callable owners. Regression checks each callback's `leaf()` edge and asserts the enclosing function has no duplicate direct `leaf()` edge.
- Unsupported TS/JS generator/class expressions stop traversal after a per-instance diagnostic; enclosing `callExpressions` skips those nested forms, preventing unsupported-body calls from leaking to the parent. Object-literal methods retain their diagnostic and no owner attribution. Regression asserts a generator callback call is not attributed to its enclosing function.
- C# expression-bodied ordinary methods remain supported through `method_declaration`. Property/event accessors, destructors, operators, conversion operators, indexers, and accessor nodes with invocations produce per-instance `unsupported_callable` diagnostics instead of disappearing silently. A regression checks a method-expression-body edge and property/operator/field-callback diagnostics without a guessed owner edge.
- Qualified fallback no longer accepts a known namespace/type head as sufficient evidence. It validates the entire qualifier as a project type, or a unique single-segment type name. Regression includes known-head inconsistency `A.Nonexistent.Worker.Go()`.

## Follow-up validation evidence (current snapshot)

- `mindplace-focused-tests`: **32 tests, 32 passed, 0 failed** (5 suites).
- `mindplace-full-tests`: **67 tests, 67 passed, 0 failed** (13 suites).
- `mindplace-dev-validate`: **ok** on the isolated snapshot: fresh install, strict full-workspace typecheck passed, focused suite passed, full suite **67/67**, and generated snapshot lock transferred. The validator's final success marker confirms focused tests; the explicit focused command above supplies the observable total.
- `mindplace-diff-check`: **ok** (existing LF→CRLF working-copy warnings only).
- `mindplace-staged-diff-check`: **ok** (silent successful whitespace check; not a statement about staged contents).
- Changed TypeScript diagnostics: **none**. The root `build` tool still exits with `tsc exited 1` and no diagnostics against the checkout's known incomplete root dependency installation; the isolated validator is authoritative.

Remaining boundaries: no inheritance-aware lookup, `global::` using coverage remains untested, and unsupported callable enumeration is not exhaustive. MP2-04 is design-only in `docs/IMPLEMENTATION_2_FRESHNESS_DESIGN.md`; no freshness behavior changed.

## Final independent verdict (Haiku, after Luna follow-up; docs-only pass)

No source or test changes in this pass. Binding evidence reused from the Luna follow-up (focused 32/32, full 67/67, isolated strict typecheck via `mindplace-dev-validate`); the binding regressions were re-read in `tests/binding-regressions.test.ts` (lines 161–205) and the C# unsupported-form list was re-read in `src/extract.ts` (line 167).

| Prior finding | Disposition | Boundary |
| --- | --- | --- |
| Cache mutation / stale guessed TS/JS edge (1) | Accepted | Cache stores unbound extractor output; schema 7. |
| Qualifier guessing incl. known-head `A.Nonexistent.Worker.Go()` (2) | Accepted | Whole qualifier must be a project type or unique single-segment name. |
| Unrelated unqualified C# binding (3) | Accepted | Inherited unqualified calls remain unresolved (residual). |
| Callback innermost ownership (4 follow-up) | Accepted | TS/JS arrow and function-expression callbacks; object-literal methods, class and generator expressions diagnosed, not attributed. Decorators and JSX callbacks unverified. |
| C# expression-bodied methods and unsupported forms | Accepted | Expression-bodied methods supported; destructor, operator, conversion operator, indexer, and accessor forms with invocations are diagnosed. Property/field-initializer diagnostics are covered by test. Other grammar forms are not claimed. |
| `skippedFiles` semantics (6) | Accepted | Only non-`unsupported_callable` diagnostics count. Issue 9 remains preserved pre-existing behavior. |
| `global::` using forms (8) | Open, minor | Untested residual; no false edge claimed. |

Major findings: none undispositioned. Binding per-case acceptance is limited to the listed supported forms; no compiler, assembly, virtual, or inherited dispatch semantics are claimed.

Readiness: binding follow-up is ready to accept as bounded. Freshness (MP2-04/05) is not approved; see `docs/IMPLEMENTATION_2_FRESHNESS_DESIGN.md` for the user decision (A recommended; A changes today's per-prompt walk, so it needs approval). Root `build` remains non-authoritative (known incomplete root install).
