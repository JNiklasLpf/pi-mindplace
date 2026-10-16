import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract, EXTRACTION_CACHE_VERSION, MAX_SOURCE_FILE_SIZE, MAX_JSON_KEYS } from "../src/extract.ts";
import { KnowledgeGraph } from "../src/graph.ts";

const roots: string[] = [];
function project(): string { const root = mkdtempSync(join(tmpdir(), "mindplace-cache-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("extraction cache versions and diagnostics", () => {
 it("reuses unchanged cache entries but invalidates pre-fix C# extraction identities", () => {
  const root = project(), cache = join(root, "cache"); writeFileSync(join(root, "a.ts"), "export function alpha() {}\n");
  assert.equal(extract(root, ["a.ts"], cache).extracted, 1);
  assert.equal(extract(root, ["a.ts"], cache).cached, 1);
  assert.ok(EXTRACTION_CACHE_VERSION.includes("extract-schema"));
  const cacheFile = join(cache, "cache.json");
  writeFileSync(cacheFile, readFileSync(cacheFile, "utf8").replace(EXTRACTION_CACHE_VERSION, "extract-schema-3/tree-sitter-0.21-grammars-lock-1"));
  const refreshed = extract(root, ["a.ts"], cache);
  assert.equal(refreshed.extracted, 1);
  assert.equal(refreshed.cached, 0);
 });

 it("reports oversized, malformed JSON, and bounded JSON key omissions", () => {
  const root = project(); writeFileSync(join(root, "large.ts"), "x".repeat(MAX_SOURCE_FILE_SIZE + 1));
  writeFileSync(join(root, "bad.json"), "{broken");
  const object = Object.fromEntries(Array.from({ length: MAX_JSON_KEYS + 3 }, (_, i) => [`key${i}`, i]));
  writeFileSync(join(root, "many.json"), JSON.stringify(object));
  const result = extract(root, ["large.ts", "bad.json", "many.json"]);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "oversized"));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "parser_failed"));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "truncated_json"));
  assert.equal(result.skippedFiles, 3);
 });

 it("loads legacy graph files without new extraction metadata", () => {
  const legacy = { nodes: [{ id: "a", label: "A", type: "function", sourceFile: "a.cs" }, { id: "b", label: "B", type: "method", sourceFile: "b.cs" }], edges: [{ source: "a", target: "b", relation: "calls", confidence: "INFERRED" as const }] };
  const graph = KnowledgeGraph.fromJSON(legacy);
  assert.equal(graph.nodes.size, 2); assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relation, "calls");
 });

 it("removes deleted files from the persisted incremental cache", () => {
  const root = project(), cache = join(root, "cache");
  writeFileSync(join(root, "a.ts"), "export const a = 1;"); writeFileSync(join(root, "b.ts"), "export const b = 2;");
  extract(root, ["a.ts", "b.ts"], cache);
  extract(root, ["a.ts"], cache);
  const entries = JSON.parse(readFileSync(join(cache, "cache.json"), "utf8"));
  assert.deepEqual(Object.keys(entries), ["a.ts"]);
 });
});
