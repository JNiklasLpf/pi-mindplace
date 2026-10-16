# Mind Place continuation summary

## Current position

The core software work in `IMPLEMENTATION_PLAN_2.md`, MP2-01 through MP2-06, is implemented and independently reviewed. MP2-07 is incomplete. Its offline evaluation harness and Copilot/Luna adapter exist, but the adapter still differs from the production tools. No model-backed evaluation, real smoke trial, blinded scoring, or keep/restrict/retire decision has run.

Luna implemented the changes. Haiku reviewed them, fixed concrete defects, and ran validation. The parent coordinated the work rather than implementing or testing it.

Read this summary first. Earlier plans and review ledgers describe intermediate snapshots and sometimes retain superseded status text. The latest evaluation review's **Offline conformance closure** and **Remaining graph divergences** sections supersede its earlier validation table and parent-run checklist.

## What changed and why

### Navigation is optional

The first implementation pass removed graph-first instructions and unsupported savings claims. Direct search, source reads, diffs, runtime evidence, and documentation remain valid alternatives. Build/query/explain tools are still available, but passive prompts do not trigger builds or modify the worktree. Explicit builds preserve automatic graph-output ignore behavior and provide an `autoIgnore=false` opt-out.

This avoids forcing graph work onto tasks where ordinary navigation is simpler. Whether the graph earns its extra tools and build cost remains an empirical question.

### Lookup and output are more predictable

- Build, query, and explain share project-root handling. Results identify their scope instead of silently switching roots.
- Explain prefers exact identities and symbols, supports disambiguation, and returns candidates rather than choosing an arbitrary duplicate.
- Retrieval separates lexical relevance from centrality and graph coverage. File-only matches remain useful.
- Final query text, including status and scope notices, is trimmed against a normalized character-based token estimate. This is not exact provider token accounting.
- File ranking uses a graph-instance file-to-symbol index instead of scanning every node for each selected file.

The regressions cover the named symbol collisions, insertion-order independence, long inputs, invalid/minimum budgets, and the real lifecycle-hook-then-tool path.

### Relationship extraction is conservative

C# declarations and references are collected across the detected root before binding. Supported unique qualified calls, base types, namespace imports, aliases, static imports, and partial declarations retain real finished-graph edges. Ambiguous overloads, unknown receivers, and external references remain unresolved rather than receiving guessed targets.

Supported TS/JS and C# nested callables have owner-aware identities. Inner calls are not also attributed to their outer function. Known unsupported forms produce diagnostics. Cache schema 7 invalidates incompatible extraction records; cached unbound references are rebound against the current project.

This remains syntax-based analysis. Compiler semantics, cross-assembly resolution, inherited member lookup, virtual dispatch, and exhaustive grammar coverage are not implemented.

### Freshness moved off the passive prompt path

The user approved on-demand verification:

- Passive guidance performs no source walks, source reads/hashes, graph-byte reads/parsing, or ranking. It reports `not_checked` or a cheap `not_built` result.
- `PI_MINDPLACE_CONTEXT=off` adds no guidance. Passive `map` mode does not read or render an unverified graph map.
- `/mindplace status`, query, and explain verify supported-file membership/content and graph generation. Only `verified_current` permits graph results. Other states return status notices.
- Legacy, malformed, incomplete, unreadable, or uncertain data does not become current merely because it loaded successfully.
- Builds compare pre/post inventories and publish graph JSON through a temporary file and atomic rename. Detected concurrent changes fail closed.

Verification describes observations over a read interval, not an atomic whole-tree snapshot. There is no cross-process lock or guarantee of detecting completely unobserved A-to-B-to-A edits. Synthetic operation counters demonstrate passive work removal; they do not establish production latency or agent savings.

### Strict validation is reproducible in isolation

Development types are pinned to Pi SDK 1.2.0 and TypeScript 5.9.3 with strict NodeNext checking. Tool-result return types now conform to the SDK without casts or error suppression.

The published pi-ai declarations omit JSON import attributes. The user authorized a declaration-only correction, guarded by exact version, package integrity, declaration inventory, and expected content. It changes no runtime JavaScript or API shapes. Remove it when a supported upstream release fixes the declarations, then repeat fresh validation.

Use the authoritative validation entry point:

```text
node tests/validate-development.mjs
```

It snapshots the current tracked and non-ignored untracked files, installs dependencies with lifecycle scripts disabled, applies the guarded declaration correction inside that snapshot, runs strict type checking and both test suites, and transfers the generated lockfile only after success. It cleans the snapshot afterward. It does not install the SDK into the root checkout.

Do not assume the README's plain `npm ci` followed by `npm run typecheck` reproduces this pass without the declaration correction. Earlier root build failures reflected missing local SDK resolution; the isolated validator supplied the accepted type-check evidence.

## Progress and evidence

| Work | State |
| --- | --- |
| MP2-01 development dependencies, strict checking, clean install | Accepted, with the authorized upstream declaration workaround |
| MP2-02 C# project-local relationship binding | Accepted for the documented syntax-only scope |
| MP2-03 nested callable ownership and provenance | Accepted with explicit unsupported-language boundaries |
| MP2-04 freshness contract | On-demand contract approved by the user |
| MP2-05 freshness implementation and measurements | Accepted with documented filesystem/concurrency limits |
| MP2-06 ranking, explain, and final output-budget evidence | Accepted |
| MP2-07 matched-agent evaluation | Offline preparation only; full evaluation remains blocked |

Latest delegated post-edit evidence from Haiku's final continuation pass:

- Isolated fresh-install validator and strict full-workspace type check passed.
- Full suite: **80/80 passed**.
- Focused suite: **44/44 passed**.
- Working and staged whitespace checks passed.

These counts include offline harness tests. Fake SDK sessions and canned smoke artifacts prove plumbing, not agent correctness, usefulness, latency, or savings. The current files have not been exercised in an authorized model-backed trial.

## What remains

### Finish evaluation fidelity before full trials

The harness has task/rubric manifests, fixture hashes, execution-approval checks, seeded treatment ordering, separate workspaces, cold/reusable graph accounting, blinded score-sheet formats, and paired analysis. The adapter targets the user-selected `github-copilot/gpt-6-luna` for both arms.

The main remaining problems are:

1. Production/adapter equivalence is incomplete. Query-core formatting is compared, but the adapter uses a different freshness gate and header, explain equivalence is untested, build writes an external evaluation artifact by design, and its query schema caps a budget that production does not cap. Do not interpret this as an evaluation of the exact production workflow yet.
2. The C# fixture is synthetic and small/medium. Its directory name does not establish representative large-project coverage.
3. Actual model usage and overhead are unmeasured. Tool-declaration/prompt splits remain unavailable, not zero. The context ceiling is estimated, not an exact provider-token cap.
4. Local pinned SDK loading, credential availability, effective hooks, and provider control compliance need a separately authorized runtime preflight/smoke. Static catalog metadata and fake SDK tests do not prove account entitlement or live behavior.

The draft full run is nine tasks, three repetitions, and two treatments, totaling 54 invocations. That is a proposal, not approval. Selecting Luna did not authorize those invocations or even a real smoke trial.

### Smaller deferred software limits

- The build path reloads/saves the extraction cache per file and can have quadratic cost. This was deferred outside ranking work.
- The ranking index assumes graph nodes are not replaced or structurally mutated in place without changing map identity/size.
- Reported estimated `tokensUsed` has a digit-boundary caveat; it is not exact tokenizer output.
- Some C# forms, including `global::` imports, remain untested or unsupported. Unsupported-callable diagnostics are not exhaustive.

## Resume in this order

1. Read the latest review links below, especially the remaining graph divergences. Keep core software completion separate from empirical completion.
2. Have Luna align the evaluation adapter with the production tool behavior, or explicitly redesign the treatment before calling it a production comparison. Have Haiku independently verify the result.
3. Close representative-fixture and measurement gaps. Record unavailable metrics honestly rather than inventing them.
4. Freeze a concrete limited-smoke proposal with manifest, rubric, source/adapter/dependency identities, exact model/settings, repetitions, environment, and isolation/credential boundaries.
5. Obtain explicit user execution approval before any model-backed smoke or matched run. No approval artifact has been created.
6. Run the approved smoke, then obtain approval for any larger run set. Score blind to treatment where practical, retain failures, and report paired uncertainty before deciding keep/restrict/retire.

Do not retune tasks or the rubric after seeing real outcomes. An unfavorable or inconclusive result is valid.

## References and repository state

- [Second implementation plan](../IMPLEMENTATION_PLAN_2.md)
- [Core software review](IMPLEMENTATION_2_FINAL_REVIEW.md)
- [Binding review](IMPLEMENTATION_2_BINDING_REVIEW.md)
- [Freshness acceptance](IMPLEMENTATION_2_FRESHNESS.md) and [review](IMPLEMENTATION_2_FRESHNESS_REVIEW.md)
- [Evaluation proposal and adapter limits](IMPLEMENTATION_2_EVALUATION.md)
- [Latest offline evaluation review](IMPLEMENTATION_2_EVALUATION_FINAL_REVIEW.md)
- [Original evaluation protocol](QUALITY_EVALUATION.md)

The branch is `feat/csharp-support`, tracking `origin/feat/csharp-support` in the user's fork. This delivery combines preserved first-pass work with the second implementation pass, evaluation preparation, and this handoff. Local `.pi/plan-mode/` state is not a project deliverable and is excluded.

Before the newly requested commit, the raw index was byte-identical to the saved baseline. A local worktree/index backup exists at `C:/Users/jnikla/AppData/Local/Temp/pi-mindplace-mp2-baseline-20261016-092614`. That path and the globally approved subagent validators are machine-local conveniences, not prerequisites supplied by this commit.

For continued delegation, use Luna for implementation and Haiku for independent review/refactoring. The parent remains responsible for planning and coordination. The user's latest instruction explicitly authorizes committing and pushing this handoff; older no-commit notes describe the implementation phase, not this delivery step.
