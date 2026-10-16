# Implementation plan 2 — MP2-01 progress ledger

Status: **MP2-01 acceptance evidence is now green** (job 40f9cead). The isolated `mindplace-dev-validate` run completed a fresh install, guarded pi-ai 1.2.0 declaration correction, strict full-workspace typecheck, focused suite, full suite, and transferred the generated `package-lock.json`. Remaining work is the parent's final acceptance review. No MP2-02 or later work was started.

## Current result (authoritative)

- Validator: `mindplace-dev-validate` → **ok**. Node 26.5.0, npm 12.0.2; `npm ci --ignore-scripts` installed **531 packages**; declaration correction updated **42** `pi-ai` 1.2.0 `.models.d.ts` files (lock integrity verified against `sha512-U5/1zXqfV1on7/9sbez03tT4Ru49Lvfb4+zXSDK3DBKF5cRk6KxvAOTOY3HJ4jimlZth+rs7vbJqN6iBQAoNuQ==`).
- Strict typecheck (`tsc --noEmit`, TS 5.9.3, NodeNext, strict): **passed**, zero errors in the isolated snapshot.
- Focused tests: **19 tests, 19 passed, 0 failed** (5 suites), isolated.
- Full tests: **54 tests, 54 passed, 0 failed** (13 suites), isolated.
- Lock transfer: **performed** by the validator after all gates passed; `package-lock.json` is the snapshot's generated lock.
- `mindplace-diff-check`: passed (existing LF→CRLF working-copy warnings only).
- `mindplace-staged-diff-check`: passed (silent; no whitespace errors; this is not a claim about staging contents).
- Final `build` tool: `tsc exited 1`, no diagnostics. This runs against the checkout's root `node_modules`, which has no Pi SDK; it is not authoritative and is not acceptance evidence. The isolated validator is the acceptance evidence.

## Source-conformance fix (this pass)

Cause of the three prior TS2345 errors (`index.ts` lines 54–56 `registerTool`): the three tool objects in `src/tools/` were untyped object literals. Their `execute` results were inferred as unions with widened `status: string`, which the SDK's `AgentToolResult<TDetails>` rejects.

Fix (no runtime behavior, schema, or public contract change):
- `src/tools/mindplace-query.ts`: exported `MindplaceQueryDetails`; `execute` annotated `Promise<AgentToolResult<MindplaceQueryDetails>>`.
- `src/tools/mindplace-explain.ts`: exported `MindplaceExplainDetails`; same annotation.
- `src/tools/mindplace-build.ts`: exported `MindplaceBuildDetails` (discriminated union of the actual return shapes, incl. `GraphStats` spread); same annotation.
- `tests/tool-regressions.test.ts`: the tests read `result.content[0].text`, which no longer type-checks once content is typed as `TextContent | ImageContent`. Added a `textOf()` helper that runtime-checks `type === "text"` (no cast) and used it at the seven call sites. Assertions are unchanged.

No casts, `any`, suppressions, `skipLibCheck`, strictness/module changes, stubs, or runtime dependency edits were made.

## Pi-ai declaration correction (maintenance-bound)

- `package.json` pins the transitive `@earendil-works/pi-ai` to exactly **1.2.0** via override; the Pi SDK stays exactly **1.2.0**; TypeScript **5.9.3**; `@types/node` **22.19.19**; `typebox` **1.3.27**; dev-only `@modelcontextprotocol/sdk` **1.25.2**.
- `tests/patch-pi-ai-declarations.mjs` runs only inside the validator snapshot, after `npm ci --ignore-scripts`. It checks: SDK 1.2.0; pi-ai 1.2.0 version; exact lock integrity and 1.2.0 tarball path; exact 42-file `.models.d.ts` inventory; each model's JSON data file exists; the expected first import line. All checks run before any write. It adds `with { type: "json" }` only to those import lines, is idempotent, and leaves JavaScript untouched. Fixture regressions (`--self-test`) cover first application, idempotent second pass, wrong version rejection, and changed-content rejection without writes; they passed in the validator run.
- **Maintenance/removal condition:** remove the override, helper, and validator invocation once a supported Pi SDK/pi-ai release publishes model declarations with the JSON import attributes. Then regenerate the lock through the validator and re-verify strict typecheck and both suites.

## Historical notes (superseded)

Earlier results in this file (the TS1543 blocker, the three TS2345 errors, and the 32-error count) were true at their time and are superseded by the **Current result** above. The earlier existing-checkout test totals (54/54, 19/19) are not isolated evidence and were not used as the acceptance basis.

## Dirty-baseline preservation

Baseline authority: `C:/Users/jnikla/AppData/Local/Temp/pi-mindplace-mp2-baseline-20261016-092614` (worktree archive, raw index, staged/unstaged patches, HEAD, status). This job did not reset, stage, commit, or modify the index, and did not touch the checkout's root `node_modules`. Parent bookkeeping must still confirm `A IMPLEMENTATION_PLAN_2.md` remains staged and the raw index matches the baseline. This ledger does not claim the worktree is clean.

## Handoff

- MP2-01 status: **isolated acceptance passed** (typecheck, focused 19/19, full 54/54, lock transferred) with the authorized, maintenance-bound pi-ai declaration correction.
- Parent should, before closing: confirm `git status` / `git diff --stat -- package-lock.json` shows only the expected lock change and the expected source edits; confirm the raw index still matches the baseline; accept or reject the review dispositions in `docs/IMPLEMENTATION_2_REVIEW.md`.
- Residual risks are listed with dispositions in `docs/IMPLEMENTATION_2_REVIEW.md`. The main open ones: Windows process-tree cleanup can fail (fails closed, no lock transfer); the upstream `.d.ts` defect remains until a supported SDK fixes it.
- Do not advance MP2-02 or later from this handoff.
