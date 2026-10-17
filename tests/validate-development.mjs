import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = join(root, "tests", ".mp2-validation-scratch");
const totalTimeoutMs = 15 * 60 * 1000;
const commandTimeoutMs = 7 * 60 * 1000;
const deadline = Date.now() + totalTimeoutMs;
const isWindows = process.platform === "win32";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function run(command, args, cwd, label, useShell = isWindows) {
	const remainingMs = deadline - Date.now();
	assert(remainingMs > 0, `Validation exceeded its ${totalTimeoutMs / 60_000}-minute total time bound before ${label}.`);
	const timeout = Math.min(commandTimeoutMs, remainingMs);
	const display = [command, ...args].join(" ");
	console.log(`\n[${label}] $ ${display}\n[cwd] ${cwd}\n[timeout] ${Math.ceil(timeout / 1000)}s`);

	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, CI: "1", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false" },
			shell: useShell,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout = [];
		const stderr = [];
		const maxBuffer = 64 * 1024 * 1024;
		let bufferedBytes = 0;
		let timedOut = false;
		let overflow = false;
		let terminationError;
		let spawnError;
		let finished = false;
		let timer;
		let closeTimer;
		let forceTimer;

		function finish(error, value) {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			clearTimeout(closeTimer);
			if (error) rejectRun(error);
			else resolveRun(value);
		}

		function terminate() {
			if (!child.pid) return;
			if (isWindows) {
				// Kill the tree while the shell PID still exists, then wait for the child close event.
				const killed = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
					encoding: "utf8",
					timeout: 10_000,
				});
				if (killed.error || killed.status !== 0) {
					terminationError = `taskkill failed: ${killed.error?.message ?? killed.stderr ?? killed.status}`;
					child.kill();
				}
			} else {
				child.kill("SIGTERM");
				forceTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
				forceTimer.unref();
			}
			closeTimer = setTimeout(() => finish(new Error(`${label} did not close after termination; descendant cleanup may be incomplete.`)), 10_000);
		}

		function collect(target, chunk) {
			if (finished || timedOut || overflow) return;
			bufferedBytes += chunk.length;
			if (bufferedBytes > maxBuffer) {
				overflow = true;
				terminate();
				return;
			}
			target.push(chunk);
		}

		child.stdout.on("data", (chunk) => collect(stdout, chunk));
		child.stderr.on("data", (chunk) => collect(stderr, chunk));
		child.on("error", (error) => { spawnError = error; });
		timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, timeout);
		child.on("close", (status) => {
			clearTimeout(forceTimer);
			const out = Buffer.concat(stdout).toString("utf8");
			const err = Buffer.concat(stderr).toString("utf8");
			if (out) process.stdout.write(out);
			if (err) process.stderr.write(err);
			if (spawnError) return finish(new Error(`${label} could not start: ${spawnError.message}`));
			if (terminationError) return finish(new Error(`${label} was terminated, but process-tree cleanup was incomplete: ${terminationError}`));
			if (timedOut) return finish(new Error(`${label} exceeded its ${Math.ceil(timeout / 1000)}-second timeout.`));
			if (overflow) return finish(new Error(`${label} exceeded the 64 MiB output limit.`));
			if (status !== 0) return finish(new Error(`${label} failed with exit status ${status ?? "unknown"}.`));
			finish(undefined, `${out}\n${err}`);
		});
	});
}

function hash(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function extractTestTotals(output, label) {
	const totals = Object.fromEntries(["tests", "pass", "fail"].map((key) => {
		const match = output.match(new RegExp(`(?:ℹ|#)\\s*${key}\\s+(\\d+)`));
		return [key, match ? Number(match[1]) : null];
	}));
	assert(totals.tests !== null && totals.pass !== null && totals.fail !== null,
		`${label} passed but its Node test totals could not be read from output.`);
	console.log(`[${label} totals] ${totals.tests} tests, ${totals.pass} passed, ${totals.fail} failed`);
	return totals;
}

function isExcluded(relativePath) {
	const parts = relativePath.split(/[\\/]/);
	return parts.includes(".git") || parts.includes("node_modules") ||
		relativePath === "tests/.mp2-validation-scratch" || relativePath.startsWith("tests/.mp2-validation-scratch/");
}

async function copySnapshot(snapshotRoot) {
	const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."], {
		cwd: root,
		encoding: "buffer",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (listed.error || listed.status !== 0) throw new Error(`git ls-files failed: ${listed.error?.message ?? listed.stderr?.toString() ?? listed.status}`);
	const paths = listed.stdout.toString("utf8").split("\0").filter(Boolean);
	assert(paths.length > 0, "Git returned no tracked or non-ignored untracked files for the snapshot.");

	let copied = 0;
	for (const repoPath of paths) {
		const relPath = repoPath.replaceAll("\\", "/");
		if (isExcluded(relPath)) continue;
		const source = resolve(root, repoPath);
		const sourceRelative = relative(root, source);
		assert(sourceRelative !== ".." && !sourceRelative.startsWith(`..${sep}`) && !isAbsolute(sourceRelative),
			`Refusing path outside the checkout: ${repoPath}`);
		let info;
		try {
			info = await lstat(source);
		} catch (error) {
			if (error?.code === "ENOENT") continue; // Tracked but deleted in the intended dirty snapshot.
			throw error;
		}
		const destination = join(snapshotRoot, repoPath);
		await mkdir(dirname(destination), { recursive: true });
		if (info.isSymbolicLink()) {
			const target = await readlink(source);
			assert(!isAbsolute(target), `Refusing absolute symlink in snapshot: ${repoPath} -> ${target}`);
			const resolvedTarget = resolve(dirname(source), target);
			const targetRelative = relative(root, resolvedTarget);
			assert(targetRelative !== ".." && !targetRelative.startsWith(`..${sep}`) && !isAbsolute(targetRelative),
				`Refusing symlink outside the checkout: ${repoPath} -> ${target}`);
			await symlink(target, destination);
		} else if (info.isFile()) {
			await copyFile(source, destination);
			await chmod(destination, info.mode & 0o777);
		} else {
			throw new Error(`Unsupported non-file Git entry in snapshot: ${repoPath}`);
		}
		copied++;
	}
	assert(copied > 0, "No files were copied into the isolated snapshot.");
	console.log(`[snapshot] Copied ${copied} tracked and non-ignored untracked files; excluded .git, node_modules, and ${relative(root, scratchRoot)}.`);
}

function getGitRoot() {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
	if (result.error || result.status !== 0) throw new Error(`Cannot identify checkout root: ${result.error?.message ?? result.stderr}`);
	return realpath(resolve(result.stdout.trim()));
}

async function main() {
	assert(process.argv.length === 2, "This validator accepts no command-line arguments.");
	const canonicalRoot = await realpath(root);
	assert((await getGitRoot()) === canonicalRoot, "Run this validator from within the pi-mindplace Git checkout.");
	const nodeVersion = process.version;
	console.log(`[runtime] Node.js ${nodeVersion}`);
	await run(isWindows ? "npm.cmd" : "npm", ["--version"], root, "npm version");

	const initialPackage = await readFile(join(root, "package.json"));
	const initialLock = await readFile(join(root, "package-lock.json"));
	const initialPackageHash = hash(initialPackage);
	const initialLockHash = hash(initialLock);
	const scratchInfo = await lstat(scratchRoot).then((info) => info, (error) => {
		if (error?.code === "ENOENT") return undefined;
		throw error;
	});
	assert(!scratchInfo || (scratchInfo.isDirectory() && !scratchInfo.isSymbolicLink()),
		`Refusing to use non-directory or symlinked validator scratch path: ${scratchRoot}`);
	const scratchExisted = scratchInfo !== undefined;
	await mkdir(scratchRoot, { recursive: true });
	const canonicalScratch = await realpath(scratchRoot);
	const scratchRelative = relative(canonicalRoot, canonicalScratch);
	assert(scratchRelative !== ".." && !scratchRelative.startsWith(`..${sep}`) && !isAbsolute(scratchRelative),
		"Refusing validator scratch directory outside the checkout.");
	let runRoot;

	try {
		await run(process.execPath, ["tests/patch-pi-ai-declarations.mjs", "--self-test", scratchRoot], root,
			"declaration correction regression checks", false);
		runRoot = await mkdtemp(join(scratchRoot, "run-"));
		const snapshotRoot = join(runRoot, "snapshot");
		await mkdir(snapshotRoot, { recursive: true });
		await copySnapshot(snapshotRoot);
		await run(isWindows ? "npm.cmd" : "npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], snapshotRoot, "generate isolated package lock");
		await run(isWindows ? "npm.cmd" : "npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], snapshotRoot, "fresh isolated dependency install");
		await run(process.execPath, ["tests/patch-pi-ai-declarations.mjs"], snapshotRoot, "guarded declaration-only correction", false);
		await run(isWindows ? "npm.cmd" : "npm", ["run", "typecheck"], snapshotRoot, "full-workspace strict typecheck");
		const focused = await run(isWindows ? "npm.cmd" : "npm", ["run", "test:focused"], snapshotRoot, "focused tests");
		extractTestTotals(focused, "focused tests");
		const full = await run(isWindows ? "npm.cmd" : "npm", ["test"], snapshotRoot, "full tests");
		extractTestTotals(full, "full tests");

		assert(hash(await readFile(join(root, "package.json"))) === initialPackageHash,
			"package.json changed during validation; refusing to install a lockfile for a different snapshot.");
		assert(hash(await readFile(join(root, "package-lock.json"))) === initialLockHash,
			"package-lock.json changed during validation; refusing to overwrite a concurrent update.");
		const generatedLock = await readFile(join(snapshotRoot, "package-lock.json"));
		await writeFile(join(root, "package-lock.json"), generatedLock);
		console.log("\n[success] Fresh install, full-workspace typecheck, focused tests, and full tests passed.");
		console.log("[success] Transferred the generated snapshot lockfile to package-lock.json; no install or test ran against the checkout's node_modules.");
	} finally {
		if (runRoot) await rm(runRoot, { recursive: true, force: true });
		if (!scratchExisted) {
			await rm(scratchRoot, { recursive: true, force: true });
		}
	}
}

main().catch((error) => {
	console.error(`\n[validation failed] ${error?.stack ?? error}`);
	process.exitCode = 1;
});
