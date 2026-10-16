/** pi-mindplace — advisory knowledge-graph tools for pi. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MindplaceBuildTool } from "./src/tools/mindplace-build.ts";
import { MindplaceQueryTool } from "./src/tools/mindplace-query.ts";
import { MindplaceExplainTool } from "./src/tools/mindplace-explain.ts";
import { inspectGraph, recordPassivePrompt } from "./src/graph-file.ts";
import { GRAPH_FILE_NAME, GRAPH_OUTPUT_DIR } from "./src/paths.ts";

function graphGuidance(cwd: string): string {
	recordPassivePrompt();
	const graphExists = existsSync(join(cwd, GRAPH_OUTPUT_DIR, GRAPH_FILE_NAME));
	const state = graphExists ? "not_checked" : "not_built";
	const mapNote = process.env.PI_MINDPLACE_CONTEXT === "map"
		? " PI_MINDPLACE_CONTEXT=map does not read an unverified graph; build and explicitly verify/query it to use graph content."
		: "";
	return `\n\n## Mind Place (optional navigation aid)\nFreshness: ${state}. Passive prompt guidance does not walk or read source files, hash source, or read/parse graph bytes. Use mindplace status or an explicit query/explain to verify before graph results.${mapNote} Graph use and build are optional; inspect source directly when useful.\n`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(MindplaceBuildTool);
	pi.registerTool(MindplaceQueryTool);
	pi.registerTool(MindplaceExplainTool);
	pi.on("before_agent_start", (event, ctx) => ({
		systemPrompt: event.systemPrompt + (process.env.PI_MINDPLACE_CONTEXT === "off" ? "" : graphGuidance(ctx.cwd)),
	}));
	pi.registerCommand("mindplace", {
		description: "Build, query, or verify the mind place knowledge graph",
		handler: async (args, ctx) => {
			if (args?.trim().toLowerCase() === "status") {
				const status = inspectGraph(ctx.cwd);
				const counts = status.sourceFiles === undefined ? "" : `; ${status.verifiedFiles ?? 0}/${status.sourceFiles} source files verified`;
				ctx.ui.notify(`Mind Place: ${status.status}${counts}${status.detail ? ` — ${status.detail}` : ""}`, status.status === "verified_current" ? "info" : "warning");
				return;
			}
			const graphExists = existsSync(join(ctx.cwd, GRAPH_OUTPUT_DIR, GRAPH_FILE_NAME));
			if (!args) {
				ctx.ui.notify(graphExists ? "Mind Place exists; freshness is not checked until explicit status/query/explain." : "No Mind Place yet. Building is optional; run mindplace_build if useful.", "info");
				return;
			}
			if (args === "build" || args === "rebuild") pi.sendUserMessage("Run mindplace_build only if a graph refresh is useful.", { deliverAs: "steer" });
			else pi.sendUserMessage(`Query the mind place if useful: "${args}"`, { deliverAs: "steer" });
		},
	});
}
