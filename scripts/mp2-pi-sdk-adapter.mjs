#!/usr/bin/env node
/**
 * MP2-07 adapter for Pi coding-agent SDK 1.2.0.
 * No import-time SDK/model/auth work: tests inject a fake SDK into executeAdapterRequest().
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const ADAPTER_VERSION = "mp2-pi-sdk-luna-1.0.0";
export const PROVIDER = "github-copilot";
export const MODEL = "gpt-6-luna";
export const COMMON_LIMITS = Object.freeze({ contextEstimateTokens: 16000, maxOutputTokens: 2048, ordinaryToolCalls: 32, graphToolCalls: 16, timeLimitSeconds: 600, thinkingLevel: "off" });
const ORDINARY_NAMES = ["list_files", "search_text", "read_file", "read_diff"];
const GRAPH_NAMES = ["mindplace_query", "mindplace_explain", "mindplace_build"];

function inside(root, candidate) {
  const r = relative(resolve(root), resolve(candidate));
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
}
function safePath(root, value) {
  if (typeof value !== "string" || !value || isAbsolute(value)) throw new Error("Path must be workspace-relative.");
  const candidate = resolve(root, value);
  if (!inside(root, candidate)) throw new Error("Path escapes the fixture workspace.");
  let cursor = resolve(root);
  for (const part of relative(cursor, candidate).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("Symlinks are not accessible to evaluation tools."); } catch (e) { if (e?.code !== "ENOENT") throw e; }
  }
  const resolved = existsSync(candidate) ? realpathSync(candidate) : candidate;
  if (!inside(root, resolved)) throw new Error("Resolved path escapes the fixture workspace.");
  return candidate;
}
function content(text) { return [{ type: "text", text }]; }
function toolDefinition(Type, name, label, description, fields, execute) {
  return { name, label, description, parameters: Type.Object(fields), execute: async (id, params, signal, update, ctx) => execute(params, ctx?.cwd, signal, update) };
}
function makeOrdinaryTools(Type, workspace, observe) {
  const maxReadBytes = 64 * 1024;
  const listFiles = toolDefinition(Type, "list_files", "List files", "List fixture files by relative path. No shell or writes are available.", { path: Type.Optional(Type.String({ description: "Workspace-relative directory, default ." })) }, (p) => {
    const root = resolve(workspace); const base = safePath(root, p.path ?? ".");
    const rows = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = join(dir, entry.name); if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(full); else if (entry.isFile()) rows.push(relative(root, full).split(sep).join("/"));
        if (rows.length >= 2000) return;
      }
    };
    walk(base); observe({ name: "list_files", paths: rows });
    return { content: content(rows.join("\n") || "(no files)") };
  });
  const searchText = toolDefinition(Type, "search_text", "Search text", "Search fixture text for a literal case-insensitive string. Returns matching file paths and lines.", { query: Type.String({ minLength: 1 }), path: Type.Optional(Type.String({ description: "Workspace-relative subtree, default ." })) }, (p) => {
    const root = resolve(workspace); const base = safePath(root, p.path ?? "."); const matches = []; const q = p.query.toLocaleLowerCase();
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = join(dir, entry.name); if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && matches.length < 200) {
          let text; try { text = readFileSync(full, "utf8"); } catch { continue; }
          if (text.includes("\0")) continue;
          const lines = text.split(/\r?\n/); const rel = relative(root, full).split(sep).join("/");
          lines.forEach((line, i) => { if (line.toLocaleLowerCase().includes(q) && matches.length < 200) matches.push(`${rel}:${i + 1}: ${line}`); });
        }
      }
    };
    walk(base); observe({ name: "search_text", paths: [...new Set(matches.map(line => line.slice(0, line.lastIndexOf(":"))))] });
    return { content: content(matches.join("\n") || "(no matches)") };
  });
  const readFile = (name, description) => toolDefinition(Type, name, name === "read_diff" ? "Read diff" : "Read file", description, { path: Type.String({ description: "Workspace-relative file path" }) }, (p) => {
    const full = safePath(workspace, p.path); const stat = lstatSync(full); if (!stat.isFile()) throw new Error("Path is not a regular file.");
    if (stat.size > maxReadBytes) throw new Error(`File exceeds the ${maxReadBytes}-byte read limit.`);
    const text = readFileSync(full, "utf8"); observe({ name, paths: [relative(workspace, full).split(sep).join("/")] }); return { content: content(text) };
  });
  return [listFiles, searchText, readFile("read_file", "Read one UTF-8 text file inside the fixture workspace."), readFile("read_diff", "Read a supplied patch file inside the fixture workspace; does not execute or apply it.")];
}
async function loadGraphApi() {
  const [detectModule, extractModule, graphModule, fileModule, queryModule] = await Promise.all([
    import("../src/detect.ts"), import("../src/extract.ts"), import("../src/graph.ts"), import("../src/graph-file.ts"), import("../src/query.ts"),
  ]);
  return { detect: detectModule.detect, extract: extractModule.extract, KnowledgeGraph: graphModule.KnowledgeGraph, makeGraphMetadata: fileModule.makeGraphMetadata, query: queryModule.query, formatQueryResult: queryModule.formatQueryResult };
}
function equalInventory(actual, expected) {
  if (!actual || !expected || Object.keys(actual).length !== Object.keys(expected).length) return false;
  return Object.keys(expected).every((path) => actual[path]?.size === expected[path]?.size && actual[path]?.sha256 === expected[path]?.sha256);
}
function graphAtWorkspace(workspace, graphPath, api) {
  if (!isAbsolute(graphPath) || inside(workspace, graphPath)) throw new Error("Evaluation graph must be an absolute artifact outside the ordinary workspace.");
  const raw = JSON.parse(readFileSync(graphPath, "utf8")); const metadata = raw?.mindplace;
  const detected = api.detect(workspace); const current = api.makeGraphMetadata(workspace, detected);
  if (!metadata || metadata.schemaVersion !== 3 || metadata.root !== resolve(workspace) || metadata.scanComplete !== true || !current.scanComplete || !equalInventory(metadata.inventory, current.inventory)) {
    throw new Error("External graph does not verify against this fixture workspace; no graph result was returned.");
  }
  return { raw, kg: api.KnowledgeGraph.fromJSON(raw), metadata };
}
function buildExternalGraph(workspace, graphPath, api) {
  const detected = api.detect(workspace); if (!detected.scanComplete || detected.scanLimited) throw new Error("Fixture scan is incomplete.");
  const extraction = api.extract(workspace, detected.files, undefined, true); const kg = api.KnowledgeGraph.fromExtraction(extraction);
  const metadata = api.makeGraphMetadata(workspace, detected); if (!metadata.scanComplete) throw new Error("Fixture freshness inventory is incomplete.");
  mkdirSync(dirname(graphPath), { recursive: true }); writeFileSync(graphPath, JSON.stringify({ ...kg.toJSON(), mindplace: metadata }, null, 2));
}
function graphTools(Type, workspace, graphPath, graphApi, observe) {
  const queryTool = toolDefinition(Type, "mindplace_query", "Query Mind Place", "Optionally retrieve relevant entities and relationships from the verified external fixture graph. Source reads remain available.", { question: Type.String({ minLength: 1 }), budget: Type.Optional(Type.Number({ minimum: 160, maximum: 4000 })) }, (p) => {
    const { kg } = graphAtWorkspace(workspace, graphPath, graphApi); graphApi.recordRanking?.();
    const result = graphApi.query(kg, p.question, p.budget ?? 4000, "bfs", 0.15, "verified external evaluation graph");
    observe({ name: "mindplace_query", paths: [] }); return { content: content(graphApi.formatQueryResult(result)) };
  });
  const explainTool = toolDefinition(Type, "mindplace_explain", "Explain graph node", "Optionally explain an exact graph entity and its connections. Verify facts with source reads.", { name: Type.String({ minLength: 1 }), file: Type.Optional(Type.String()), type: Type.Optional(Type.String()) }, (p) => {
    const { kg } = graphAtWorkspace(workspace, graphPath, graphApi); const name = p.name.trim();
    const found = [...kg.nodes.values()].filter(n => (!p.type || n.type.toLowerCase() === p.type.toLowerCase()) && (!p.file || n.sourceFile.replace(/\\/g, "/").toLowerCase().endsWith(p.file.replace(/\\/g, "/").toLowerCase())) && (n.id.toLowerCase() === name.toLowerCase() || n.label.toLowerCase() === name.toLowerCase()));
    graphApi.recordRanking?.(); observe({ name: "mindplace_explain", paths: [] });
    if (!found.length) return { content: content(`No exact graph entity matching ${name}. Use direct source search.`) };
    if (found.length > 1) return { content: content(`Ambiguous graph entity ${name}: ${found.slice(0, 12).map(n => `${n.label} (${n.type}) ${n.sourceFile}`).join("; ")}`) };
    const n = found[0]; const links = kg.edges.filter(e => e.source === n.id || e.target === n.id).slice(0, 30).map(e => `${e.source === n.id ? "->" : "<-"} ${e.relation} ${kg.nodes.get(e.source === n.id ? e.target : e.source)?.label ?? "?"}`);
    return { content: content(`${n.label} (${n.type})\nFile: ${n.sourceFile}${n.sourceLocation ? ` ${n.sourceLocation}` : ""}\n${links.join("\n")}`) };
  });
  const buildTool = toolDefinition(Type, "mindplace_build", "Build Mind Place", "Optionally rebuild only the external evaluation graph artifact. Never writes graph files into the workspace.", { force: Type.Optional(Type.Boolean()) }, () => {
    buildExternalGraph(workspace, graphPath, graphApi); observe({ name: "mindplace_build", paths: [] }); return { content: content(`Built verified graph artifact outside the workspace: ${basename(graphPath)}.`) };
  });
  return [queryTool, explainTool, buildTool];
}
/** Pi's estimateTokens(message: AgentMessage) is per message; sum the assembled context and return null (fail closed) on any non-finite value. */
function approximateMessageTokens(estimateTokens, messages) {
  if (!Array.isArray(messages)) return null;
  let total = 0;
  for (const message of messages) { const value = estimateTokens(message); if (!Number.isFinite(value) || value < 0) return null; total += value; }
  return total;
}
function messageUsage(message) {
  if (message?.role !== "assistant" || !message.usage) return null;
  const input = message.usage.input; const output = message.usage.output;
  return Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null;
}

/** Execute one request with injected SDK objects. This is the offline conformance seam. */
export async function executeAdapterRequest(request, deps) {
  if (request?.protocol !== "pi-mindplace-mp2-adapter-v1") throw new Error("Unsupported adapter protocol.");
  if (request.provider !== PROVIDER || request.model !== MODEL) throw new Error("Adapter only targets github-copilot/gpt-6-luna.");
  if (!request.isolation?.home || !request.isolation?.session || !request.isolation?.temp) throw new Error("Isolated home/session/temp directories are required.");
  const settings = request.settings;
  if (!settings || settings.contextEstimateTokens !== COMMON_LIMITS.contextEstimateTokens || settings.maxOutputTokens !== COMMON_LIMITS.maxOutputTokens || settings.ordinaryToolCalls !== COMMON_LIMITS.ordinaryToolCalls || settings.graphToolCalls !== COMMON_LIMITS.graphToolCalls || settings.thinkingLevel !== COMMON_LIMITS.thinkingLevel || settings.timeLimitSeconds !== COMMON_LIMITS.timeLimitSeconds) throw new Error("Request controls differ from the adapter's frozen supported settings.");
  const workspace = resolve(request.workspace); const graphAvailable = request.tools?.graph?.length > 0;
  if (JSON.stringify(request.tools?.ordinary) !== JSON.stringify(ORDINARY_NAMES) || JSON.stringify(request.tools?.graph ?? []) !== JSON.stringify(graphAvailable ? GRAPH_NAMES : [])) throw new Error("Tool allowlists differ from the frozen protocol.");
  if (graphAvailable && (!request.graph?.available || !request.graph.graphPath || inside(workspace, request.graph.graphPath))) throw new Error("Graph treatment requires an external graph path.");
  const runtime = await deps.ModelRuntime.create({ authPath: join(request.isolation.home, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const registeredModel = runtime.getModel(PROVIDER, MODEL);
  if (!registeredModel || registeredModel.provider !== PROVIDER || registeredModel.id !== MODEL || registeredModel.type === "classifier") throw new Error("Pinned chat model is absent from this offline Pi SDK catalog; stop before creating a session.");
  const model = { ...registeredModel, maxTokens: settings.maxOutputTokens, samplingParams: { ...(registeredModel.samplingParams ?? {}) } };
  const settingsManager = deps.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, cacheWarming: "off", defaultThinkingLevel: "off" });
  const commonPrompt = `You are answering a source-navigation task. Use only supplied files and evidence; do not edit files. State uncertainty when source does not support a claim. Cite workspace-relative file paths and symbols.\n\nRepository map (identical in both treatments):\n${request.context.repositoryMap}`;
  const resourceLoader = new deps.DefaultResourceLoader({ cwd: workspace, agentDir: request.isolation.home, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: commonPrompt, appendSystemPrompt: [] });
  const observed = { toolCalls: [], inspectedPaths: new Set(), usage: { inputTokens: 0, outputTokens: 0 }, contextEstimateTokens: 0, contextAbort: false, toolLimitAbort: false };
  const recordPaths = ({ paths }) => { for (const p of paths ?? []) if (typeof p === "string" && !isAbsolute(p) && !p.split(/[\\/]/).includes("..")) observed.inspectedPaths.add(p); };
  const tools = [...makeOrdinaryTools(deps.Type, workspace, recordPaths), ...(graphAvailable ? graphTools(deps.Type, workspace, request.graph.graphPath, deps.graphApi, recordPaths) : [])];
  const allowlist = graphAvailable ? [...ORDINARY_NAMES, ...GRAPH_NAMES] : ORDINARY_NAMES;
  const { session } = await deps.createAgentSession({ cwd: workspace, agentDir: request.isolation.home, modelRuntime: runtime, model, thinkingLevel: settings.thinkingLevel, tools: allowlist, noTools: "all", customTools: tools, sessionManager: deps.SessionManager.inMemory(workspace), settingsManager, resourceLoader });
  if (!session?.agent || typeof session.prompt !== "function" || typeof session.subscribe !== "function") throw new Error("SDK returned an invalid AgentSession.");
  const active = session.getActiveToolNames().slice().sort();
  if (JSON.stringify(active) !== JSON.stringify([...allowlist].sort())) { session.dispose(); throw new Error("SDK active tools do not exactly match the approved allowlist."); }
  const toolLimit = graphAvailable ? settings.graphToolCalls : settings.ordinaryToolCalls;
  const elapsedStart = performance.now(); let ordinaryCalls = 0; let graphCalls = 0;
  const priorBeforeToolCall = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (ctx, signal) => {
    const name = ctx.toolCall.name; const isGraph = GRAPH_NAMES.includes(name);
    const count = isGraph ? graphCalls : ordinaryCalls; const limit = isGraph ? settings.graphToolCalls : settings.ordinaryToolCalls;
    if (count >= limit) {
      observed.toolLimitAbort = true; session.agent.abort();
      return { block: true, terminate: true, reason: `Evaluation ${isGraph ? "graph" : "ordinary"} tool-call limit reached; stopping this attempt.` };
    }
    if (isGraph) graphCalls++; else ordinaryCalls++;
    return priorBeforeToolCall?.(ctx, signal);
  };
  const priorPrepareRequest = session.agent.prepareRequest;
  session.agent.prepareRequest = async (requestInfo, signal) => {
    const remaining = settings.maxOutputTokens - observed.usage.outputTokens;
    if (remaining <= 0) { observed.outputLimitAbort = true; session.agent.abort(); return; }
    const estimated = approximateMessageTokens(deps.estimateTokens, requestInfo.context.messages);
    observed.contextEstimateTokens = estimated ?? 0;
    if (estimated === null || estimated > settings.contextEstimateTokens) { observed.contextAbort = true; session.agent.abort(); return; }
    const next = { ...requestInfo.model, maxTokens: Math.min(settings.maxOutputTokens, remaining) };
    await priorPrepareRequest?.(requestInfo, signal);
    return { model: next };
  };
  const priorTransformContext = session.agent.transformContext;
  session.agent.transformContext = async (messages, signal) => {
    const estimate = approximateMessageTokens(deps.estimateTokens, messages); observed.contextEstimateTokens = estimate ?? 0;
    if (estimate === null || estimate > settings.contextEstimateTokens) { observed.contextAbort = true; session.agent.abort(); }
    return priorTransformContext ? priorTransformContext(messages, signal) : messages;
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_end") {
      const usage = messageUsage(event.message);
      if (usage) { observed.usage.inputTokens += usage.input; observed.usage.outputTokens += usage.output; }
    }
    if (event.type === "tool_execution_start") {
      observed.toolCalls.push({ name: event.toolName, durationMs: null });
      const args = event.args; if (args?.path && typeof args.path === "string" && !isAbsolute(args.path) && !args.path.split(/[\\/]/).includes("..")) observed.inspectedPaths.add(args.path.replace(/\\/g, "/"));
    }
    if (event.type === "tool_execution_end") {
      const call = [...observed.toolCalls].reverse().find(x => x.name === event.toolName && x.durationMs === null);
      if (call && Number.isFinite(event.durationMs)) call.durationMs = event.durationMs;
    }
  });
  let promptError;
  try { await session.prompt(request.taskText, { expandPromptTemplates: false, source: "rpc" }); }
  catch (error) { promptError = error; }
  finally { unsubscribe(); }
  const sessionWallMs = performance.now() - elapsedStart;
  const answer = session.getLastAssistantText?.() ?? "";
  const stats = session.getSessionStats?.();
  const answerUsage = stats?.tokens;
  if (answerUsage && observed.usage.inputTokens === 0 && observed.usage.outputTokens === 0) {
    // Session totals are a Pi aggregate and may include non-provider work; only fall back if the event stream supplied no assistant usage at all.
    observed.usage.inputTokens = Number.isFinite(answerUsage.input) ? answerUsage.input : 0;
    observed.usage.outputTokens = Number.isFinite(answerUsage.output) ? answerUsage.output : 0;
  }
  session.dispose();
  if (promptError && !observed.contextAbort && !observed.toolLimitAbort) throw promptError;
  return {
    schemaVersion: 1, provider: PROVIDER, model: MODEL, adapterVersion: ADAPTER_VERSION, settings,
    answer: answer || (observed.contextAbort ? "Stopped before provider request: estimated prompt context exceeded the configured bound." : observed.toolLimitAbort ? "Stopped after reaching the configured tool-call limit." : observed.outputLimitAbort ? "Stopped before provider request: total output-token limit was exhausted." : ""),
    usage: {
      inputTokens: observed.usage.inputTokens, outputTokens: observed.usage.outputTokens,
      toolDeclarationTokens: null, toolPromptTokens: null,
      sessionWallMs, toolCalls: observed.toolCalls.map(x => ({ name: x.name, durationMs: Number.isFinite(x.durationMs) ? x.durationMs : 0 })),
      inspectedPaths: [...observed.inspectedPaths], retrievedTargets: [], wrongTargetDetours: null,
      measurement: "Pi-normalized assistant message usage; provider-origin/provenance is not independently attested. Tool declaration/prompt token splits and rubric target/detour classification are not separately measurable by this SDK adapter.",
      contextEstimateTokens: observed.contextEstimateTokens, contextBudgetTokens: settings.contextEstimateTokens, contextBudgetKind: "Pi estimate, not exact provider tokenization", contextBudgetAbort: observed.contextAbort,
      toolLimit: toolLimit, toolLimitReached: observed.toolLimitAbort, maxOutputTokens: settings.maxOutputTokens, outputLimitReached: observed.outputLimitAbort,
    },
  };
}

async function loadLiveDependencies() {
  const [sdk, typebox, graphApi] = await Promise.all([import("@earendil-works/pi-coding-agent"), import("typebox"), loadGraphApi()]);
  return { ...sdk, Type: typebox.Type, graphApi };
}
export async function main() {
  const requestText = await new Promise((resolveText, reject) => {
    let text = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => resolveText(text)); process.stdin.on("error", reject);
  });
  const request = JSON.parse(requestText);
  const deps = await loadLiveDependencies();
  const result = await executeAdapterRequest(request, deps);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { process.stderr.write(`MP2 Pi SDK adapter: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
