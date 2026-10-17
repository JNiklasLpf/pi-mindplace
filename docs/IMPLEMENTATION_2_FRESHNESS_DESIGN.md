# MP2-04 freshness design proposal and MP2-05 resolution

Status: **Option A on-demand verification approved and implemented**. This note preserves the original proposal decision context; the approval and implementation refinements are recorded at the end, with acceptance evidence in [`IMPLEMENTATION_2_FRESHNESS.md`](IMPLEMENTATION_2_FRESHNESS.md).

## Current behavior (baseline this design changes)

Verified by reading the code in this pass (not by running it):

- `index.ts` registers a `before_agent_start` hook that calls `inspectGraph(cwd)` on **every prompt**. Its prompt text is advisory ("optional navigation aid").
- `src/graph-file.ts` `inspectGraph` reads and SHA-256-hashes the graph file, parses it (cached by hash), and on every call runs a full `detect(root)` source walk and re-hashes each supported source file. It returns the existing vocabulary `missing | corrupt | incompatible | unknown | stale | fresh`.
- With `PI_MINDPLACE_CONTEXT=map`, the same hook also uses the parsed graph payload to build an optional map.
- Registered agent tools: `mindplace_build`, `mindplace_query`, `mindplace_explain`. Registered command: `/mindplace`. **There is no separate status tool.** Whether `/mindplace` exposes status, and whether `mindplace_explain` reads the graph, must be confirmed in MP2-05 before either is described as a status surface.

Consequence: Option A below is a **behavior change** from the current prompt-time full walk and hash, not a description of existing behavior. The current `fresh` value is the existing name for what this design calls `verified_current`; the rename or mapping is part of the approval decision.

## Decision to make

How much freshness verification should happen during passive prompt guidance versus explicit graph use? A graph must never be labeled current from TTL, timestamps, file size, cache hit, absence of watcher events, or an old successful check. "Verified current" means a complete membership and content comparison succeeded for the relevant root and graph generation, over a stated read interval (defined below).

## Exact observable states

Every status-bearing surface exposes one of these states, plus optional history:

- **`verified_current`** — a complete verification for this root and graph generation found matching source membership and content, with no racy or concurrent-mutation indicator inside its interval. The only state that permits "fresh/current."
- **`stale`** — a completed verification found an addition, deletion, rename, content change, or generation mismatch. Report the known mismatch; do not query the graph as if current.
- **`not_checked`** — passive context did no verification in this interaction. Neutral; not a freshness claim.
- **`unknown`** — verification absent, incomplete, failed, interrupted, racy, legacy, unreadable/unsupported, or unable to establish a consistent interval. A reason code is required where known (legacy metadata, scan error, hash error, concurrent mutation, racy timestamp, root mismatch, lock contention).
- **`verification_in_progress`** — an explicit verification/build for this root is running. A concurrent request must not borrow its eventual success.
- **`not_built`** — no graph for this root (reported separately from freshness).

Mapping to current `GraphStatus`: `fresh`→`verified_current`; `stale`→`stale`; `unknown`→`unknown`; `missing`→`not_built`; `corrupt`/`incompatible` remain separate load-failure reasons under `unknown`. Any rename is a user-visible change and needs approval.

Root identity is part of every state and cache key. A state from one root is never shown for another.

## Verified interval and generation (what "verified" means)

- A verification records `startedAt` and `endedAt` monotonic/wall times, the root, the graph generation (graph content hash plus the inventory it was built from), and per-file `size`, `mtime`, and content hash observed at read time.
- The claim is limited to: **"at each file's read, its content matched the recorded inventory; the reads spanned [startedAt, endedAt]."** It is not a claim that the whole tree was simultaneously in that state. Ordinary filesystems offer no instantaneous, atomic multi-file snapshot without OS-level snapshot or locking support, which this design does not assume.
- **Racy-timestamp rule:** a file whose mtime is not safely older than the verification start (granularity margin, e.g. within the filesystem timestamp resolution plus a small margin) cannot anchor `verified_current`; that file's state is `unknown`. This prevents same-size edits within one timestamp tick from being accepted on mtime alone. Content hashing still runs; the rule only blocks the mtime-based trust.
- **Stat-before/after rule:** stat each file before and after reading its content. Any change, or any file that disappears or appears during the interval, yields `unknown` (or `stale` if the change establishes a membership/content mismatch), never `verified_current`.
- **Double scan is not a guarantee.** Repeating the walk can catch some concurrent edits but cannot detect every A-B-A sequence (content changed and changed back between reads, or an edit that preserves size and timestamp and is read by neither pass). The design therefore does not claim it does. A mutation that is reverted entirely between reads and never observed is outside the claim; the verification records that its interval was not clean only when a stat/mtime/racy indicator fired.
- **Publication (build):** a build records its own read interval and publishes a generation only if the pre-build and post-build stat/hash observations agree for all supported files and no racy indicator fired. Otherwise it publishes nothing as current, leaves status `unknown` or `stale`, and permits retry. Atomic write (temp file plus rename) of the graph and metadata is an MP2-05 requirement.
- **Concurrency control:** `verification_in_progress` needs a per-root lock or marker. Lock contention is reported as `verification_in_progress`, not as success. If the lock cannot be obtained or is stale and cannot be recovered safely, the state is `unknown`. Lock design (lock file, stale-lock recovery, crash behavior) is an MP2-05 decision and needs tests.
- Known limits, fail-closed: symlinks, unreadable files, unsupported encodings, very large or limited scans, files changing faster than the timestamp resolution, network filesystems with weaker timestamps, and interruptions during verification all yield `unknown`. Any of these reported as `verified_current` is a defect.

## Alternatives

### A. On-demand full verification — recommended first option

- **Passive prompt guidance:** no source-tree walk, no source hashing, no graph-byte read, no graph parse. Report `not_checked` (or `not_built` if no graph path is known from a cheap existence check, which must not read the graph). Optional text: "use explicit status/query/build to verify." A cached graph is never presented as verified context.
- **Explicit status:** the complete supported source set is inventoried and compared with the graph generation under the verified-interval rules. Returns `verified_current`, `stale`, `unknown`, or `verification_in_progress`, with reason and counts. Surface: an explicit status action must be chosen and approved (a new tool, or an extension of `/mindplace`). Until approved, no status surface is assumed.
- **Explicit query:** performs the same verification before graph-backed results. `verified_current` → query the verified generation. `stale` → report stale and recommend build; do not return graph results as current. `unknown`/`verification_in_progress` → report the state and do not present graph results as authoritative. (Whether an explicit query may return labeled, unverified results is a user decision; default is to refuse as authoritative.)
- **Explicit explain:** must state whether it reads the graph. If it does, it follows the query rules above. If it does not, it must say so and must not imply graph verification.
- **Explicit build:** scan and build under the publication rules above. Build is the only path that moves legacy or stale graphs to a verifiable generation.
- **Legacy graphs:** existing graph JSON remains loadable. Missing or old metadata (`scanComplete`, inventory shape, schema version) starts `unknown`. Compatibility alone never confers freshness; a legacy graph is never promoted from age, mtime, or size.
- **Cost/compatibility:** removes the per-prompt walk and hash that exists today, at the cost of a `not_checked` notice and explicit-use latency. Behavior change requires user approval.

### B. Watcher-assisted dirty tracking (corrected)

- A watcher is **never** proof of content equality. Quiet, healthy, or restarted watcher periods do not establish `verified_current`. Only a full verification (as in A) can produce `verified_current`.
- Watcher role is limited to **invalidation**: a relevant event on a previously verified generation moves it to `stale` (or `unknown` if the event is ambiguous). Restart, overflow, dropped events, unsupported paths/symlinks, permission errors, or incomplete coverage move the root to `unknown` until a full verification recovers it.
- Passive guidance under B therefore still cannot say `verified_current` from watcher health alone. At most it can say the last verified generation has no invalidation event, which is history, not current status. Its default passive state remains `not_checked`.
- Explicit status/query under B still run the full verification before claiming a current result, unless the design is explicitly approved to accept watcher-only state, which this note does not recommend.
- Cost: reduces repeated work only after the initial verification, but adds OS-specific lifecycle, missed-event recovery, shutdown, path normalization, symlink, and overflow behavior. A watcher is an optimization, not an authority. Do not select it without MP2-05 cost evidence and recovery tests.

### C. Full verification on every prompt

- Passive guidance performs complete verification each time and returns `verified_current`, `stale`, or `unknown`; explicit status/query/build use the same path. This is what the current hook effectively does (with `fresh` naming and without the racy/interval rules).
- Simplest to explain and strongest for prompt-time statements, but retains the repeated walk/read/hash cost. Keep only if measured costs are acceptable and documented; do not describe prompt overhead as removed.

## Cross-cutting rules

- No TTL, mtime alone, equal size, cache hit, absence of watcher events, or previous successful check is content-equality evidence. A last-verified timestamp is informational history.
- The racy-timestamp, stat-before/after, and publication rules above apply to every option.
- Root changes select a different state and cache namespace.
- Concurrent verification/build exposes `verification_in_progress`; passive requests never inherit success.
- Test requirements (for MP2-05, not implemented here):
  - Passive hook: counters prove zero source walks, source reads, hashes, graph-byte reads, and graph parses (for A). Current behavior is the baseline to be changed.
  - Explicit status/query/explain: counters prove a complete membership and content check; add/delete/rename/change, legacy metadata, unreadable/unsupported files, interruption, racy same-size edits with preserved timestamps, concurrent edits during verification, lock contention, and two-root isolation.
  - Build: pre/post mismatch publishes nothing current; atomic publication; retry.
  - Test the public lifecycle surfaces (hook, the approved status surface, query, explain, build), not only internal helpers. Report deterministic operation/byte counters separately from tolerant elapsed-time measurements.
  - Watcher (only if B is chosen): all of the above, plus event loss becomes `unknown`, never `verified_current`; overflow simulation; restart; shutdown; symlink/path normalization.

## Explicitly not claimed

- No instantaneous, atomic whole-tree snapshot on ordinary filesystems.
- No detection of every A-B-A edit sequence by re-scanning.
- No freshness for symlink targets, unreadable or unsupported files, or limited scans; these are `unknown`.
- No compiler-level or inherited-dispatch semantics in the graph; freshness concerns source membership and content only.

## Historical recommendation / approval gate (resolved)

Evaluate **A, on-demand full verification**, first. It has the simplest defensible semantics: passive context is `not_checked`; graph use is explicit and fully verified over a stated read interval; uncertainty is visible; no watcher reliability is assumed. It is a behavior change from the current per-prompt walk and must be approved.

The user must approve, before MP2-05 implementation:
1. Option A, B, or C, with the verified-interval and racy-timestamp limits above.
2. The state vocabulary, including the `fresh`→`verified_current` mapping and `not_built`.
3. The explicit status surface (new tool or `/mindplace` extension), and whether explicit query may return unverified results (default: no).
4. The explain graph-use statement.
5. The lock/marker approach for `verification_in_progress`.

## MP2-05 resolution and implementation refinement

The user-approved contract is Option A: passive prompts do no source walk/hash/read and do no graph-byte read/parse; they report `not_checked` or cheap `not_built`. `/mindplace status`, query, and explain fully verify before graph results. Stale/unknown/in-progress states never return graph-backed query/explain results. Legacy metadata remains loadable but maps to `unknown`; no watcher was selected.

Refinements made for truthful, feasible interval semantics: content hashes, not timestamp age, establish file equality; each source read is bracketed by stat, membership is walked before and after, and the graph content hash is checked again after source verification. No blanket recent-mtime rejection was added. This is not snapshot isolation and cannot detect every unobserved A→B→A edit. Publication uses a unique temporary graph file and atomic rename only after pre/post inventories match. `/mindplace status` was selected as the status surface; explain reads the graph via the common verification path. An in-process per-canonical-root marker coordinates builds with explicit verification requests; there is no cross-process lock. Full acceptance/tests/counters and explicit deferrals are in `IMPLEMENTATION_2_FRESHNESS.md`.
