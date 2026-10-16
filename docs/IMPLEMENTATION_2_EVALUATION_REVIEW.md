# MP2-07 offline harness preparation review (Haiku audit)

Status: **harness readiness only. No model, provider, or agent process was launched; no approval artifact was created; no empirical result, keep/restrict/retire decision, or savings claim exists.** Offline smoke output is harness simulation, not evidence.

## Software verification (this pass)

- `mindplace-focused-tests`: ok, 41/41 pass (includes offline smoke and approval-gate tests).
- `mindplace-full-tests`: ok, 77/77 pass.
- `mindplace-diff-check`: ok (only CRLF advisory warnings).
- `mindplace-staged-diff-check`: ok.
- `build`: run once as final check (see parent-visible result).
- `mindplace-dev-validate`, strict-isolated run and `package-lock` were not run by this job; the parent must run them.
- Language-server noise: `tests/tool-regressions.test.ts` TS2307 on `@earendil-works/pi-coding-agent` and JSON syntax diagnostics on `.schema.json` files are LS artifacts, not validated failures; the executed test suite passes.

## Changes made in this pass

| Severity | Finding | Disposition |
|---|---|---|
| Major (blinding) | `blindId` was `sha256(runId, taskId, repetition, treatment)`; `runId`, task and repetition are in the public score sheet, so a scorer could unblind by testing two treatment values. | Fixed: random 96-bit blind IDs; mapping only in sealed key. |
| Major (arm confound) | Graph arm wrote `graph-out/` into the fixture workspace and session home/temp/session dirs were also inside the workspace, so ordinary `search_text`/`list_files` could see graph artifacts only in the graph arm. | Fixed: graph artifacts (`graphs/<session>/graph.json`) and isolated home/session/temp dirs live outside the workspace; request `graph.graphPath` points there. Adapter must read the graph from that path. |
| Major (adapter identity) | Approval pinned the adapter command/args but not the adapter file content; a changed entry file could run under an approved command string. | Fixed: approval must carry `adapterEntry` (one of the frozen args) and `adapterEntrySha256`; verifier refuses mismatch/unreadable file. Schema updated. |
| Major (forgery of settings/version) | Adapter reports were checked for provider/model only; adapter could not be held to the approved settings or adapter version. | Fixed: response must echo `adapterVersion` and `settings` (canonical JSON equality). |
| Minor (analysis integrity) | Duplicate (task, repetition, treatment) rows silently overwrote pairs; paired repetition count was not checked against the manifest. | Fixed: duplicate rows and wrong paired-repetition counts throw. |
| Documentation | Adapter protocol/approval docs did not describe the above. | Updated `docs/IMPLEMENTATION_2_EVALUATION.md`. |

## Remaining blockers (not fixed; must not be claimed as runnable)

1. **No live adapter exists.** Nothing implements the `pi-mindplace-mp2-adapter-v1` protocol against Pi SDK 1.2.0 with an ordinary-tool surface, optional graph tools, one fresh session per invocation, isolated home/temp/session, or faithful usage reporting. Harness readiness ≠ real execution capability. **Blocker.**
2. **Unverified model/provider.** `gpt-4.1-mini` on the OpenAI API has not been verified for this account or availability; no user-approved evaluation model exists. Parent only verified github-copilot Luna/Haiku profiles, not OpenAI auth. **Blocker** for the execution gate. Proposal must be re-verified (exact model id, revision, supported temperature/top_p/max-output/reasoning controls) before approval.
3. **Budget and tool-call limits are not enforced by the runner.** The proposal cites a 16,000-input-token cap and tool-call limits; the runner only records what the adapter reports. The adapter must enforce them and report them; the runner cannot prove them. **Blocker for the claim of equal context/tool budgets.**
4. **Provider-level attestation is absent.** Harness validates reported tool names and paths, not actual tool routing, billed usage, or model revision. Reported values are adapter self-reports.
5. **Source/harness reproducibility boundary is partial.** `harnessSha256` covers only `scripts/mp2-eval.mjs`; the graph builder imports `src/*`, and approval does not pin a source tree/revision hash. Approval must include the package source revision or a source-tree digest. **Major, open.**
6. **Settings are not enforced by the runner.** Settings are passed to the adapter and echoed; the adapter itself must apply them. Honest, but not verified.
7. **Categories are thin.** `large-csharp` is 12 files (four target symbols) — a small-medium project, not a large navigation fixture; the label "large" should not be checked off. The `empty` fixture contains README.md and .gitkeep, and `unsupported` is a single RST note. Required categories should not be marked satisfied on name alone. Recommend adding a genuinely larger C# fixture (e.g., dozens of files with multi-hop call chains) before claiming large-project coverage; the manifest is still changeable before approval.
8. **Blind scoring leakage risk remains in free text.** Answers may mention "Mind Place", "graph", or tool names, revealing the arm. The score sheet is not redacted. Scorers must be instructed; or the adapter/answer must be normalized before scoring. Open.
9. **Cost accounting.** Cold graph build is charged in full on repetition-1 rows; reusable rows charge the single stage build divided by reuse count. The stage build is performed outside any charged session, and the copy cost is not measured. Accounting is honest only as documented; any savings claim requires separate review. Keep as documented; no change.
10. **Graph arm graph-tool availability is advisory only.** The adapter must expose only the same ordinary tools in both arms and the optional graph tools in the graph arm; the runner cannot mediate this. Same as item 4.
11. **Pairing/bootstrap.** Pairing is by task and repetition with randomized treatment order; overall CI is a task-cluster bootstrap with 10,000 resamples. Low pair counts (3 per task) make per-task intervals wide; the decision rule (≥3 complete pairs per category, non-inferiority margin 0.5/5) is a proposal only, not validated by any data.

## Concrete next fixes for Luna

1. Implement a real adapter against the `pi-mindplace-mp2-adapter-v1` protocol (Pi SDK 1.2.0), reviewed, with one fresh session per invocation, isolated home/temp/session dirs, same ordinary tools and map context in both arms, graph tools only in the graph arm, and faithful usage/tool-event reporting. Use a fake/offline adapter for tests only.
2. Add a source-tree digest (or revision pin) to approval and verify it; extend `harnessSha256` coverage to imported `src/*` the graph builder uses.
3. Enforce the context/tool-call budget inside the adapter and report the applied limits; the runner should record them in provenance.
4. Re-verify the OpenAI model identifier, revision, and supported settings; if `gpt-4.1-mini` is unavailable or lacks the proposed controls, produce a revised proposal and send it for review.
5. Replace or add a truly large C# navigation fixture; do not claim "large" coverage until it exists.
6. Add a scorer instruction/redaction step for arm-revealing words in answers.
7. Re-run `node scripts/mp2-eval.mjs --proposal` after changes and let the parent route the concrete proposal for user authorization. No model run until explicit approval.

## Validation evidence

- focused 41/41, full 77/77, diff-check ok, staged-diff-check ok (this pass).
- Parent must still run: `mindplace-dev-validate` (fresh install/strict/full/focused) and any strict isolated checks; this job did not run them.

## Non-evidence statement

The offline smoke remains a harness simulation (`harnessSimulation: true`, `empirical: false`, `decisionEligible: false`). It proves plumbing, not correctness, cost, latency, or usefulness.
