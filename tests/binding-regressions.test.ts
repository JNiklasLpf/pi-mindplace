import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "../src/extract.ts";
import { KnowledgeGraph } from "../src/graph.ts";
import { query } from "../src/query.ts";

const roots: string[] = [];
function project(): string { const root = mkdtempSync(join(tmpdir(), "mindplace-binding-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("conservative call binding", () => {
 it("binds C# same-class unqualified and this calls to actual members", () => {
  const root = project();
  writeFileSync(join(root, "Runner.cs"), "class Runner { void Run() { Helper(); this.Also(); } void Helper() {} void Also() {} }");
  const result = extract(root, ["Runner.cs"]);
  const run = result.nodes.find(node => node.label === "Runner.Run")!;
  const helper = result.nodes.find(node => node.label === "Runner.Helper")!;
  const also = result.nodes.find(node => node.label === "Runner.Also")!;
  assert.ok(result.edges.some(edge => edge.source === run.id && edge.target === helper.id && edge.relation === "calls"));
  assert.ok(result.edges.some(edge => edge.source === run.id && edge.target === also.id && edge.relation === "calls"));
 });

 it("binds TypeScript named aliases, default imports, and namespace members project-locally", () => {
  const root = project();
  writeFileSync(join(root, "helper.ts"), "export function namedHelper() {}\nfunction defaultHelper() {}\nexport default defaultHelper;\n");
  writeFileSync(join(root, "main.ts"), "import { namedHelper as alias } from './helper';\nimport defaultHelper from './helper';\nimport * as helpers from './helper';\nexport function run() { alias(); defaultHelper(); helpers.namedHelper(); }\n");
  const result = extract(root, ["main.ts", "helper.ts"]);
  const run = result.nodes.find(node => node.sourceFile === "main.ts" && node.label === "run")!;
  const target = result.nodes.find(node => node.sourceFile === "helper.ts" && node.label === "namedHelper")!;
  const defaultTarget = result.nodes.find(node => node.sourceFile === "helper.ts" && node.label === "defaultHelper")!;
  const calls = result.edges.filter(edge => edge.source === run.id && edge.relation === "calls");
  assert.equal(calls.filter(edge => edge.target === target.id).length, 2, "alias and namespace member bind to the named declaration");
  assert.ok(calls.some(edge => edge.target === defaultTarget.id), "default import binds its exported declaration");
 });

 it("leaves overloaded C# calls unresolved with a diagnostic instead of guessing", () => {
  const root = project();
  writeFileSync(join(root, "Runner.cs"), "class Runner { void Run() { Helper(); External(); } void Helper() {} void Helper(int value) {} }");
  const result = extract(root, ["Runner.cs"]);
  const run = result.nodes.find(node => node.label === "Runner.Run")!;
  assert.ok(!result.edges.some(edge => edge.source === run.id && edge.relation === "calls"), "unresolved overloads must not produce ghost call edges");
  assert.ok(result.diagnostics?.some(diagnostic => diagnostic.reason === "unresolved_reference" && diagnostic.referenceStatus === "ambiguous"));
  assert.ok(result.diagnostics?.some(diagnostic => diagnostic.reason === "unresolved_reference" && diagnostic.message.includes("External")));
 });

 it("binds C# qualified calls, unique bases, and namespace imports across files in the finished graph", () => {
  const root = project();
  writeFileSync(join(root, "Base.cs"), "namespace Shared; public class Base { public static void Helper() {} }");
  writeFileSync(join(root, "Derived.cs"), "using Shared; namespace Client; public class Derived : Base { public void Run() { Base.Helper(); } }");
  const extracted = extract(root, ["Derived.cs", "Base.cs"]); const graph = KnowledgeGraph.fromExtraction(extracted);
  const base = [...graph.nodes.values()].find(node => node.label === "Shared.Base")!;
  const helper = [...graph.nodes.values()].find(node => node.label === "Shared.Base.Helper")!;
  const derived = [...graph.nodes.values()].find(node => node.label === "Client.Derived")!;
  const run = [...graph.nodes.values()].find(node => node.label === "Client.Derived.Run")!;
  const shared = [...graph.nodes.values()].find(node => node.type === "namespace" && node.label === "Shared")!;
  assert.ok(graph.edges.some(edge => edge.source === derived.id && edge.target === base.id && edge.relation === "inherits"));
  assert.ok(graph.edges.some(edge => edge.source === run.id && edge.target === helper.id && edge.relation === "calls"));
  const derivedFile = [...graph.nodes.values()].find(node => node.type === "file" && node.sourceFile === "Derived.cs")!;
  assert.ok(graph.edges.some(edge => edge.source === derivedFile.id && edge.target === shared.id && edge.relation === "imports"));
  assert.ok(graph.edges.every(edge => graph.nodes.has(edge.source) && graph.nodes.has(edge.target)), "finished graph must retain only real endpoints");
 });

 it("resolves C# namespace aliases and static imports while diagnosing duplicate names and dynamic receivers", () => {
  const root = project();
  writeFileSync(join(root, "A.cs"), "namespace A; public class Worker { public static void Go() {} }");
  writeFileSync(join(root, "B.cs"), "namespace B; public class Worker { public static void Go() {} }");
  writeFileSync(join(root, "Caller.cs"), "using Alias = A; using static A.Worker; namespace Client; class Runner { void Run() { Alias.Worker.Go(); Go(); Worker.Go(); unknown.Go(); } }");
  const extracted = extract(root, ["Caller.cs", "A.cs", "B.cs"]); const graph = KnowledgeGraph.fromExtraction(extracted);
  const run = [...graph.nodes.values()].find(node => node.label === "Client.Runner.Run")!;
  const goA = [...graph.nodes.values()].find(node => node.label === "A.Worker.Go")!;
  assert.equal(graph.edges.filter(edge => edge.source === run.id && edge.target === goA.id && edge.relation === "calls").length, 1, "namespace alias and static import both bind to the same project method edge");
  assert.ok(!graph.edges.some(edge => edge.source === run.id && graph.nodes.get(edge.target)?.label === "B.Worker.Go"));
  assert.ok(graph.edges.some(edge => edge.source === run.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.label === "A.Worker.Go"));
  assert.ok(graph.edges.every(edge => graph.nodes.has(edge.source) && graph.nodes.has(edge.target)));
  assert.ok(extracted.diagnostics.some(diagnostic => diagnostic.referenceStatus === "ambiguous" && diagnostic.message.includes("Worker.Go")));
  assert.ok(extracted.diagnostics.some(diagnostic => diagnostic.referenceStatus === "dynamic" && diagnostic.message.includes("unknown.Go")));
 });

 it("coalesces partial type identity and invalidates project binding when a declaration moves", () => {
  const root = project(); const cache = join(root, "cache");
  writeFileSync(join(root, "Runner.cs"), "namespace App; partial class Runner { void Run() { Helper(); } }");
  writeFileSync(join(root, "Part.cs"), "namespace App; partial class Runner { void Helper() {} }");
  let result = extract(root, ["Runner.cs", "Part.cs"], cache); let graph = KnowledgeGraph.fromExtraction(result);
  const typeNodes = [...graph.nodes.values()].filter(node => node.label === "App.Runner");
  assert.equal(typeNodes.length, 1, "partial declarations share one project type entity");
  const run = [...graph.nodes.values()].find(node => node.label === "App.Runner.Run")!;
  assert.ok(graph.edges.some(edge => edge.source === run.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.sourceFile === "Part.cs"));
  writeFileSync(join(root, "Part.cs"), "namespace App; partial class Runner { }");
  writeFileSync(join(root, "Other.cs"), "namespace App; partial class Runner { void Helper() {} }");
  result = extract(root, ["Runner.cs", "Part.cs", "Other.cs"], cache); graph = KnowledgeGraph.fromExtraction(result);
  const rebuiltRun = [...graph.nodes.values()].find(node => node.label === "App.Runner.Run")!;
  const rebuiltCall = graph.edges.find(edge => edge.source === rebuiltRun.id && edge.relation === "calls");
  assert.equal(graph.nodes.get(rebuiltCall?.target ?? "")?.sourceFile, "Other.cs", "rebinding follows the moved declaration rather than a stale cached edge");
 });

 it("assigns nested TS/JS function and arrow calls to distinct innermost owners", () => {
  const root = project();
  writeFileSync(join(root, "nested.ts"), "function leaf() {}\nfunction first() { function inner() { leaf(); } inner(); }\nfunction second() { function inner() { leaf(); } inner(); }\nconst arrow = () => { leaf(); };\nfunction invokesArrow() { arrow(); }\nclass Box { method() { leaf(); } }\n");
  const graph = KnowledgeGraph.fromExtraction(extract(root, ["nested.ts"]));
  const inners = [...graph.nodes.values()].filter(node => node.type === "function" && node.label.endsWith(".inner"));
  assert.equal(inners.length, 2); assert.notEqual(inners[0].id, inners[1].id);
  for (const inner of inners) assert.ok(graph.edges.some(edge => edge.source === inner.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.label === "leaf"));
  const first = [...graph.nodes.values()].find(node => node.label === "first")!;
  assert.ok(graph.edges.some(edge => edge.source === first.id && graph.nodes.get(edge.target)?.label === inners.find(node => node.label.startsWith("first."))?.label), "outer-to-inner call binds to the nested owner");
  assert.ok(!graph.edges.some(edge => edge.source === first.id && graph.nodes.get(edge.target)?.label === "leaf"), "nested body calls must not be attributed again to the parent");
  const arrow = [...graph.nodes.values()].find(node => node.label === "arrow")!;
  const method = [...graph.nodes.values()].find(node => node.label === "Box.method")!;
  assert.ok(graph.edges.some(edge => edge.source === arrow.id && edge.relation === "calls"));
  const invokesArrow = [...graph.nodes.values()].find(node => node.label === "invokesArrow")!;
  assert.ok(graph.edges.some(edge => edge.source === invokesArrow.id && edge.target === arrow.id && edge.relation === "calls"));
  assert.ok(graph.edges.some(edge => edge.source === method.id && edge.relation === "calls"));
 });

 it("attributes C# local-function and lambda calls to their innermost callable", () => {
  const root = project();
  writeFileSync(join(root, "Nested.cs"), "class Runner { void Run() { void Local() { Helper(); } Local(); System.Action action = () => Helper(); Use(() => Helper()); Use(delegate { Helper(); }); } void Use(System.Action action) {} void Helper() {} }");
  const graph = KnowledgeGraph.fromExtraction(extract(root, ["Nested.cs"]));
  const run = [...graph.nodes.values()].find(node => node.label === "Runner.Run")!;
  const local = [...graph.nodes.values()].find(node => node.type === "function" && node.label.includes(".Local@"))!;
  const lambda = [...graph.nodes.values()].find(node => node.type === "function" && node.label.includes(".lambda@"))!;
  const helper = [...graph.nodes.values()].find(node => node.label === "Runner.Helper")!;
  assert.ok(graph.edges.some(edge => edge.source === run.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.label.endsWith("Local@L1")));
  assert.ok(graph.edges.some(edge => edge.source === local.id && edge.target === helper.id && edge.relation === "calls"));
  assert.ok(graph.edges.some(edge => edge.source === lambda.id && edge.target === helper.id && edge.relation === "calls"));
  const callbackOwners = [...graph.nodes.values()].filter(node => node.type === "function" && (node.label.includes(".lambda@") || node.label.includes(".anonymous@")));
  assert.ok(callbackOwners.length >= 3, "inline lambda and anonymous-method callbacks get callable owners");
  for (const callback of callbackOwners) assert.ok(graph.edges.some(edge => edge.source === callback.id && edge.target === helper.id && edge.relation === "calls"), "callback body calls belong to that callback");
  assert.ok(!graph.edges.some(edge => edge.source === run.id && edge.target === helper.id && edge.relation === "calls"));
 });

 it("keeps distinct relation kinds and opposite directions in selected query output", () => {
  const result = { nodes: [
   { id: "a", label: "Alpha", type: "function", sourceFile: "a.ts" },
   { id: "b", label: "Beta", type: "function", sourceFile: "b.ts" },
  ], edges: [
   { source: "a", target: "b", relation: "calls", confidence: "INFERRED" as const },
   { source: "a", target: "b", relation: "imports", confidence: "EXTRACTED" as const },
   { source: "b", target: "a", relation: "calls", confidence: "INFERRED" as const },
  ] };
  const graph = KnowledgeGraph.fromExtraction(result); const selected = query(graph, "Alpha Beta", 1000, "bfs", 0);
  assert.equal(selected.edges.length, 3);
  assert.equal(new Set(selected.edges.map(edge => `${edge.source}:${edge.relation}:${edge.target}`)).size, 3);
 });

 it("does not reuse a cached TS/JS import binding after the target becomes ambiguous", () => {
  const root = project(), cache = join(root, "cache");
  writeFileSync(join(root, "a.ts"), "import { target } from './b';\nexport function run() { target(); }\n");
  writeFileSync(join(root, "b.ts"), "export function target() {}\n");
  let graph = KnowledgeGraph.fromExtraction(extract(root, ["a.ts", "b.ts"], cache));
  let run = [...graph.nodes.values()].find(node => node.label === "run")!;
  assert.ok(graph.edges.some(edge => edge.source === run.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.sourceFile === "b.ts"), "first build binds the named import");
  writeFileSync(join(root, "b.ts"), "export function target() {}\nclass K { target() {} }\n");
  graph = KnowledgeGraph.fromExtraction(extract(root, ["a.ts", "b.ts"], cache));
  run = [...graph.nodes.values()].find(node => node.label === "run")!;
  assert.ok(!graph.edges.some(edge => edge.source === run.id && edge.relation === "calls"), "ambiguous rebuilt target must not keep the stale cached edge");
 });

 it("does not bind qualified calls whose qualifier is not a project namespace or type", () => {
  const root = project();
  writeFileSync(join(root, "A.cs"), "namespace A; public class Worker { public static void Go() {} }");
  writeFileSync(join(root, "Caller.cs"), "namespace Client; class Runner { void Run() { Other.Worker.Go(); A.Nonexistent.Worker.Go(); } }");
  const extracted = extract(root, ["Caller.cs", "A.cs"]); const graph = KnowledgeGraph.fromExtraction(extracted);
  const run = [...graph.nodes.values()].find(node => node.label === "Client.Runner.Run")!;
  assert.ok(!graph.edges.some(edge => edge.source === run.id && edge.relation === "calls"), "inconsistent qualifiers must not suffix-match A.Worker.Go, even when the first segment is known");
  assert.ok(extracted.diagnostics.some(diagnostic => diagnostic.message.includes("Other.Worker.Go")));
  assert.ok(extracted.diagnostics.some(diagnostic => diagnostic.message.includes("A.Nonexistent.Worker.Go")));
 });

 it("does not bind unqualified C# calls to a same-namespace member of an unrelated class", () => {
  const root = project();
  writeFileSync(join(root, "N.cs"), "namespace N; class Other { public static void Helper() {} } class Runner { void Run() { Helper(); } }");
  const graph = KnowledgeGraph.fromExtraction(extract(root, ["N.cs"]));
  const run = [...graph.nodes.values()].find(node => node.label === "N.Runner.Run")!;
  assert.ok(!graph.edges.some(edge => edge.source === run.id && edge.relation === "calls"), "Helper is not a member of Runner or a static import");
 });

 it("attributes TS/JS callbacks passed as call arguments to each innermost owner", () => {
  const root = project();
  writeFileSync(join(root, "callbacks.ts"), "function leaf() {}\nfunction register(callback: () => void) {}\nfunction run() { register(() => { leaf(); }); register(function () { leaf(); }); }\n");
  const result = extract(root, ["callbacks.ts"]); const graph = KnowledgeGraph.fromExtraction(result);
  const run = [...graph.nodes.values()].find(node => node.label === "run")!;
  const callbacks = [...graph.nodes.values()].filter(node => node.type === "function" && (node.label.includes("anonymous@L3") || node.label.includes("run.anonymous@L3")));
  assert.equal(callbacks.length, 2, "arrow and function-expression callback owners are both represented");
  for (const callback of callbacks) assert.ok(graph.edges.some(edge => edge.source === callback.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.label === "leaf"));
  assert.ok(!graph.edges.some(edge => edge.source === run.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.label === "leaf"), "callback body calls are not also attributed to the enclosing function");
  assert.equal(result.diagnostics.filter(diagnostic => diagnostic.reason === "unsupported_callable").length, 0);
 });

 it("attributes C# method expression bodies and diagnoses unsupported callable bodies", () => {
  const root = project();
  writeFileSync(join(root, "Expressions.cs"), "class Runner { System.Func<int> callback = () => Helper(); void Run() => Helper(); int Value => Helper(); public static Runner operator +(Runner left, Runner right) => Create(); int Helper() => 1; static Runner Create() => new Runner(); }");
  const result = extract(root, ["Expressions.cs"]); const graph = KnowledgeGraph.fromExtraction(result);
  const run = [...graph.nodes.values()].find(node => node.label === "Runner.Run")!;
  const helper = [...graph.nodes.values()].find(node => node.label === "Runner.Helper")!;
  assert.ok(graph.edges.some(edge => edge.source === run.id && edge.target === helper.id && edge.relation === "calls"), "expression-bodied ordinary methods are supported");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "unsupported_callable" && diagnostic.message.includes("property/indexer accessor")), "expression-bodied property calls are disclosed");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "unsupported_callable" && diagnostic.message.includes("operator")), "operator callable calls are disclosed");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "unsupported_callable" && diagnostic.message.includes("field initializer callback")), "field-initializer lambdas are disclosed rather than dropped");
  const create = [...graph.nodes.values()].find(node => node.label === "Runner.Create")!;
  assert.ok(!graph.edges.some(edge => edge.target === create.id && edge.relation === "calls"), "unsupported operator body does not emit a guessed owner edge");
 });

 it("records unsupported TS/JS object-literal methods and attributes abstract class method calls", () => {
  const root = project();
  writeFileSync(join(root, "forms.ts"), "function leaf() {}\nconst obj = { m() { leaf(); } };\nconst Holder = class { method() { leaf(); } };\nfunction generatorRun() { consume(function* () { leaf(); }); }\nabstract class Base { run() { leaf(); } }\n");
  const result = extract(root, ["forms.ts"]); const graph = KnowledgeGraph.fromExtraction(result);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "unsupported_callable" && diagnostic.message.includes("object literal method")));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "unsupported_callable" && diagnostic.message.includes("class expression")));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.reason === "unsupported_callable" && diagnostic.message.includes("generator function expression")));
  assert.equal(result.skippedFiles, 0, "unsupported callable diagnostics do not count as skipped files");
  const generatorRun = [...graph.nodes.values()].find(node => node.label === "generatorRun")!;
  assert.ok(!graph.edges.some(edge => edge.source === generatorRun.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.label === "leaf"), "unsupported generator callback calls do not leak to the enclosing function");
  const run = [...graph.nodes.values()].find(node => node.label === "Base.run")!;
  assert.ok(graph.edges.some(edge => edge.source === run.id && edge.relation === "calls" && graph.nodes.get(edge.target)?.label === "leaf"));
 });
});
