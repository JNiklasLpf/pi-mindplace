/** mindplace_explain — resolve an exact graph target or request explicit disambiguation. */

import { Type } from "typebox";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeProjectRoot } from "../paths.ts";
import { inspectGraph, recordRanking, type GraphStatus } from "../graph-file.ts";
import { KnowledgeGraph } from "../graph.ts";
import type { GraphEdge } from "../types.ts";

export interface MindplaceExplainDetails {
	status: GraphStatus | "matched" | "no_match" | "ambiguous" | "execution_error";
	root: string;
	graphPath: string;
	detail?: string;
	matchesFound?: number;
	candidates?: Array<{ id: string; label: string; type: string; sourceFile: string; sourceLocation?: string }>;
	nodeId?: string;
	connections?: number;
	matchesTotal?: number;
	error?: string;
}

export const MindplaceExplainTool = {
	name: "mindplace_explain",
	label: "Explain Mind Place Node",
	description: "Explain one graph entity. Prefer exact node IDs or qualified labels. If names collide, use file/type filters; graph source should still be inspected to verify implementation.",
	promptSnippet: "Explain a code entity and its connections",
	parameters: Type.Object({
		name: Type.String({ description: "Exact node ID, qualified label, symbol label, or file path" }),
		path: Type.Optional(Type.String({ description: "Project root; defaults to current working directory" })),
		file: Type.Optional(Type.String({ description: "Restrict candidates to this source file/path" })),
		type: Type.Optional(Type.String({ description: "Restrict candidates to this node type (for example function, class, file)" })),
	}),
	async execute(
		_toolCallId: string,
		params: { name: string; path?: string; file?: string; type?: string },
		_signal: AbortSignal,
		_onUpdate: (update: unknown) => void,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<MindplaceExplainDetails>> {
		const root = normalizeProjectRoot(ctx.cwd, params.path);
		const inspected = inspectGraph(root);
		if (inspected.status !== "verified_current" || inspected.graphData === undefined) {
			return {
				content: [{ type: "text" as const, text: inspected.status === "not_built"
					? `No graph exists for root \`${root}\`. You can inspect source directly; optionally run mindplace_build with path=\"${root}\` first.`
					: `Graph at \`${inspected.path}\` is ${inspected.status}: ${inspected.detail ?? "Invalid graph format."} No graph results were returned. You can inspect source directly or rebuild with mindplace_build path=\"${root}\`.` }],
				details: { status: inspected.status, root, graphPath: inspected.path, detail: inspected.detail },
				isError: inspected.status === "unknown" || inspected.status === "verification_in_progress",
			};
		}
		try {
			const raw = inspected.graphData;
			const kg = KnowledgeGraph.fromJSON(raw as Parameters<typeof KnowledgeGraph.fromJSON>[0]);
			const name = params.name.trim();
			const fileFilter = params.file?.replace(/\\/g, "/").toLowerCase();
			const candidates = [...kg.nodes.values()].filter(node => {
				if (params.type && node.type.toLowerCase() !== params.type.toLowerCase()) return false;
				if (fileFilter) {
					const source = node.sourceFile.replace(/\\/g, "/").toLowerCase();
					if (source !== fileFilter && !source.endsWith(`/${fileFilter}`)) return false;
				}
				return true;
			});
			const byId = candidates.filter(node => node.id.toLowerCase() === name.toLowerCase());
			const byQualifiedLabel = candidates.filter(node => node.type !== "file" && node.label.toLowerCase() === name.toLowerCase());
			const byFile = candidates.filter(node => node.type === "file" && (node.sourceFile.toLowerCase() === name.toLowerCase() || node.label.toLowerCase() === name.toLowerCase()));
			const bySymbolLabel = candidates.filter(node => node.type !== "file" && node.label.toLowerCase() === name.toLowerCase());
			const matches = byId.length ? byId : byQualifiedLabel.length ? byQualifiedLabel : byFile.length ? byFile : bySymbolLabel.length ? bySymbolLabel : candidates.filter(node => node.type !== "file" && (node.label.toLowerCase().includes(name.toLowerCase()) || node.id.toLowerCase().includes(name.toLowerCase())));
			recordRanking();
			const sorted = matches.sort((a, b) => a.id.localeCompare(b.id));
			if (!sorted.length) {
				return {
					content: [{ type: "text" as const, text: `No entity matching \"${name}\"${params.file ? ` in ${params.file}` : ""}${params.type ? ` of type ${params.type}` : ""} found in graph \`${inspected.path}\` (status: ${inspected.status}). Try an exact node ID, qualified label, file/type filter, or direct source search.` }],
					details: { status: "no_match", root, graphPath: inspected.path, matchesFound: 0 },
				};
			}
			if (sorted.length > 1) {
				const list = sorted.slice(0, 12).map(candidate => `- \`${candidate.id}\` — ${candidate.label} (${candidate.type}), ${candidate.sourceFile}${candidate.sourceLocation ? ` ${candidate.sourceLocation}` : ""}`).join("\n");
				return {
					content: [{ type: "text" as const, text: `Ambiguous entity \"${name}\" (${sorted.length} candidates). Narrow with file= or type=, or call again with an exact node ID:\n${list}${sorted.length > 12 ? `\n- … ${sorted.length - 12} more candidates` : ""}` }],
					details: { status: "ambiguous", root, graphPath: inspected.path, matchesFound: sorted.length, candidates: sorted.slice(0, 12).map(candidate => ({ id: candidate.id, label: candidate.label, type: candidate.type, sourceFile: candidate.sourceFile, sourceLocation: candidate.sourceLocation })) },
				};
			}
			const node = sorted[0];
			const connectedEdges: GraphEdge[] = kg.edges.filter(edge => edge.source === node.id || edge.target === node.id);
			const byRelation = new Map<string, string[]>();
			for (const edge of connectedEdges) {
				const other = kg.nodes.get(edge.source === node.id ? edge.target : edge.source);
				if (!other) continue;
				const direction = edge.source === node.id ? "→" : "←";
				const group = byRelation.get(edge.relation) ?? [];
				group.push(`${direction} **${other.label}** (${other.type}) _${edge.confidence}_`);
				byRelation.set(edge.relation, group);
			}
			const lines = [
				`## ${node.label} (${node.type})`,
				`- **Graph:** \`${inspected.path}\` (root \`${root}\`, status: ${inspected.status})`,
				`- **ID:** \`${node.id}\``,
				`- **File:** \`${node.sourceFile}\`${node.sourceLocation ? ` ${node.sourceLocation}` : ""}`,
				`- **Connections:** ${connectedEdges.length}`,
			];
			if (node.description) lines.push(`- **Description:** ${node.description}`);
			for (const [relation, items] of byRelation) {
				lines.push("", `### ${relation} (${items.length})`, ...items.slice(0, 15).map(item => `- ${item}`));
				if (items.length > 15) lines.push(`- … ${items.length - 15} additional connections omitted`);
			}
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { status: "matched", root, graphPath: inspected.path, nodeId: node.id, connections: connectedEdges.length, matchesTotal: sorted.length },
			};
		} catch (error) {
			return { content: [{ type: "text" as const, text: `Failed to explain graph at \`${inspected.path}\`: ${String(error)}` }], details: { status: "execution_error", root, graphPath: inspected.path, error: String(error) }, isError: true };
		}
	},
};
