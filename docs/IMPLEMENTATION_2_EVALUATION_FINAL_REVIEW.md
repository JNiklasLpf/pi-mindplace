# MP2-07 final offline readiness review (Luna4036126d retained snapshot, final pass)

Status: **software/harness preparation only. Evaluation prep readiness is NOT granted.** No real Pi `ModelRuntime`/`AgentSession`, no provider/model call, no credential or auth-file read, no approval artifact was created or used. No real smoke, matched run, blind scoring, or analysis was executed. No keep/restrict/retire eligibility is claimed.

## Distinction of states

| Layer | State |
|---|---|
| Core MP2-01..06 software | Accepted baseline (strict 75 / focused 39 at the earlier baseline); not changed here. |
| Offline adapter/harness software | Complete for offline fake-injection tests; one major SDK-conformance defect fixed in this pass (below). |
| Evaluation preparation readiness | **Blocked by open items listed below** (not rubber-stamped). |
| Real smoke / matched run / blind scoring / analysis | **Unexecuted.** No evidence exists. |

## Validation evidence (fresh, this pass)

| Check | Result |
|---|---|
| `mindplace-dev-validate` (run before the edit below, on the retained snapshot) | ok; 79 tests / 79 pass / 0 fail; coverage: adapter 62.70% line. |
| `mindplace-focused-tests` (after the fix) | ok; **43 / 43 pass**, 0 fail. |
| `mindplace-full-tests` (after the fix) | ok; **79 / 79 pass**, 0 fail; coverage all files 83.34% line. |
| `mindplace-diff-check` | ok (only CRLF advisory warnings). |
| `mindplace-staged-diff-check` | see parent-run note below. |
| `build` / strict isolated typecheck after the final edit | **Not re-run by this job after the final edit**; the parent must run `mindplace-dev-validate` (strict isolated, SDK 1.2.0 declarations) and `build` once more. |

Note: the prior review's totals (full 77 / focused 41) are superseded by the current counts above. The runner's `Luna4036126d` timeout produced no completion report, so no totals from it are used.

## Fixes applied in this pass

1. **Major (SDK conformance, context guard).** Pi 1.2.0 exports `estimateTokens(message: AgentMessage): number` per message (`dist/core/compaction/compaction.d.ts:64`). The adapter called `estimateTokens(messages)` with the whole array, so the 16,000-token pre-request guard would have operated on a wrong input in the live SDK. The fake in `tests/tool-regressions.test.ts` ignored its argument (`() => estimate`), so the defect was self-fulfilling and undetected. Fix: `approximateMessageTokens` now sums `estimateTokens(message)` over the assembled messages and returns `null` on any non-finite or negative value; both `prepareRequest` and `transformContext` now **fail closed** on `null` (previously `null` silently allowed the request). The fake now asserts the per-message argument shape (`message.role` is a string) and returns the estimate.
2. Test-only: fake shape assertion as above. No suppression, no strictness change.

## Conformance audit against documented/declared Pi 1.2.0 APIs (verified from installed `.d.ts`, not from docs)

Verified present with matching shapes:
- `ModelRuntime.create(options)` with `authPath`, `modelsPath`, `allowModelNetwork`, `refreshOnCreate` (`dist/core/model-runtime.d.ts`). `getModel(provider, id)` exists.
- `createAgentSession` options used: `cwd`, `agentDir`, `modelRuntime`, `model`, `thinkingLevel`, `tools`, `noTools`, `customTools`, `resourceLoader`, `sessionManager`, `settingsManager` (`dist/core/sdk.d.ts`).
- `SessionManager.inMemory(cwd)`, `SettingsManager.inMemory(settings)`, `DefaultResourceLoader` exported; `cacheWarming` and `defaultThinkingLevel` are valid settings keys (`settings-schema.d.ts`).
- `session.agent` (public readonly `Agent`) with `beforeToolCall`, `prepareRequest` (receives `{context, model, thinkingLevel}`), `transformContext`, `abort()`; `session.getActiveToolNames()`, `prompt(text, options)`, `subscribe`, `getSessionStats()`, `getLastAssistantText()`, `dispose()`.
- Events `message_end`, `tool_execution_start` (`toolName`, `args`), `tool_execution_end` (`durationMs?`) match the adapter's usage.

**Former open items, now closed by declaration/source reading in job 005d7ec7 (offline; no SDK runtime launched):** see the closure section below.

## Remaining readiness blockers (open; do not waive)

1. **No live Pi execution has ever occurred.** The adapter is conformant only where the declarations above match; the injected fakes exercise the adapter's own logic, not the SDK's runtime behavior (e.g., whether `prepareRequest`/`transformContext` are actually invoked by the agent loop with those argument shapes).
2. **Token/measurement truthfulness.** Input/output counts are Pi-normalized assistant-message usage, not billing or provider attestation. Tool declaration/prompt splits are nullable and reported as `null`. Context is a Pi estimator bound, not an exact provider token cap. The MP2-07 original actual input/output overhead acceptance remains **open** unless measured by a real run.
3. **Time guard is only the harness `spawnSync` timeout** (600 s, hard kill). A killed run has no usage; it is recorded as an adapter failure. The adapter has no internal wall-clock guard.
4. **Graph equivalence against the optional production Mind Place tool is not verified.** The adapter's `mindplace_query`/`explain`/`build` implement their own wrappers over `src/*` APIs (`query`, `formatQueryResult`, `extract`, `detect`, `makeGraphMetadata`, `KnowledgeGraph.fromJSON`). No comparison test against the production extension tool surface was added in this pass. Any essential divergence is a blocker; this is **unverified**.
5. **Privacy/session isolation** is enforced by directory layout and env pass-through (`HOME`/`PI_CODING_AGENT_DIR`/temp, `PI_OFFLINE=1`), with symlink refusal in ordinary tools. Real Pi isolation (e.g., whether `agentDir`/`authPath` fully prevents reading the user's private store) is not demonstrated without a live SDK.
6. **Score blinding.** Random 96-bit blind IDs, sealed key, and free-text normalization of arm terms (`graph`, `Mind Place`, treatment labels, tool names) are in place. Normalization is regex-based and cannot prove that answers reveal no arm information; scorers must still be instructed and the risk remains.
7. **Pairing/analysis** is by task and repetition with seeded randomized treatment order; duplicate and missing-pair checks exist. Pair counts per task are small (three repetitions in the manifest); per-task intervals are wide. Decision rule is a proposal only.
8. **Task categories.** `large-csharp` remains a small/medium fixture; "large" coverage must not be claimed. Category boundaries are not independently validated.
9. **Dependency closure.** `sourceTreeSha256` covers `src`, both adapter/harness scripts, `package.json`, `package-lock.json`, and `assets/vis-network.min.js`. It does not cover the globally installed SDK tree; the SDK version is pinned by name in the approval only. A real approval would need the SDK package integrity recorded.

## Offline conformance closure (job 005d7ec7)

Evidence source: installed `@earendil-works/pi-coding-agent` 1.2.0 declarations and the nested pinned `pi-agent-core` / `pi-ai` packages under the global install (`.../pi-coding-agent/node_modules/...`). Provenance caveat below.

| Former open item | Declaration / source evidence | Result |
|---|---|---|
| `BeforeToolCallResult` `block`/`reason`/`terminate` | `pi-agent-core/dist/types.d.ts:44-53`; `agent-loop.js:507-512`: `block` returns an error tool result with `reason`; `terminate:true` on a blocked result sets `result.terminate`, and the batch stops only if every finalized result sets it. The adapter's limit branch (`block`, `terminate`, `reason`, then `agent.abort()`) matches. `agent.js:316` reads `this.beforeToolCall` at run time, so the instance reassignment takes effect. | Conformant |
| `DefaultResourceLoader` options | `resource-loader.d.ts:70-88`: `cwd`, `agentDir`, `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`, `systemPrompt: string`, `appendSystemPrompt: string[]` all exist. | Conformant |
| `SessionStats.tokens` | `agent-session.d.ts:201-219`: `tokens: {input, output, cacheRead, cacheWrite, total}`. Adapter uses only `input`/`output` as the no-event-usage fallback. | Conformant |
| assistant `usage` (pi-ai) | `pi-ai/dist/types.d.ts:274-295`: `Usage` has `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost`. Adapter reads `input`/`output` only. Tool-declaration and prompt splits are not in `Usage`, so they stay `null`. | Conformant |
| `retry` / `compaction` / `cacheWarming` / `defaultThinkingLevel` | `settings-schema.d.ts`: `compaction.enabled`, `retry.enabled`, `retry.maxRetries`, `cacheWarming` in `off`/`streaming`/`idle`, `defaultThinkingLevel` including `off`. `settings-manager.d.ts:70`: `inMemory(settings?: Partial<Settings>)`. | Conformant |

Also verified: `estimateTokens(message)` is per message (fixed in the prior pass). `prepareRequest` gets `{context, model, thinkingLevel}` and returns `AgentRequestUpdate` (`model?`), which the adapter uses.

**Defect fixed in this job (concrete mismatch, production vs adapter):** the adapter's `mindplace_query` default budget was 2000; production `src/tools/mindplace-query.ts` defaults to 4000. The adapter now defaults to 4000 (`scripts/mp2-pi-sdk-adapter.mjs`).

**Graph equivalence test (new, `tests/tool-regressions.test.ts` "production-vs-adapter graph query equivalence"):** the adapter builds the external artifact with the real `src` APIs, then its `mindplace_query` output is compared with production `query`+`formatQueryResult` on the same artifact (explicit budget 2000 and default budget 4000). Both pass.

**Final validation (job 005d7ec7, post-edit, run by this job):** focused 44/44 pass; full 80/80 pass (line coverage all files 84.06%); `mindplace-diff-check` ok; `mindplace-staged-diff-check` ok; `mindplace-dev-validate` strict totals are recorded in the subagent result, not in this document. The earlier counts in the validation table above are superseded.

**Remaining graph divergences (explicit, not waived):**
- The freshness gate is different. Production uses `inspectGraph` status `verified_current`; the adapter uses its own root/schema/scanComplete/inventory equality check. Both should refuse the same stale fixtures, but this is not proven by a test.
- The `graphInfo` header string differs (production includes the graph path and status; adapter uses `verified external evaluation graph`). The test passes the same string on both sides, so it tests the query/format core, not the header.
- `mindplace_explain` is not compared with production `MindplaceExplainTool`. This is an open residual blocker.
- `mindplace_build` in the adapter is an external-artifact-only rebuild, not production build. It is not equivalent by design.
- The adapter caps `budget` at 4000 in the tool schema; production has no maximum.

**Provenance / integrity boundary:** `package.json` pins `@earendil-works/pi-coding-agent` 1.2.0 and `package-lock.json` records its integrity (`sha512-h/4WaVWv...`) and `pi-ai` 1.2.0. No local `node_modules` exists in this worktree, so the adapter's live import (`loadLiveDependencies`) resolves nothing here. Offline tests use injected fakes only. Global declarations are design evidence, not runtime provenance. A snapshot with `npm ci` must record the lock integrity before any runtime use.

**Limited smoke readiness (offline conformance only):** the four declaration items and the query-core equivalence are closed offline. A limited smoke proposal is therefore approval-ready to write, but it is NOT approved. The following remain smoke-preflight or runtime questions, not offline defects: real `createAgentSession` loading from the pinned local SDK; whether the live agent loop calls the hooks with the same argument shapes; account entitlement for `github-copilot/gpt-6-luna`; network/provider control compliance; actual token and time measurements. Full matched evaluation readiness remains open (explain equivalence, freshness-gate equivalence, and real measurements).

## Explicit non-claims

- No empirical result, no completed evaluation, no savings or quality claim, no keep/restrict/retire eligibility.
- The offline smoke remains a harness simulation (`harnessSimulation: true`, `empirical: false`, `decisionEligible: false`).
- The user's exact model choice (`github-copilot/gpt-6-luna`) is **not** execution approval. ACTUAL model execution, including smoke, is not approved.

## Concrete next safe decision

No approval-ready proposal is issued by this job. Recommended next steps (parent-controlled):
1. Parent runs `mindplace-dev-validate` (strict isolated) and `build` after this edit.
2. A bounded reviewer verifies the four unverified SDK items above against the installed declarations, and adds a comparison test for graph tool equivalence with the production Mind Place tool surface (or records the divergence as a blocker).
3. Only after those, the parent may ask the user whether to approve a fixed, reviewed snapshot for a *smoke* run. No automatic run request and no credential access is made by this job.
