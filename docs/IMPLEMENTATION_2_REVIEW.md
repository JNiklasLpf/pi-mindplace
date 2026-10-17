# MP2-01 independent review ledger (Haiku review, job 1ea65082)

## Authoritative status (current)

MP2-01 **isolated acceptance passed** after the guarded declaration fix and source-conformance follow-up. The authoritative current evidence is in [`IMPLEMENTATION_2_PROGRESS.md`](IMPLEMENTATION_2_PROGRESS.md) and the final MP2-01 review section below: isolated fresh install, strict full-workspace typecheck, focused/full tests, and lock transfer succeeded. This file is a chronologically accumulated review archive. Earlier blocker/partial verdicts and the pre-fix TS1543 analysis are historical snapshots, superseded by that accepted run; do not treat them as current status. The open maintenance risks and removal condition remain described in the current progress ledger.

Scope: MP2-01 only (SDK/compiler setup, README/progress docs, `tests/validate-development.mjs`). No MP2-02+ work, no freshness changes, no git reset/stage/commit. Staging note: per parent bookkeeping, `.git/index` is byte-identical to the external baseline after Luna's release and `git status` still shows `A IMPLEMENTATION_PLAN_2.md`. Luna's "no staged diff" wording is an inaccurate reading of a silent successful `git diff --cached --check`, not evidence of lost staging. No further staging investigation performed.

## Current authorized declaration-fix attempt (Haiku review still required)

The user authorized a narrowly guarded declaration-only correction. The implementation pins only `@earendil-works/pi-ai` to 1.2.0 (Pi SDK remains 1.2.0; TS 5.9.3 / strict NodeNext unchanged), then in the isolated snapshot after scripts-disabled `npm ci` verifies the resolved SDK/ai versions, exact pi-ai 1.2.0 registry tarball SHA-512 (`sha512-U5/1zXqfV1on7/9sbez03tT4Ru49Lvfb4+zXSDK3DBKF5cRk6KxvAOTOY3HJ4jimlZth+rs7vbJqN6iBQAoNuQ==`), and exact 42-file model declaration inventory/import lines before changing declaration imports only. The helper is `tests/patch-pi-ai-declarations.mjs`; the existing fixed validator invokes it explicitly, not as an npm hook. No checked-out `node_modules`, runtime JavaScript, API definitions, source files, or lockfile were changed/transferred.

The validator's direct fixture regressions passed: attribute insertion, byte-identical idempotent second pass, wrong version rejection, and changed-import rejection without writes. The fresh install completed (Node 26.5.0, npm 12.0.2, 531 packages), and the correction got past the 32 TS1543 errors. **Superseded:** strict typecheck subsequently failed on three TS2345 tool-result incompatibilities at `index.ts` lines 54–56; job 40f9cead fixed those (see the final review section below). Current status: the isolated validator passed.

After this attempt, the approved checkout-local focused suite passed **19/19**, full suite passed **54/54**, and both diff validators passed (working diff reported existing LF/CRLF warnings; successful staged check was silent). These are existing-checkout tests, not isolated tests. The final build request failed with `tsc exited 1` and no diagnostics. The checked-in lock stayed unchanged because the isolated strict typecheck gate failed.

Maintenance condition: remove override/helper/validator invocation only when a supported upstream Pi SDK/pi-ai release ships model `.d.ts` imports with the correct JSON attributes; then verify with the same fresh strict validator. `README.md` and the progress ledger record this removal plan.
## Findings and dispositions

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| R1 | blocker (acceptance) | The approved validator ran twice after the user closed `/subagents-profiles` to reload its configuration (there is no `save` subcommand). Both isolated snapshots generated a lock and completed fresh `npm ci`. Run 1 strict typecheck failed on upstream TS1543 JSON import-attribute diagnostics, plus TS2694 (`path.PlatformPath`) and TS2307 (missing optional MCP SDK module). After adding dev-only dependency pins, run 2 cleared TS2694/TS2307 but still reports 32 TS1543 errors in `@earendil-works/pi-ai` model declarations under TypeScript 5.9.3 / NodeNext. Tests were not reached in the isolated validator, and `package-lock.json` was not transferred. | The TS1543 portion is resolved in the validator snapshot by the authorized correction described above. The former `index.ts` TS2345 blocker is closed by the source-type fix (R12). Acceptance evidence is in the progress ledger. |
| R2 | major (fixed) | Dependency pinning gap. `@earendil-works/pi-coding-agent` 1.2.0 declares `typebox` `1.3.27` as an exact dependency, but the package initially declared it only as a wildcard peer. | Applied: `typebox` 1.3.27 is pinned in `devDependencies`. Fresh typecheck evidence also found that the SDK's Node 22 declaration baseline and the optional `@modelcontextprotocol/sdk` module are needed for this workspace's declaration graph; `package.json` now pins `@types/node` 22.19.19 and dev-depends on `@modelcontextprotocol/sdk` 1.25.2. These changes cleared TS2694 and TS2307 in the second isolated attempt. No lock entry was hand-edited or transferred. |
| R3 | major (fixed, with bounded OS-level limitation) | Timeout cleanup on Windows. `spawnSync` with `shell: true` kills only the direct `cmd` child on timeout; calling `taskkill` only after `spawnSync` returns may be too late because the root PID may already be gone while descendants survive. | Applied: `run()` now uses asynchronous `spawn`, invokes `taskkill /pid <pid> /T /F` while the shell PID is still live, and waits for the child's `close` event (up to a 10-second cleanup grace) before failing. A `taskkill` failure or failure to close is surfaced and prevents lock transfer. This is materially stronger than the prior post-timeout attempt, but cannot guarantee OS cleanup if Windows refuses/fails the tree kill; descendants may outlive the cleanup attempt and scratch removal may fail, which remains an explicit residual limitation. |
| R4 | major (fixed) | `tests/.mp2-validation-scratch` can contain copied `.ts` files while validation runs. `tsconfig.json` includes `tests/**/*.ts`, so TypeScript could scan the snapshot unless explicitly excluded; the validator's snapshot exclusion alone does not affect tsc. | Applied: added only `tests/.mp2-validation-scratch` to `tsconfig.json`'s `exclude`. The existing explicit `include` for `index.ts`, `src/**/*.ts`, and `tests/**/*.ts` is unchanged, so ordinary source/tests remain included. No `.gitignore` change was made. |
| R5 | major (closed by supplied evidence) | `file:vendor/npm-check-updates` must be present in the snapshot or isolated install can fail. | Closed: parent confirmed `git ls-files vendor/npm-check-updates` is non-empty and lists tracked `index.js` and `package.json`; both are included by the snapshot's Git file list. No extra preflight is needed. |
| R6 | minor (open) | Node/npm lifecycle: `CI=1` and `--ignore-scripts` are set. `npm_config_ignore_scripts` is set in `run()`. This is correct, but the `npm install --package-lock-only` step does not set `--ignore-scripts` on the process env in the same way. Command-level flag is present, so no change needed. | Verified by reading. No change. |
| R7 | minor (open) | Each npm command is bounded at 7 minutes and the overall run at 15 minutes, with up to 20 seconds of Windows termination/close grace after a timeout. A cold `npm ci` with native tree-sitter builds can take longer than 7 minutes on Windows. | Open risk. A timeout fails the run without lock transfer; the failed attempt may waste time but does not claim successful validation. |
| R8 | minor (open) | Lock-transfer race: the validator compares `package.json` and `package-lock.json` hashes captured before the snapshot against values read after tests. It does not guard against edits during the snapshot copy. The window is small and the failure mode is a changed lock being overwritten only if the checkout lock is also unchanged. | Accepted. Recorded as residual risk. |
| R9 | minor (open) | Language-server diagnostics may parse JSON configuration files (`package.json`, `tsconfig.json`) as TypeScript and report syntax/comma-operator errors; this does not validate JSON. | Accepted as a tooling artifact. Verify JSON with the intended TypeScript project or a JSON parse, not the standalone diagnostics view. |
| R10 | nit (fixed) | Progress ledger said "Full-workspace language-server diagnostics ... failed" and described a silent staged diff check as reporting no staged diff. | The pre-install diagnostics statement is accurate. The staged-diff wording is corrected in the progress ledger: a silent successful `git diff --cached --check` means no whitespace errors, not absence of staged changes. |
| R11 | blocker (upstream SDK/compiler compatibility; historical TS1543 phase) | With `typescript` 5.9.3 and the existing `module: "NodeNext"`, the resolved `@earendil-works/pi-ai` model `.d.ts` files import JSON without required import attributes; the isolated strict typecheck reported 32 TS1543 errors. | Resolved in the validator snapshot only by the authorized exact-version/integrity-guarded declaration correction; no runtime JS, API, compiler setting, or checkout `node_modules` was modified. Current blocker is R12 below. |
| R12 | blocker (current acceptance) | After the guarded JSON attributes allow declarations to typecheck, three TS2345 tool-result incompatibilities are reported at `index.ts` registerTool calls, lines 54–56. | Closed (job 40f9cead). Cause: the three untyped tool object literals in `src/tools/` were inferred with widened `status: string` and unioned detail shapes, which the SDK's `AgentToolResult<TDetails>` rejects. Fix: named details types and `Promise<AgentToolResult<...>>` annotations on `execute` in `mindplace-query.ts`, `mindplace-explain.ts`, `mindplace-build.ts`. Runtime behavior and tool schemas are unchanged; no casts or suppressions. The validator's fresh strict typecheck then passed. |

## Verified by reading (no execution)

- Snapshot correctness: `copySnapshot` copies tracked and non-ignored untracked files, skips `.git`, `node_modules`, and the scratch tree, and refuses absolute or outside-checkout symlinks. Deleted tracked files are skipped via ENOENT. Modes are preserved.
- Scratch safety: refuses symlink or non-directory scratch; cleans its run directory in `finally`; removes scratch only if it did not exist before.
- Subprocess safety: no shell string interpolation except fixed commands; `shell: isWindows` is used only with fixed args; command timeouts and the 15-minute total deadline are enforced, with up to 20 seconds of additional Windows termination/close grace after a timeout; non-zero status and spawn errors throw.
- Lockfile consistency: the lock is generated from the snapshot's `package.json` and then used by `npm ci` in the same snapshot, so the transferred lock matches the tested manifest.
- Totals parsing: regex matches Node `ℹ` and TAP `#` output; a missing total fails the run rather than passing silently.
- No-arg enforcement: `process.argv.length === 2` is enforced.

## Applied fixes carried into this review

1. `package.json`: `typebox` 1.3.27, `@types/node` 22.19.19, and optional MCP SDK 1.25.2 were added/pinned as dev dependencies (R2/R1 follow-up); runtime dependencies unchanged. `typescript` 5.9.3 and Pi SDK 1.2.0 remain unchanged.
2. `tests/validate-development.mjs`: Windows process-tree termination is initiated while the shell is still live and the validator waits for child closure on timeout (R3). Cleanup remains dependent on successful Windows `taskkill`; failure is surfaced and no lock transfer follows.
3. This preflight follow-up adds the explicit scratch exclusion in `tsconfig.json` (R4), records the supplied tracked vendor evidence (R5), and corrects staged-check wording in the progress ledger (R10).

Not changed in this validation follow-up: source files, test sources, `.gitignore`, validator script, and `package-lock.json`. The isolated validator generated its own snapshot lock but correctly did not transfer it after the typecheck failure. This follow-up updates `package.json` and both documentation ledgers; earlier MP2-01 edits remain as listed above.

## Command evidence

- Two approved `mindplace-dev-validate` attempts each completed isolated snapshot copy, `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, and `npm ci --ignore-scripts --no-audit --no-fund`. Run 1 strict typecheck failed with TS1543 plus TS2694 and TS2307; after adding dev-only type dependencies, run 2 had only 32 TS1543 errors in `@earendil-works/pi-ai` model declarations. Thus isolated fresh dependency installation is demonstrated, but strict typecheck is not; isolated focused/full tests did not run, and generated lock transfer did not occur.
- After the second install attempt, approved `mindplace-focused-tests` passed **19/19** (5 suites) and `mindplace-full-tests` passed **54/54** (13 suites) against existing checkout `node_modules`. This is separate from, and not evidence for, tests after the isolated fresh install.
- Current `mindplace-diff-check` and `mindplace-staged-diff-check`: both passed; Git emitted LF/CRLF warnings for the working diff, and the staged check was silent (`git diff --cached --check` reports whitespace issues only).
- The single final `build` tool request reported `tsc exited 1`, `npm notice run @patimweb/pi-mindplace@1.4.2 npx`, and no diagnostics. This does not override or resolve the isolated validator's explicit TS1543 errors.
- Workspace language-server diagnostics are separate and still reflect the root checkout's missing SDK resolution; they do not diagnose the isolated npm install. Diagnostics on `.mjs`/JSON/Markdown are not execution or format validation.
- The approved profile was available after the user closed `/subagents-profiles`; do not tell users to run a nonexistent `/subagents-profiles save` command.

## Exact approval-ready validator specification

Name: `mindplace-dev-validate` (approved entry)
Command: `node tests/validate-development.mjs`
Working directory: checkout root (`C:/development/pi/extensions/pi-mindplace`)
Arguments: none (script enforces `argv.length === 2`)
Classification: bounded snapshot + isolated install + typecheck + tests + lock transfer
Environment: Node.js 26+, Git, npm registry/cache access; `CI=1` and `npm_config_ignore_scripts=true` are set by the script
Timeouts: 15 min total, 7 min per npm command, plus up to 20 seconds of Windows termination/close grace after a timeout
Output paths:
- Read: all tracked and non-ignored untracked checkout files (snapshot source)
- Write (scratch, removed on exit): `tests/.mp2-validation-scratch/run-*/snapshot`
- Write (persistent, on success only): `package-lock.json`
- Write (scratch dir root, removed if it did not exist before): `tests/.mp2-validation-scratch/`

Pre-run checks: R5 is closed by the parent's confirmation that tracked `vendor/npm-check-updates/index.js` and `vendor/npm-check-updates/package.json` are included in the snapshot file list. R4 is closed by the explicit TypeScript exclusion; no gitignore mutation is required.

Expected success markers:
- `[snapshot] Copied N ...`
- `full-workspace strict typecheck` exit 0
- `focused tests` and `full tests` totals with `0 failed`
- `[success] Fresh install, full-workspace typecheck, focused tests, and full tests passed.`
- `[success] Transferred the generated snapshot lockfile ...`

Post-run acceptance (parent or Haiku, by command):
1. `git diff --stat -- package-lock.json` shows the lock change only from the generated install.
2. `npm run typecheck` in the checkout, or the approved validator's typecheck step, exits 0 with zero diagnostics in the four previously failing files.
3. Full diagnostics (`scope=workspace`) show no TS2307 for `@earendil-works/pi-coding-agent` and no TS7006 at `index.ts` lines 60 and 66.
4. Full (54/54) and focused (19/19) suites pass again after the lock transfer.
5. Staging preserved: `git status` still shows `A IMPLEMENTATION_PLAN_2.md`; the raw index is byte-identical to the external baseline's `index`.

Failure handling: if any validation step fails, the lock is not transferred and cleanup is attempted in `finally`. If Windows process-tree termination fails, a descendant may remain and hold scratch files; scratch removal can then fail and the path may need follow-up cleanup. Luna must return the failing output without editing the lock manually.

## Baseline preservation evidence

- External baseline at `C:/Users/jnikla/AppData/Local/Temp/pi-mindplace-mp2-baseline-20261016-092614` contains `worktree.zip`, `index`, `staged.patch`, `unstaged.patch`, `status.txt`, `HEAD.txt`. Confirmed present by directory listing.
- This job did not reset, stage, commit, or modify the index or any file outside its work areas.
- Parent bookkeeping (in the job brief): raw `.git/index` byte-identical to baseline after Luna's release; `A IMPLEMENTATION_PLAN_2.md` still staged.

## Ledger correction requested (R10)

The progress ledger's original phrase, "validator reported no staged diff," incorrectly implies a staging check reported no staged changes. `mindplace-staged-diff-check` is `git diff --cached --check`; a successful silent result means no whitespace errors were reported, not that no staged diff exists. Parent bookkeeping confirms the raw index matches the external baseline and `A IMPLEMENTATION_PLAN_2.md` remains staged.

## Remaining risks and open acceptance (historical review snapshot; current status above)

- Superseded (job 40f9cead): the TS1543 blocker is resolved by the guarded correction, and the TS2345 `index.ts` blocker is closed by the source-type fix. The isolated validator passed with fresh strict typecheck, focused 19/19, full 54/54, and lock transfer. Current acceptance evidence is in `docs/IMPLEMENTATION_2_PROGRESS.md`.
- R4 and R5 are resolved as described above. The Windows tree-kill has a residual OS-level limitation: if `taskkill` fails, cleanup cannot be guaranteed; the validator reports this failure and does not transfer the lock.
- Package lock reproducibility remains unproven until an approved strict-check-compatible solution allows a successful run and generated lock transfer.

## Final MP2-01 review (job 40f9cead, Haiku audit + source-conformance fix)

Verdict: **MP2-01 isolated acceptance passed**, conditional on the parent's final acceptance checks listed in the progress ledger.

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | blocker (closed) | Three TS2345 `registerTool` incompatibilities (`index.ts` 54–56) after the TS1543 correction. Cause: untyped tool object literals with widened `status: string` and unioned details. | Fixed with named details types and `AgentToolResult<...>` return annotations in `src/tools/*`. No runtime/schema change. |
| F2 | minor (closed) | After F1, `tests/tool-regressions.test.ts` failed strict typecheck: `.content[0].text` on `TextContent \| ImageContent`. | Added runtime-checked `textOf()` helper; assertions unchanged; no cast. |
| F3 | audit (verified by reading + run) | Declaration correction `tests/patch-pi-ai-declarations.mjs`: version pin, lock SHA-512, 42-file inventory, expected import lines all checked before any write; idempotent; JS untouched; fixture self-tests passed. | Accepted as a maintenance-bound workaround (removal condition in progress ledger). |
| F4 | major (open, upstream) | The published pi-ai 1.2.0 `.models.d.ts` drop JSON import attributes. | Needs an upstream fix or a supported SDK; parent/user decision. Not a workspace source issue. |
| F5 | minor (open) | Windows process-tree cleanup depends on `taskkill` success (R3). | Fails closed; no lock transfer on failure. Accepted residual. |
| F6 | nit (open) | The final `build` tool runs against the checkout's root `node_modules`, which has no Pi SDK, and reports `tsc exited 1` without diagnostics. | Not acceptance evidence; the isolated validator is authoritative. |

Evidence: `mindplace-dev-validate` ok (fresh install 531 packages, strict typecheck clean, focused 19/19, full 54/54, lock transferred); `mindplace-diff-check` ok; `mindplace-staged-diff-check` ok.

Staging/baseline: the parent must still confirm the raw index matches the external baseline and `A IMPLEMENTATION_PLAN_2.md` remains staged. This job did not stage, reset, or commit.

Maintenance: remove the pi-ai override, the declaration helper, and its validator invocation once a supported SDK publishes correct declarations; regenerate the lock and re-run the validator.


## Historical appendix — pre-fix TS1543 review (superseded)

Historical verdict at the time: **blocker confirmed as upstream-caused; MP2-01 remained open (partial).** That verdict predates the authorized declaration correction and successful isolated validator run recorded above. No source, compiler, SDK, or dependency contract was changed by that reading-only review.

Evidence (by reading only; no shell, no npm registry access, no tsc run in this job):

- The failing declarations are the published `*.models.d.ts` files under the installed `@earendil-works/pi-ai` 1.2.0 (the copy nested in the global `@earendil-works/pi-coding-agent` 1.2.0 install). Each has `import values from "./data/<provider>.json";` with no import attribute, e.g. `providers/openai.models.d.ts:1`. Their sibling `providers/<provider>.models.js` files use `import values from "./data/<provider>.json" with { type: "json" };`. So the upstream build emits JS with the attribute but drops it from the declaration output. That is a packaging defect in the published declarations, not a workspace source error.
- `pi-ai` is `"type": "module"`, so under `module: "NodeNext"` those `.d.ts` files are ESM and TS1543 applies. `skipLibCheck` is off, so the errors are reported.
- The dependency chain is workspace `index.ts` / `src/**` -> `@earendil-works/pi-coding-agent` 1.2.0 types -> `@earendil-works/pi-ai` `^1.2.0` types -> `providers/*.models.d.ts`. Source files are not the cause. `TS2694` (`path.PlatformPath`) and `TS2307` (optional MCP SDK) were separate issues already addressed by `@types/node` 22.19.19 and dev `@modelcontextprotocol/sdk` 1.25.2.
- Count caveat: 42 `*.models.d.ts` files carry the unattributed import in the installed copy, while Luna's isolated run reported 32 TS1543 errors. The difference is not reconciled here; the isolated run's resolved `pi-ai` version was not captured in the evidence (the snapshot lock was discarded). The installed 1.2.0 copy was inspected, but the isolated install could resolve a different `pi-ai` 1.x because the SDK declares `^1.2.0`. The attribution to upstream is therefore strong but based on the installed copy; the exact resolved version must be recorded from the failing run's lock before a fix is claimed.
- Checked-in `package-lock.json` contains no `@earendil-works` entries, so the lock transfer gate is not yet informative about the resolved SDK tree.

Options (none applied; each needs a parent or user decision):

1. **Preferred: move to a published Pi SDK / pi-ai version whose declarations include the import attribute** (or otherwise fixed declarations). Keeps strict NodeNext and `typescript` 5.9.3. Blocked on evidence: this job had no registry/`npm view` capability, so no published version is claimed to fix it. Parent needs a tool or Luna must run `npm view @earendil-works/pi-coding-agent versions` and `npm view @earendil-works/pi-ai@<v> types` style checks, then inspect the candidate `providers/*.models.d.ts` for `with { type: "json" }`.
2. **Upstream report** to Pi maintainers: the published `.d.ts` drops import attributes that the `.js` keeps. Required regardless of option 1 if no fixed version exists.
3. **Compiler change (not recommended without evidence):** a TypeScript upgrade or a module/resolution change could alter TS1543 behavior, but that changes the NodeNext semantics this plan requires preserved. Unverified; needs a separate decision and a probe, not a silent change.
4. **Rejected:** `skipLibCheck`, ambient stubs or `declare module` for the JSON imports, `paths` remapping, editing `node_modules`, or excluding `pi-ai` from the program. Each suppresses or bypasses the check the plan requires.

Recommendation: keep MP2-01 partial. Ask the user to choose between option 1 (after a registry capability or Luna's `npm view` evidence) and option 2 with a time-boxed hold. Do not rerun the validator unchanged. Next validator run only after a dependency or contract decision.

Baseline preservation: this job edited only `docs/IMPLEMENTATION_2_REVIEW.md`. It ran no git reset, stage, or commit and did not modify the index or the external baseline. Staged `A IMPLEMENTATION_PLAN_2.md` is parent bookkeeping and was not re-verified here.

Remaining evidence the parent must still obtain: the resolved `@earendil-works/pi-ai` version from the failing validator snapshot lock or a fresh `npm ls @earendil-works/pi-ai` in an isolated copy; the registry version list; and a clean typecheck, focused/full suites, and lock transfer only after a compatible decision is approved.
