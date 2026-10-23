# MP2-07 evaluation proposal — GitHub Copilot GPT-6 Luna

**Status: offline validation complete; live execution declined.** No real Pi session, provider/model request, credential lookup, approval artifact or empirical trial was created or performed. The user reviewed the exact two-session proposal and chose **Stop at offline validation**. A canned two-session simulation ran without a model. All real execution requires a new explicit decision. See [the current validation ledger](BRANCH_VALIDATION.md) for strict typecheck, 90/90 full tests, 54/54 focused tests and independent re-audit evidence. Offline tests establish plumbing, not quality, cost, latency or savings.

## Implemented harness and offline evidence

- Nine hand-authored tasks/rubrics over checked-in synthetic repositories; three repetitions and two randomized treatments yield 54 planned calls. The C# navigation fixture is now a 36-source-file multi-module repository with a six-step order submission route (controller → gateway → handler/policy → service/validator → repository contract/implementation), plus similar `SubmitAsync`, `Validate`, and `SaveAsync` names in unrelated feature modules. The target map and rubric are written independently of Mind Place output.
- `scripts/mp2-pi-sdk-adapter.mjs` implements `pi-mindplace-mp2-adapter-v1` using the documented Pi coding-agent SDK 1.2.0: one fresh `ModelRuntime` and `SessionManager.inMemory()`/`AgentSession` per invocation; exact model selection; a fixed, resource-isolated loader; custom read-only ordinary tools; graph tools only in the graph treatment; SDK session usage/tool events; and pre-request/tool-call limit guards. It does not import the SDK at module load: tests inject a fake SDK/runtime/session. No real SDK runtime is called by tests.
- The graph arm runs the actual production `MindplaceBuildTool`/`MindplaceQueryTool`/`MindplaceExplainTool` objects (production name, label, description, parameters, defaults, `inspectGraph` freshness) inside the disposable fixture workspace with a headless context (`hasUI: false`). The adapter only confines `path`/`file` arguments (safe, relative, nonhidden, inside the fixture) and records per-call wall time and artifact side effects (`usage.graphToolRuns`). Production build writes `graph-out/` and may create/modify `.gitignore` in the disposable workspace; these are recorded as `createdGraphOut`, `graphJsonPresent` (exists afterward, true even for read-only queries), `graphJsonChanged` (content-fingerprint difference; an identical rewrite is not observable), `createdGitignore`, `modifiedGitignore`. No external graph artifact is assumed.
- Approval freezes the manifest, fixture bytes, runner, adapter entry, package source boundary and lockfile. `sourceTreeSha256` covers every file under `src/`, both evaluation scripts, package metadata/lockfile, and the graph HTML asset. Approval is checked before adapter process launch and fails closed on any mismatch.
- `blind-score-sheet.json` contains arm/tool words normalized to neutral placeholders; raw answer text remains only in the arm-labelled raw result artifact and is not the scoring input. Instructions require independent per-task rubric scoring and linear 0–5 normalization by the same task maximum for both hidden arms, prohibit treatment guessing, and say navigation coverage alone is not answer quality. Preserve the original normalized scoring sheet and evidence; do not retune tasks/rubrics after outcomes.
- Offline conformance uses an injected fake SDK/session only and covers session freshness, exact allowlists, identical common prompt/map/settings, disabled model-network refresh, isolated auth path, pre-request budget abort, tool-call termination, SDK-style usage/tool events, and no real credential/provider path. Approval tests verify missing/tampered approvals fail before launch. These tests are not an agent trial.

## Pi SDK/model evidence and settings proposal

The installed **Pi coding-agent SDK 1.2.0** documentation and declarations were inspected, including SDK, models/providers/configuration/settings/sessions/security/compaction/environment/CLI integration and checked examples for custom models, tool allowlists, auth, in-memory settings/sessions and full control. The installed `pi-ai` raw Copilot catalog contains an exact **chat** model `github-copilot/gpt-6-luna` using `openai-responses`, model ID `gpt-6-luna`, 1,000,000-token advertised context, 128,000 maximum output, reasoning enabled and `thinkingLevelMap.off = "none"`. This is static installed catalog metadata, **not** proof that the user's runtime registry, Copilot subscription, account entitlement, credentials, service availability, or any server-side revision is available. The adapter never probes auth/model availability during offline tests; it selects the exact ID offline and will fail closed if absent in a future authorized process.

The settings to freeze for review are exactly:

```json
{
  "contextEstimateTokens": 16000,
  "maxOutputTokens": 2048,
  "ordinaryToolCalls": 32,
  "graphToolCalls": 16,
  "timeLimitSeconds": 600,
  "thinkingLevel": "off"
}
```

There is deliberately **no** temperature, `top_p`, sampling override, or reasoning-effort field: this proposal does not assume that the Copilot endpoint accepts those controls. Pi's exact Luna catalog maps thinking `off` to provider `none`; a future dry preflight must still confirm effective session model/thinking selection without sending a prompt. The output cap is set in the per-session model `maxTokens` and reduced to remaining total output budget before each request; over-cap reported usage fails closed. Ordinary tool allowance is exactly `list_files`, `search_text`, `read_file`, and `read_diff` in both arms. The graph treatment alone has optional `mindplace_query`, `mindplace_explain`, and `mindplace_build`; the map treatment has none. The same task text, fixed system instructions and fixture README map are used in both arms.

**Control/measurement semantics are intentionally limited and explicit:**

- The 16,000 context bound is a hard pre-provider-request abort using Pi's documented character/token estimator (`estimateTokens`) over the assembled SDK context. It is an **estimated context bound**, not exact provider tokenization, server enforcement, or billed input-token cap. The estimator is checked before each request; if it exceeds the cap, the agent is aborted before another provider request.
- Maximum output is capped through Pi's model `maxTokens` request setting and the adapter tracks remaining aggregate response usage across turns. It is the strongest SDK-level control available here; an endpoint ignoring/rewriting the field cannot be independently attested. Any Pi-normalized usage beyond 2,048 fails validation.
- `beforeToolCall` blocks the 33rd ordinary call or 17th graph call and aborts the session. Identical ordinary-call ceiling in both arms; no shell, write, edit, MCP or other tools are loaded.
- Parent harness hard-kills an adapter process after 600 seconds. This is process wall time, not provider server execution time.
- Input/output totals come from Pi-normalized assistant message usage. The SDK does not attest whether every count is provider-originated versus normalized/fallback, and there is no independent Copilot billing/identity attestation. Tool declaration and prompt token splits are `null` (unmeasured, not zero). Tool call names come from SDK events and durations are retained only when the event supplies them. Target retrieval and wrong-target detours are not supplied to the adapter (that would leak rubric targets); adapter reports `wrongTargetDetours: null`; answer correctness remains a blind human-rubric task.

## Isolation, authentication and graph routing

Each attempt gets a separate workspace, home/config directory, session directory, temp directory and (graph artifacts are production `graph-out/` inside the disposable workspace, hidden from ordinary tools). The SDK uses `ModelRuntime.create({ authPath: <isolated>/auth.json, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })`, in-memory settings/session state and no discovered extensions/skills/prompts/themes/context files. No auth file is copied or created. In an authorized process, Pi's documented provider credential interface may resolve only `COPILOT_GITHUB_TOKEN`; the parent passes through that environment variable alone from provider credentials, never logs or serializes its value, and does not read private Pi session history. Other unrelated environment variables are not inherited (except minimal process/platform variables). This is credential pass-through, not evidence a token is set or valid. The parent must specifically authorize the future Copilot provider request before any such process runs.

Ordinary file tools resolve paths inside the fixture, reject symlinks/path escapes, have bounded reads, and cannot execute commands or write. Optional graph tools are the production tools rooted at the fixture workspace; production freshness verification returns no graph information for missing/stale/corrupt graphs. Ordinary list/search/read tools reject and skip (including during recursion) any `graph-out` path segment (case, trailing-dot, 8.3 variants), the root `.gitignore`, and colon-containing segments; symlinks are rejected/skipped.

## Reproducible approval proposal (not approved)

- **Provider/model:** `github-copilot` / `gpt-6-luna`, exact chat model only; no fallback/alias. The adapter/approval require exactly this pair. The catalog's display ID is not a provider-side model revision attestation.
- **Absolute adapter paths:** the adapter is spawned with the fixture workspace as cwd, so `adapterEntry` must be an absolute path identical to the corresponding `adapterArgs` element (relative entries are rejected); use an absolute adapter command too (e.g. the full path to `node`) so PATH is not trusted.
- **SDK provenance:** approval records `piSdkIntegrity` (the `package-lock.json` sha512 for the exact pinned dependency). The runtime adapter checks the `package.json` pin, lock version/integrity, and the version of the actually resolved SDK package (static file reads only; installed bytes are not re-hashed, and no auth/session/ModelRuntime is created by the check).
- **SDK/adapter:** Pi coding-agent SDK `1.2.0`; adapter ID `pi-mindplace-mp2-pi-sdk-luna`, version `mp2-pi-sdk-luna-1.0.0`; exact adapter command/argument vector, entry SHA-256, runner SHA-256, and source-tree digest must be supplied in a manually authorized artifact.
- **Controls/treatments:** the exact JSON settings above, same common prompt/map and ordinary allowlist, graph tools optional only in graph arm. Repetition 1 is charged cold graph build; repetitions 2–3 use reusable graph preparation with build duration amortized as reported.
- **Design/environment:** 9 tasks × 3 repetitions × 2 arms = 54 invocations; seed `271828`; pair by task/repetition and randomize arm order. Freeze current Node version, platform, architecture, OS, CPU, locale and timezone from `--proposal`; any mismatch stops. The approved source digest covers all project source imported by the runner/adapter, tool declarations/implementations, package lock and visualization asset; the fixture digest separately covers all fixtures.
- **Scoring/analysis:** use the fixed rubric and treatment-neutralized score sheet only; preserve scorer evidence, adjudicate disagreements before unblinding. Normalize each task score by that task's fixed max onto 0–5 equally for either treatment. Report every task/repetition pair and failures; overall interval is task-cluster bootstrap with 10,000 resamples. Decision eligibility remains false; an independent human review is mandatory.

Print the proposal only (no session/model/provider process):

```text
node scripts/mp2-eval.mjs --proposal
```

Before any run the authorized user must review the *current* proposal/digests, registry/auth preflight boundaries, exact runtime SDK/model and environment, fixture/rubric, adapter behavior, and scoring instructions. They must then explicitly authorize creating a manual `evaluation/execution-approval.json` conforming to the schema. No approval was created by this work. The approval verifier checks the exact model, supported controls, source/harness/adapter/fixture/manifest/rubric/environment hashes, command arguments, SDK and adapter versions before fixture execution or process launch. The gated form, only after approval, is:

```text
node scripts/mp2-eval.mjs --run --manifest evaluation/task-manifest.json --approval evaluation/execution-approval.json --adapter <ABSOLUTE_PATH_TO_NODE> --adapter-arg <ABSOLUTE_PATH_TO>/scripts/mp2-pi-sdk-adapter.mjs --out evaluation/artifacts/approved-run-001
```

Offline canned simulation remains separate and permanently marks all artifacts `harnessSimulation: true`, `empirical: false`, `decisionEligible: false`:

```text
node scripts/mp2-eval.mjs --smoke --out evaluation/artifacts/offline-smoke
```

## Revised fidelity contract and issue ledger (implementation pass)

The harness intends to run in disposable fixture workspaces; graph artifacts must remain outside ordinary list/search/read visibility, and source/path filtering must reject escapes and symlinks. Build effects and elapsed time must be retained, including generated artifacts and any `.gitignore` change. Production build's automatic ignore behavior can modify fixture sources, so a production-equivalent build must capture/restore or explicitly account for that mutation before ordinary-arm comparisons; never silently expose the delta as an ordinary-treatment difference.

A one-task, two-arm, one-repetition manifest is now present at `evaluation/smoke-task-manifest.json`, explicitly labeled `LIVE SMOKE ONLY` and `decisionEligible:false`. Full evaluation remains guarded at two repetitions. This proposal is not execution authorization; no approval artifact, credential access, model execution, or smoke was created. Approval schema permits a one-repetition tuple only with the described smoke manifest; the runner enforces it: `liveSmoke:true` requires exactly manifest ID `mp2-live-smoke-v1`, `decisionEligible:false`, one task and one repetition; every other manifest needs at least two repetitions. Results carry `liveSmoke`; the result schema allows one repetition only then.

Scorer-key boundary: only `blind-score-sheet.json` is shared with scorers; `scoring-key.sealed.json` and raw results live in the same output folder and must be withheld by the operator (no technical separation is implemented).

Issue ledger:
- **VALIDATED / major:** adapter uses the actual production graph tools; passing regressions compare schema, description and output (query, explain exact/ambiguous/no-match/filters, missing/stale/corrupt).
- **VALIDATED / major:** harness provisions through the production build tool in the disposable workspace (reusable runs copy a production build's graph-out/.gitignore and rebase only the recorded root); build time/status/side effects are recorded in rows.
- **VALIDATED / major:** ordinary tools block graph-out/.gitignore in read/search/list and recursion; graph path/file arguments are confined. DOS short-name (`~digit`), trailing dot/space variants and root `.gitignore` variants are blocked; a junction/symlink escape regression exists (skipped only if the OS refuses link creation). Incomplete freshness metadata and pre-cancelled-signal equivalence with production are regression-tested.
- **DONE / minor:** smoke manifest is explicitly one-task/one-repetition/two-arm and decision-ineligible; schema documents the exception. Runner validation is enforced (see above).

## Measurement and abort semantics added in the audit pass

- Missing assistant usage is reported `null` (never fabricated zero); a legitimate zero is kept zero. Missing tool durations are `null`. Failed attempts record `inputTokens/outputTokens: null`, empty tool calls, and `wrongTargetDetours: null`. Context, tool-call and output-limit stops are recorded as attempt `failures` with the reason (and `usage.stopReason`). `analyzeScoredResults` refuses any failed attempt or null/missing metric rather than coercing zero.
- Static evidence from the locally installed Pi 1.2 `pi-agent-core` (`agent-loop.js` ~123–142, ~263–276): `prepareRequest`, `transformContext` and the provider call run unconditionally, so `abort()` alone does not prove a pre-provider stop. The context/output guards therefore set a flag, call `abort()`, and **throw** a local limit exception from the hook; offline tests show a fake provider callback is never reached after the throw. This is local 1.2 source evidence (not the 1.3 global docs); the real Agent loop and actual provider abort hooks remain unverified and no runtime claim is made.

## Remaining uncertainties/blockers

1. No user-approved runtime preflight or Luna/Copilot session has been performed; exact account availability, token validity and live server behavior/revision remain unknown.
2. Pi SDK usage is normalized/self-reported, not independently provider-attested; tool declaration/prompt usage splits and correctness detours cannot be independently measured by the adapter.
3. A Pi context estimator cannot guarantee an exact token-level provider context cap. This must remain labelled approximate and cannot support exact token-budget claims.
4. SDK controls and static catalog do not guarantee the remote Copilot endpoint honors the output cap/thinking mapping; any observed discrepancy blocks the real trial and requires new approval.
5. These 36 C# files provide meaningful multi-hop/ambiguity navigation, but the fixture remains synthetic and is not representative of a production-sized repository.
6. Empirical execution, blinded scoring, cost/savings conclusions, and any keep/restrict/retire decision remain unapproved and unrun.
