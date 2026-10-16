import { afterEach, describe, it } from "node:test";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import extension from "../index.ts";
import { MindplaceQueryTool } from "../src/tools/mindplace-query.ts";
import { MindplaceExplainTool } from "../src/tools/mindplace-explain.ts";
import { KnowledgeGraph } from "../src/graph.ts";
import { detect } from "../src/detect.ts";
import { makeGraphMetadata, getFreshnessCounters, resetFreshnessCounters } from "../src/graph-file.ts";
import { estimateQueryTokens, query as productionQuery, formatQueryResult as productionFormat } from "../src/query.ts";
import { extract } from "../src/extract.ts";
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
  graph: { available: graphAvailable, graphPath: graphAvailable ? join(base, "external-graphs", "graph.json") : null },
 };
}
function fakeAdapterDependencies({ estimate = 20, blockAfterTools = false }: { estimate?: number; blockAfterTools?: boolean } = {}): any {
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
      sessionState.listener?.({ type: "message_end", message: { role: "assistant", usage: { input: 123, output: 87 } } });
      sessionState.listener?.({ type: "tool_execution_start", toolName: "read_file", args: { path: "src/a.ts" } });
      sessionState.listener?.({ type: "tool_execution_end", toolName: "read_file", durationMs: 12.5 });
     }
    },
    getLastAssistantText: () => "The endpoint calls the service. Mind Place graph was optional.",
    getSessionStats: () => ({ tokens: { input: 123, output: 87 } }),
    dispose() { sessionState.disposed = true; },
   };
   state.sessions.push(sessionState); return { session };
  },
  graphApi: { detect() {}, extract() {}, KnowledgeGraph: {}, makeGraphMetadata() {}, query() {}, formatQueryResult() {} },
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
  assert.ok(graph.graph.graphPath.startsWith(base) && !graph.graph.graphPath.startsWith(graph.workspace));
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
});

describe("production-vs-adapter graph query equivalence", () => {
 it("matches production query output for the same verified external artifact and production default budget", async () => {
  const base = root(); const workspace = join(base, "workspace"); mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.ts"), "export function alpha() { return beta(); }\nexport function beta() { return 1; }\n");
  const req = mp2Request("graph_optional", base);
  const realApi = { detect, extract, KnowledgeGraph, makeGraphMetadata, query: productionQuery, formatQueryResult: productionFormat };
  const { deps, state } = fakeAdapterDependencies(); deps.graphApi = realApi;
  await mp2Adapter.executeAdapterRequest(req, deps);
  const tools = state.sessions[0].options.customTools; const byName = (name: string) => tools.find((tool: any) => tool.name === name);
  const toolContext = { cwd: workspace };
  await byName("mindplace_build").execute("build", {}, undefined, undefined, toolContext);
  const raw = JSON.parse(readFileSync(req.graph.graphPath, "utf8"));
  const question = "what does alpha call";
  const info = "verified external evaluation graph";
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

 it("refuses unapproved or hash-mismatched model execution before any adapter can launch", async () => {
  const manifestBytes = readFileSync(mp2Eval.DEFAULT_MANIFEST);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const inputs = mp2Eval.approvalInputs();
  const approval = {
   schemaVersion: 1, approved: true, approvedBy: "test-only", approvedAt: "2026-10-16T12:00:00Z",
   manifestSha256: inputs.manifestSha256, fixtureDigest: inputs.fixtureDigest, harnessSha256: inputs.harnessSha256, rubricSha256: inputs.rubricSha256,
   provider: inputs.provider, model: inputs.model, settings: inputs.settings, repetitions: inputs.repetitions, adapterVersion: inputs.adapterVersion, piSdkVersion: "1.2.0",
   sourceTreeSha256: inputs.sourceTreeSha256, environment: inputs.environment, adapterId: inputs.adapterId, adapterCommand: "not-a-real-command", adapterArgs: [],
  };
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: undefined, adapterCommand: "not-a-real-command", adapterArgs: [] }), /No adapter launch is authorized/);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: { ...approval, manifestSha256: "0".repeat(64) }, adapterCommand: approval.adapterCommand, adapterArgs: [] }), /manifest hash mismatch/);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval: { ...approval, adapterCommand: "different-command" }, adapterCommand: approval.adapterCommand, adapterArgs: [] }), /Adapter command differs/);
  await assert.rejects(mp2Eval.runApprovedEvaluation({ outputDirectory: join(root(), "blocked"), approvalPath: undefined, adapterCommand: "not-a-real-command", adapterArgs: [] }), /--approval is required/);
  const entry = join(root(), "adapter-entry.mjs"); writeFileSync(entry, "// reviewed test adapter identity fixture\n");
  const pinned = { ...approval, adapterCommand: "node", adapterArgs: [entry], adapterEntry: entry, adapterEntrySha256: mp2Eval.sha256(readFileSync(entry)) };
  assert.equal(mp2Eval.verifyApproval({ manifestBytes, manifest, approval: pinned, adapterCommand: "node", adapterArgs: [entry] }).fixtureDigest, inputs.fixtureDigest);
  assert.throws(() => mp2Eval.verifyApproval({ manifestBytes, manifest, approval, adapterCommand: approval.adapterCommand, adapterArgs: [] }), /Approval must pin the adapter entry/);
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
