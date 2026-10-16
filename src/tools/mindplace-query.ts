/** mindplace_query — optional retrieval from a project-local graph. */

import { Type } from "typebox";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeProjectRoot } from "../paths.ts";
import { inspectGraph, recordRanking, type GraphStatus } from "../graph-file.ts";
import { KnowledgeGraph } from "../graph.ts";
import { query, formatQueryResult } from "../query.ts";

export interface MindplaceQueryDetails {
	status: GraphStatus | "matched" | "no_match" | "execution_error";
	root: string;
	graphPath: string;
	detail?: string;
	graphStatus?: GraphStatus;
	nodesReturned?: number;
	tokensUsed?: number;
	budget?: number;
	coverage?: number;
	truncated?: boolean;
	error?: string;
}

export const MindplaceQueryTool = {
	name: "mindplace_query",
	label: "Query Mind Place",
	description: "Optionally retrieve relevant entities and relationships from the selected project's graph. Source search/read remains available and graph use/build is not required.",
	promptSnippet: "Optionally query the code knowledge graph",
	promptGuidelines: ["Use this graph as one navigation aid when useful; verify implementation details by inspecting source. If it is missing or stale, continue with direct search/read or refresh it only if useful."],
	parameters: Type.Object({
		question: Type.String({ description: "Natural-language question about the codebase" }),
		path: Type.Optional(Type.String({ description: "Project root; defaults to current working directory" })),
		budget: Type.Optional(Type.Number({ description: "Estimated character-based output budget in tokens (default 4000; values below 160 are raised to 160)" })),
		minScore: Type.Optional(Type.Number({ description: "Minimum lexical relevance 0..1 (default 0.15)" })),
	}),
	async execute(
		_toolCallId: string,
		params: { question: string; path?: string; budget?: number; minScore?: number },
		_signal: AbortSignal,
		_onUpdate: (update: unknown) => void,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<MindplaceQueryDetails>> {
		const root = normalizeProjectRoot(ctx.cwd, params.path);
		const inspected = inspectGraph(root);
		if (inspected.status !== "verified_current" || inspected.graphData === undefined) {
			return {
				content: [{ type: "text" as const, text: inspected.status === "not_built"
					? `No graph exists for root \`${root}\`. Graph use is optional: inspect source directly, or build it with mindplace_build path=\"${root}\` if useful.`
					: `Graph at \`${inspected.path}\` is ${inspected.status}: ${inspected.detail ?? "Invalid graph format."} No graph results were returned. Inspect source directly or optionally rebuild with mindplace_build path=\"${root}\`.` }],
				details: { status: inspected.status, root, graphPath: inspected.path, detail: inspected.detail },
				isError: inspected.status === "unknown" || inspected.status === "verification_in_progress",
			};
		}
		try {
			const kg = KnowledgeGraph.fromJSON(inspected.graphData as Parameters<typeof KnowledgeGraph.fromJSON>[0]);
			const graphInfo = `status ${inspected.status}; graph ${inspected.path} (root ${root}${inspected.detail ? `; ${inspected.detail}` : ""})`;
			recordRanking();
			const result = query(kg, params.question, params.budget ?? 4000, "bfs", params.minScore ?? 0.15, graphInfo);
			const formatted = formatQueryResult(result);
			return {
				content: [{ type: "text" as const, text: formatted }],
				details: {
					status: result.nodes.length ? "matched" : "no_match",
					root,
					graphPath: inspected.path,
					graphStatus: inspected.status,
					nodesReturned: result.nodes.length,
					tokensUsed: result.tokensUsed,
					budget: result.budget,
					coverage: result.coverage,
					truncated: result.truncated ?? false,
				},
			};
		} catch (error) {
			return {
				content: [{ type: "text" as const, text: `Failed to query graph at \`${inspected.path}\`: ${String(error)}` }],
				details: { status: "execution_error", root, graphPath: inspected.path, error: String(error) },
				isError: true,
			};
		}
	},
};
