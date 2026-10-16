#!/usr/bin/env node
// @ts-nocheck -- standalone Node.js CLI; runtime adapter payloads are validated explicitly below.
/** MP2-07 harness. The only model-backed code path is --run, after approval validation. */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
export const DEFAULT_MANIFEST = join(PACKAGE_ROOT, "evaluation/task-manifest.json");
const TREATMENTS = ["graph_optional", "map_only"];
const ORDINARY_TOOLS = ["list_files", "search_text", "read_file", "read_diff"];
const GRAPH_TOOLS = ["mindplace_query", "mindplace_explain", "mindplace_build"];
const TARGET_PROVIDER = "github-copilot";
const TARGET_MODEL = "gpt-6-luna";
const APPROVED_SETTINGS = { contextEstimateTokens: 16000, maxOutputTokens: 2048, ordinaryToolCalls: 32, graphToolCalls: 16, timeLimitSeconds: 600, thinkingLevel: "off" };

export function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sortedFiles(path, relativeTo = path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const full = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Fixture symlinks are forbidden: ${full}`);
    return entry.isDirectory() ? sortedFiles(full, relativeTo) : [{ full, name: relative(relativeTo, full).split(sep).join("/") }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export function fixtureDigest(manifest, packageRoot = PACKAGE_ROOT) {
  const fixtureRows = [];
  for (const fixture of [...new Set(manifest.tasks.map(task => task.fixture))].sort()) {
    const dir = resolve(packageRoot, fixture);
    if (!dir.startsWith(resolve(packageRoot) + sep)) throw new Error(`Fixture escapes package root: ${fixture}`);
    const entries = sortedFiles(dir);
    if (!entries.length) fixtureRows.push({ fixture, files: [] });
    fixtureRows.push({ fixture, files: entries.map(({ full, name }) => ({ path: name, sha256: sha256(readFileSync(full)) })) });
  }
  return sha256(JSON.stringify(fixtureRows));
}
export function environmentFingerprint() {
  return { nodeVersion: process.version, platform: process.platform, arch: process.arch, osRelease: release(), cpuModel: cpus()[0]?.model ?? "unknown", logicalCpuCount: cpus().length, locale: process.env.LC_ALL ?? process.env.LANG ?? "unset", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
function harnessSha256() { return sha256(readFileSync(fileURLToPath(import.meta.url))); }
const SOURCE_ROOTS = ["src", "scripts/mp2-eval.mjs", "scripts/mp2-pi-sdk-adapter.mjs", "package.json", "package-lock.json", "assets/vis-network.min.js"];
export function evaluationSourceDigest(packageRoot = PACKAGE_ROOT) {
  const rows = [];
  for (const entry of SOURCE_ROOTS) {
    const full = resolve(packageRoot, entry);
    if (!full.startsWith(resolve(packageRoot) + sep)) throw new Error(`Evaluation source path escapes package root: ${entry}`);
    if (!existsSync(full)) throw new Error(`Pinned evaluation source is missing: ${entry}`);
    const isDirectory = statSync(full).isDirectory();
    const files = isDirectory ? sortedFiles(full, full) : [{ full, name: entry }];
    for (const file of files) rows.push({ path: (isDirectory ? `${entry}/${file.name}` : entry).replaceAll("\\", "/"), sha256: sha256(readFileSync(file.full)) });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return sha256(JSON.stringify(rows));
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function validateManifest(manifest) {
  assert(manifest?.schemaVersion === 1 && Array.isArray(manifest.tasks) && manifest.tasks.length > 0, "Unsupported or empty task manifest.");
  assert(Number.isSafeInteger(manifest.seed) && manifest.seed >= 0, "Manifest seed must be a nonnegative integer.");
  assert(Number.isSafeInteger(manifest.repetitions) && manifest.repetitions >= 2, "Manifest repetitions must be at least two.");
  const ids = new Set();
  for (const task of manifest.tasks) {
    assert(typeof task.id === "string" && !ids.has(task.id), `Task IDs must be unique: ${task.id}`); ids.add(task.id);
    assert(typeof task.fixture === "string" && typeof task.prompt === "string" && task.prompt.length > 0, `Task ${task.id} is incomplete.`);
    assert(Array.isArray(task.expectedTargets) && Number.isFinite(task.maxScore) && task.maxScore > 0 && task.rubric && Array.isArray(task.rubric.requiredClaims), `Task ${task.id} needs independent targets, numeric maxScore, and a rubric.`);
  }
}
function mulberry32(seed) {
  return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function validateAdapterMetrics(output, approval, treatment) {
  assert(output && output.schemaVersion === 1, "Adapter response must use schemaVersion 1.");
  assert(output.provider === approval.provider && output.model === approval.model && output.provider === TARGET_PROVIDER && output.model === TARGET_MODEL, "Adapter-reported provider/model differs from the approved Luna identity.");
  assert(output.adapterVersion === approval.adapterVersion && output.settings !== undefined && canonicalJson(output.settings) === canonicalJson(approval.settings), "Adapter must echo the approved adapterVersion and settings; reported settings differ from the approval.");
  assert(typeof output.answer === "string", "Adapter response must include the answer text for blinded scoring.");
  const usage = output.usage;
  assert(usage && ["inputTokens", "outputTokens", "sessionWallMs"].every(key => Number.isFinite(usage[key]) && usage[key] >= 0) && ["toolDeclarationTokens", "toolPromptTokens"].every(key => usage[key] === null || (Number.isFinite(usage[key]) && usage[key] >= 0)), "Adapter must report nonnegative Pi-normalized input/output and session time; unmeasurable token splits must be null.");
  assert(usage.inputTokens >= 0 && usage.outputTokens <= approval.settings.maxOutputTokens && usage.maxOutputTokens === approval.settings.maxOutputTokens, "Adapter output usage exceeds the approved output cap.");
  assert(Array.isArray(usage.toolCalls) && Array.isArray(usage.inspectedPaths) && Array.isArray(usage.retrievedTargets), "Adapter must report tool calls, inspected paths, and retrieved targets.");
  assert(usage.wrongTargetDetours === null || (Number.isSafeInteger(usage.wrongTargetDetours) && usage.wrongTargetDetours >= 0), "wrongTargetDetours must be null unless independently measurable.");
  const permitted = new Set([...ORDINARY_TOOLS, ...(treatment === "graph_optional" ? GRAPH_TOOLS : [])]);
  for (const call of usage.toolCalls) assert(typeof call.name === "string" && permitted.has(call.name) && (call.durationMs === null || (Number.isFinite(call.durationMs) && call.durationMs >= 0)), `Malformed or unavailable tool call event: ${call.name}`);
  for (const path of usage.inspectedPaths) assert(typeof path === "string" && !isAbsolute(path) && !path.split(/[\\/]/).includes(".."), `Inspected path must remain workspace-relative: ${path}`);
  return usage;
}
function classifyCalls(calls) {
  const graphNames = new Set(GRAPH_TOOLS);
  return { ordinary: calls.filter(call => !graphNames.has(call.name)).length, graph: calls.filter(call => graphNames.has(call.name)).length, total: calls.length };
}
function taskWorkOrder(manifest) {
  const order = [];
  for (let repetition = 1; repetition <= manifest.repetitions; repetition++) for (const task of manifest.tasks) order.push({ task, repetition, graphProvisioning: repetition === 1 ? "cold" : "reusable" });
  return shuffle(order, mulberry32(manifest.seed));
}
// Random per-row blind IDs: a deterministic hash of public run/task/repetition/treatment was reversible by any scorer.
function makeBlindId() { return randomBytes(12).toString("hex"); }

async function buildGraph(root, outputDirectory = join(root, "graph-out")) {
  const [{ extract }, { detect }, { KnowledgeGraph }, { makeGraphMetadata }, { mkdirSync: fsMkdirSync }] = await Promise.all([
    import("../src/extract.ts"), import("../src/detect.ts"), import("../src/graph.ts"), import("../src/graph-file.ts"), import("node:fs"),
  ]);
  const detected = detect(root);
  const extracted = extract(root, detected.files, undefined, true);
  const graph = KnowledgeGraph.fromExtraction(extracted);
  const metadata = makeGraphMetadata(root, detected);
  if (!metadata.scanComplete) throw new Error(`Graph build inventory incomplete for ${root}`);
  const output = outputDirectory; fsMkdirSync(output, { recursive: true });
  writeFileSync(join(output, "graph.json"), JSON.stringify({ ...graph.toJSON(), mindplace: metadata }, null, 2));
}
function rebaseGraphMetadata(path, workspace) {
  const graph = JSON.parse(readFileSync(path, "utf8"));
  graph.mindplace.root = workspace;
  writeFileSync(path, JSON.stringify(graph, null, 2));
}
function copyFixture(task, workspace, packageRoot) {
  const source = resolve(packageRoot, task.fixture);
  assert(source.startsWith(resolve(packageRoot) + sep), `Fixture path escapes package root: ${task.fixture}`);
  cpSync(source, workspace, { recursive: true, errorOnExist: false, force: true });
}
function makeAdapterRequest({ runId, task, repetition, treatment, workspace, isolation, approval, provisioning, graphBuild, timeoutSeconds, graphPath }) {
  const graphAvailable = treatment === "graph_optional";
  return {
    protocol: "pi-mindplace-mp2-adapter-v1", runId, taskId: task.id, repetition, taskText: task.prompt,
    workspace, timeLimitSeconds: timeoutSeconds, provider: approval.provider, model: approval.model,
    settings: approval.settings, context: { repositoryMap: readFileSync(join(workspace, "README.md"), "utf8") },
    isolation,
    tools: { ordinary: ORDINARY_TOOLS, graph: graphAvailable ? GRAPH_TOOLS : [], graphUseRequired: false },
    graph: { available: graphAvailable, provisioning, graphPath: graphAvailable ? graphPath : null, buildWallMs: graphBuild.buildWallMs, chargedBuildMs: graphBuild.chargedBuildMs, reusableAcrossSessions: provisioning === "reusable" },
    reporting: { requirePiNormalizedUsage: true, requireToolEvents: true, requireInspectedPaths: true, targetAndDetourClassification: "harness/scorer only; never disclosed to adapter" },
  };
}
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

/** Preflight verifies the complete approval tuple. It never creates/spawns the adapter. */
export function verifyApproval({ manifestBytes, manifest, packageRoot = PACKAGE_ROOT, approval, adapterCommand, adapterArgs }) {
  validateManifest(manifest);
  assert(manifest.timeLimitSeconds === APPROVED_SETTINGS.timeLimitSeconds, "Manifest time limit differs from the frozen approval setting.");
  assert(approval && approval.schemaVersion === 1 && approval.approved === true && typeof approval.approvedBy === "string" && approval.approvedBy.trim(), "Missing explicit approval artifact (schemaVersion 1, approved, approvedBy required). No adapter launch is authorized.");
  assert(approval.manifestSha256 === sha256(manifestBytes), "Approval manifest hash mismatch. No adapter launch is authorized.");
  assert(approval.harnessSha256 === harnessSha256(), "Approval harness hash mismatch. No adapter launch is authorized.");
  const fixtures = fixtureDigest(manifest, packageRoot);
  assert(approval.fixtureDigest === fixtures, "Approval fixture digest mismatch. No adapter launch is authorized.");
  assert(approval.repetitions === manifest.repetitions, "Approved repetitions differ from the manifest.");
  const actualEnvironment = environmentFingerprint();
  assert(approval.environment && Object.keys(actualEnvironment).every(key => approval.environment[key] === actualEnvironment[key]) && Object.keys(approval.environment).length === Object.keys(actualEnvironment).length, "Approved environment differs from this runtime.");
  const expectedRubricHash = sha256(JSON.stringify(manifest.tasks.map(task => ({ id: task.id, expectedTargets: task.expectedTargets, maxScore: task.maxScore, rubric: task.rubric }))));
  assert(approval.rubricSha256 === expectedRubricHash, "Approval rubric hash mismatch.");
  assert(approval.provider === TARGET_PROVIDER && approval.model === TARGET_MODEL && canonicalJson(approval.settings) === canonicalJson(APPROVED_SETTINGS) && typeof approval.adapterId === "string" && approval.adapterId === "pi-mindplace-mp2-pi-sdk-luna" && approval.adapterVersion === "mp2-pi-sdk-luna-1.0.0" && approval.piSdkVersion === "1.2.0", "Approval must pin github-copilot/gpt-6-luna, the adapter version, Pi SDK 1.2.0, and only supported frozen settings.");
  assert(approval.sourceTreeSha256 === evaluationSourceDigest(packageRoot), "Evaluation source-tree digest mismatch. No adapter launch is authorized.");
  assert(approval.adapterCommand === adapterCommand && JSON.stringify(approval.adapterArgs) === JSON.stringify(adapterArgs), "Adapter command differs from the explicitly approved command.");
  assert(typeof approval.adapterEntry === "string" && adapterArgs.includes(approval.adapterEntry) && /^[0-9a-f]{64}$/.test(approval.adapterEntrySha256 ?? ""), "Approval must pin the adapter entry file (one of the frozen adapter arguments) and its SHA-256.");
  let entryBytes; try { entryBytes = readFileSync(resolve(approval.adapterEntry)); } catch { throw new Error("Approved adapter entry file is unreadable. No adapter launch is authorized."); }
  assert(sha256(entryBytes) === approval.adapterEntrySha256, "Adapter entry file hash mismatch. No adapter launch is authorized.");
  assert(typeof approval.approvedAt === "string" && !Number.isNaN(Date.parse(approval.approvedAt)), "Approval must record approvedAt.");
  return { fixtureDigest: fixtures, rubricSha256: expectedRubricHash, environment: environmentFingerprint() };
}

function aggregatePairs(rows) {
  const index = new Map();
  for (const row of rows) { const k = `${row.taskId}\0${row.repetition}`; const pair = index.get(k) ?? {}; pair[row.treatment] = row; index.set(k, pair); }
  return [...index.entries()].map(([key, pair]) => {
    const [taskId, repetition] = key.split("\0");
    return { taskId, repetition: Number(repetition), order: pair.graph_optional?.randomizedOrder ?? pair.map_only?.randomizedOrder ?? [], graph_optional: pair.graph_optional?.metrics ?? null, map_only: pair.map_only?.metrics ?? null, pairedDifferences: null };
  });
}
function packageRunResult({ manifest, manifestHash, fixtureHash, approval, runId, rows, synthetic }) {
  return {
    schemaVersion: 1, runId, createdAt: new Date().toISOString(), manifestId: manifest.manifestId,
    manifestSha256: manifestHash, fixtureDigest: fixtureHash, harnessSha256: harnessSha256(), sourceTreeSha256: evaluationSourceDigest(), seed: manifest.seed, repetitions: manifest.repetitions,
    provider: approval.provider, model: approval.model, settings: approval.settings, environment: environmentFingerprint(),
    harnessSimulation: synthetic, empirical: !synthetic, decisionEligible: false,
    executionStatus: synthetic ? "HARNESS_SIMULATION_NOT_EMPIRICAL" : "UNSCORED_AWAITING_BLIND_REVIEW",
    usageAccounting: { inputOutputTokens: "Pi-normalized assistant-message usage; provider-returned provenance is not independently attested and missing tool-declaration/prompt splits are null", toolDeclarationAndPromptTokens: "not separately measurable with the documented SDK session API; null, not zero", toolCalls: "Pi tool execution events; durations from SDK events when present, otherwise null", contextBudget: "hard 16000 Pi estimator-token pre-request guard; approximate tokenizer estimate, not exact provider tokenization or billing", outputBudget: "2048 total returned-output-token guard and per-request maxTokens cap via exact Luna model metadata; provider enforcement is not separately attested", toolLimits: "SDK beforeToolCall gate: at most 32 ordinary and 16 graph calls per invocation; the next call is blocked and aborts", wrongTargetDetours: "not independently derivable without leaking rubric targets to the adapter; null", wallTime: "parent-measured adapter-process elapsed milliseconds; hard-killed at 600 seconds", graphBuild: "cold build is charged; reusable build time amortized across the predeclared graph sessions using that fixture; raw build time retained" },
    sourceTreeSha256: evaluationSourceDigest(),
    results: rows, pairedResults: aggregatePairs(rows), scoredAnalysis: null,
  };
}
export function normalizeBlindAnswer(answer) {
  return answer
    .replace(/\b(?:map[-_ ]only|map[-_ ]arm|graph[-_ ]optional|graph_optional)\b/gi, "[treatment label]")
    .replace(/\bmind\s*place\b/gi, "[optional navigation aid]")
    .replace(/\bmindplace_(?:query|explain|build)\b/gi, "[optional navigation tool]")
    .replace(/\bknowledge\s+graph\b|\bcode\s+graph\b|\bgraph[- ](?:only|arm|optional|tool|based)\b|\bgraph\b/gi, "[optional navigation]");
}
function blindArtifacts(runId, manifest, rows, synthetic) {
  const scoreRows = rows.map(row => ({ blindId: row.blindId, taskId: row.taskId, repetition: row.repetition, answer: normalizeBlindAnswer(row.answer), failures: row.failures.length ? ["attempt_failed"] : [], score: null, maxScore: manifest.tasks.find(task => task.id === row.taskId).maxScore, evidence: "", scorerId: "" }));
  const key = { schemaVersion: 1, runId, harnessSimulation: synthetic, note: "Keep sealed from blinded scorers until score sheet is final.", mapping: Object.fromEntries(rows.map(row => [row.blindId, { treatment: row.treatment, taskId: row.taskId, repetition: row.repetition, expectedTargets: manifest.tasks.find(task => task.id === row.taskId).expectedTargets, maxScore: manifest.tasks.find(task => task.id === row.taskId).maxScore, rubric: manifest.tasks.find(task => task.id === row.taskId).rubric }])) };
  const scoringInstructions = "Score factual correctness and source evidence strictly against the predeclared task rubric. Score each task independently on its own declared scale; analysis maps each score linearly to 0–5 using that task's maximum, identically for both hidden treatments. Do not guess or infer treatment from writing style, quality, tool mentions, or paired answers. Explicit arm/tool language was normalized in the answer; correctness claims, source paths, and quotes were preserved. Do not score navigation coverage itself as answer quality. Keep the sealed treatment key away from scorers until all scores and evidence are final. Preserve this normalized sheet and the raw results separately; never score the raw treatment-tagged result file.";
  return { scoreSheet: { schemaVersion: 1, runId, harnessSimulation: synthetic, scoringStatus: "BLIND_SCORING_REQUIRED", scoringInstructions, entries: scoreRows }, scoringKey: key };
}
function bootstrapMeanCI(values, seed, iterations = 10000) {
  if (!values.length) return { lower95: null, upper95: null, method: "percentile paired bootstrap", iterations: 0 };
  const random = mulberry32(seed); const means = new Array(iterations);
  for (let i = 0; i < iterations; i++) { let total = 0; for (let j = 0; j < values.length; j++) total += values[Math.floor(random() * values.length)]; means[i] = total / values.length; }
  means.sort((a, b) => a - b);
  return { lower95: means[Math.floor(iterations * 0.025)], upper95: means[Math.min(iterations - 1, Math.ceil(iterations * 0.975) - 1)], method: "percentile paired bootstrap", iterations };
}
export function analyzeScoredResults(results, scoreSheet, scoringKey) {
  assert(results.schemaVersion === 1 && results.empirical === true && results.harnessSimulation === false, "Simulation or malformed results are never eligible for empirical analysis.");
  assert(scoreSheet.runId === results.runId && scoringKey.runId === results.runId && scoreSheet.harnessSimulation === false && scoreSheet.scoringStatus === "BLIND_SCORING_COMPLETE", "Analysis requires a completed, matching blind score sheet and key.");
  const scores = new Map();
  for (const entry of scoreSheet.entries) {
    const key = scoringKey.mapping[entry.blindId];
    assert(key && Number.isFinite(entry.score) && entry.score >= 0 && entry.score <= key.maxScore && entry.maxScore === key.maxScore && entry.scorerId, `Invalid independent score for ${entry.blindId}.`);
    scores.set(entry.blindId, { score: entry.score, maxScore: key.maxScore });
  }
  assert(scores.size === results.results.length, "Every result must have exactly one independent score.");
  const grouped = new Map();
  for (const row of results.results) { const list = grouped.get(row.taskId) ?? []; list.push(row); grouped.set(row.taskId, list); }
  const metricNames = ["score", "normalizedScore0to5", "inputTokens", "outputTokens", "sessionWallMs", "ordinaryToolCalls", "graphToolCalls", "effectiveWallMsIncludingGraphCharge"];
  const rowMetric = (row, metric) => metric === "score" ? scores.get(row.blindId).score
    : metric === "normalizedScore0to5" ? scores.get(row.blindId).score * 5 / scores.get(row.blindId).maxScore
    : metric === "ordinaryToolCalls" ? row.metrics.toolCallCounts.ordinary
    : metric === "graphToolCalls" ? row.metrics.toolCallCounts.graph
    : metric === "effectiveWallMsIncludingGraphCharge" ? row.metrics.effectiveWallMsIncludingGraphCharge
    : metric === "wrongTargetDetours" ? row.metrics.wrongTargetDetours : row.metrics.usage[metric];
  const pairedByTask = [];
  for (const [taskId, taskRows] of grouped) {
    const reps = new Map(); for (const row of taskRows) { const pair = reps.get(row.repetition) ?? {}; assert(!pair[row.treatment], `Duplicate ${row.treatment} row for ${taskId} repetition ${row.repetition}.`); pair[row.treatment] = row; reps.set(row.repetition, pair); }
    assert(reps.size === results.repetitions, `Task ${taskId} must have exactly ${results.repetitions} paired repetitions.`);
    const deltasByMetric = Object.fromEntries(metricNames.map(metric => [metric, []]));
    for (const [repetition, pair] of reps) {
      assert(pair.graph_optional && pair.map_only, `Missing matched treatment for ${taskId} repetition ${repetition}.`);
      for (const metric of metricNames) deltasByMetric[metric].push(rowMetric(pair.graph_optional, metric) - rowMetric(pair.map_only, metric));
    }
    const metrics = Object.fromEntries(metricNames.map((metric, i) => {
      const differences = deltasByMetric[metric]; const average = differences.reduce((a, b) => a + b, 0) / differences.length;
      return [metric, { pairedDifferences: differences, meanDifferenceGraphMinusMap: average, medianDifference: [...differences].sort((a, b) => a - b)[Math.floor(differences.length / 2)], uncertainty95: bootstrapMeanCI(differences, results.seed + i + taskId.length) }];
    }));
    pairedByTask.push({ taskId, pairs: reps.size, metrics });
  }
  const overall = Object.fromEntries(metricNames.map((metric, i) => {
    const taskGroups = pairedByTask.map(item => item.metrics[metric].pairedDifferences);
    const clusterDraws = []; const random = mulberry32(results.seed + 1000 + i);
    for (let n = 0; n < 10000; n++) {
      let sum = 0, count = 0;
      for (let j = 0; j < taskGroups.length; j++) { const chosen = taskGroups[Math.floor(random() * taskGroups.length)]; for (const value of chosen) { sum += value; count++; } }
      clusterDraws.push(sum / count);
    }
    clusterDraws.sort((a, b) => a - b); const all = taskGroups.flat();
    return [metric, { pairs: all.length, meanDifferenceGraphMinusMap: all.reduce((a, b) => a + b, 0) / all.length, uncertainty95: { lower95: clusterDraws[Math.floor(clusterDraws.length * 0.025)], upper95: clusterDraws[Math.ceil(clusterDraws.length * 0.975) - 1], method: "task-cluster paired bootstrap percentile", iterations: 10000, clusters: taskGroups.length } }];
  }));
  return { schemaVersion: 1, runId: results.runId, empirical: true, harnessSimulation: false, decisionEligible: false, contrast: "graph_optional minus map_only; negative cost deltas favor graph, positive score deltas favor graph", pairing: "same task/repetition; treatment order seeded and randomized", uncertainty: "task-level bootstrap over paired repetitions; overall bootstrap resamples tasks as clusters", metrics: metricNames, taskLevel: pairedByTask, overall };
}

function validateResultArtifact(result, scoreSheet, scoringKey) {
  assert(result.schemaVersion === 1 && Array.isArray(result.results) && result.results.length > 0, "Malformed result artifact.");
  assert(result.harnessSimulation === scoreSheet.harnessSimulation && result.runId === scoreSheet.runId && result.runId === scoringKey.runId, "Result/blind artifact identity mismatch.");
  assert(result.results.length === scoreSheet.entries.length && result.results.length === Object.keys(scoringKey.mapping).length, "Result/blind artifact counts differ.");
  assert(result.results.every(row => TREATMENTS.includes(row.treatment) && typeof row.workspaceId === "string" && row.metrics), "Result rows must include both treatment IDs, isolated workspace IDs, and metrics.");
  assert(scoreSheet.entries.every(entry => entry.score === null && Number.isFinite(entry.maxScore) && entry.maxScore > 0), "New blind score sheet must have declared maxima but no assigned scores.");
  return true;
}

async function runCore({ manifestPath = DEFAULT_MANIFEST, outputDirectory, packageRoot = PACKAGE_ROOT, synthetic = false, adapterCommand, adapterArgs = [], approval }) {
  const manifestBytes = readFileSync(manifestPath); const manifest = JSON.parse(manifestBytes.toString("utf8")); validateManifest(manifest);
  const manifestHash = sha256(manifestBytes); const fixtureHash = fixtureDigest(manifest, packageRoot);
  if (!synthetic) verifyApproval({ manifestBytes, manifest, packageRoot, approval, adapterCommand, adapterArgs });
  const tempRoot = mkdtempSync(join(tmpdir(), synthetic ? "mp2-smoke-" : "mp2-run-"));
  const runId = `${synthetic ? "simulation" : "run"}-${manifestHash.slice(0, 12)}-${fixtureHash.slice(0, 8)}`;
  const rows = []; const random = mulberry32(manifest.seed); const work = taskWorkOrder(manifest); const fixtureCounts = new Map();
  for (const task of manifest.tasks) fixtureCounts.set(task.fixture, (fixtureCounts.get(task.fixture) ?? 0) + 1);
  const reusableStages = new Map();
  try {
    for (const fixture of fixtureCounts.keys()) {
      const stage = join(tempRoot, "reusable-stage", sha256(fixture).slice(0, 10)); mkdirSync(stage, { recursive: true });
      const task = manifest.tasks.find(item => item.fixture === fixture); copyFixture(task, stage, packageRoot);
      const start = performance.now(); await buildGraph(stage); const buildWallMs = performance.now() - start;
      reusableStages.set(fixture, { path: stage, buildWallMs, reuseCount: fixtureCounts.get(fixture) * (manifest.repetitions - 1) });
    }
    for (const item of work) {
      const order = shuffle(TREATMENTS, random);
      for (const treatment of order) {
        const sessionId = `${item.task.id}-r${item.repetition}-${treatment}`; const workspace = join(tempRoot, "sessions", sessionId); const graphDir = join(tempRoot, "graphs", sessionId); mkdirSync(dirname(workspace), { recursive: true }); copyFixture(item.task, workspace, packageRoot);
        let graphBuild = { buildWallMs: 0, chargedBuildMs: 0 };
        if (treatment === "graph_optional") {
          if (item.graphProvisioning === "cold") {
            const started = performance.now(); await buildGraph(workspace, graphDir); graphBuild.buildWallMs = performance.now() - started; graphBuild.chargedBuildMs = graphBuild.buildWallMs;
          } else {
            const stage = reusableStages.get(item.task.fixture); mkdirSync(join(tempRoot, "graphs"), { recursive: true }); cpSync(join(stage.path, "graph-out"), graphDir, { recursive: true }); rebaseGraphMetadata(join(graphDir, "graph.json"), workspace);
            graphBuild.buildWallMs = stage.buildWallMs; graphBuild.chargedBuildMs = stage.buildWallMs / stage.reuseCount;
          }
        }
        const blindId = makeBlindId();
        // Home/session/temp dirs and graph artifacts live OUTSIDE the fixture workspace so ordinary search/list tools cannot see them.
        const isolationRoot = join(tempRoot, "isolation", sessionId);
        const isolated = { home: join(isolationRoot, "agent-home"), session: join(isolationRoot, "session-data"), temp: join(isolationRoot, "agent-temp") };
        for (const directory of Object.values(isolated)) mkdirSync(directory, { recursive: true });
        const request = makeAdapterRequest({ runId, task: item.task, repetition: item.repetition, treatment, workspace, isolation: isolated, approval: approval ?? { provider: "HARNESS_SIMULATION", model: "NONE", settings: {} }, provisioning: item.graphProvisioning, graphBuild, timeoutSeconds: manifest.timeLimitSeconds, graphPath: join(graphDir, "graph.json") });
        let answer, usage, provider, model, failure = null, measuredWallMs;
        if (synthetic) {
          const began = performance.now();
          // Deliberately canned adapter: no model/provider/agent call is possible in this branch.
          await Promise.resolve(); measuredWallMs = performance.now() - began;
          provider = "HARNESS_SIMULATION"; model = "NONE"; answer = "HARNESS SIMULATION ONLY — no agent answer or usefulness outcome was produced.";
          const events = treatment === "graph_optional" ? [{ name: "search_text", durationMs: 1 }, ...(item.task.expectedTargets.length ? [{ name: "mindplace_query", durationMs: 1 }] : [])] : [{ name: "search_text", durationMs: 1 }, { name: "read_file", durationMs: 1 }];
          usage = { inputTokens: 0, outputTokens: 0, toolDeclarationTokens: 0, toolPromptTokens: 0, sessionWallMs: measuredWallMs, toolCalls: events, inspectedPaths: [], retrievedTargets: [], wrongTargetDetours: 0 };
        } else {
          const started = performance.now();
          const childEnv = { PATH: process.env.PATH ?? "", HOME: isolated.home, USERPROFILE: isolated.home, TMPDIR: isolated.temp, TEMP: isolated.temp, TMP: isolated.temp, PI_CODING_AGENT_DIR: isolated.home, PI_CODING_AGENT_SESSION_DIR: isolated.session, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_MINDPLACE_EVAL_REQUEST_PROTOCOL: "pi-mindplace-mp2-adapter-v1" };
          for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT"]) if (process.env[key]) childEnv[key] = process.env[key];
          // Explicit documented Copilot credential pass-through only. Pi reads it via its provider auth interface; it is never logged or serialized.
          if (process.env.COPILOT_GITHUB_TOKEN) childEnv.COPILOT_GITHUB_TOKEN = process.env.COPILOT_GITHUB_TOKEN;
          const child = spawnSync(adapterCommand, adapterArgs, { input: JSON.stringify(request), cwd: workspace, encoding: "utf8", timeout: manifest.timeLimitSeconds * 1000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, env: childEnv });
          measuredWallMs = performance.now() - started;
          if (child.error) failure = String(child.error);
          else if (child.status !== 0) failure = `adapter exited ${child.status}: ${child.stderr?.slice(0, 4000) ?? ""}`;
          if (!failure) {
            try { const output = JSON.parse(child.stdout); usage = validateAdapterMetrics(output, approval, treatment); answer = output.answer; provider = output.provider; model = output.model; }
            catch (error) { failure = `invalid adapter response: ${error instanceof Error ? error.message : String(error)}`; }
          }
          if (failure) { answer = "ADAPTER FAILURE — no score should be inferred."; provider = approval.provider; model = approval.model; usage = { inputTokens: 0, outputTokens: 0, toolDeclarationTokens: null, toolPromptTokens: null, sessionWallMs: measuredWallMs, toolCalls: [], inspectedPaths: [], retrievedTargets: [], wrongTargetDetours: null, measurement: "adapter failure; usage unavailable" }; }
        }
        const callCounts = classifyCalls(usage.toolCalls);
        rows.push({ blindId, taskId: item.task.id, repetition: item.repetition, treatment, randomizedOrder: order, workspaceId: sha256(`${runId}/${item.task.id}/${item.repetition}/${treatment}`).slice(0, 12), graphProvisioning: item.graphProvisioning, provider, model, answer, failures: failure ? [failure] : [], metrics: { usage, toolCallCounts: callCounts, inspectedPaths: usage.inspectedPaths, retrievedTargets: usage.retrievedTargets, wrongTargetDetours: usage.wrongTargetDetours, measuredAdapterWallMs: measuredWallMs, graphBuildWallMs: graphBuild.buildWallMs, chargedGraphBuildMs: graphBuild.chargedBuildMs, effectiveWallMsIncludingGraphCharge: measuredWallMs + graphBuild.chargedBuildMs } });
      }
    }
    const result = packageRunResult({ manifest, manifestHash, fixtureHash, approval: approval ?? { provider: "HARNESS_SIMULATION", model: "NONE", settings: {} }, runId, rows, synthetic });
    const blind = blindArtifacts(runId, manifest, rows, synthetic);
    validateResultArtifact(result, blind.scoreSheet, blind.scoringKey);
    writeJson(join(outputDirectory, "results.json"), result);
    writeJson(join(outputDirectory, "blind-score-sheet.json"), blind.scoreSheet);
    writeJson(join(outputDirectory, "scoring-key.sealed.json"), blind.scoringKey);
    writeJson(join(outputDirectory, "run-provenance.json"), { schemaVersion: 1, runId, harnessSimulation: synthetic, empirical: !synthetic, decisionEligible: false, manifestSha256: manifestHash, fixtureDigest: fixtureHash, harnessSha256: harnessSha256(), sourceTreeSha256: evaluationSourceDigest(), approval: synthetic ? null : { approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, provider: approval.provider, model: approval.model, settings: approval.settings, repetitions: approval.repetitions, environment: approval.environment, rubricSha256: approval.rubricSha256, adapterId: approval.adapterId, adapterVersion: approval.adapterVersion, piSdkVersion: approval.piSdkVersion, sourceTreeSha256: approval.sourceTreeSha256, adapterEntry: approval.adapterEntry, adapterEntrySha256: approval.adapterEntrySha256 } });
    return result;
  } finally { rmSync(tempRoot, { recursive: true, force: true }); }
}

export async function runScoredAnalysis({ resultsPath, scoreSheetPath, scoringKeyPath, outputPath }) {
  if (!resultsPath || !scoreSheetPath || !scoringKeyPath || !outputPath) throw new Error("Analysis requires --results, --scores, --key, and --out.");
  const analysis = analyzeScoredResults(JSON.parse(readFileSync(resultsPath, "utf8")), JSON.parse(readFileSync(scoreSheetPath, "utf8")), JSON.parse(readFileSync(scoringKeyPath, "utf8")));
  writeJson(outputPath, analysis); return analysis;
}
export async function runOfflineSmoke({ manifestPath = DEFAULT_MANIFEST, outputDirectory = join(PACKAGE_ROOT, "evaluation/artifacts/offline-smoke"), packageRoot = PACKAGE_ROOT } = {}) {
  return runCore({ manifestPath, outputDirectory, packageRoot, synthetic: true });
}
export async function runApprovedEvaluation({ manifestPath = DEFAULT_MANIFEST, outputDirectory, packageRoot = PACKAGE_ROOT, approvalPath, adapterCommand, adapterArgs = [] }) {
  if (!outputDirectory) throw new Error("--out is required for approved runs.");
  if (!approvalPath) throw new Error("--approval is required; no adapter launch is authorized.");
  const manifestBytes = readFileSync(manifestPath); const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
  verifyApproval({ manifestBytes, manifest, packageRoot, approval, adapterCommand, adapterArgs });
  return runCore({ manifestPath, outputDirectory, packageRoot, synthetic: false, adapterCommand, adapterArgs, approval });
}
export function approvalInputs(manifestPath = DEFAULT_MANIFEST, packageRoot = PACKAGE_ROOT) {
  const bytes = readFileSync(manifestPath); const manifest = JSON.parse(bytes.toString("utf8")); validateManifest(manifest);
  return { manifestSha256: sha256(bytes), fixtureDigest: fixtureDigest(manifest, packageRoot), harnessSha256: harnessSha256(), sourceTreeSha256: evaluationSourceDigest(packageRoot), rubricSha256: sha256(JSON.stringify(manifest.tasks.map(task => ({ id: task.id, expectedTargets: task.expectedTargets, maxScore: task.maxScore, rubric: task.rubric })))), repetitions: manifest.repetitions, environment: environmentFingerprint(), provider: TARGET_PROVIDER, model: TARGET_MODEL, settings: APPROVED_SETTINGS, adapterId: "pi-mindplace-mp2-pi-sdk-luna", adapterVersion: "mp2-pi-sdk-luna-1.0.0", piSdkVersion: "1.2.0", seed: manifest.seed, taskCount: manifest.tasks.length, runCount: manifest.tasks.length * manifest.repetitions * 2 };
}

function parseArgs(argv) {
  const result = { flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    if (["--smoke", "--proposal", "--run", "--analyze"].includes(key)) result.flags.add(key);
    else { if (i + 1 >= argv.length) throw new Error(`Missing value for ${key}`); if (result.values.has(key)) result.values.get(key).push(argv[++i]); else result.values.set(key, [argv[++i]]); }
  }
  return result;
}
async function main(argv) {
  const args = parseArgs(argv); const get = (key, fallback) => args.values.get(key)?.at(-1) ?? fallback;
  const manifest = get("--manifest", DEFAULT_MANIFEST); const output = get("--out", undefined);
  if (args.flags.has("--proposal")) { console.log(JSON.stringify(approvalInputs(manifest), null, 2)); return; }
  if (args.flags.has("--analyze")) { const result = await runScoredAnalysis({ resultsPath: get("--results", undefined), scoreSheetPath: get("--scores", undefined), scoringKeyPath: get("--key", undefined), outputPath: output }); console.log(JSON.stringify({ runId: result.runId, empirical: result.empirical, taskCount: result.taskLevel.length, output }, null, 2)); return; }
  if (args.flags.has("--smoke")) { const result = await runOfflineSmoke({ manifestPath: manifest, outputDirectory: output ?? join(PACKAGE_ROOT, "evaluation/artifacts/offline-smoke") }); console.log(JSON.stringify({ status: result.executionStatus, runId: result.runId, resultRows: result.results.length, artifacts: output ?? join(PACKAGE_ROOT, "evaluation/artifacts/offline-smoke"), empirical: false, decisionEligible: false }, null, 2)); return; }
  const command = get("--adapter", undefined); const approvalPath = get("--approval", undefined);
  if (!args.flags.has("--run")) throw new Error("Specify --run for an approved model-backed evaluation; no launch was attempted.");
  const adapterArgs = args.values.get("--adapter-arg") ?? [];
  if (!command || !approvalPath || !output) throw new Error("Usage: --run --approval FILE --adapter COMMAND [--adapter-arg ARG ...] --out DIR. No model process is started without a valid explicit approval.");
  const result = await runApprovedEvaluation({ manifestPath: manifest, outputDirectory: output, approvalPath, adapterCommand: command, adapterArgs });
  console.log(JSON.stringify({ status: result.executionStatus, runId: result.runId, resultRows: result.results.length, artifacts: output }, null, 2));
}
const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main(process.argv.slice(2)).catch(error => { console.error(`MP2-07: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; });
