import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync, unlinkSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect } from "../src/detect.ts";
import { inspectGraph, makeGraphMetadata, getFreshnessCounters, resetFreshnessCounters } from "../src/graph-file.ts";
import { KnowledgeGraph } from "../src/graph.ts";
import { query, formatQueryResult, estimateQueryTokens } from "../src/query.ts";
import type { GraphNode } from "../src/types.ts";

const roots: string[] = [];
function project(): string { const root = mkdtempSync(join(tmpdir(), "mindplace-quality-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("freshness and deterministic retrieval fixtures", () => {
 it("detects a changed source file beyond the former 200-file prefix", () => {
  const root = project();
  for (let i = 0; i < 206; i++) writeFileSync(join(root, `file-${String(i).padStart(3, "0")}.ts`), `export const item${i} = ${i};\n`);
  const detected = detect(root);
  mkdirSync(join(root, "graph-out"));
  const kg = KnowledgeGraph.fromExtraction({ nodes: [], edges: [] });
  writeFileSync(join(root, "graph-out", "graph.json"), JSON.stringify({ ...kg.toJSON() as object, mindplace: makeGraphMetadata(root, detected) }));
  assert.equal(inspectGraph(root).status, "verified_current");
  appendFileSync(join(root, "file-205.ts"), "// changed beyond old prefix\n");
  assert.equal(inspectGraph(root).status, "stale");
 });

 it("detects same-size content changes even when source timestamps are preserved", () => {
  const root = project(); const source = join(root, "same.ts"); writeFileSync(source, "export const value = 1;\n"); utimesSync(source, new Date(1000), new Date(1000)); mkdirSync(join(root, "graph-out"));
  const metadata = makeGraphMetadata(root, detect(root));
  writeFileSync(join(root, "graph-out", "graph.json"), JSON.stringify({ nodes: [], edges: [], mindplace: metadata }));
  assert.equal(inspectGraph(root).status, "verified_current");
  const before = statSync(source);
  writeFileSync(source, "export const value = 2;\n");
  utimesSync(source, new Date(before.atimeMs), new Date(before.mtimeMs));
  assert.equal(statSync(source).size, before.size);
  assert.equal(statSync(source).mtimeMs, before.mtimeMs);
  const sameSize = inspectGraph(root);
  assert.equal(sameSize.status, "stale");
  assert.equal(sameSize.verifiedFiles, 1, "verified-file count is per call, not a cumulative read counter");
 });

 it("fails closed for injected unreadable and changed-during-read source failures", () => {
  const root = project(); writeFileSync(join(root, "source.ts"), "export const source = true;\n"); mkdirSync(join(root, "graph-out"));
  const metadata = makeGraphMetadata(root, detect(root));
  writeFileSync(join(root, "graph-out", "graph.json"), JSON.stringify({ nodes: [], edges: [], mindplace: metadata }));

  const unreadable = inspectGraph(root, { readSource: () => { throw new Error("injected EACCES unreadable source"); } });
  assert.equal(unreadable.status, "unknown");
  assert.match(unreadable.detail ?? "", /unreadable or changed during verification/);
  assert.match(unreadable.detail ?? "", /injected EACCES/);

  const changedWhileRead = inspectGraph(root, { readSource: () => { throw new Error("injected source changed during verification"); } });
  assert.equal(changedWhileRead.status, "unknown");
  assert.match(changedWhileRead.detail ?? "", /changed during verification/);
 });

 it("fails closed when the post-verification source detection throws", () => {
  const root = project(); writeFileSync(join(root, "source.ts"), "export const source = true;\n"); mkdirSync(join(root, "graph-out"));
  const metadata = makeGraphMetadata(root, detect(root));
  writeFileSync(join(root, "graph-out", "graph.json"), JSON.stringify({ nodes: [], edges: [], mindplace: metadata }));
  let calls = 0;
  const result = inspectGraph(root, { detect: sourceRoot => {
   calls++;
   if (calls === 2) throw new Error("injected post-detect failure");
   return detect(sourceRoot);
  } });
  assert.equal(calls, 2);
  assert.equal(result.status, "unknown");
  assert.match(result.detail ?? "", /Post-verification source scan failed/);
  assert.match(result.detail ?? "", /injected post-detect failure/);
 });

 it("reuses parsed graph data only while its full content fingerprint matches", () => {
  const root = project(); writeFileSync(join(root, "source.ts"), "export const source = true;\n"); mkdirSync(join(root, "graph-out"));
  const graphPath = join(root, "graph-out", "graph.json"); const metadata = makeGraphMetadata(root, detect(root));
  writeFileSync(graphPath, JSON.stringify({ nodes: [], edges: [], mindplace: metadata, marker: "a" }));
  const first = inspectGraph(root); const repeat = inspectGraph(root);
  assert.strictEqual(repeat.graphData, first.graphData, "unchanged graph JSON should reuse its parsed object");
  const before = statSync(graphPath);
  writeFileSync(graphPath, JSON.stringify({ nodes: [], edges: [], mindplace: metadata, marker: "b" }));
  utimesSync(graphPath, new Date(before.atimeMs), new Date(before.mtimeMs));
  const changed = inspectGraph(root);
  assert.notStrictEqual(changed.graphData, first.graphData, "same-size/same-time graph edits must invalidate the parse cache");
  assert.notEqual(changed.graphHash, first.graphHash);
 });

 it("marks additions, deletions, and legacy graphs as stale or unknown", () => {
  const root = project(); writeFileSync(join(root, "one.ts"), "export const one = 1;"); mkdirSync(join(root, "graph-out"));
  const metadata = makeGraphMetadata(root, detect(root));
  writeFileSync(join(root, "graph-out", "graph.json"), JSON.stringify({ nodes: [], edges: [], mindplace: metadata }));
  writeFileSync(join(root, "two.ts"), "export const two = 2;");
  assert.equal(inspectGraph(root).status, "stale");
  unlinkSync(join(root, "two.ts")); unlinkSync(join(root, "one.ts"));
  assert.equal(inspectGraph(root).status, "stale");
  writeFileSync(join(root, "renamed.ts"), "export const one = 1;");
  assert.equal(inspectGraph(root).status, "stale", "rename changes supported-source membership");
  writeFileSync(join(root, "graph-out", "graph.json"), JSON.stringify({ nodes: [], edges: [] }));
  assert.equal(inspectGraph(root).status, "unknown");
  const incomplete = makeGraphMetadata(root, detect(root)); incomplete.scanComplete = false;
  writeFileSync(join(root, "graph-out", "graph.json"), JSON.stringify({ nodes: [], edges: [], mindplace: incomplete }));
  assert.equal(inspectGraph(root).status, "unknown", "incomplete generations are never promoted to current");
 });

 it("retrieves concrete named code ahead of synthetic attribute/test noise", () => {
  const nodes: GraphNode[] = [{ id: "src_auth_file", label: "src/auth.cs", type: "file", sourceFile: "src/auth.cs" }, { id: "target_authenticate", label: "AuthenticateUser", type: "method", sourceFile: "src/auth.cs", sourceLocation: "L12" }];
  for (let i = 0; i < 120; i++) nodes.push({ id: `attribute_${i}`, label: `ObsoleteAttribute${i}`, type: "attribute", sourceFile: `src/generated${i}.cs` });
  for (let i = 0; i < 80; i++) nodes.push({ id: `test_${i}`, label: `AuthenticationTest${i}`, type: "function", sourceFile: `tests/auth${i}.test.ts` });
  const kg = KnowledgeGraph.fromExtraction({ nodes, edges: [] });
  const result = query(kg, "AuthenticateUser", 1000);
  assert.equal(result.nodes.find(node => node.type !== "file")?.label, "AuthenticateUser");
  assert.ok(result.nodes.find(node => node.label === "AuthenticateUser"));
  const testQuery = query(kg, "AuthenticationTest", 1000);
  assert.ok(testQuery.nodes.some(node => node.label.startsWith("AuthenticationTest")), "explicit test queries remain discoverable");
 });

 it("returns useful file-only hits and estimates the final formatted budget", () => {
  const kg = KnowledgeGraph.fromExtraction({ nodes: [{ id: "file", label: "scripts/deploy.sh", type: "file", sourceFile: "scripts/deploy.sh" }], edges: [] });
  const result = query(kg, "scripts/deploy.sh", 300);
  assert.ok(result.nodes.some(node => node.type === "file"));
  assert.ok(result.tokensUsed <= result.budget);
  assert.equal(result.tokensUsed, estimateQueryTokens(formatQueryResult(result)), "named/file hit budget includes the final formatted response");
  assert.throws(() => query(kg, "deploy", Number.NaN));
  assert.throws(() => query(kg, "deploy", 100, "bfs", 1.5));
 });

 it("records deterministic small/large cold, unchanged, changed, and revalidation benchmark evidence", () => {
  const reports: Array<Record<string, unknown>> = [];
  for (const count of [8, 240]) {
   const root = project();
   for (let i = 0; i < count; i++) writeFileSync(join(root, `bench-${String(i).padStart(4, "0")}.ts`), `export const item${i} = ${i};\\n`);
   mkdirSync(join(root, "graph-out"));
   const graphPath = join(root, "graph-out", "graph.json");
   const publish = () => writeFileSync(graphPath, JSON.stringify({ nodes: [], edges: [], mindplace: makeGraphMetadata(root, detect(root)) }));
   publish();
   const measure = (phase: string) => {
    resetFreshnessCounters(); const started = performance.now(); const result = inspectGraph(root); const elapsedMs = performance.now() - started;
    const counters = getFreshnessCounters();
    reports.push({ files: count, phase, status: result.status, elapsedMs: Number(elapsedMs.toFixed(3)), ...counters });
    return counters;
   };
   const cold = measure("cold"); assert.equal(reports.at(-1)?.status, "verified_current"); assert.equal(cold.sourceHashes, count); assert.equal(cold.graphParses, 1);
   const unchanged = measure("unchanged"); assert.equal(reports.at(-1)?.status, "verified_current"); assert.equal(unchanged.sourceHashes, count); assert.equal(unchanged.graphReads, 2); assert.equal(unchanged.graphParses, 0);
   appendFileSync(join(root, `bench-${String(count - 1).padStart(4, "0")}.ts`), "// changed\\n");
   const changed = measure("changed"); assert.equal(reports.at(-1)?.status, "stale"); assert.ok(changed.sourceHashes > 0);
   publish(); const revalidate = measure("revalidate"); assert.equal(reports.at(-1)?.status, "verified_current"); assert.equal(revalidate.sourceHashes, count);
  }
  console.log(`MP2-05 synthetic freshness benchmark (informational timings; no production extrapolation): ${JSON.stringify(reports)}`);
 });

 it("keeps empty responses within the normalized minimum for long questions and roots", () => {
  const kg = KnowledgeGraph.fromExtraction({ nodes: [], edges: [] });
  const result = query(kg, "question ".repeat(200), 1, "bfs", 0.15, "C:/very-long-project-root/".repeat(40));
  const formatted = formatQueryResult(result);
  assert.equal(result.budget, 160);
  assert.equal(result.tokensUsed, estimateQueryTokens(formatted));
  assert.ok(result.tokensUsed <= result.budget);
 });
});
