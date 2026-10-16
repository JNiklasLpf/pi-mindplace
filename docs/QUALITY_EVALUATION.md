# Mind Place quality evaluation

## Current evidence and limits

The deterministic regression suite is represented by `tests/freshness-quality.test.ts`, `tests/binding-regressions.test.ts`, and tool-level tests. It exercises a synthetic noise-heavy C#-shaped graph, explicit test retrieval, file-only navigation, import/call binding, ambiguity, multiple project roots, final formatted-output estimation, and freshness beyond 200 files. These tests are included in `npm test`.

**Execution status for this follow-up:** approved focused tests passed before edits (17/17) and after edits (19/19). The approved full suite passed before edits (52/52) and after edits (54/54). The fixture tests remain deterministic software regressions, not agent-outcome or efficiency measurements. No matched agent trials, token savings, latency savings, or end-to-end correctness comparisons have been executed or are claimed.

Freshness metadata v2 stores SHA-256 fingerprints for every detected supported source file. Older metadata without fingerprints is `unknown`, never presumed fresh. Each prompt still performs complete source inventory detection and re-hashes source bytes; caching that result across prompts using timestamps alone would miss same-size edits with preserved timestamps. Repeated hooks do reuse parsed graph JSON and the opt-in ranked map while their full graph-content hash is identical. Thus parsing/ranking work is avoided, but source walking/reading remains O(number of files + total source bytes) per hook. No standalone performance benchmark was run.

## Reproducible fixture protocol

Run `npm test` from the package root. For retrieval-quality comparisons, preserve fixed fixture files and query strings. For each fixture task record:

- expected target node IDs/files and whether they are retrieved in the first 5/10 results;
- whether the graph returns an actionable file-only result or an explicit no-match;
- estimated output tokens and actual formatted character count;
- false-positive categories (generated/attribute/test/vendor) and ambiguity behavior;
- freshness status following a source edit, addition, and deletion;
- call/import edge precision against the fixture's hand-authored expected edges.

Use synthetic/public fixtures only. Keep output-size measurements distinct from answer accuracy and graph coverage.

## MP2-07 harness status

The executable task manifest, explicit approval gate, result/blinded-scoring formats, and offline-only synthetic harness simulation are documented in [`IMPLEMENTATION_2_EVALUATION.md`](IMPLEMENTATION_2_EVALUATION.md). The smoke deliberately produces no model answer or empirical score. No model-backed matched trial has been approved or run; no keep/restrict/retire or savings conclusion is available.

## Matched agent-run comparison before savings claims

To evaluate optional graph navigation against a concise repository map plus ordinary search/read, use paired runs on the same public repository commit and isolated worktrees. Randomize task order and navigation treatment. Match model/provider, model settings, tool access, task wording, time limit, and starting context; repeat each task/treatment enough times to expose variance. Have a reviewer score task correctness blind to treatment. Record input/output tokens, wall time, tool calls, inspected source paths, answer correctness, and failures. Report paired distributions and uncertainty, not only averages. Include tasks where graph retrieval is expected to help and tasks where direct search is expected to win.

Keep or retire graph navigation based on the matched task-quality and cost evidence, not query estimates alone. Do not include private session transcripts or use historical private-session counts as a benchmark.
