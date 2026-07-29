import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const GRAPH_OUTPUT_IGNORE_ENTRY = "graph-out/";

function normalizeIgnoreEntry(entry: string): string {
	return entry.trim().replace(/^\//, "");
}

function targetsGraphOutput(entry: string): boolean {
	const pattern = normalizeIgnoreEntry(entry);
	return (
		pattern === "graph-out" ||
		pattern === GRAPH_OUTPUT_IGNORE_ENTRY ||
		pattern === "graph-out/*" ||
		pattern === "graph-out/**" ||
		pattern === "**/graph-out" ||
		pattern === "**/graph-out/" ||
		pattern === "**/graph-out/*" ||
		pattern === "**/graph-out/**"
	);
}

/**
 * Returns whether the root .gitignore ignores the graph output directory.
 * Covers root-relative, recursive, and content-wildcard patterns, while a
 * cache-only entry such as graph-out/cache/ is not sufficient.
 */
export function isGraphOutputIgnored(gitignoreContents: string): boolean {
	let ignored = false;

	for (const line of gitignoreContents.split(/\r?\n/)) {
		const entry = line.trim();
		if (!entry || entry.startsWith("#")) continue;

		const isNegation = entry.startsWith("!");
		const pattern = isNegation ? entry.slice(1) : entry;
		if (targetsGraphOutput(pattern)) ignored = !isNegation;
	}

	return ignored;
}

/**
 * Returns whether Git itself excludes a file inside graph-out/. This covers
 * parent .gitignore files, .git/info/exclude, and the user's global excludes
 * in addition to the root .gitignore checked by {@link isGraphOutputIgnored}.
 */
export function isGraphOutputIgnoredAtRoot(root: string): boolean {
	const gitignorePath = join(root, ".gitignore");
	const contents = existsSync(gitignorePath)
		? readFileSync(gitignorePath, "utf-8")
		: "";
	if (isGraphOutputIgnored(contents)) return true;

	try {
		return (
			spawnSync(
				"git",
				["check-ignore", "--quiet", "graph-out/.mindplace-ignore-probe"],
				{ cwd: root, stdio: "ignore" },
			).status === 0
		);
	} catch {
		return false;
	}
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
