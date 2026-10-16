import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MindplaceBuildTool } from "../src/tools/mindplace-build.ts";
import { MindplaceQueryTool } from "../src/tools/mindplace-query.ts";

const roots: string[] = [];
function project(): string { const root = mkdtempSync(join(tmpdir(), "mindplace-build-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const context = (cwd: string) => ({ cwd, hasUI: false }) as any;
async function build(cwd: string, path = ".", params: Record<string, unknown> = {}, signal = new AbortController().signal): Promise<any> {
 return MindplaceBuildTool.execute("test", { path, force: true, noViz: true, noReport: true, ...params } as any, signal, () => {}, context(cwd));
}

describe("build statuses and explicit side effects", () => {
 it("keeps automatic ignore behavior by default and offers a read-only opt-out", async () => {
  const root = project(); writeFileSync(join(root, "source.ts"), "export function source() {}\n"); writeFileSync(join(root, ".gitignore"), "keep-me\n");
  const noEdit = await build(root, ".", { autoIgnore: false });
  assert.equal(noEdit.details.status, "complete");
  assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), "keep-me\n");
  rmSync(join(root, "graph-out"), { recursive: true, force: true });
  const defaultBuild = await build(root);
  assert.equal(defaultBuild.details.status, "complete");
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /graph-out\//);
 });

 it("fails closed when a source changes during extraction without publishing a graph", async () => {
  const root = project(); const source = join(root, "source.ts"); writeFileSync(source, "export const before = true;\\n");
  let edited = false;
  let concurrentQuery: Promise<any> | undefined;
  const result = await MindplaceBuildTool.execute("concurrent", { path: ".", force: true, noViz: true, noReport: true, autoIgnore: false }, new AbortController().signal, (update: any) => {
   if (!edited && update?.details?.stage === "extracting") {
    edited = true;
    concurrentQuery = MindplaceQueryTool.execute("during-build", { question: "before" }, new AbortController().signal, () => {}, context(root));
    writeFileSync(source, "export const after = true;\\n");
   }
  }, context(root));
  assert.equal(edited, true);
  assert.equal((await concurrentQuery).details.status, "verification_in_progress", "queries cannot borrow an older generation during a build");
  assert.ok("status" in result.details);
  assert.equal(result.details.status, "execution_error");
  assert.equal(existsSync(join(root, "graph-out", "graph.json")), false);
 });

 it("reports no supported source and cancellation without writing an empty graph", async () => {
  const empty = project();
  const noSource = await build(empty);
  assert.equal(noSource.details.status, "no_supported_source");
  assert.equal(existsSync(join(empty, "graph-out", "graph.json")), false);
  assert.equal(existsSync(join(empty, ".gitignore")), false);
  const sourceRoot = project(); writeFileSync(join(sourceRoot, "source.ts"), "export const ready = true;");
  const controller = new AbortController(); controller.abort();
  const cancelled = await build(sourceRoot, ".", {}, controller.signal);
  assert.equal(cancelled.details.status, "cancelled");
  assert.equal(existsSync(join(sourceRoot, "graph-out", "graph.json")), false);
  assert.equal(existsSync(join(sourceRoot, ".gitignore")), false);
 });
});
