import { join, resolve } from "node:path";

export const GRAPH_OUTPUT_DIR = "graph-out";
export const GRAPH_FILE_NAME = "graph.json";

/** Resolve user-selected roots without changing process.cwd(). */
export function normalizeProjectRoot(cwd: string, selectedPath?: string): string {
	return resolve(cwd, selectedPath ?? ".");
}

export function graphFilePath(root: string): string {
	return join(resolve(root), GRAPH_OUTPUT_DIR, GRAPH_FILE_NAME);
}
