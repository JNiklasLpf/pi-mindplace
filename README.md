# pi-mindplace

> "I walk into my mind place. The codebase is organized. Every function has its place."

An optional, local code-navigation aid for pi. Build a queryable graph from supported source using tree-sitter; use it when useful alongside direct search, source inspection, diffs, runtime evidence, and documentation. Graph coverage and retrieval relevance are approximate and do not replace implementation review.

## How it works

![How pi-mindplace works](how-it-works.png)

1. **`mindplace_build`** parses your source files locally with tree-sitter (zero LLM cost), extracting functions, classes, imports, and call relationships into a knowledge graph
2. **`mindplace_query`** uses TF-IDF scoring and BFS traversal to find the most relevant subgraph within your token budget
3. **`mindplace_explain`** drills into a single entity and shows all its connections

### Optional navigation context

When loaded, the extension adds short advisory guidance but does not verify or read graph/source content on passive prompts. It reports `not_built` or `not_checked`; builds and queries remain optional. Explicit `/mindplace status`, `mindplace_query`, and `mindplace_explain` perform full supported-source and graph-generation verification; query/explain return graph results only when `verified_current`. `stale`, `unknown`, and `verification_in_progress` return status only. `PI_MINDPLACE_CONTEXT=map` does not load an unverified map (it explains that explicit verification is needed); set `PI_MINDPLACE_CONTEXT=off` to contribute no prompt guidance. No token/time savings are claimed without matched agent-run measurements.

## Supported languages

JavaScript, TypeScript, Python, Go, C#, Java, Rust, C++, Ruby, Kotlin, Scala, Bash, JSON

## Install

```bash
pi install npm:@patimweb/pi-mindplace
```

Or for local development:

```bash
pi -e /path/to/pi-mindplace/index.ts
```

Requirements: Node.js 26+, tree-sitter (auto-installed as dependency).

### Local development and validation

The extension targets the Pi extension API with `@earendil-works/pi-coding-agent` 1.2.0 as its development type baseline. Pi supplies that SDK at runtime, so it is declared as a peer rather than bundled; local development installs the exact SDK and TypeScript compiler versions from the lockfile. The package uses the supported Pi declarations and normal TypeScript `NodeNext` module resolution—there are no ambient SDK stubs or relaxed strictness settings.

Use the same fresh-install validation command locally and in CI:

```bash
node tests/validate-development.mjs
```

The validator snapshots the current checkout, including non-ignored untracked files, installs dependencies with lifecycle scripts disabled, applies the guarded declaration-only compatibility correction described below, runs strict type checking and both test suites, and copies its generated lockfile back only after success. It cleans its temporary snapshot on exit and does not install dependencies into the root checkout. CI runs this command on Node.js 26 on Linux and Windows and rejects unexpected lockfile changes.

`npm run typecheck` runs TypeScript 5.9.3 with the repository's strict `tsconfig.json`; `npm run test:focused` and `npm test` run the test suites in an already prepared development environment. Plain `npm ci` followed by type checking is not the accepted fresh-validation path while the upstream declaration defect below remains.

Pi SDK 1.2.0 resolves `@earendil-works/pi-ai` through a compatible 1.x range, but pi-ai 1.2.0 publishes 42 model `.d.ts` imports of JSON without the `with { type: "json" }` attribute already present in sibling JavaScript. The dev-only npm override pins pi-ai to exactly 1.2.0; the isolated validator checks its exact registry tarball SHA-512 (`sha512-U5/1zXqfV1on7/9sbez03tT4Ru49Lvfb4+zXSDK3DBKF5cRk6KxvAOTOY3HJ4jimlZth+rs7vbJqN6iBQAoNuQ==`), SDK/package versions, complete expected declaration inventory, and each declaration's exact first import before editing only those import lines in the isolated `node_modules`. Its regression checks prove repeat application is byte-idempotent and reject unexpected versions or declaration content. No runtime JavaScript, APIs, dependencies, compiler settings, or installed checkout files are changed by this correction. This temporary workaround should be removed when a supported Pi SDK/pi-ai release ships corrected declarations: remove the override and patch invocation/helper, update the lock through the validator, then confirm strict typecheck and tests against the upstream declarations. Do not convert it into an npm lifecycle hook; validation must remain reproducible with `npm ci --ignore-scripts`.

## Usage

### Build the mind place

```
mindplace_build
```

Scans all supported files in the current directory and creates `graph-out/` with:

| File | Description |
| ------ | ------------- |
| `graph.json` | The full knowledge graph, queryable across sessions |
| `GRAPH_REPORT.md` | Audit report with god nodes, communities, suggested questions |
| `graph.html` | Interactive local vis-network visualization (open in browser) |
| `vis-network.min.js` | Bundled visualisation runtime used by `graph.html` (no CDN request) |
| `cache/` | SHA256 cache for incremental rebuilds |

When the output directory is not already ignored, the tool automatically adds `graph-out/` to
the selected project's `.gitignore`. This keeps generated graph files from appearing as untracked
changes in both interactive and non-interactive sessions.

Options:

```
mindplace_build path="./src"              # scan specific directory
mindplace_build force=true                # force rebuild ignoring cache
mindplace_build update=true               # incremental: only re-extract changed files
mindplace_build directed=true             # preserve edge direction
mindplace_build noViz=true                # skip HTML visualization
mindplace_build noReport=true             # skip report generation
mindplace_build autoIgnore=false          # read-only/review build; do not edit .gitignore
```

### Query the graph

```
mindplace_query question="How does authentication flow work?" budget=4000
```

Returns a relevance-ranked, budgeted subgraph when the selected project's graph is available. Output size is a character-based estimate; query use is optional and source inspection remains available. `path` selects a project root; use `budget` and `minScore` to tune retrieval.

### Explain a node

```
mindplace_explain name="authenticateUser"
```

Shows detailed info about a specific entity: where it's defined, what it connects to, and what calls it.

### Command shortcuts

The `/mindplace` command provides quick access:

```
/mindplace              # show availability (does not verify freshness)
/mindplace status       # full on-demand freshness verification
/mindplace "auth flow"  # query shortcut (verifies before graph results)
/mindplace build        # rebuild
```

## Architecture

```
pi-mindplace/
+-- index.ts                  Extension entry point + advisory lifecycle guidance
+-- src/
|   +-- types.ts              Core data interfaces and language support map
|   +-- detect.ts             File scanner and language detection
|   +-- extract.ts            tree-sitter AST extraction with SHA256 caching
|   +-- graph.ts              KnowledgeGraph class (PageRank, Louvain, directed mode)
|   +-- query.ts              TF-IDF scorer + BFS/DFS traversal with token budget
|   +-- report.ts             GRAPH_REPORT.md generator
|   +-- viz.ts                Local standalone graph.html generator
|   +-- tools/
|       +-- mindplace-build.ts
|       +-- mindplace-query.ts
|       +-- mindplace-explain.ts
+-- tests/
    +-- detect.test.ts
    +-- extract.test.ts
    +-- graph.test.ts
    +-- query.test.ts
    +-- fixtures/
```

## Inspiration

pi-mindplace was inspired by [graphify](https://github.com/codelion/graphify). It adapts local AST-derived graph navigation to pi as an optional tool, with tree-sitter parsing and character-estimated output budgets. The extension does not enforce graph-first exploration or claim savings without matched agent-run evidence.

## Design decisions

- Zero Python: pure TypeScript/Node.js, no Python required
- Zero LLM cost for building: tree-sitter AST parsing is deterministic and local
- Minimal dependencies: only `tree-sitter` and language grammars. No numpy, no scikit-learn, no networkx
- PageRank without numpy: pure JS power iteration in ~25 lines
- TF-IDF without scikit-learn: hand-rolled lexical relevance scoring, separate from PageRank centrality and not answer-accuracy confidence
- Louvain without networkx: greedy modularity optimization in ~50 lines
- Character-estimated output budgeting: the formatted result, including scope and relationships, is trimmed to fit a minimum-normalized budget
- Incremental extraction cache: SHA256 content hashing plus an extractor compatibility version; graph analysis is rebuilt on build runs
- Local standalone visualization: `graph.html` copies its pinned vis-network runtime beside the report; opening it makes no CDN request

## Binding and freshness limitations

Call/import extraction is conservative static analysis, not compiler-backed resolution. C# same-class unqualified/`this` calls are resolved only where a target is unambiguous; overloads, inheritance, cross-file namespace/project semantics, dynamic receivers, and external libraries remain unresolved and are reported where detected. JavaScript/TypeScript local calls and straightforward relative named/default/aliased/namespace imports are best-effort and should be verified against source. The scan is bounded at 10,000 supported files and individual files above 1 MB are skipped with diagnostics. Graph freshness metadata compares complete supported-file membership and SHA-256 content. Verification brackets each file read with stats, walks membership before/after, and hashes the graph generation again before returning; the read interval is not an atomic whole-tree snapshot, and unobserved A→B→A edits remain outside the guarantee. Old/legacy graphs, unreadable files, incomplete/limited scans, and observed concurrent changes fail closed as `unknown` or `stale`. A rebuild is optional. See [the MP2-05 acceptance ledger](docs/IMPLEMENTATION_2_FRESHNESS.md) for operation counters, synthetic benchmark results, compatibility, and exact deferrals.

## Quality evaluation

See [`docs/QUALITY_EVALUATION.md`](docs/QUALITY_EVALUATION.md) for the synthetic fixture protocol and the matched agent-run evaluation required before making savings claims. The MP2-07 task manifest, execution gate, offline-only smoke, and unexecuted run proposal are documented in [`docs/IMPLEMENTATION_2_EVALUATION.md`](docs/IMPLEMENTATION_2_EVALUATION.md).

## License

MIT
