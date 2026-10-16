/**
 * Core types for pi-mindplace
 */

export interface GraphNode {
	id: string;
	label: string;
	type: string;
	sourceFile: string;
	sourceLocation?: string;
	community?: number;
	centrality?: number;
	description?: string;
}

export interface GraphEdge {
	source: string;
	target: string;
	relation: string;
	confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
	confidenceScore?: number;
}

export interface ExtractionDiagnostic {
	file: string;
	reason: "oversized" | "unreadable" | "parser_failed" | "unsupported" | "unresolved_reference" | "truncated_json" | "unsupported_callable";
	message: string;
	referenceStatus?: "ambiguous" | "external" | "dynamic" | "unknown";
}

export interface BindingReference {
	file: string;
	source: string;
	kind: "call" | "base" | "import";
	target: string;
	scope: string;
	alias?: string;
	staticImport?: boolean;
}

export interface ExtractionResult {
	nodes: GraphNode[];
	edges: GraphEdge[];
	diagnostics?: ExtractionDiagnostic[];
	/** Cached syntax-level references; resolved only after all project declarations are collected. */
	bindingReferences?: BindingReference[];
}

export interface DetectResult {
	root: string;
	files: string[];
	totalFiles: number;
	byExtension: Record<string, number>;
	scanComplete?: boolean;
	scanLimited?: boolean;
	warnings?: string[];
}

export interface QueryResult {
	question: string;
	mode: "bfs" | "dfs";
	nodes: GraphNode[];
	edges: GraphEdge[];
	tokensUsed: number;
	budget: number;
	coverage: number;
	/** Query-time lexical relevance, deliberately distinct from PageRank centrality. */
	relevanceByNode?: Record<string, number>;
	scope?: string;
	truncated?: boolean;
}

export interface GraphStats {
	nodeCount: number;
	edgeCount: number;
	communityCount: number;
	godNodes: Array<{ id: string; label: string; degree: number }>;
}

/** Supported file extensions → language grammar key */
export const CODE_EXTENSIONS: Record<string, string> = {
	// JavaScript family
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "javascript",
	// TypeScript family
	".ts": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".tsx": "typescript",
	// Python
	".py": "python",
	".pyi": "python",
	// Go
	".go": "go",
	// Bash
	".sh": "bash",
	".bash": "bash",
	".zsh": "bash",
	// Config
	".json": "json",
	// C#
	".cs": "csharp",
	// Java
	".java": "java",
	// Rust
	".rs": "rust",
	// C++
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".hpp": "cpp",
	".hh": "cpp",
	".hxx": "cpp",
	// Ruby
	".rb": "ruby",
	// Kotlin
	".kt": "kotlin",
	".kts": "kotlin",
	// Scala
	".scala": "scala",
	".sc": "scala",
};

/** File extensions that may contain useful info but aren't parsed as code */
export const DOC_EXTENSIONS = new Set([
	".md",
	".mdx",
	".txt",
	".rst",
	".yaml",
	".yml",
	".toml",
	".xml",
	".html",
	".css",
	".scss",
	".less",
]);
