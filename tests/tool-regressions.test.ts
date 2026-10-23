import { afterEach, describe, it } from "node:test";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync, utimesSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import extension from "../index.ts";
import { MindplaceQueryTool } from "../src/tools/mindplace-query.ts";
import { MindplaceExplainTool } from "../src/tools/mindplace-explain.ts";
import { KnowledgeGraph } from "../src/graph.ts";
import { detect } from "../src/detect.ts";
import { makeGraphMetadata, getFreshnessCounters, resetFreshnessCounters } from "../src/graph-file.ts";
import { estimateQueryTokens, query as productionQuery, formatQueryResult as productionFormat } from "../src/query.ts";
import type { ExtractionResult } from "../src/types.ts";
// @ts-expect-error The executable evaluation harness is standalone JavaScript outside the TS source include.
const mp2Eval: any = await import("../scripts/mp2-eval.mjs");
// @ts-expect-error Standalone SDK adapter is exercised with an injected fake SDK, never the real registry/auth/transport.
const mp2Adapter: any = await import("../scripts/mp2-pi-sdk-adapter.mjs");

const roots: string[] = [];
function root(): string { const path = mkdtempSync(join(tmpdir(), "mindplace-tools-")); roots.push(path); return path; }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function mp2Request(treatment: "map_only" | "graph_optional", base: string): any {
 const graphAvailable = treatment === "graph_optional";
 return {
  protocol: "pi-mindplace-mp2-adapter-v1", taskId: "fake-task", repetition: 1, taskText: "Trace the call chain.", workspace: join(base, "workspace"),
  provider: "github-copilot", model: "gpt-6-luna", settings: { ...mp2Adapter.COMMON_LIMITS }, timeLimitSeconds: 600,
  context: { repositoryMap: "same map context" }, isolation: { home: join(base, "home"), session: join(base, "session"), temp: join(base, "temp") },
  tools: { ordinary: ["list_files", "search_text", "read_file", "read_diff"], graph: graphAvailable ? ["mindplace_query", "mindplace_explain", "mindplace_build"] : [], graphUseRequired: false },
  graph: { available: graphAvailable },
 };
}
const stubTool = (name: string) => ({ name, parameters: { properties: {} }, execute: async () => ({ content: [{ type: "text", text: "" }] }) });
function fakeAdapterDependencies({ estimate = 20, blockAfterTools = false, exhaustOutput = false, noUsage = false }: { estimate?: number; blockAfterTools?: boolean; exhaustOutput?: boolean; noUsage?: boolean } = {}): any {
 const state: any = { sessions: [], runtimes: [], authLookups: 0, prompts: 0, providerCalls: 0 };
 const Type = { Object: (x: unknown) => x, Optional: (x: unknown) => x, String: (x: unknown) => x, Number: (x: unknown) => x, Boolean: (x: unknown) => x };
 class DefaultResourceLoader { options: any; constructor(options: any) { this.options = options; } }
 const deps = {
  Type, DefaultResourceLoader, estimateTokens: (message: any) => { assert.equal(typeof message?.role, "string", "Pi estimateTokens takes one AgentMessage, not an array"); return estimate; },
  ModelRuntime: { async create(options: any) { state.runtimes.push(options); return { getModel(provider: string, id: string) { assert.equal(provider, "github-copilot"); assert.equal(id, "gpt-6-luna"); return { provider, id, maxTokens: 128000 }; } }; } },
  SessionManager: { inMemory: (cwd: string) => ({ cwd }) },
  SettingsManager: { inMemory: (settings: any) => ({ settings }) },
  async createAgentSession(options: any) {
   const sessionState: any = { options, disposed: false, listener: undefined, aborted: 0 };
   const agent: any = { abort() { sessionState.aborted++; }, beforeToolCall: undefined, prepareRequest: undefined, transformContext: undefined };
   const session: any = {
    agent, getActiveToolNames: () => options.tools,
    subscribe(listener: any) { sessionState.listener = listener; return () => { sessionState.listener = undefined; }; },
    async prompt(text: string, promptOptions: any) {
     state.prompts++; assert.equal(text, "Trace the call chain."); assert.equal(promptOptions.expandPromptTemplates, false);
     if (exhaustOutput) sessionState.listener?.({ type: "message_end", message: { role: "assistant", usage: { input: 5, output: 2048 } } });
     if (agent.transformContext) await agent.transformContext([{ role: "user", content: [{ type: "text", text }] }]);
     if (sessionState.aborted) return;
     if (agent.prepareRequest) await agent.prepareRequest({ context: { messages: [] }, model: options.model });
     if (sessionState.aborted) return;
     state.providerCalls++;
     if (blockAfterTools) {
      for (let i = 0; i < 33; i++) {
       const outcome = await agent.beforeToolCall({ toolCall: { name: "list_files" } });
       if (outcome?.block) break;
      }
     } else {
      if (agent.beforeToolCall) await agent.beforeToolCall({ toolCall: { name: "read_file" } });
      if (!noUsage) sessionState.listener?.({ type: "message_end", message: { role: "assistant", usage: { input: 123, output: 87 } } });
      sessionState.listener?.({ type: "tool_execution_start", toolName: "read_file", args: { path: "src/a.ts" } });
      sessionState.listener?.({ type: "tool_execution_end", toolName: "read_file", ...(noUsage ? {} : { durationMs: 12.5 }) });
     }
    },
    getLastAssistantText: () => "The endpoint calls the service. Mind Place graph was optional.",
    getSessionStats: () => noUsage ? undefined : ({ tokens: { input: 123, output: 87 } }),
    dispose() { sessionState.disposed = true; },
   };
   state.sessions.push(sessionState); return { session };
  },
  graphApi: { MindplaceQueryTool: stubTool("mindplace_query"), MindplaceExplainTool: stubTool("mindplace_explain"), MindplaceBuildTool: stubTool("mindplace_build") },
 };
 return { deps, state };
}
function saveGraph(path: string, nodes: ExtractionResult["nodes"], edges: ExtractionResult["edges"] = []): void {
 mkdirSync(join(path, "graph-out"), { recursive: true });
 const kg = KnowledgeGraph.fromExtraction({ nodes, edges });
  writeFileSync(join(path, "graph-out", "graph.json"), JSON.stringify({ ...kg.toJSON() as object, mindplace: makeGraphMetadata(path, detect(path)) }));
}
const ctx = (cwd: string) => ({ cwd }) as any;
function textOf(result: AgentToolResult<unknown>): string { const first = result.content[0]; if (first?.type !== "text") throw new Error("expected text content"); return first.text; }

describe("offline Pi SDK 1.2.0 Luna adapter conformance", () => {
 it("uses fresh fake SDK sessions, identical task/map/settings, strict arm allowlists, and Pi usage events", async () => {
  const base = root(); const map = mp2Request("map_only", base); const graph = mp2Request("graph_optional", base);
  const { deps, state } = fakeAdapterDependencies();
  const mapResult = await mp2Adapter.executeAdapterRequest(map, deps);
  const graphResult = await mp2Adapter.executeAdapterRequest(graph, deps);
  assert.equal(state.sessions.length, 2); assert.notEqual(state.sessions[0], state.sessions[1]);
  assert.equal(state.prompts, 2); assert.equal(state.authLookups, 0);
  assert.ok(state.runtimes.every((item: any) => item.allowModelNetwork === false && item.refreshOnCreate === false && item.modelsPath === null));
  assert.ok(state.runtimes.every((item: any) => item.authPath.startsWith(join(base, "home"))));
  const mapOptions = state.sessions[0].options; const graphOptions = state.sessions[1].options;
  assert.deepEqual(mapOptions.tools, ["list_files", "search_text", "read_file", "read_diff"]);
  assert.deepEqual(graphOptions.tools, [...mapOptions.tools, "mindplace_query", "mindplace_explain", "mindplace_build"]);
  assert.deepEqual(mapOptions.customTools.map((tool: any) => tool.name), mapOptions.tools);
  assert.deepEqual(graphOptions.customTools.map((tool: any) => tool.name), graphOptions.tools);
  assert.equal(mapOptions.noTools, "all"); assert.equal(graphOptions.noTools, "all");
  assert.equal(mapOptions.model.maxTokens, 2048); assert.equal(graphOptions.model.maxTokens, 2048);
  assert.equal(mapOptions.resourceLoader.options.systemPrompt, graphOptions.resourceLoader.options.systemPrompt);
  assert.deepEqual(map.settings, graph.settings); assert.deepEqual(map.context, graph.context); assert.equal(map.taskText, graph.taskText);
  assert.equal(mapResult.usage.inputTokens, 123); assert.equal(mapResult.usage.outputTokens, 87);
  assert.equal(mapResult.usage.toolDeclarationTokens, null); assert.equal(mapResult.usage.toolPromptTokens, null);
  assert.deepEqual(mapResult.usage.toolCalls, [{ name: "read_file", durationMs: 12.5 }]);
  assert.deepEqual(mapResult.usage.inspectedPaths, ["src/a.ts"]);
  assert.equal(mapResult.provider, "github-copilot"); assert.equal(mapResult.model, "gpt-6-luna");
  assert.equal(graph.graph.graphPath, undefined, "no external graph artifact is assumed");
 });

 it("aborts an over-budget fake context before any provider request and stops after the tool-call cap", async () => {
  const base = root(); const tooLarge = mp2Request("map_only", base); const budgetFake = fakeAdapterDependencies({ estimate: 16001 });
  const aborted = await mp2Adapter.executeAdapterRequest(tooLarge, budgetFake.deps);
  assert.equal(budgetFake.state.providerCalls, 0); assert.equal(aborted.usage.contextBudgetAbort, true);
  assert.equal(budgetFake.state.sessions[0].aborted, 1);
  const bounded = mp2Request("map_only", base); const toolFake = fakeAdapterDependencies({ blockAfterTools: true });
  const capped = await mp2Adapter.executeAdapterRequest(bounded, toolFake.deps);
  assert.equal(capped.usage.toolLimitReached, true); assert.equal(toolFake.state.sessions[0].aborted, 1);
  assert.equal(toolFake.state.runtimes[0].allowModelNetwork, false);
 });

 it("throws from guard hooks so the (fake) provider callback is never reached; actual Pi agent loop is not launched here", async () => {
  const base = root();
  const ctxFake = fakeAdapterDependencies({ estimate: 16001 });
  const ctxResult = await mp2Adapter.executeAdapterRequest(mp2Request("map_only", base), ctxFake.deps);
  assert.equal(ctxFake.state.providerCalls, 0); assert.equal(ctxResult.usage.stopReason, "context_budget");
  const outFake = fakeAdapterDependencies({ exhaustOutput: true });
  const outResult = await mp2Adapter.executeAdapterRequest(mp2Request("map_only", base), outFake.deps);
  assert.equal(outFake.state.providerCalls, 0); assert.equal(outResult.usage.outputLimitReached, true); assert.equal(outResult.usage.stopReason, "output_limit");
  assert.equal(outFake.state.sessions[0].aborted, 1);
  assert.equal(outResult.usage.outputTokens, 2048);
  // Static note: Pi 1.2 agent-loop calls these hooks then the provider unconditionally, so the hooks throw; the real Agent loop is not launched here.
 });

 it("reports missing usage/durations as null (never fabricated zero) and truthful legitimate zero usage", async () => {
  const base = root(); const fake = fakeAdapterDependencies({ noUsage: true });
  const result = await mp2Adapter.executeAdapterRequest(mp2Request("map_only", base), fake.deps);
  assert.equal(result.usage.inputTokens, null); assert.equal(result.usage.outputTokens, null);
  assert.deepEqual(result.usage.toolCalls, [{ name: "read_file", durationMs: null }]);
  assert.equal(result.usage.stopReason, null); assert.equal(result.usage.toolLimitReached, false); assert.equal(result.usage.outputLimitReached, false);
  // legitimate zero: stats fallback reports finite zeros only when no event usage was seen
  const zeroResult = await mp2Adapter.executeAdapterRequest(mp2Request("map_only", base), (() => { const f = fakeAdapterDependencies({ noUsage: true }); const c = f.deps.createAgentSession; f.deps.createAgentSession = async (o: any) => { const r = await c(o); r.session.getSessionStats = () => ({ tokens: { input: 0, output: 0 } }); return r; }; return f.deps; })());
  assert.equal(zeroResult.usage.inputTokens, 0); assert.equal(zeroResult.usage.outputTokens, 0);
 });
});

const FIXTURE_FILES: Record<string, string> = {
  "src/a.ts": "export function alpha() { return beta(); }\nexport function beta() { return 1; }\n",
  "src/b.ts": "export function beta() { return 2; }\n",
};
async function adapterGraphTools(): Promise<{ base: string; workspace: string; api: any; byName: (name: string) => any; ordinary: (name: string) => any; prod: (name: string) => any }> {
  const base = root(); const workspace = join(base, "workspace");
  for (const [file, text] of Object.entries(FIXTURE_FILES)) { mkdirSync(join(workspace, file, ".."), { recursive: true }); writeFileSync(join(workspace, file), text); }
  const api = await mp2Adapter.loadGraphApi();
  const { deps, state } = fakeAdapterDependencies(); deps.graphApi = api;
  await mp2Adapter.executeAdapterRequest(mp2Request("graph_optional", base), deps);
  const tools = state.sessions[0].options.customTools;
  const byName = (name: string) => tools.find((tool: any) => tool.name === name);
  const prod = (name: string) => ({ mindplace_build: api.MindplaceBuildTool, mindplace_query: api.MindplaceQueryTool, mindplace_explain: api.MindplaceExplainTool } as any)[name];
  return { base, workspace, api, byName, ordinary: byName, prod };
}
const signal = () => new AbortController().signal;
const adapterCall = (tool: any, workspace: string, params: any) => tool.execute("t", params, signal(), () => {}, { cwd: workspace, hasUI: false });
const productionCall = (tool: any, workspace: string, params: any) => tool.execute("t", params, signal(), () => {}, { cwd: workspace, hasUI: false });

describe("actual production graph tools in the adapter", () => {
  it("exposes production schema/description and matches production output for query and explain (exact, ambiguous, no-match, filters)", async () => {
    const t = await adapterGraphTools();
    for (const name of ["mindplace_build", "mindplace_query", "mindplace_explain"]) {
      assert.equal(t.byName(name).description, t.prod(name).description);
      assert.equal(t.byName(name).parameters, t.prod(name).parameters);
      assert.equal(t.byName(name).label, t.prod(name).label);
    }
    const built = await adapterCall(t.byName("mindplace_build"), t.workspace, { force: true });
    assert.match(textOf(built), /Mind Place built/);
    const cases: Array<[string, any]> = [
      ["mindplace_query", { question: "what does alpha call" }],
      ["mindplace_query", { question: "what does alpha call", budget: 2000, minScore: 0.3 }],
      ["mindplace_explain", { name: "alpha" }],
      ["mindplace_explain", { name: "beta" }],
      ["mindplace_explain", { name: "beta", file: "src/b.ts" }],
      ["mindplace_explain", { name: "beta", type: "function", file: "src/a.ts" }],
      ["mindplace_explain", { name: "doesNotExistAnywhere" }],
    ];
    for (const [name, params] of cases) {
      const actual = await adapterCall(t.byName(name), t.workspace, params); const expected = await productionCall(t.prod(name), t.workspace, params);
      assert.deepEqual(actual, expected, `${name} ${JSON.stringify(params)}`);
    }
    assert.equal((await adapterCall(t.byName("mindplace_explain"), t.workspace, { name: "beta" })).details.status, "ambiguous");
    assert.equal((await adapterCall(t.byName("mindplace_explain"), t.workspace, { name: "doesNotExistAnywhere" })).details.status, "no_match");
  });

  it("matches production for missing, stale, and corrupt graph states", async () => {
    const t = await adapterGraphTools(); const params = { question: "alpha" };
    const compare = async () => {
      for (const name of ["mindplace_query", "mindplace_explain"]) {
        const p = name === "mindplace_query" ? params : { name: "alpha" };
        assert.deepEqual(await adapterCall(t.byName(name), t.workspace, p), await productionCall(t.prod(name), t.workspace, p));
      }
    };
    assert.equal((await adapterCall(t.byName("mindplace_query"), t.workspace, params)).details.status, "not_built"); await compare();
    await adapterCall(t.byName("mindplace_build"), t.workspace, { force: true });
    writeFileSync(join(t.workspace, "src", "a.ts"), "export function changed() {}\n");
    assert.equal((await adapterCall(t.byName("mindplace_query"), t.workspace, params)).details.status, "stale"); await compare();
    writeFileSync(join(t.workspace, "graph-out", "graph.json"), "not json");
    const corrupt = await adapterCall(t.byName("mindplace_query"), t.workspace, params);
    assert.notEqual(corrupt.details.status, "matched"); await compare();
  });

  it("hides production build artifacts from every ordinary tool and confines graph tool paths", async () => {
    const t = await adapterGraphTools(); const run = async (name: string, params: any) => adapterCall(t.ordinary(name), t.workspace, params);
    await adapterCall(t.byName("mindplace_build"), t.workspace, { force: true });
    assert.ok(statSync(join(t.workspace, "graph-out", "graph.json")).isFile());
    const listing = textOf(await run("list_files", {})); const search = textOf(await run("search_text", { query: "alpha" })); const searchAll = textOf(await run("search_text", { query: "graph-out" }));
    for (const text of [listing, search, searchAll]) assert.doesNotMatch(text, /graph-out|\.gitignore|graph\.json|GRAPH_REPORT/);
    assert.match(listing, /src\/a\.ts/);
    for (const [name, params] of [["read_file", { path: "graph-out/graph.json" }], ["read_diff", { path: "GRAPH-OUT/graph.json" }], ["read_file", { path: ".gitignore" }], ["list_files", { path: "graph-out" }], ["search_text", { query: "alpha", path: "graph-out" }], ["read_file", { path: "src/../graph-out/graph.json" }]] as Array<[string, any]>) {
      await assert.rejects(() => run(name, params), /not available|escapes|relative/, `${name} ${JSON.stringify(params)}`);
    }
    for (const params of [{ path: ".." }, { path: "../elsewhere" }, { path: ".hidden" }, { path: "src/.secret" }, { path: "graph-out" }, { path: join(t.base, "abs") }]) {
      await assert.rejects(() => adapterCall(t.byName("mindplace_query"), t.workspace, { question: "alpha", ...params }), /safe|relative|escapes|not available/);
    }
    for (const file of ["/etc/passwd", "..\\x", ".env", "a/.hidden/b.ts"]) {
      await assert.rejects(() => adapterCall(t.byName("mindplace_explain"), t.workspace, { name: "alpha", file }), /file filter/);
    }
  });

  it("provisions via the production build, records side effects/time, and returns legitimate statuses for empty fixtures", async () => {
    const t = await adapterGraphTools();
    const run = await mp2Adapter.provisionGraph(t.api, t.workspace);
    assert.equal(run.name, "mindplace_build"); assert.ok(run.wallMs >= 0); assert.equal(run.sideEffects.createdGraphOut, true); assert.equal(run.sideEffects.graphJsonPresent, true); assert.equal(run.sideEffects.graphJsonChanged, true);
    const empty = root(); mkdirSync(empty, { recursive: true });
    const none = await mp2Adapter.provisionGraph(t.api, empty);
    assert.equal(none.status, "no_supported_source"); assert.equal(none.sideEffects.graphJsonPresent, false); assert.equal(none.sideEffects.graphJsonChanged, false);
    const query = await mp2Adapter.runProductionGraphTool(t.api.MindplaceQueryTool, t.workspace, { question: "alpha" });
    assert.equal(query.run.sideEffects.graphJsonPresent, true); assert.equal(query.run.sideEffects.graphJsonChanged, false, "a read-only query is present but not changed");
  });

  it("blocks DOS short-name and trailing-dot/space variants and rejects junction/symlink escapes", async () => {
    const t = await adapterGraphTools(); const run = async (name: string, params: any) => adapterCall(t.ordinary(name), t.workspace, params);
    await adapterCall(t.byName("mindplace_build"), t.workspace, { force: true });
    for (const path of ["GRAPH-~1/graph.json", "graph~1/graph.json", "graph-out./graph.json", "graph-out /graph.json", ".gitignore.", ".gitignore ", "GITIGN~1"]) await assert.rejects(() => run("read_file", { path }), /not available|escapes|relative/, path);
    const outside = root(); writeFileSync(join(outside, "secret.txt"), "TOPSECRET alpha\n");
    try { symlinkSync(outside, join(t.workspace, "link"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error: any) { if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) return; throw error; }
    await assert.rejects(() => run("read_file", { path: "link/secret.txt" }), /Symlink|escapes|not available/);
    await assert.rejects(() => run("list_files", { path: "link" }), /Symlink|escapes|not available/);
    assert.doesNotMatch(textOf(await run("list_files", {})), /secret/);
    assert.doesNotMatch(textOf(await run("search_text", { query: "TOPSECRET" })), /TOPSECRET/);
  });

  it("matches production for incomplete freshness metadata and for pre-cancelled signals", async () => {
    const t = await adapterGraphTools();
    await adapterCall(t.byName("mindplace_build"), t.workspace, { force: true });
    const graphPath = join(t.workspace, "graph-out", "graph.json"); const raw = JSON.parse(readFileSync(graphPath, "utf8"));
    raw.mindplace.scanComplete = false; writeFileSync(graphPath, JSON.stringify(raw));
    for (const [name, p] of [["mindplace_query", { question: "alpha" }], ["mindplace_explain", { name: "alpha" }]] as Array<[string, any]>) {
      const actual = await adapterCall(t.byName(name), t.workspace, p);
      assert.equal(actual.details.status, "unknown"); assert.deepEqual(actual, await productionCall(t.prod(name), t.workspace, p));
    }
    const aborted = new AbortController(); aborted.abort();
    for (const [name, p] of [["mindplace_query", { question: "alpha" }], ["mindplace_explain", { name: "alpha" }], ["mindplace_build", { force: true }]] as Array<[string, any]>) {
      const call = (tool: any) => tool.execute("c", p, aborted.signal, () => {}, { cwd: t.workspace, hasUI: false });
      const actual = await call(t.byName(name)); const expected = await call(t.prod(name));
      assert.equal(actual.details?.status, expected.details?.status, name); assert.deepEqual(actual.content, expected.content, name);
    }
  });
});

describe("production-vs-adapter graph query equivalence", () => {
 it("matches production query output for the same verified workspace graph and production default budget", async () => {
  const base = root(); const workspace = join(base, "workspace"); mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.ts"), "export function alpha() { return beta(); }\nexport function beta() { return 1; }\n");
  const req = mp2Request("graph_optional", base);
  const { deps, state } = fakeAdapterDependencies(); deps.graphApi = await mp2Adapter.loadGraphApi();
  await mp2Adapter.executeAdapterRequest(req, deps);
  const tools = state.sessions[0].options.customTools; const byName = (name: string) => tools.find((tool: any) => tool.name === name);
  const toolContext = { cwd: workspace };
  await byName("mindplace_build").execute("build", {}, undefined, undefined, toolContext);
  const raw = JSON.parse(readFileSync(join(workspace, "graph-out", "graph.json"), "utf8"));
  const question = "what does alpha call";
  const info = `status verified_current; graph ${join(workspace, "graph-out", "graph.json")} (root ${workspace})`;
  const explicit = textOf(await byName("mindplace_query").execute("query", { question, budget: 2000 }, undefined, undefined, toolContext));
  assert.equal(explicit, productionFormat(productionQuery(KnowledgeGraph.fromJSON(raw), question, 2000, "bfs", 0.15, info)));
  const defaulted = textOf(await byName("mindplace_query").execute("query-default", { question }, undefined, undefined, toolContext));
  assert.equal(defaulted, productionFormat(productionQuery(KnowledgeGraph.fromJSON(raw), question, 4000, "bfs", 0.15, info)));
 });
});

describe("tool root and explanation regressions", () => {
 it("runs the explicitly synthetic offline MP2-07 smoke and writes blinded result artifacts", async () => {
  const out = join(root(), "smoke-artifacts");
  const result = await mp2Eval.runOfflineSmoke({ outputDirectory: out });
  const raw = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
  const blind = JSON.parse(readFileSync(join(out, "blind-score-sheet.json"), "utf8"));
  const key = JSON.parse(readFileSync(join(out, "scoring-key.sealed.json"), "utf8"));
  assert.equal(result.executionStatus, "HARNESS_SIMULATION_NOT_EMPIRICAL");
  assert.equal(result.harnessSimulation, true);
  assert.equal(result.empirical, false);
  assert.equal(result.decisionEligible, false);
  assert.equal(raw.results.length, 54, "nine tasks × three repetitions × two treatments");
  assert.equal(new Set(raw.results.map((row: any) => row.workspaceId)).size, 54, "every arm uses a fresh isolated fixture copy/session");
  assert.equal(raw.results.filter((row: any) => row.treatment === "graph_optional").length, 27);
  assert.equal(raw.results.filter((row: any) => row.treatment === "map_only").length, 27);
  assert.ok(raw.results.some((row: any) => row.treatment === "graph_optional" && row.metrics.toolCallCounts.graph > 0));
  assert.ok(raw.results.filter((row: any) => row.treatment === "map_only").every((row: any) => row.metrics.toolCallCounts.graph === 0));
  assert.ok(raw.results.filter((row: any) => row.graphProvisioning === "cold").every((row: any) => row.repetition === 1));
  assert.ok(raw.results.filter((row: any) => row.graphProvisioning === "reusable").every((row: any) => row.repetition > 1));
  assert.equal(blind.harnessSimulation, true);
  assert.equal(blind.entries.length, 54);
  assert.ok(blind.entries.every((entry: any) => entry.score === null && entry.maxScore > 0));
  assert.ok(blind.entries.every((entry: any) => !("treatment" in entry)));
  assert.equal(Object.keys(key.mapping).length, 54);
  assert.throws(() => mp2Eval.analyzeScoredResults(raw, blind, key), /never eligible/);
 });

 it("accepts only the explicitly designated one-task LIVE SMOKE manifest and keeps full evaluation repetition guard", () => {
  const smokePath = "evaluation/smoke-task-manifest.json";
  const smoke = JSON.parse(readFileSync(smokePath, "utf8"));
  const inputs = mp2Eval.approvalInputs(smokePath);
  assert.equal(smoke.liveSmoke, true);
  assert.equal(smoke.decisionEligible, false);
  assert.equal(smoke.tasks.length * smoke.repetitions * 2, 2, "LIVE SMOKE is bounded to two arm sessions");
  assert.equal(inputs.repetitions, 1);
  assert.ok(mp2Eval.approvalInputs(mp2Eval.DEFAULT_MANIFEST).repetitions >= 2);
  const invalidFullPath = join(root(), "one-repetition-full.json");
  const invalidFull = { ...JSON.parse(readFileSync(mp2Eval.DEFAULT_MANIFEST, "utf8")), repetitions: 1 };
  writeFileSync(invalidFullPath, JSON.stringify(invalidFull));
  assert.throws(() => mp2Eval.approvalInputs(invalidFullPath), /at least two/);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes: Buffer.from(JSON.stringify({ ...smoke, decisionEligible: true })), manifest: { ...smoke, decisionEligible: true }, approval: {}, adapterCommand: "node", adapterArgs: [] }), /liveSmoke manifests must be exactly/);
  for (const [label, mutate] of [["two reps", { repetitions: 2 }], ["two tasks", { tasks: [smoke.tasks[0], { ...smoke.tasks[0], id: "second" }] }]] as Array<[string, any]>) {
   const bad = { ...smoke, ...mutate }; const badPath = join(root(), `${label.replace(" ", "-")}.json`); writeFileSync(badPath, JSON.stringify(bad));
   assert.throws(() => mp2Eval.approvalInputs(badPath), /liveSmoke manifests must be exactly/, label);
  }
 });

 it("analysis refuses failed attempts and null metrics instead of coercing zero", () => {
  const usage = { inputTokens: 1, outputTokens: 1, sessionWallMs: 1 };
  const row = (failures: string[], inputTokens: number | null) => ({ blindId: "b1", taskId: "t", repetition: 1, treatment: "map_only", failures, metrics: { usage: { ...usage, inputTokens }, toolCallCounts: { ordinary: 0, graph: 0 }, effectiveWallMsIncludingGraphCharge: 1 } });
  const sheet = { runId: "r", harnessSimulation: false, scoringStatus: "BLIND_SCORING_COMPLETE", entries: [{ blindId: "b1", score: 1, maxScore: 5, scorerId: "s" }] };
  const key = { runId: "r", mapping: { b1: { maxScore: 5 } } };
  const results = (r: any) => ({ schemaVersion: 1, empirical: true, harnessSimulation: false, runId: "r", repetitions: 1, seed: 1, results: [r] });
  assert.throws(() => mp2Eval.analyzeScoredResults(results(row(["adapter stopped: tool-call limit reached"], 1)), sheet, key), /refuses failed attempt/);
  assert.throws(() => mp2Eval.analyzeScoredResults(results(row([], null)), sheet, key), /refuses null/);
 });
 it("refuses unapproved or hash-mismatched model execution before any adapter can launch", async () => {
  const manifestBytes = readFileSync(mp2Eval.DEFAULT_MANIFEST);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const inputs = mp2Eval.approvalInputs();
  const approval = {
   schemaVersion: 1, approved: true, approvedBy: "test-only", approvedAt: "2026-10-16T12:00:00Z",
   manifestSha256: inputs.manifestSha256, fixtureDigest: inputs.fixtureDigest, harnessSha256: inputs.harnessSha256, rubricSha256: inputs.rubricSha256,
   provider: inputs.provider, model: inputs.model, settings: inputs.settings, repetitions: inputs.repetitions, liveSmoke: inputs.liveSmoke, adapterVersion: inputs.adapterVersion, piSdkVersion: "1.2.0",
   sourceTreeSha256: inputs.sourceTreeSha256, piSdkIntegrity: inputs.piSdkIntegrity, environment: inputs.environment, adapterId: inputs.adapterId, adapterCommand: "not-a-real-command", adapterArgs: [],
  };
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: undefined, adapterCommand: "not-a-real-command", adapterArgs: [] }), /No adapter launch is authorized/);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: { ...approval, manifestSha256: "0".repeat(64) }, adapterCommand: approval.adapterCommand, adapterArgs: [] }), /manifest hash mismatch/);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: { ...approval, adapterCommand: "different-command" }, adapterCommand: approval.adapterCommand, adapterArgs: [] }), /Adapter command differs/);
  await assert.rejects(mp2Eval.runApprovedEvaluation({ outputDirectory: join(root(), "blocked"), approvalPath: undefined, adapterCommand: "not-a-real-command", adapterArgs: [] }), /--approval is required/);
  const entry = join(root(), "adapter-entry.mjs"); writeFileSync(entry, "// reviewed test adapter identity fixture\n");
  const pinned = { ...approval, adapterCommand: "node", adapterArgs: [entry], adapterEntry: entry, adapterEntrySha256: mp2Eval.sha256(readFileSync(entry)) };
  assert.equal(mp2Eval.verifyApproval({ manifestBytes, manifest, approval: pinned, adapterCommand: "node", adapterArgs: [entry] }).fixtureDigest, inputs.fixtureDigest);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval, adapterCommand: approval.adapterCommand, adapterArgs: [] }), /Approval must pin the adapter entry/);
  const relativePinned = { ...pinned, adapterArgs: [relative(process.cwd(), entry)], adapterEntry: relative(process.cwd(), entry) };
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: relativePinned, adapterCommand: "node", adapterArgs: relativePinned.adapterArgs }), /absolute path/);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: { ...pinned, piSdkIntegrity: "sha512-AAAA" }, adapterCommand: "node", adapterArgs: [entry] }), /lock integrity/);
  writeFileSync(entry, "// tampered after approval\n");
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: pinned, adapterCommand: "node", adapterArgs: [entry] }), /Adapter entry file hash mismatch/);
 });
 it("keeps query scope rooted at cwd unless an explicit root is selected", async () => {
  const a = root(), b = root();
  saveGraph(a, [{ id: "a_file", label: "a.ts", type: "file", sourceFile: "a.ts" }, { id: "a_target", label: "alphaTarget", type: "function", sourceFile: "a.ts" }]);
  saveGraph(b, [{ id: "b_file", label: "b.ts", type: "file", sourceFile: "b.ts" }, { id: "b_target", label: "betaTarget", type: "function", sourceFile: "b.ts" }]);
  resetFreshnessCounters();
  const explicit = await MindplaceQueryTool.execute("1", { question: "betaTarget", path: b }, new AbortController().signal, () => {}, ctx(a));
  const relativeRoot = await MindplaceQueryTool.execute("1b", { question: "betaTarget", path: relative(a, b) }, new AbortController().signal, () => {}, ctx(a));
  const implicit = await MindplaceQueryTool.execute("2", { question: "alphaTarget" }, new AbortController().signal, () => {}, ctx(a));
  assert.match(textOf(explicit), /betaTarget/);
  assert.match(textOf(explicit), new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(textOf(implicit), /alphaTarget/);
  assert.doesNotMatch(textOf(implicit), /betaTarget/);
  const operationCounts = getFreshnessCounters();
  assert.equal(operationCounts.rankings, 3, "each successful explicit query records ranking work");
  assert.equal(operationCounts.graphReads, 6, "each query brackets source verification with graph-generation reads");
  assert.equal(explicit.details.root, b);
  assert.equal(relativeRoot.details.root, b);
  const used = explicit.details.tokensUsed;
  const budget = explicit.details.budget;
  if (used === undefined || budget === undefined) throw new Error("query details should include output budget metrics");
  assert.ok(used <= budget);
  assert.ok(estimateQueryTokens(textOf(explicit)) <= budget);
 });

 it("reports exact duplicate symbols as ambiguous and supports file disambiguation", async () => {
  const path = root();
  saveGraph(path, [
   { id: "a_article", label: "Article", type: "class", sourceFile: "src/a.ts", sourceLocation: "L2" },
   { id: "b_article", label: "Article", type: "class", sourceFile: "src/b.ts", sourceLocation: "L4" },
   { id: "query_file", label: "src/query.ts", type: "file", sourceFile: "src/query.ts" },
   { id: "query_symbol", label: "query", type: "function", sourceFile: "src/query.ts" },
   { id: "article_settings", label: "ArticleSettingsReferences", type: "class", sourceFile: "src/settings.ts" },
   { id: "tk_update", label: "TkUpdateSession", type: "class", sourceFile: "src/session.ts" },
   { id: "tk_update_event", label: "TkUpdateSessionEvent", type: "class", sourceFile: "src/events.ts" },
   { id: "qualified_article", label: "Demo.Article", type: "class", sourceFile: "src/demo.ts" },
  ]);
  const ambiguous = await MindplaceExplainTool.execute("1", { name: "Article" }, new AbortController().signal, () => {}, ctx(path));
  const selected = await MindplaceExplainTool.execute("2", { name: "Article", file: "src/a.ts" }, new AbortController().signal, () => {}, ctx(path));
  const file = await MindplaceExplainTool.execute("3", { name: "src/query.ts" }, new AbortController().signal, () => {}, ctx(path));
  const shortName = await MindplaceExplainTool.execute("3b", { name: "query" }, new AbortController().signal, () => {}, ctx(path));
  const longerName = await MindplaceExplainTool.execute("3c", { name: "ArticleSettingsReferences" }, new AbortController().signal, () => {}, ctx(path));
  const prefix = await MindplaceExplainTool.execute("4", { name: "TkUpdateSession" }, new AbortController().signal, () => {}, ctx(path));
  const eventName = await MindplaceExplainTool.execute("4b", { name: "TkUpdateSessionEvent" }, new AbortController().signal, () => {}, ctx(path));
  const qualified = await MindplaceExplainTool.execute("5", { name: "Demo.Article" }, new AbortController().signal, () => {}, ctx(path));
  const none = await MindplaceExplainTool.execute("6", { name: "MissingSymbol" }, new AbortController().signal, () => {}, ctx(path));
  assert.equal(ambiguous.details.status, "ambiguous");
  assert.deepEqual(ambiguous.details.candidates?.map((candidate: { id: string }) => candidate.id), ["a_article", "b_article"]);
  assert.doesNotMatch(JSON.stringify(ambiguous.details.candidates), /article_settings/i, "Article must not fuzzy-match ArticleSettingsReferences");
  assert.match(textOf(ambiguous), /src\/a\.ts/);
  assert.equal(selected.details.status, "matched");
  assert.equal(selected.details.nodeId, "a_article");
  assert.match(textOf(file), /src\/query\.ts/);
  assert.equal(file.details.nodeId, "query_file", "an exact path resolves to the file node");
  assert.equal(shortName.details.nodeId, "query_symbol", "an exact symbol name resolves independently of its file path");
  assert.equal(longerName.details.nodeId, "article_settings");
  assert.equal(prefix.details.nodeId, "tk_update");
  assert.equal(eventName.details.nodeId, "tk_update_event");
  assert.equal(qualified.details.nodeId, "qualified_article");
  assert.equal(none.details.status, "no_match");
 });

 it("returns duplicate qualified-name ambiguity in the same order regardless of insertion order", async () => {
  const firstRoot = root(), reversedRoot = root();
  const qualifiedNodes = [
   { id: "z_qualified", label: "Demo.Article", type: "class", sourceFile: "src/z.ts" },
   { id: "a_qualified", label: "Demo.Article", type: "class", sourceFile: "src/a.ts" },
  ];
  saveGraph(firstRoot, qualifiedNodes);
  saveGraph(reversedRoot, [...qualifiedNodes].reverse());
  const first = await MindplaceExplainTool.execute("1", { name: "Demo.Article" }, new AbortController().signal, () => {}, ctx(firstRoot));
  const reversed = await MindplaceExplainTool.execute("2", { name: "Demo.Article" }, new AbortController().signal, () => {}, ctx(reversedRoot));
  assert.equal(first.details.status, "ambiguous");
  assert.equal(reversed.details.status, "ambiguous");
  assert.deepEqual(first.details.candidates?.map((candidate: { id: string }) => candidate.id), ["a_qualified", "z_qualified"]);
  assert.deepEqual(reversed.details.candidates?.map((candidate: { id: string }) => candidate.id), first.details.candidates?.map((candidate: { id: string }) => candidate.id));
 });

 it("budgets the actual query tool response after the lifecycle hook", async () => {
  const base = root();
  const longRoot = join(base, "p".repeat(40), "q".repeat(40), "r".repeat(40));
  mkdirSync(longRoot, { recursive: true });
  saveGraph(longRoot, [{ id: "deploy_file", label: "scripts/deploy.sh", type: "file", sourceFile: "scripts/deploy.sh" }]);
  let before: ((event: any, context: any) => any) | undefined;
  const pi = { registerTool() {}, registerCommand() {}, on(name: string, handler: any) { if (name === "before_agent_start") before = handler; } } as any;
  extension(pi);
  const hookResult = before!({ systemPrompt: "BASE" }, { cwd: longRoot });
  assert.match(hookResult.systemPrompt, /optional navigation aid/i);

  const minimum = await MindplaceQueryTool.execute("budget", {
   question: "deploy ".repeat(200), path: longRoot, budget: 1,
  }, new AbortController().signal, () => {}, ctx(base));
  const minimumText = textOf(minimum);
  assert.equal(minimum.details.budget, 160, "positive budgets below the normalized minimum become 160 tokens");
  assert.equal(minimum.details.tokensUsed, estimateQueryTokens(minimumText), "the tool's final visible content, including its graph status/path notice, is estimated");
  assert.ok(estimateQueryTokens(minimumText) <= 160);
  assert.match(minimumText, /status verified_current/);
  assert.ok(minimumText.includes("deploy.sh"), "file-only graph hits remain useful through the real tool response");
  assert.ok(minimumText.includes("…"), "long question/path display is safely abbreviated");

  const invalid = await MindplaceQueryTool.execute("invalid", {
   question: "deploy", path: longRoot, budget: Number.POSITIVE_INFINITY,
  }, new AbortController().signal, () => {}, ctx(base));
  assert.equal(invalid.details.status, "execution_error");
  assert.match(textOf(invalid), /budget must be a finite positive number/);
 });

 it("refuses stale graph results from explicit queries", async () => {
  const path = root(); const source = join(path, "source.ts"); writeFileSync(source, "export const target = true;\\n");
  saveGraph(path, [{ id: "target", label: "secretTarget", type: "function", sourceFile: "source.ts" }]);
  writeFileSync(source, "export const target = false;\\n");
  const result = await MindplaceQueryTool.execute("stale", { question: "secretTarget" }, new AbortController().signal, () => {}, ctx(path));
  assert.equal(result.details.status, "stale");
  assert.match(textOf(result), /No graph results were returned/);
  assert.doesNotMatch(textOf(result), /secretTarget/);
 });

 it("distinguishes missing and corrupt graph tool states", async () => {
  const missing = root();
  const absent = await MindplaceQueryTool.execute("1", { question: "symbol" }, new AbortController().signal, () => {}, ctx(missing));
  assert.equal(absent.details.status, "not_built");
  mkdirSync(join(missing, "graph-out")); writeFileSync(join(missing, "graph-out", "graph.json"), "not json");
  const corrupt = await MindplaceExplainTool.execute("2", { name: "symbol" }, new AbortController().signal, () => {}, ctx(missing));
  assert.equal(corrupt.details.status, "unknown");
 });

 it("keeps lifecycle guidance advisory and supports an explicit off mode", async () => {
  const path = root();
  let before: ((event: any, context: any) => any) | undefined;
  let commandHandler: ((args: string | undefined, context: any) => Promise<void>) | undefined;
  const pi = {
   registerTool() {}, registerCommand(_name: string, config: any) { commandHandler = config.handler; },
   on(name: string, handler: any) { if (name === "before_agent_start") before = handler; },
  } as any;
  extension(pi);
  const previous = process.env.PI_MINDPLACE_CONTEXT;
  try {
   resetFreshnessCounters();
   delete process.env.PI_MINDPLACE_CONTEXT;
   const prompt = before!({ systemPrompt: "BASE" }, { cwd: path }).systemPrompt;
   assert.match(prompt, /not_built/i);
   assert.match(prompt, /optional/i);
   assert.doesNotMatch(prompt, /MUST|FIRST:|20-100x|build it immediately/i);
   saveGraph(path, [{ id: "source", label: "source.ts", type: "file", sourceFile: "source.ts" }]);
   const withGraph = before!({ systemPrompt: "BASE" }, { cwd: path }).systemPrompt;
   assert.match(withGraph, /optional navigation aid/i);
   assert.match(withGraph, /not_checked/i);
   assert.doesNotMatch(withGraph, /MUST|FIRST:|20-100x|build it immediately/i);
   assert.doesNotMatch(withGraph, /Optional Mind Place repository map/);
   process.env.PI_MINDPLACE_CONTEXT = "map";
   const firstMap = before!({ systemPrompt: "BASE" }, { cwd: path }).systemPrompt;
   assert.match(firstMap, /does not read an unverified graph/i);
   const passiveCounts = getFreshnessCounters();
   assert.equal(passiveCounts.sourceWalks + passiveCounts.sourceReads + passiveCounts.sourceHashes + passiveCounts.graphReads + passiveCounts.graphParses + passiveCounts.rankings, 0);
   assert.equal(passiveCounts.passivePrompts, 3);
   let verifiedStatus = "";
   await commandHandler!("status", { cwd: path, ui: { notify(message: string) { verifiedStatus = message; } } });
   assert.match(verifiedStatus, /verified_current/);
   resetFreshnessCounters();
   const graphPath = join(path, "graph-out", "graph.json"); const graphStat = statSync(graphPath);
   const updated = KnowledgeGraph.fromExtraction({ nodes: [{ id: "source", label: "target.ts", type: "file", sourceFile: "target.ts" }], edges: [] });
   writeFileSync(graphPath, JSON.stringify(updated.toJSON()));
   utimesSync(graphPath, new Date(graphStat.atimeMs), new Date(graphStat.mtimeMs));
   const updatedMap = before!({ systemPrompt: "BASE" }, { cwd: path }).systemPrompt;
   assert.match(updatedMap, /does not read an unverified graph/i);
   assert.doesNotMatch(updatedMap, /target\.ts|source\.ts/);
   const counts = getFreshnessCounters();
   assert.equal(counts.sourceWalks, 0);
   assert.equal(counts.sourceReads, 0);
   assert.equal(counts.sourceHashes, 0);
   assert.equal(counts.graphReads, 0);
   assert.equal(counts.graphParses, 0);
   assert.equal(counts.rankings, 0);
   assert.equal(counts.passivePrompts, 1);
   let statusNotice = "";
   await commandHandler!("status", { cwd: path, ui: { notify(message: string) { statusNotice = message; } } });
   assert.match(statusNotice, /unknown/, "legacy graph replacement remains unknown instead of borrowing old verification");
   process.env.PI_MINDPLACE_CONTEXT = "off";
   assert.equal(before!({ systemPrompt: "BASE" }, { cwd: path }).systemPrompt, "BASE");
  } finally {
   if (previous === undefined) delete process.env.PI_MINDPLACE_CONTEXT;
   else process.env.PI_MINDPLACE_CONTEXT = previous;
  }
 });
});
