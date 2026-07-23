import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addGraphOutputToGitignore,
	isGraphOutputIgnored,
} from "../src/gitignore.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function createTemporaryProject(): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-mindplace-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("graph output gitignore helpers", () => {
	it("recognizes root-relative and directory ignore entries", () => {
		assert.ok(isGraphOutputIgnored("/graph-out/\n"));
		assert.ok(isGraphOutputIgnored("graph-out\n"));
		assert.ok(!isGraphOutputIgnored("graph-out/cache/\n"));
	});

	it("creates .gitignore with the graph output entry", () => {
		const root = createTemporaryProject();

		assert.ok(addGraphOutputToGitignore(root));
		assert.equal(
			readFileSync(join(root, ".gitignore"), "utf-8"),
			"graph-out/\n",
		);
	});

	it("appends once without changing an existing ignore entry", () => {
		const root = createTemporaryProject();
		const gitignorePath = join(root, ".gitignore");
		writeFileSync(gitignorePath, "node_modules/", "utf-8");

		assert.ok(addGraphOutputToGitignore(root));
		assert.equal(
			readFileSync(gitignorePath, "utf-8"),
			"node_modules/\ngraph-out/\n",
		);
		assert.ok(!addGraphOutputToGitignore(root));
		assert.equal(
			readFileSync(gitignorePath, "utf-8"),
			"node_modules/\ngraph-out/\n",
		);
	});
});
