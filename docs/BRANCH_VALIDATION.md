# Branch validation and offline-only handoff

## Decision

The user authorized fresh validation, CI alignment, production-tool fidelity fixes and preparation of a limited live smoke. They selected actual production tools in disposable fixture workspaces instead of separate external-artifact wrappers.

After reviewing the exact one-task, one-repetition, two-treatment proposal, the user chose **Stop at offline validation**. No execution approval artifact, credential-presence check, real SDK session or provider request was created or performed. No commit or push was requested or performed. A future smoke needs a new execution decision and freshly checked identities.

## Changes

- CI uses Node 26 on Linux and Windows, runs `node tests/validate-development.mjs`, and rejects lockfile drift. README points to the same authoritative command. Hosted CI results are not available from this local pass.
- The adapter delegates build, query and explain to the actual production tool objects, retaining schemas, defaults, descriptions, output and freshness behavior. Only the evaluation path restrictions and measurement wrapper are added. Production source/API files are unchanged.
- Production builds run in disposable fixture workspaces. Ordinary tools hide `graph-out/` and the root `.gitignore`, including recursive traversal, DOS short-name and trailing-dot/space variants. Path escapes and symlinks/junctions are rejected.
- Build status, elapsed time and observed artifact changes are recorded. Graph existence is distinct from a content change; identical rewrites cannot be inferred from fingerprints.
- `evaluation/smoke-task-manifest.json` defines exactly one task, one repetition and two treatment sessions. Malformed smoke designations are rejected; full evaluations still require at least two repetitions. Smoke results are decision-ineligible.
- Approvals require the absolute adapter entry, exact command/arguments and source/manifest/fixture/rubric/environment hashes. SDK provenance includes the declared 1.2.0 pin, lock integrity and actually resolved package version. Installed package bytes are not independently re-hashed.
- Missing usage and tool durations are null, not fabricated zero. Limit stops become attempt failures. Analysis refuses failed attempts or unavailable metrics.
- Context/output guards abort and throw before entering provider stream code. This is supported by pinned SDK source reading and fake-session regressions, not a live provider test.

## Executed validation

Environment: Windows x64, Node 26.8.1, npm 11.19.0.

| Check | Result |
| --- | --- |
| Initial isolated fresh-install validator | Strict typecheck passed; full 80/80, focused 44/44 |
| Final isolated fresh-install validator | Strict typecheck passed; full **90/90**, focused **54/54**, zero failures |
| JavaScript syntax checks | Both evaluation scripts passed `node --check` |
| Two-session canned simulation | Two result rows; `harnessSimulation: true`, `empirical: false`, `decisionEligible: false` |
| Simulation result schema | Validated with AJV 2020 against `evaluation/result.schema.json` |
| Windows junction support probe | Junction creation succeeded and `lstat().isSymbolicLink()` returned true |
| Independent re-audit | No blocker for the bounded two-session smoke; remaining limits below |
| `git diff --check` | Passed |
| Lockfile | No tracked change after validation |

The root dependencies were also installed with `npm ci --ignore-scripts`. Root type checking still encounters the known upstream pi-ai JSON-import declaration defect. The accepted type-check result comes from the isolated validator's guarded declaration-only correction; no declaration patch was applied to the root installation.

Local baseline/final validator logs were saved under the OS temporary directory as `pi-mindplace-baseline-validation.log` and `pi-mindplace-final-validation.log`. Temporary runtime/simulation copies were removed after the user declined live execution. They are not repository deliverables.

## Remaining work and limits

- Live SDK/session behavior, Copilot entitlement, credentials and endpoint compliance are unverified. The catalog containing `github-copilot/gpt-6-luna` is not evidence of account access.
- The 16,000 context bound is an estimator per request, not a cumulative input or billing cap. The 2,048 aggregate output guard relies on usage events; without usage, only the per-request output cap and tool/time limits apply. No dollar cap is established.
- Application-level workspace/path restrictions are not an OS sandbox. The harness timeout is process-side, not a provider cancellation guarantee.
- This is a production-tool treatment, not a complete replication of production extension discovery and passive lifecycle hooks.
- The C# fixture remains synthetic and small/medium. No quality, savings, latency, or keep/restrict/retire conclusion follows from offline tests.
- Only `blind-score-sheet.json` may be shared with scorers. Raw results and the treatment key share the operator's output directory and must be withheld operationally.
- Manifest task IDs are reviewed and digest-pinned, but the validator does not yet impose a path-safe slug pattern. The smoke task ID is safe.
- The junction regression returns early if the OS refuses link creation. This host supports junction creation, but another runner should report that coverage limitation if relevant.
- Pi's own failure messages can contain zero normalized usage. Such stopped attempts are flagged as failures and cannot enter paired analysis; those zeros are not provider billing measurements.

Core software and offline preparation are validated. Empirical MP2-07 work remains deliberately deferred by the user's decision.
