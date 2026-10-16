/**
 * Tests for graph operations
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { KnowledgeGraph } from "../src/graph.ts";
import type { ExtractionResult } from "../src/types.ts";

function sampleExtraction(): ExtractionResult {
  return {
    nodes: [
      { id: "mod_a", label: "moduleA", type: "file", sourceFile: "a.ts" },
      { id: "a_login", label: "login", type: "function", sourceFile: "a.ts", sourceLocation: "L10" },
      { id: "a_validate", label: "validate", type: "function", sourceFile: "a.ts", sourceLocation: "L20" },
      { id: "mod_b", label: "moduleB", type: "file", sourceFile: "b.ts" },
      { id: "b_process", label: "process", type: "function", sourceFile: "b.ts", sourceLocation: "L5" },
    ],
    edges: [
      { source: "mod_a", target: "a_login", relation: "contains", confidence: "EXTRACTED" as const },
      { source: "mod_a", target: "a_validate", relation: "contains", confidence: "EXTRACTED" as const },
      { source: "a_login", target: "a_validate", relation: "calls", confidence: "INFERRED" as const, confidenceScore: 0.85 },
      { source: "mod_b", target: "b_process", relation: "contains", confidence: "EXTRACTED" as const },
      { source: "b_process", target: "a_login", relation: "calls", confidence: "INFERRED" as const, confidenceScore: 0.95 },
    ],
  };
}

describe("KnowledgeGraph", () => {
  it("builds from extraction result", () => {
    const kg = KnowledgeGraph.fromExtraction(sampleExtraction());

    assert.equal(kg.nodes.size, 5);
    assert.equal(kg.edges.length, 5);
  });

  it("filters edges with missing endpoints", () => {
    const ext = sampleExtraction();
    ext.edges.push({
      source: "nonexistent",
      target: "a_login",
      relation: "calls",
      confidence: "INFERRED",
    });

    const kg = KnowledgeGraph.fromExtraction(ext);
    // Edge with missing source should be filtered
    assert.equal(kg.edges.length, 5);
  });

  it("computes PageRank centrality", () => {
    const kg = KnowledgeGraph.fromExtraction(sampleExtraction());
    kg.computeCentrality();

    for (const node of kg.nodes.values()) {
      assert.ok(node.centrality !== undefined, `node ${node.id} should have centrality`);
      assert.ok(node.centrality! >= 0 && node.centrality! <= 1, "centrality should be 0..1");
    }
  });

  it("detects communities", () => {
    const kg = KnowledgeGraph.fromExtraction(sampleExtraction());
    kg.computeCentrality();
    const communities = kg.detectCommunities();

    assert.ok(communities.size > 0, "should find at least one community");
    // Every node should be assigned
    for (const nodeId of kg.nodes.keys()) {
      const node = kg.nodes.get(nodeId);
      assert.ok(node?.community !== undefined, `node ${nodeId} should have community`);
    }
  });

  it("identifies god nodes", () => {
    const kg = KnowledgeGraph.fromExtraction(sampleExtraction());
    kg.computeCentrality();
    kg.detectCommunities();

    const top = kg.topNodes(3);
    assert.ok(top.length > 0, "should find god nodes");
    assert.ok(top[0].degree >= (top[1]?.degree ?? 0), "should be sorted by degree");
  });

  it("reuses one generation-scoped file-to-symbol index across rankings", () => {
    const nodes: ExtractionResult["nodes"] = [];
    for (let i = 0; i < 240; i++) {
      const sourceFile = `src/file-${i}.ts`;
      nodes.push({ id: `file-${i}`, label: sourceFile, type: "file", sourceFile });
      nodes.push({ id: `symbol-${i}-a`, label: `Symbol${i}A`, type: "class", sourceFile, centrality: 0.2 });
      nodes.push({ id: `symbol-${i}-b`, label: `Symbol${i}B`, type: "method", sourceFile, centrality: 0.1 });
    }
    const kg = KnowledgeGraph.fromExtraction({ nodes, edges: [] });
    let visited = 0;
    const originalValues = kg.nodes.values.bind(kg.nodes);
    Object.defineProperty(kg.nodes, "values", {
      configurable: true,
      value: function* () { for (const node of originalValues()) { visited++; yield node; } },
    });

    const first = kg.fileRanking(40);
    assert.equal(first.length, 40);
    assert.deepEqual(first[0].symbols.map(symbol => symbol.label), ["Symbol0A", "Symbol0B"]);
    assert.equal(visited, nodes.length, "building the index visits each graph node once, not once per selected file");
    kg.fileRanking(80);
    assert.equal(visited, nodes.length, "a second ranking reuses the graph-generation index without a whole-node scan");

    const nextGeneration = KnowledgeGraph.fromExtraction({ nodes: [...nodes, { id: "new-file", label: "new.ts", type: "file", sourceFile: "new.ts" }], edges: [] });
    let nextGenerationVisits = 0;
    const nextValues = nextGeneration.nodes.values.bind(nextGeneration.nodes);
    Object.defineProperty(nextGeneration.nodes, "values", {
      configurable: true,
      value: function* () { for (const node of nextValues()) { nextGenerationVisits++; yield node; } },
    });
    assert.equal(nextGeneration.fileRanking(1).length, 1);
    assert.equal(nextGenerationVisits, nodes.length + 1, "a new graph generation builds its own index");
  });

  it("serializes to and from JSON", () => {
    const kg1 = KnowledgeGraph.fromExtraction(sampleExtraction());
    kg1.computeCentrality();
    kg1.detectCommunities();

    const json = JSON.stringify(kg1.toJSON());
    const parsed = JSON.parse(json);
    const kg2 = KnowledgeGraph.fromJSON(parsed);

    assert.equal(kg2.nodes.size, kg1.nodes.size);
    assert.equal(kg2.edges.length, kg1.edges.length);
  });

});
