import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GRAPH_OUTPUT_IGNORE_ENTRY = "graph-out/";

function normalizeIgnoreEntry(entry: string): string {
	return entry.trim().replace(/^\//, "");
}

/**
 * Returns whether the root .gitignore explicitly ignores the graph output
 * directory. A cache-only entry such as graph-out/cache/ is not sufficient.
 */
export function isGraphOutputIgnored(gitignoreContents: string): boolean {
	return gitignoreContents.split(/\r?\n/).some((line) => {
		const entry = normalizeIgnoreEntry(line);
		return entry === "graph-out" || entry === GRAPH_OUTPUT_IGNORE_ENTRY;
	});
}

export function addGraphOutputToGitignore(root: string): boolean {
	const gitignorePath = join(root, ".gitignore");
	const contents = existsSync(gitignorePath)
		? readFileSync(gitignorePath, "utf-8")
		: "";

	if (isGraphOutputIgnored(contents)) return false;

	const separator =
		contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
	writeFileSync(
		gitignorePath,
		`${contents}${separator}${GRAPH_OUTPUT_IGNORE_ENTRY}\n`,
		"utf-8",
	);
	return true;
}
