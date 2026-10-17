import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { detect } from "./detect.ts";
import { graphFilePath } from "./paths.ts";
import type { DetectResult } from "./types.ts";

export const GRAPH_METADATA_VERSION = 3;
export interface GraphMetadata {
	schemaVersion: number;
	root: string;
	scanComplete: boolean;
	inventory: Record<string, { size: number; mtimeMs: number; sha256: string }>;
}
export type GraphStatus = "not_built" | "unknown" | "stale" | "verified_current" | "verification_in_progress";
export interface FreshnessCounters {
	passivePrompts: number; sourceWalks: number; sourceFiles: number; sourceReads: number;
	sourceBytes: number; sourceHashes: number; graphReads: number; graphBytes: number;
	graphParses: number; rankings: number;
}
const counters: FreshnessCounters = { passivePrompts: 0, sourceWalks: 0, sourceFiles: 0, sourceReads: 0, sourceBytes: 0, sourceHashes: 0, graphReads: 0, graphBytes: 0, graphParses: 0, rankings: 0 };
export function getFreshnessCounters(): Readonly<FreshnessCounters> { return { ...counters }; }
export function resetFreshnessCounters(): void { for (const key of Object.keys(counters) as (keyof FreshnessCounters)[]) counters[key] = 0; }
export function recordPassivePrompt(): void { counters.passivePrompts++; }
export function recordRanking(): void { counters.rankings++; }
function sha256(data: Buffer): string { return createHash("sha256").update(data).digest("hex"); }
function readAndHashSource(path: string): { size: number; mtimeMs: number; sha256: string } {
	const before = statSync(path);
	const bytes = readFileSync(path);
	counters.sourceReads++; counters.sourceBytes += bytes.byteLength; counters.sourceHashes++;
	const after = statSync(path);
	if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error(`Source changed during verification: ${path}`);
	return { size: after.size, mtimeMs: after.mtimeMs, sha256: sha256(bytes) };
}
export interface InspectGraphDependencies {
	detect?: typeof detect;
	readSource?: typeof readAndHashSource;
}
export function makeGraphMetadata(root: string, detected: DetectResult): GraphMetadata {
	const inventory: GraphMetadata["inventory"] = {};
	let complete = detected.scanComplete !== false && !detected.scanLimited;
	for (const file of detected.files) {
		try { inventory[file] = readAndHashSource(resolve(root, file)); }
		catch { complete = false; }
	}
	return { schemaVersion: GRAPH_METADATA_VERSION, root: resolve(root), scanComplete: complete, inventory };
}

// One-entry caches are intentionally bounded: a root/content generation change replaces them.
let parsedGraphCache: { root: string; path: string; sha256: string; data: unknown } | undefined;
const verifyingRoots = new Set<string>();
const activeBuilds = new Map<string, number>();
export function markBuildInProgress(rootPath: string): void { const root = resolve(rootPath); activeBuilds.set(root, (activeBuilds.get(root) ?? 0) + 1); }
export function clearBuildInProgress(rootPath: string): void { const root = resolve(rootPath); const count = activeBuilds.get(root) ?? 0; if (count <= 1) activeBuilds.delete(root); else activeBuilds.set(root, count - 1); }
export function inspectGraph(rootPath: string, dependencies: InspectGraphDependencies = {}): {
	path: string; status: GraphStatus; metadata?: GraphMetadata; detail?: string;
	graphData?: unknown; graphHash?: string; sourceFiles?: number; verifiedFiles?: number;
} {
	const root = resolve(rootPath); const path = graphFilePath(root);
	const detectSources = dependencies.detect ?? detect;
	const readSource = dependencies.readSource ?? readAndHashSource;
	if (verifyingRoots.has(root) || activeBuilds.has(root)) return { path, status: "verification_in_progress", detail: "Verification or build is already in progress for this root." };
	if (!existsSync(path)) return { path, status: "not_built", detail: "No graph has been built for this root." };
	verifyingRoots.add(root);
	try {
		let bytes: Buffer; let raw: unknown; let graphHash: string;
		try {
			bytes = readFileSync(path); counters.graphReads++; counters.graphBytes += bytes.byteLength;
			graphHash = sha256(bytes);
			if (parsedGraphCache?.root === root && parsedGraphCache.path === path && parsedGraphCache.sha256 === graphHash) raw = parsedGraphCache.data;
			else { raw = JSON.parse(bytes.toString("utf-8")); counters.graphParses++; parsedGraphCache = { root, path, sha256: graphHash, data: raw }; }
		} catch (error) { return { path, status: "unknown", detail: `Graph load failed: ${String(error)}` }; }
		if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).nodes) || !Array.isArray((raw as any).edges)) return { path, status: "unknown", detail: "Incompatible graph JSON: expected nodes and edges arrays." };
		const metadata = (raw as any).mindplace as GraphMetadata | undefined;
		if (!metadata || metadata.schemaVersion !== GRAPH_METADATA_VERSION || metadata.scanComplete !== true || typeof metadata.root !== "string" || !metadata.inventory || typeof metadata.inventory !== "object" || Array.isArray(metadata.inventory)) {
			return { path, status: "unknown", metadata, detail: "Legacy or incomplete freshness metadata; rebuild to establish status.", graphData: raw, graphHash };
		}
		if (resolve(metadata.root) !== root) return { path, status: "unknown", metadata, detail: "Graph freshness metadata belongs to a different project root.", graphData: raw, graphHash };
		if (Object.values(metadata.inventory).some(entry => !entry || typeof entry.size !== "number" || typeof entry.mtimeMs !== "number" || typeof entry.sha256 !== "string")) return { path, status: "unknown", metadata, detail: "Freshness inventory is malformed.", graphData: raw, graphHash };
		let current: DetectResult;
		try { counters.sourceWalks++; current = detectSources(root); }
		catch (error) { return { path, status: "unknown", metadata, detail: `Source scan failed: ${String(error)}`, graphData: raw, graphHash }; }
		counters.sourceFiles += current.files.length;
		if (!current.scanComplete || current.scanLimited) return { path, status: "unknown", metadata, detail: "Source scan was incomplete or limited.", graphData: raw, graphHash, sourceFiles: current.files.length };
		const expected = Object.keys(metadata.inventory).sort();
		if (current.files.length !== expected.length || current.files.some((file, i) => file !== expected[i])) return { path, status: "stale", metadata, detail: "Supported source file membership changed.", graphData: raw, graphHash, sourceFiles: current.files.length };
		let verifiedFiles = 0;
		for (const file of current.files) {
			// Unreadable or changed-while-reading files are unknown, never stale or an escaped exception.
			let observed: ReturnType<typeof readAndHashSource>;
			try { observed = readSource(resolve(root, file)); }
			catch (error) { return { path, status: "unknown", metadata, detail: `Source unreadable or changed during verification: ${file}: ${String(error)}`, graphData: raw, graphHash, sourceFiles: current.files.length, verifiedFiles }; }
			const prior = metadata.inventory[file]; verifiedFiles++;
			if (prior.size !== observed.size || prior.sha256 !== observed.sha256) return { path, status: "stale", metadata, detail: `Source changed: ${file}`, graphData: raw, graphHash, sourceFiles: current.files.length, verifiedFiles };
		}
		// A second membership pass catches additions/removals observed during the read interval.
		counters.sourceWalks++;
		let after: DetectResult;
		try { after = detectSources(root); }
		catch (error) { return { path, status: "unknown", metadata, detail: `Post-verification source scan failed: ${String(error)}`, graphData: raw, graphHash, sourceFiles: current.files.length, verifiedFiles }; }
		if (!after.scanComplete || after.scanLimited) return { path, status: "unknown", metadata, detail: "Post-verification source scan was incomplete.", graphData: raw, graphHash };
		if (after.files.length !== current.files.length || after.files.some((file, i) => file !== current.files[i])) return { path, status: "unknown", metadata, detail: "Source membership changed during verification.", graphData: raw, graphHash };
		// Tie the source interval to the exact graph generation. Do not trust a
		// stat/size/cache hit: hash graph bytes again before claiming current.
		let finalGraphBytes: Buffer;
		try { finalGraphBytes = readFileSync(path); counters.graphReads++; counters.graphBytes += finalGraphBytes.byteLength; }
		catch (error) { return { path, status: "unknown", metadata, detail: `Unable to revalidate graph generation: ${String(error)}`, graphData: raw, graphHash }; }
		if (sha256(finalGraphBytes) !== graphHash) return { path, status: "unknown", metadata, detail: "Graph generation changed during verification.", graphData: raw, graphHash };
		return { path, status: "verified_current", metadata, graphData: raw, graphHash, sourceFiles: current.files.length, verifiedFiles: current.files.length };
	} finally { verifyingRoots.delete(root); }
}
