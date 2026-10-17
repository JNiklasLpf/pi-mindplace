import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_AI_VERSION = "1.2.0";
export const PI_AI_INTEGRITY = "sha512-U5/1zXqfV1on7/9sbez03tT4Ru49Lvfb4+zXSDK3DBKF5cRk6KxvAOTOY3HJ4jimlZth+rs7vbJqN6iBQAoNuQ==";

const expectedModels = [
	"amazon-bedrock", "ant-ling", "anthropic", "azure", "baseten", "cerebras",
	"cloudflare-ai-gateway", "cloudflare-workers-ai", "deepseek", "fireworks",
	"github-copilot", "google-vertex", "google", "groq", "huggingface", "kimi-coding",
	"meta", "minimax-cn", "minimax", "mistral", "moonshotai-cn", "moonshotai",
	"nvidia", "openai-codex", "openai", "opencode-go", "opencode", "openrouter",
	"qwen-token-plan-cn", "qwen-token-plan-individual", "qwen-token-plan", "radius",
	"together", "typesafe", "vercel-ai-gateway", "xai", "xiaomi-token-plan-ams",
	"xiaomi-token-plan-cn", "xiaomi-token-plan-sgp", "xiaomi", "zai-coding-cn", "zai",
];

function assertCondition(condition, message) {
	if (!condition) throw new Error(message);
}

async function packageMetadata(packageRoot) {
	return JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
}

async function patchPackage(packageRoot, modelNames = expectedModels) {
	const metadata = await packageMetadata(packageRoot);
	assertCondition(metadata.name === "@earendil-works/pi-ai", `Unexpected package name: ${metadata.name}`);
	assertCondition(metadata.version === PI_AI_VERSION,
		`Refusing pi-ai ${metadata.version}; this correction is approved only for ${PI_AI_VERSION}.`);

	const providersRoot = join(packageRoot, "dist", "providers");
	const entries = await readdir(providersRoot, { withFileTypes: true });
	const actualModels = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".models.d.ts"))
		.map((entry) => entry.name.slice(0, -".models.d.ts".length))
		.sort();
	const expected = [...modelNames].sort();
	assertCondition(JSON.stringify(actualModels) === JSON.stringify(expected),
		`Unexpected pi-ai ${PI_AI_VERSION} model declaration inventory. Expected ${expected.length} files, found ${actualModels.length}.`);

	const pending = [];
	for (const model of expected) {
		const declarationPath = join(providersRoot, `${model}.models.d.ts`);
		const dataPath = join(providersRoot, "data", `${model}.json`);
		await readFile(dataPath); // Reject incomplete or unexpectedly packaged declarations before editing anything.
		const original = await readFile(declarationPath, "utf8");
		const bareImport = `import values from "./data/${model}.json";`;
		const attributedImport = `${bareImport.slice(0, -1)} with { type: "json" };`;
		if (original.startsWith(`${bareImport}\n`) || original.startsWith(`${bareImport}\r\n`) || original === bareImport) {
			pending.push([declarationPath, original, `${attributedImport}${original.slice(bareImport.length)}`]);
		} else if (!(original.startsWith(`${attributedImport}\n`) || original.startsWith(`${attributedImport}\r\n`) || original === attributedImport)) {
			throw new Error(`Unexpected declaration content in ${declarationPath}; refusing to patch.`);
		}
	}

	// All version, inventory, and content checks complete before the first write.
	for (const [declarationPath, _original, corrected] of pending) {
		await writeFile(declarationPath, corrected, "utf8");
	}
	return pending.length;
}

export async function correctSnapshot(snapshotRoot) {
	const sdkRoot = join(snapshotRoot, "node_modules", "@earendil-works", "pi-coding-agent");
	const sdk = await packageMetadata(sdkRoot);
	assertCondition(sdk.version === "1.2.0",
		`Refusing Pi SDK ${sdk.version}; expected the supported 1.2.0 baseline.`);
	let aiRoot;
	for (const candidate of [
		join(sdkRoot, "node_modules", "@earendil-works", "pi-ai"),
		join(snapshotRoot, "node_modules", "@earendil-works", "pi-ai"),
	]) {
		try {
			const metadata = await packageMetadata(candidate);
			if (metadata.name === "@earendil-works/pi-ai") {
				aiRoot = candidate;
				break;
			}
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	assertCondition(aiRoot, "Could not find the pi-ai package installed for the supported Pi SDK.");
	const ai = { directory: aiRoot, metadata: await packageMetadata(aiRoot) };
	const lock = JSON.parse(await readFile(join(snapshotRoot, "package-lock.json"), "utf8"));
	const lockKey = relative(snapshotRoot, ai.directory).split(sep).join("/");
	const locked = lock.packages?.[lockKey];
	assertCondition(locked?.version === PI_AI_VERSION && locked.integrity === PI_AI_INTEGRITY &&
		typeof locked.resolved === "string" && locked.resolved.endsWith(`/pi-ai-${PI_AI_VERSION}.tgz`),
		`Missing exact pi-ai ${PI_AI_VERSION} registry tarball integrity in ${lockKey}; refusing to patch.`);
	assertCondition(ai.metadata.version === locked.version,
		`Installed pi-ai ${ai.metadata.version} does not match its integrity-locked version ${locked.version}.`);
	const changed = await patchPackage(ai.directory);
	console.log(`[declaration correction] pi-ai ${PI_AI_VERSION}; verified lock integrity ${locked.integrity}; ${changed} model declarations updated; JavaScript untouched.`);
	return changed;
}

async function expectReject(callback, expectedText) {
	let failure;
	try {
		await callback();
	} catch (error) {
		failure = error;
	}
	assert(failure, `Expected rejection containing: ${expectedText}`);
	assert.match(String(failure.message), new RegExp(expectedText));
}

async function fixture(root, version, declaration) {
	const packageRoot = join(root, "fixture-pi-ai");
	const providers = join(packageRoot, "dist", "providers");
	await mkdir(join(providers, "data"), { recursive: true });
	await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-ai", version }));
	await writeFile(join(providers, "data", "openai.json"), "{}\n");
	await writeFile(join(providers, "openai.models.d.ts"), declaration);
	return { packageRoot, declarationPath: join(providers, "openai.models.d.ts") };
}

export async function runRegressionChecks(scratchRoot) {
	const testRoot = await mkdtemp(join(scratchRoot, "pi-ai-declaration-regression-"));
	try {
		const { packageRoot, declarationPath } = await fixture(testRoot, PI_AI_VERSION,
			'import values from "./data/openai.json";\nexport declare const OPENAI_MODELS: unknown;\n');
		const firstChanges = await patchPackage(packageRoot, ["openai"]);
		assert.equal(firstChanges, 1, "the first pass adds exactly one import attribute");
		const corrected = await readFile(declarationPath, "utf8");
		assert.match(corrected, /^import values from "\.\/data\/openai\.json" with \{ type: "json" \};\n/);
		assert.match(corrected, /export declare const OPENAI_MODELS: unknown;\n$/);
		assert.equal(await patchPackage(packageRoot, ["openai"]), 0, "reapplying is idempotent");
		assert.equal(await readFile(declarationPath, "utf8"), corrected, "idempotent pass leaves bytes unchanged");

		const wrongVersion = await fixture(testRoot, "1.2.1", 'import values from "./data/openai.json";\n');
		await expectReject(() => patchPackage(wrongVersion.packageRoot, ["openai"]), "Refusing pi-ai");
		assert.equal(await readFile(wrongVersion.declarationPath, "utf8"), 'import values from "./data/openai.json";\n');

		const wrongContent = await fixture(testRoot, PI_AI_VERSION, 'import values from "./data/changed.json";\n');
		await expectReject(() => patchPackage(wrongContent.packageRoot, ["openai"]), "Unexpected declaration content");
		assert.equal(await readFile(wrongContent.declarationPath, "utf8"), 'import values from "./data/changed.json";\n');
		console.log("[declaration correction regression] idempotence, version rejection, and changed-content rejection passed.");
	} finally {
		await rm(testRoot, { recursive: true, force: true });
	}
}

const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
	assertCondition(argv.length === 2, "Usage: patch-pi-ai-declarations.mjs --self-test <scratch-root>");
	await runRegressionChecks(resolve(argv[1]));
} else {
	assertCondition(argv.length === 0, "This correction accepts no arguments.");
	await correctSnapshot(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}
