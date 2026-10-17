/** Token-budgeted lexical graph retrieval. Relevance and PageRank centrality are separate signals. */

import type { GraphNode, QueryResult } from "./types.ts";
import { KnowledgeGraph } from "./graph.ts";

const CHARS_PER_TOKEN = 4;
export function estimateQueryTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function tokenize(text: string): string[] {
	return text
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
		.split(/[^a-zA-Z0-9]+/)
		.map(word => word.toLowerCase())
		.filter(word => word.length > 1);
}

class TfIdfScorer {
	private readonly idf = new Map<string, number>();
	private readonly docs = new Map<string, string[]>();

	constructor(nodes: Map<string, GraphNode>) {
		const frequencies = new Map<string, number>();
		for (const [id, node] of nodes) {
			const tokens = tokenize(`${node.label} ${node.description ?? ""} ${node.type} ${node.sourceFile}`);
			if (!tokens.length) continue;
			this.docs.set(id, tokens);
			for (const token of new Set(tokens)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
		}
		for (const [token, frequency] of frequencies) {
			this.idf.set(token, Math.log((this.docs.size + 1) / (frequency + 1)) + 1);
		}
	}

	score(node: GraphNode, queryTokens: string[], question: string): number {
		const tokens = this.docs.get(node.id);
		if (!tokens?.length || !queryTokens.length) return 0;
		const termCounts = new Map<string, number>();
		for (const token of tokens) termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
		let dot = 0;
		let queryNorm = 0;
		let docNorm = 0;
		for (const token of queryTokens) {
			const weight = this.idf.get(token) ?? 0.5;
			queryNorm += weight * weight;
			if (termCounts.has(token)) dot += weight * (termCounts.get(token)! * weight);
		}
		for (const [token, count] of termCounts) {
			const weight = count * (this.idf.get(token) ?? 0.5);
			docNorm += weight * weight;
		}
		let score = queryNorm && docNorm ? dot / Math.sqrt(queryNorm * docNorm) : 0;
		const label = node.label.toLowerCase();
		const normalizedQuestion = question.toLowerCase().trim();
		if (normalizedQuestion && label === normalizedQuestion) score += 0.65;
		else if (normalizedQuestion.length > 2 && label.includes(normalizedQuestion)) score += 0.3;
		for (const token of queryTokens) if (label.includes(token)) score += 0.12;
		const file = node.sourceFile.toLowerCase();
		if (node.type === "attribute" && !queryTokens.some(t => t === "attribute" || t === "attributes")) score *= 0.45;
		if (/(^|[/.])(__tests__|tests?)([/.]|$)|\.(test|spec)\./.test(file) && !queryTokens.some(t => ["test", "tests", "spec", "fixture"].includes(t))) score *= 0.55;
		return Math.min(1, score);
	}
}

function formatNode(node: GraphNode, relevance: number, matched: boolean): string {
	let text = `#### ${node.label} (${node.type})`;
	text += matched ? ` · relevance: ${relevance.toFixed(2)}` : " · connected context";
	if (node.description) text += `\n${node.description}`;
	text += `\nFile: ${node.sourceFile}`;
	if (node.sourceLocation) text += ` ${node.sourceLocation}`;
	return text;
}

export function query(
	kg: KnowledgeGraph,
	question: string,
	requestedBudget = 4000,
	mode: "bfs" | "dfs" = "bfs",
	minScore = 0.15,
	scope?: string,
): QueryResult {
	if (!Number.isFinite(requestedBudget) || requestedBudget <= 0) throw new RangeError("budget must be a finite positive number of tokens");
	if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) throw new RangeError("minScore must be between 0 and 1");
	// The smallest useful response is 64 estimated tokens (including its heading/status).
	const budget = Math.max(160, Math.floor(requestedBudget));
	if (!kg.nodes.size) {
		const empty: QueryResult = { question, mode, nodes: [], edges: [], tokensUsed: 0, budget, coverage: 0, scope };
		for (let i = 0; i < 3; i++) empty.tokensUsed = estimateQueryTokens(formatQueryResult(empty));
		return empty;
	}

	const queryTokens = tokenize(question);
	const scorer = new TfIdfScorer(kg.nodes);
	const scored = new Map<string, number>();
	for (const node of kg.nodes.values()) {
		const score = scorer.score(node, queryTokens, question);
		if (score >= minScore && score > 0) scored.set(node.id, score);
	}
	const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const candidates: string[] = [];
	const candidateSet = new Set<string>();
	const addCandidate = (id: string) => {
		if (!candidateSet.has(id)) { candidateSet.add(id); candidates.push(id); }
	};
	if (mode === "dfs" && ranked.length) {
		const walk = (id: string, depth: number) => {
			if (depth > 5 || candidateSet.has(id)) return;
			addCandidate(id);
			const neighbors = [...(kg.adjacency.get(id) ?? [])]
				.sort((a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0));
			for (const neighbor of neighbors.slice(0, 3)) walk(neighbor, depth + 1);
		};
		walk(ranked[0][0], 0);
	} else {
		for (const [id] of ranked) {
			addCandidate(id);
			for (const neighbor of kg.adjacency.get(id) ?? []) {
				if ((scored.get(neighbor) ?? 0) >= minScore * 0.5) addCandidate(neighbor);
			}
		}
	}

	const selected: GraphNode[] = [];
	const selectedIds = new Set<string>();
	let truncated = candidates.length > 500;
	for (const id of candidates.slice(0, 500)) {
		const node = kg.nodes.get(id);
		if (!node) continue;
		selected.push(node);
		selectedIds.add(id);
	}

	let result = makeResult(selected, selectedIds, scored, question, mode, budget, kg.nodes.size, truncated, kg, scope);
	while (result.nodes.length && estimateQueryTokens(formatQueryResult(result)) > budget) {
		const removed = result.nodes.pop()!;
		selectedIds.delete(removed.id);
		result.edges = result.edges.filter(edge => selectedIds.has(edge.source) && selectedIds.has(edge.target));
		delete result.relevanceByNode?.[removed.id];
		result.coverage = result.nodes.length / kg.nodes.size;
		result.truncated = true;
	}
	for (let i = 0; i < 3; i++) {
		result.tokensUsed = estimateQueryTokens(formatQueryResult(result));
	}
	while (result.nodes.length && estimateQueryTokens(formatQueryResult(result)) > budget) {
		const removed = result.nodes.pop()!;
		selectedIds.delete(removed.id);
		result.edges = result.edges.filter(edge => selectedIds.has(edge.source) && selectedIds.has(edge.target));
		if (result.relevanceByNode) delete result.relevanceByNode[removed.id];
		result.coverage = result.nodes.length / kg.nodes.size;
		result.truncated = true;
		result.tokensUsed = estimateQueryTokens(formatQueryResult(result));
	}
	return result;
}

function makeResult(
	nodes: GraphNode[], ids: Set<string>, scores: Map<string, number>, question: string,
	mode: "bfs" | "dfs", budget: number, total: number, truncated: boolean, kg: KnowledgeGraph, scope?: string,
): QueryResult {
	const edges = [...new Map(kg.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => [`${edge.source}:${edge.relation}:${edge.target}`, edge])).values()];
	const relevanceByNode: Record<string, number> = {};
	for (const node of nodes) if (scores.has(node.id)) relevanceByNode[node.id] = scores.get(node.id)!;
	return { question, mode, nodes: [...nodes], edges, tokensUsed: 0, budget, coverage: total ? nodes.length / total : 0, relevanceByNode, scope, truncated };
}

export function formatQueryResult(result: QueryResult): string {
	const lines: string[] = [];
	const displayQuestion = result.question.length > 100 ? `${result.question.slice(0, 97)}…` : result.question;
	lines.push(`## Mind Place: "${displayQuestion}"`);
	lines.push(`_${result.nodes.length} nodes · estimated ${result.tokensUsed}/${result.budget} tokens · graph coverage ${(result.coverage * 100).toFixed(1)}%_`);
	if (result.scope) lines.push(`Graph: ${result.scope.length > 120 ? `${result.scope.slice(0, 117)}…` : result.scope}`);
	if (!result.nodes.length) lines.push(result.truncated ? "No entity fit within the requested budget." : "No useful graph match found; try a symbol name or use source search/read directly.");
	const byType = new Map<string, GraphNode[]>();
	for (const node of result.nodes) {
		const group = byType.get(node.type) ?? [];
		group.push(node);
		byType.set(node.type, group);
	}
	for (const [type, nodes] of byType) {
		lines.push(`### ${type === "file" ? "Files" : `${type.charAt(0).toUpperCase()}${type.slice(1)}s`}`);
		for (const node of nodes) {
			const relevance = result.relevanceByNode?.[node.id] ?? 0;
			lines.push(formatNode(node, relevance, relevance > 0));
			lines.push("");
		}
	}
	if (result.edges.length) {
		lines.push("### Key Relationships");
		for (const edge of result.edges.slice(0, 10)) {
			const source = result.nodes.find(node => node.id === edge.source);
			const target = result.nodes.find(node => node.id === edge.target);
			if (source && target) lines.push(`- ${source.label} —${edge.relation}→ ${target.label}${edge.confidence === "INFERRED" ? " (inferred)" : ""}`);
		}
		if (result.edges.length > 10) lines.push(`_${result.edges.length - 10} additional relationships omitted._`);
	}
	if (result.truncated) lines.push("_Truncated to fit the estimated character-based budget; increase budget for more._");
	return lines.join("\n");
}
