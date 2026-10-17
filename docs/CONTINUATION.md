# Mind Place continuation summary

## Current position

The core software work in `IMPLEMENTATION_PLAN_2.md`, MP2-01 through MP2-06, is implemented and independently reviewed. MP2-07 remains empirically incomplete. The evaluation adapter now invokes the actual production build/query/explain tools inside disposable fixture workspaces, with path restrictions and generated artifacts hidden from ordinary tools. Offline comparisons and approval guards pass. No model-backed evaluation, real smoke trial, blinded scoring, or keep/restrict/retire decision has run.

In the latest follow-up, the user explicitly chose **Stop at offline validation** after reviewing the bounded two-session proposal. Do not run a live smoke or create an approval artifact without a new execution decision. No commit or push was requested in this follow-up.

Read [the current validation ledger](BRANCH_VALIDATION.md) first. It supersedes older adapter-divergence findings and test counts. Earlier plans and reviews describe historical snapshots; their execution or commit authorizations do not apply to new work.

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

The README and CI now use this validator as the authoritative fresh-validation path. The root dependencies have also been installed with lifecycle scripts disabled. Plain root `npm run typecheck` still encounters the known upstream JSON-import declaration defect; only the isolated validator applies the guarded correction. CI targets Node 26 on Linux and Windows and checks for lockfile drift. Hosted CI has not been run in this follow-up.

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

Latest parent-run post-edit evidence:

- Isolated fresh-install validator and strict full-workspace type check passed on Node 26.8.1 / npm 11.19.0, Windows.
- Full suite: **90/90 passed**.
- Focused suite: **54/54 passed**.
- Working diff whitespace check passed; package lock unchanged.
- Independent re-audit found no blocker for the proposed two-session smoke.
- A two-session canned simulation passed result-schema validation; no model was used.

These counts include offline harness tests. Fake SDK sessions and canned smoke artifacts prove plumbing, not agent correctness, usefulness, latency, or savings. The current files have not been exercised in an authorized model-backed trial.

## What remains

### Finish evaluation fidelity before full trials

The harness has task/rubric manifests, fixture hashes, execution-approval checks, seeded treatment ordering, separate workspaces, cold/reusable graph accounting, blinded score-sheet formats, and paired analysis. The adapter targets the user-selected `github-copilot/gpt-6-luna` for both arms.

The main remaining problems are:

1. Tool-level production fidelity is covered by direct production invocation and comparison regressions, including schemas, query/explain output and freshness states. This is a constrained tool treatment, not a complete production extension/lifecycle replication. Live SDK behavior remains unverified.
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

1. Read [the current validation ledger](BRANCH_VALIDATION.md) and keep software completion separate from empirical completion.
2. Respect the user's decision to stop at offline validation. No live execution is currently authorized.
3. If live evaluation is requested later, rerun validation, freeze a fresh source/manifest/environment proposal, and obtain explicit approval. The checked-in smoke manifest is one task, one repetition and two treatment sessions; the full manifest is not authorized by smoke approval.
4. Close representative-fixture and measurement gaps before a larger matched run. Record unavailable metrics honestly.
5. After an approved smoke, obtain separate approval for larger runs and blind scoring. Retain failures and report paired uncertainty before deciding keep/restrict/retire.

Do not retune tasks or the rubric after seeing real outcomes. An unfavorable or inconclusive result is valid.

## References and repository state

- [Current validation and offline-only decision](BRANCH_VALIDATION.md)
- [Second implementation plan](../IMPLEMENTATION_PLAN_2.md)
- [Core software review](IMPLEMENTATION_2_FINAL_REVIEW.md)
- [Binding review](IMPLEMENTATION_2_BINDING_REVIEW.md)
- [Freshness acceptance](IMPLEMENTATION_2_FRESHNESS.md) and [review](IMPLEMENTATION_2_FRESHNESS_REVIEW.md)
- [Evaluation proposal and adapter limits](IMPLEMENTATION_2_EVALUATION.md)
- [Latest offline evaluation review](IMPLEMENTATION_2_EVALUATION_FINAL_REVIEW.md)
- [Original evaluation protocol](QUALITY_EVALUATION.md)

The branch is `feat/csharp-support`, tracking `origin/feat/csharp-support` in the user's fork. This delivery combines preserved first-pass work with the second implementation pass, evaluation preparation, and this handoff. Local `.pi/plan-mode/` state is not a project deliverable and is excluded.

Before the newly requested commit, the raw index was byte-identical to the saved baseline. A local worktree/index backup exists at `C:/Users/jnikla/AppData/Local/Temp/pi-mindplace-mp2-baseline-20261016-092614`. That path and the globally approved subagent validators are machine-local conveniences, not prerequisites supplied by this commit.

The earlier delivery used Luna implementation and Haiku review, with a commit/push authorization for that handoff only. The current follow-up includes parent-run validation, CI/documentation changes and delegated adapter work with independent review. Its final user decision is offline-only; no commit, push or live run was performed.
