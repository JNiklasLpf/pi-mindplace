import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { KnowledgeGraph } from "../src/graph.ts";
import { generateHtml, VIS_NETWORK_ASSET } from "../src/viz.ts";

describe("generateHtml", () => {
	it("uses a local vis-network asset instead of a CDN", () => {
		const graph = KnowledgeGraph.fromExtraction({
			nodes: [
				{ id: "file", label: "index.ts", type: "file", sourceFile: "index.ts" },
				{
					id: "function",
					label: "main",
					type: "function",
					sourceFile: "index.ts",
				},
			],
			edges: [
				{
					source: "file",
					target: "function",
					relation: "contains",
					confidence: "EXTRACTED",
				},
			],
		});

		const html = generateHtml(graph);

		assert.ok(html.includes(`<script src="./${VIS_NETWORK_ASSET}"></script>`));
		assert.doesNotMatch(html, /https:\/\/unpkg\.com/);
	});

	it("renders node tooltips with controlled HTML instead of vis-network titles", () => {
		const graph = KnowledgeGraph.fromExtraction({
			nodes: [
				{ id: "file", label: "index.ts", type: "file", sourceFile: "index.ts" },
				{
					id: "field",
					label: "keywords",
					type: "field",
					sourceFile: "package.json",
				},
			],
			edges: [
				{
					source: "file",
					target: "field",
					relation: "contains",
					confidence: "EXTRACTED",
				},
			],
		});

		const html = generateHtml(graph);

		assert.match(html, /<div id="tooltip" role="tooltip"><\/div>/);
		assert.match(html, /tooltip\.innerHTML=/);
		assert.doesNotMatch(html, /title:n\.title/);
	});

	it("escapes graph data before embedding it in a script element", () => {
		const injectedLabel =
			"</script><script>throw new Error('injected')</script>";
		const graph = KnowledgeGraph.fromExtraction({
			nodes: [
				{ id: "file", label: "index.ts", type: "file", sourceFile: "index.ts" },
				{
					id: "function",
					label: injectedLabel,
					type: "function",
					sourceFile: "index.ts",
				},
			],
			edges: [
				{
					source: "file",
					target: "function",
					relation: "contains",
					confidence: "EXTRACTED",
				},
			],
		});

		const html = generateHtml(graph, "<unsafe title>");

		assert.doesNotMatch(html, /<\/script><script>throw new Error/);
		assert.match(html, /\\u003c\/script\\u003e\\u003cscript\\u003ethrow/);
		assert.match(html, /<title>&lt;unsafe title&gt; - Mind Place<\/title>/);
	});
});
