import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import Parser from "tree-sitter";
import Kotlin from "@sengac/tree-sitter-kotlin";

describe("Kotlin grammar", () => {
	it("parses Kotlin without loading a registry client", () => {
		const parser = new Parser();
		parser.setLanguage(Kotlin);

		const tree = parser.parse("class Greeter {}");

		assert.equal(tree.rootNode.type, "source_file");
		assert.equal(tree.rootNode.hasError, false);
	});
});
