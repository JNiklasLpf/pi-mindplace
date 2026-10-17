/**
 * mindplace_build tool — scan and build the knowledge graph
 */

import { Type } from "typebox";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { detect } from "../detect.ts";
import { extractAsync } from "../extract.ts";
import { KnowledgeGraph } from "../graph.ts";
import { generateReport } from "../report.ts";
import { generateHtml, VIS_NETWORK_ASSET } from "../viz.ts";
import {
	addGraphOutputToGitignore,
	isGraphOutputIgnoredAtRoot,
} from "../gitignore.ts";
import { copyFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { normalizeProjectRoot } from "../paths.ts";
import { makeGraphMetadata, markBuildInProgress, clearBuildInProgress } from "../graph-file.ts";
import type { ExtractionDiagnostic, GraphStats } from "../types.ts";
import { fileURLToPath } from "node:url";

export type MindplaceBuildDetails =
	| { skipped: true }
	| { status: "no_supported_source"; totalFiles: number; scanComplete: boolean | undefined; warnings: string[] | undefined }
	| { status: "cancelled"; root: string }
	| { status: "empty_extraction"; root: string; detectedFiles: number; extractedFiles: number; cachedFiles: number; skippedFiles: number; diagnostics: ExtractionDiagnostic[] }
	| ({
			status: "partial" | "complete";
			cachedFiles: number;
			extractedFiles: number;
			scanComplete: boolean | undefined;
			scanLimited: boolean | undefined;
			warnings: string[] | undefined;
			diagnostics: ExtractionDiagnostic[];
			cacheHits: number;
			skippedFiles: number;
		} & GraphStats)
	| { status: "cancelled" | "execution_error"; error: string };

const OUT_DIR = "graph-out";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const VIS_NETWORK_SOURCE = fileURLToPath(
	new URL("../../assets/vis-network.min.js", import.meta.url),
);

function copyVisualizationAsset(outputDir: string): void {
	copyFileSync(VIS_NETWORK_SOURCE, join(outputDir, VIS_NETWORK_ASSET));
}

export const MindplaceBuildTool = {
	name: "mindplace_build",
	label: "Build Mind Place",
	description:
		"Scan the current project and build a knowledge graph of all code entities (functions, classes, imports). Supports JavaScript, TypeScript, Python, Go, C#, Bash, JSON, and more. The graph is persisted to graph-out/ for optional queries across sessions.",
	promptSnippet: "Optionally build a local code navigation graph",
	parameters: Type.Object({
		path: Type.Optional(
			Type.String({ description: "Project root path. Defaults to cwd." }),
		),
		force: Type.Optional(
			Type.Boolean({
				description: "Force rebuild ignoring cache",
				default: false,
			}),
		),
		directed: Type.Optional(
			Type.Boolean({
				description: "Build directed graph (preserve edge direction)",
				default: false,
			}),
		),
		noViz: Type.Optional(
			Type.Boolean({ description: "Skip HTML visualization", default: false }),
		),
		noReport: Type.Optional(
			Type.Boolean({ description: "Skip GRAPH_REPORT.md", default: false }),
		),
		update: Type.Optional(
			Type.Boolean({
				description: "Incremental update — only re-extract changed files",
				default: false,
			}),
		),
		autoIgnore: Type.Optional(
			Type.Boolean({ description: "Add graph-out/ to .gitignore when needed (default true; false for read-only/review builds)", default: true }),
		),
	}),
	async execute(
		_toolCallId: string,
		params: {
			path?: string;
			force?: boolean;
			directed?: boolean;
			noViz?: boolean;
			noReport?: boolean;
			update?: boolean;
			autoIgnore?: boolean;
		},
		signal: AbortSignal,
		_onUpdate: (update: unknown) => void,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<MindplaceBuildDetails>> {
		const root = normalizeProjectRoot(ctx.cwd, params.path);
		const outFile = join(root, OUT_DIR, "graph.json");
		const graphExists = existsSync(outFile);
		let spinner: ReturnType<typeof setInterval> | undefined;
		markBuildInProgress(root);

		try {
			let gitignoreStatus = "";
			if (
				graphExists && params.autoIgnore !== false &&
				!isGraphOutputIgnoredAtRoot(root) && addGraphOutputToGitignore(root)
			) gitignoreStatus = `Added \`graph-out/\` to \`.gitignore\`.`;

			if (!params.force && !params.update && graphExists) {
				const statusSuffix = gitignoreStatus ? `\n\n${gitignoreStatus}` : "";
				return {
					content: [
						{
							type: "text" as const,
							text: `Knowledge graph already exists at \`${outFile}\`. Use \`force=true\` to rebuild or \`update=true\` for incremental update.${statusSuffix}`,
						},
					],
					details: { skipped: true },
				};
			}

			if (ctx.hasUI) {
				let frame = 0;
				const showSpinner = () => {
					ctx.ui.setStatus(
						"mindplace-build",
						ctx.ui.theme.fg(
							"accent",
							`${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]} Building Mind Place...`,
						),
					);
				};
				showSpinner();
				spinner = setInterval(showSpinner, 100);
			}

			// Step 1: Detect
			_onUpdate({
				content: [
					{ type: "text" as const, text: "⠋ Scanning source files..." },
				],
				details: { stage: "detecting" },
			});
			const detected = detect(root);
			if (detected.files.length === 0) {
				const exts = Object.keys({
					".js": 1,
					".ts": 1,
					".py": 1,
					".go": 1,
					".sh": 1,
					".json": 1,
				}).join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `No supported code files found in ${root}. Supported: ${exts}`,
						},
					],
					details: { status: "no_supported_source", totalFiles: 0, scanComplete: detected.scanComplete, warnings: detected.warnings },
				};
			}

			// Fingerprint sources before extraction so a source edit during the build
			// makes the persisted graph report stale instead of being recorded as fresh.
			const freshnessMetadata = makeGraphMetadata(root, detected);
			if (!freshnessMetadata.scanComplete) throw new Error("Could not establish a complete source inventory before build; no current graph was published.");

			// Step 2: Extract with cache — report progress
			const cacheDir = join(root, OUT_DIR, "cache");
			const totalToExtract = detected.files.length;
			let lastReported = 0;

			const extResult = await extractAsync(
				root,
				detected.files,
				cacheDir,
				params.force,
				(done) => {
					if (done - lastReported >= 10 || done === totalToExtract) {
						lastReported = done;
						_onUpdate({
							content: [
								{
									type: "text" as const,
									text: `🔍 Extracting... ${done}/${totalToExtract} files`,
								},
							],
							details: { stage: "extracting", done, total: totalToExtract },
						});
					}
				},
				signal,
			);

			if (signal.aborted) {
				return { content: [{ type: "text" as const, text: "Mind Place build cancelled before graph output was written." }], details: { status: "cancelled", root } };
			}
			if (extResult.nodes.length === 0) {
				return {
					content: [{ type: "text" as const, text: `No graph entities could be extracted from ${detected.totalFiles} supported files. No graph/report/visualization was written. See diagnostics for skipped files.` }],
					details: { status: "empty_extraction", root, detectedFiles: detected.totalFiles, extractedFiles: extResult.extracted, cachedFiles: extResult.cached, skippedFiles: extResult.skippedFiles, diagnostics: extResult.diagnostics },
				};
			}

			if (
				params.autoIgnore !== false &&
				!isGraphOutputIgnoredAtRoot(root) &&
				addGraphOutputToGitignore(root)
			) {
				gitignoreStatus = `Added \`graph-out/\` to \`.gitignore\`.`;
			}

			// Step 3: Rebuild from the complete cached-plus-fresh extraction result.
			// `extract` re-parses only changed files, while rebuilding prevents stale
			// nodes/edges from deleted or changed files and avoids duplicate edges.
			const kg = KnowledgeGraph.fromExtraction(extResult, params.directed);

			// Step 4: Analyze
			kg.computeCentrality();
			kg.detectCommunities();
			const stats = kg.stats();

			// Verify the supported-source inventory again after extraction. A detected edit
			// fails closed rather than publishing a graph as current.
			const postBuildMetadata = makeGraphMetadata(root, detect(root));
			if (!postBuildMetadata.scanComplete || JSON.stringify(postBuildMetadata.inventory) !== JSON.stringify(freshnessMetadata.inventory)) {
				throw new Error("Supported sources changed during build; no graph was published. Retry the build.");
			}

			// Step 5: Atomically publish the complete graph JSON.
			mkdirSync(join(root, OUT_DIR), { recursive: true });
			const tempFile = `${outFile}.${process.pid}.${randomUUID()}.tmp`;
			try {
				writeFileSync(tempFile, JSON.stringify({ ...kg.toJSON() as object, mindplace: freshnessMetadata }, null, 2), "utf-8");
				renameSync(tempFile, outFile);
			} finally {
				try { unlinkSync(tempFile); } catch { /* renamed or already absent */ }
			}

			let reportPath = "";
			let htmlPath = "";

			// Step 6: Report
			if (!params.noReport) {
				const report = generateReport(
					kg,
					stats,
					root,
					detected.totalFiles,
					detected.byExtension,
				);
				reportPath = join(root, OUT_DIR, "GRAPH_REPORT.md");
				writeFileSync(reportPath, report, "utf-8");
			}

			// Step 7: HTML
			if (!params.noViz && stats.nodeCount <= 5000) {
				const outputDir = join(root, OUT_DIR);
				const html = generateHtml(
					kg,
					root.split(/[\\/]/).pop() ?? "Mind Place",
				);
				htmlPath = join(outputDir, "graph.html");
				copyVisualizationAsset(outputDir);
				writeFileSync(htmlPath, html, "utf-8");
			}

			// Build summary
			const filesLine =
				extResult.cached > 0
					? `${extResult.cached} cached, ${extResult.extracted} extracted`
					: `${extResult.extracted} extracted`;

			const outputs: string[] = [
				`🧠 **Mind Place built!**`,
				``,
				`| Metric | Value |`,
				`|--------|-------|`,
				`| Files | ${detected.totalFiles} (${filesLine}) |`,
				`| Languages | ${
					Object.entries(detected.byExtension)
						.map(([e, n]) => `\`${e}\`×${n}`)
						.join(", ") || "none"
				} |`,
				`| Nodes | ${stats.nodeCount} |`,
				`| Edges | ${stats.edgeCount} |`,
				`| Communities | ${stats.communityCount} |`,
				`| Mode | ${params.directed ? "directed" : "undirected"} |`,
				`| Skipped files | ${extResult.skippedFiles} |`,
				`| Extraction diagnostics | ${extResult.diagnostics.length} |`,
			];

			if (reportPath)
				outputs.push(`| Report | \`${OUT_DIR}/GRAPH_REPORT.md\` |`);
			if (htmlPath)
				outputs.push(`| Visualization | \`${OUT_DIR}/graph.html\` |`);
			outputs.push(`| Graph | \`${OUT_DIR}/graph.json\` |`);

			if (stats.godNodes.length > 0) {
				outputs.push(``);
				outputs.push(`### 🏛️ God Nodes`);
				stats.godNodes.forEach((n, i) => {
					outputs.push(`${i + 1}. **${n.label}** — ${n.degree} connections`);
				});
			}

			if (extResult.diagnostics.length > 0) {
				outputs.push(``, `### Extraction diagnostics`);
				for (const diagnostic of extResult.diagnostics.slice(0, 8)) outputs.push(`- ${diagnostic.file}: ${diagnostic.reason} — ${diagnostic.message}`);
				if (extResult.diagnostics.length > 8) outputs.push(`- … ${extResult.diagnostics.length - 8} more diagnostics in tool details.`);
			}
			if (gitignoreStatus) {
				outputs.push(``);
				outputs.push(gitignoreStatus);
			}

			outputs.push(``);
			outputs.push(
				`Use \`mindplace_query\` to explore. Try: "What are the main modules?"`,
			);

			return {
				content: [{ type: "text" as const, text: outputs.join("\n") }],
				details: {
					...stats,
					cachedFiles: extResult.cached,
					extractedFiles: extResult.extracted,
					status: extResult.diagnostics.length > 0 || !detected.scanComplete ? "partial" : "complete",
					scanComplete: detected.scanComplete,
					scanLimited: detected.scanLimited,
					warnings: detected.warnings,
					diagnostics: extResult.diagnostics,
					cacheHits: extResult.cached,
					skippedFiles: extResult.skippedFiles,
				},
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Failed to build mind place: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				details: { status: signal.aborted || String(err).includes("cancelled") ? "cancelled" : "execution_error", error: String(err) },
				isError: true,
			};
		} finally {
			clearBuildInProgress(root);
			if (spinner) clearInterval(spinner);
			if (ctx.hasUI) ctx.ui.setStatus("mindplace-build", undefined);
		}
	},
};
