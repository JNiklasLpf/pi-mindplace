/// <reference types="node" />
/// <reference path="./tree-sitter-typescript.d.ts" />

/** Conservative tree-sitter extraction with a versioned, content-addressed cache. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TsLang from "tree-sitter-typescript/bindings/node/typescript.js";
import TsxLang from "tree-sitter-typescript/bindings/node/tsx.js";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Bash from "tree-sitter-bash";
import CSharp from "tree-sitter-c-sharp";
import Json from "tree-sitter-json";
import Java from "tree-sitter-java";
import Rust from "tree-sitter-rust";
import Cpp from "tree-sitter-cpp";
import Ruby from "tree-sitter-ruby";
import Kotlin from "@sengac/tree-sitter-kotlin";
import Scala from "tree-sitter-scala";
import type { BindingReference, ExtractionDiagnostic, ExtractionResult, GraphEdge, GraphNode } from "./types.ts";
import { CODE_EXTENSIONS } from "./types.ts";

const parser = new Parser();
type Grammar = NonNullable<Parameters<Parser["setLanguage"]>[0]>;
const GRAMMARS: Record<string, { grammar: Grammar; exts: Set<string> }> = {
 javascript: { grammar: JavaScript as Grammar, exts: new Set([".js", ".mjs", ".cjs"]) },
 typescript: { grammar: TsLang as Grammar, exts: new Set([".ts", ".mts", ".cts"]) },
 tsx: { grammar: TsxLang as Grammar, exts: new Set([".tsx", ".jsx"]) },
 python: { grammar: Python as Grammar, exts: new Set([".py", ".pyi"]) },
 go: { grammar: Go as Grammar, exts: new Set([".go"]) },
 bash: { grammar: Bash as Grammar, exts: new Set([".sh", ".bash", ".zsh"]) },
 csharp: { grammar: CSharp as Grammar, exts: new Set([".cs"]) },
 json: { grammar: Json as Grammar, exts: new Set([".json"]) },
 java: { grammar: Java as Grammar, exts: new Set([".java"]) },
 rust: { grammar: Rust as Grammar, exts: new Set([".rs"]) },
 cpp: { grammar: Cpp as Grammar, exts: new Set([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]) },
 ruby: { grammar: Ruby as Grammar, exts: new Set([".rb"]) },
 kotlin: { grammar: Kotlin as Grammar, exts: new Set([".kt", ".kts"]) },
 scala: { grammar: Scala as Grammar, exts: new Set([".scala", ".sc"]) },
};
// Version 7 invalidates caches with corrected unsupported-callable traversal/ownership; v6 changed binding and diagnostics.
export const EXTRACTION_CACHE_VERSION = "extract-schema-7/tree-sitter-0.21-grammars-lock-1";
export const MAX_SOURCE_FILE_SIZE = 1_000_000;
export const MAX_JSON_KEYS = 20;
interface CacheEntry { hash: string; version: string; nodes: GraphNode[]; edges: GraphEdge[]; diagnostics?: ExtractionDiagnostic[]; bindingReferences?: BindingReference[] }
function fileHash(data: Buffer): string { return createHash("sha256").update(data).digest("hex").slice(0, 16); }
function loadCache(dir: string): Map<string, CacheEntry> {
 const map = new Map<string, CacheEntry>(); const path = join(dir, "cache.json");
 if (!existsSync(path)) return map;
 try { const obj = JSON.parse(readFileSync(path, "utf8")); for (const [key, value] of Object.entries(obj)) map.set(key, value as CacheEntry); } catch { /* corrupt cache is a miss */ }
 return map;
}
function saveCache(dir: string, map: Map<string, CacheEntry>): void {
 mkdirSync(dir, { recursive: true }); const obj: Record<string, CacheEntry> = {};
 for (const [key, entry] of map) obj[key] = entry;
 writeFileSync(join(dir, "cache.json"), JSON.stringify(obj, null, 2), "utf8");
}
function nodeId(file: string, name: string): string { return `${file.replace(/[\\/]/g, "_").replace(/\.[^.]+$/, "")}_${name.replace(/[^a-zA-Z0-9_$]/g, "_")}`; }
function pickGrammar(file: string): Grammar | null { const ext = file.slice(file.lastIndexOf(".")); for (const item of Object.values(GRAMMARS)) if (item.exts.has(ext)) return item.grammar; return null; }
function loc(node: Parser.SyntaxNode): string { return `L${node.startPosition.row + 1}`; }
function locKey(node: Parser.SyntaxNode): string { return `${loc(node)}C${node.startPosition.column + 1}`; }
function makeFileNode(file: string): GraphNode { return { id: nodeId(file, "file"), label: file, type: "file", sourceFile: file }; }
function addSimpleNode(file: string, nodes: GraphNode[], edges: GraphEdge[], name: string, type: string, syntax: Parser.SyntaxNode, parentId = nodeId(file, "file"), identity = name): string {
 const id = nodeId(file, identity);
 if (!nodes.some(node => node.id === id)) nodes.push({ id, label: name, type, sourceFile: file, sourceLocation: loc(syntax) });
 if (!edges.some(edge => edge.source === parentId && edge.target === id && edge.relation === "contains")) edges.push({ source: parentId, target: id, relation: "contains", confidence: "EXTRACTED" });
 return id;
}
function callExpressions(root: Parser.SyntaxNode, ownerId: string, file: string, edges: GraphEdge[], skipNested = true): void {
 function visit(node: Parser.SyntaxNode, top: boolean): void {
  if (skipNested && !top && ["function_declaration", "generator_function_declaration", "function_expression", "generator_function", "arrow_function", "method_definition", "class", "local_function_statement"].includes(node.type)) return;
  if (["call_expression", "invocation_expression", "method_invocation"].includes(node.type)) {
   const callee = node.childForFieldName?.("function") ?? node.childForFieldName?.("name") ?? node.firstNamedChild;
   if (callee) edges.push({ source: ownerId, target: nodeId(file, callee.text), relation: "calls", confidence: "INFERRED", confidenceScore: 0.85 });
  }
  for (const child of node.namedChildren) visit(child, false);
 }
 visit(root, true);
}

function extractTsJs(file: string, root: string, tree: Parser.Tree): ExtractionResult {
 const diagnostics: ExtractionDiagnostic[] = [];
 const nodes: GraphNode[] = [makeFileNode(file)]; const edges: GraphEdge[] = []; const fileId = nodeId(file, "file");
 function walk(node: Parser.SyntaxNode, ownerId = fileId, ownerLabel = ""): void {
  const type = node.type;
  const unsupported = type === "generator_function" ? "generator function expression" : type === "class" ? "class expression" : type === "method_definition" && node.parent?.type === "object" ? "object literal method" : "";
  if (unsupported) {
   diagnostics.push({ file, reason: "unsupported_callable", message: `Unsupported callable form (${unsupported}) at ${loc(node)}: calls inside it are not attributed to a callable owner.` });
   return;
  }
  if (["function_declaration", "generator_function_declaration"].includes(type)) {
   const shortName = node.childForFieldName?.("name")?.text ?? "anonymous"; const label = ownerLabel ? `${ownerLabel}.${shortName}` : shortName;
   const id = addSimpleNode(file, nodes, edges, label, "function", node, ownerId, ownerLabel ? `${label}@${locKey(node)}` : label);
   callExpressions(node, id, file, edges); for (const child of node.namedChildren) walk(child, id, label); return;
  }
  if (["arrow_function", "function_expression"].includes(type)) {
   const declarator = node.parent?.type === "variable_declarator" ? node.parent : undefined;
   const shortName = declarator?.childForFieldName?.("name")?.text ?? node.childForFieldName?.("name")?.text ?? `anonymous@${loc(node)}`;
   const label = ownerLabel ? `${ownerLabel}.${shortName}` : shortName;
   const id = addSimpleNode(file, nodes, edges, label, "function", declarator ?? node, ownerId, `${label}@${locKey(node)}`);
   callExpressions(node, id, file, edges); for (const child of node.namedChildren) walk(child, id, label); return;
  }
  if (type === "class_declaration" || type === "abstract_class_declaration") {
   const name = node.childForFieldName?.("name")?.text ?? "AnonymousClass"; const label = ownerLabel ? `${ownerLabel}.${name}` : name; const id = addSimpleNode(file, nodes, edges, label, "class", node, ownerId, `${label}@${locKey(node)}`);
   for (const heritage of node.children.filter(child => child.type === "class_heritage")) for (const ident of heritage.descendantsOfType("identifier")) edges.push({ source: id, target: nodeId(file, ident.text), relation: "inherits", confidence: "EXTRACTED" });
   const body = node.namedChildren.find(child => child.type === "class_body");
   for (const member of body?.namedChildren ?? []) if (["method_definition", "public_field_definition"].includes(member.type)) {
    const memberName = member.childForFieldName?.("name")?.text ?? "unknown"; const memberLabel = `${label}.${memberName}`; const mid = addSimpleNode(file, nodes, edges, memberLabel, "method", member, id, `${memberLabel}@${locKey(member)}`);
    callExpressions(member, mid, file, edges); for (const child of member.namedChildren) walk(child, mid, memberLabel);
   }
   return;
  }
  if (type === "variable_declaration" || type === "lexical_declaration") {
   for (const decl of node.namedChildren) if (decl.type === "variable_declarator") {
    const name = decl.childForFieldName?.("name")?.text; const value = decl.childForFieldName?.("value");
    if (value && ["class", "object"].includes(value.type)) walk(value, ownerId, ownerLabel);
    if (value && ["arrow_function", "function_expression"].includes(value.type)) walk(value, ownerId, ownerLabel);
    else if (name && ["program", "export_statement"].includes(node.parent?.type ?? "")) addSimpleNode(file, nodes, edges, name, "variable", decl, ownerId, `${ownerLabel ? `${ownerLabel}.` : ""}${name}@${loc(decl)}`);
   }
   return;
  }
  if (type === "interface_declaration" || type === "type_alias_declaration" || type === "enum_declaration") {
   const name = node.childForFieldName?.("name")?.text; if (name) addSimpleNode(file, nodes, edges, name, type === "interface_declaration" ? "interface" : type === "enum_declaration" ? "enum" : "type", node, ownerId); return;
  }
  if (type === "import_statement") {
   const src = node.childForFieldName?.("source")?.text?.replace(/^['"]|['"]$/g, "");
   if (src?.startsWith(".")) { const targetFile = resolveModulePath(file, src, root); if (targetFile) {
    edges.push({ source: fileId, target: nodeId(targetFile, "file"), relation: "imports", confidence: "EXTRACTED" });
    for (const item of node.descendantsOfType("import_specifier")) { const imported = item.childForFieldName?.("name")?.text; if (imported) edges.push({ source: fileId, target: nodeId(targetFile, imported), relation: "imports", confidence: "INFERRED" }); }
   } }
   return;
  }
  for (const child of node.namedChildren) walk(child, ownerId, ownerLabel);
 }
 walk(tree.rootNode); return { nodes, edges, diagnostics };
}

function extractCSharp(file: string, tree: Parser.Tree): ExtractionResult {
 const nodes: GraphNode[] = [makeFileNode(file)]; const edges: GraphEdge[] = []; const diagnostics: ExtractionDiagnostic[] = [];
 const fileId = nodeId(file, "file"); const bindingReferences: BindingReference[] = [];
 const addEdge = (source: string, target: string, relation: GraphEdge["relation"], confidence: GraphEdge["confidence"]) => { if (!edges.some(e => e.source === source && e.target === target && e.relation === relation)) edges.push({ source, target, relation, confidence }); };
 const projectId = (kind: string, name: string) => `csharp_${kind}_${name.replace(/[^a-zA-Z0-9_$]/g, "_")}`;
 function addSharedNode(name: string, type: string, syntax: Parser.SyntaxNode, parent: string, kind: string): string {
  const id = projectId(kind, name);
  if (!nodes.some(n => n.id === id)) nodes.push({ id, label: name, type, sourceFile: file, sourceLocation: loc(syntax) });
  addEdge(parent, id, "contains", "EXTRACTED"); return id;
 }
 function addCalls(node: Parser.SyntaxNode, source: string, scope: string, ownerLabel: string): void {
  function visit(current: Parser.SyntaxNode, activeSource: string, activeLabel: string, top: boolean): void {
   if (!top && ["method_declaration", "constructor_declaration"].includes(current.type)) return;
   if (!top && ["local_function_statement", "anonymous_method_expression", "lambda_expression"].includes(current.type)) {
    const nestedName = current.type === "local_function_statement" ? current.childForFieldName?.("name")?.text ?? "local" : current.type === "lambda_expression" ? "lambda" : "anonymous";
    const label = `${activeLabel}.${nestedName}@${loc(current)}`;
    const nestedId = addSimpleNode(file, nodes, edges, label, "function", current, activeSource, `${label}@${locKey(current)}`);
    for (const child of current.namedChildren) visit(child, nestedId, label, false);
    return;
   }
   if (current.type === "invocation_expression") { const target = current.childForFieldName?.("function")?.text; if (target) bindingReferences.push({ file, source: activeSource, kind: "call", target, scope }); }
   for (const child of current.namedChildren) visit(child, activeSource, activeLabel, false);
  }
  visit(node, source, ownerLabel, true);
 }
 function walk(node: Parser.SyntaxNode, parent: string, scope: string): void {
  const unsupportedCallableTypes: Record<string, string> = { destructor_declaration: "destructor", operator_declaration: "operator", conversion_operator_declaration: "conversion operator", indexer_declaration: "indexer", accessor_declaration: "accessor" };
  const unsupportedCallable = unsupportedCallableTypes[node.type];
  if (unsupportedCallable) {
   if (node.descendantsOfType("invocation_expression").length) diagnostics.push({ file, reason: "unsupported_callable", message: `Unsupported C# callable form (${unsupportedCallable}) at ${loc(node)}: calls inside it are not attributed to a callable owner.` });
   return;
  }
  if (node.type === "compilation_unit") { let activeParent = parent, activeScope = scope; for (const child of node.namedChildren) { if (child.type === "file_scoped_namespace_declaration") { const name = child.childForFieldName?.("name")?.text ?? ""; activeParent = name ? addSharedNode(name, "namespace", child, parent, "namespace") : parent; activeScope = name; for (const nested of child.namedChildren) if (nested.type !== "identifier") walk(nested, activeParent, activeScope); } else walk(child, activeParent, activeScope); } return; }
  const name = node.childForFieldName?.("name")?.text ?? node.descendantsOfType("identifier")[0]?.text ?? "anonymous";
  if (node.type === "namespace_declaration") { const ns = node.childForFieldName?.("name")?.text ?? name; const id = addSharedNode(ns, "namespace", node, parent, "namespace"); for (const child of node.namedChildren) walk(child, id, ns); return; }
  if (node.type === "attribute") { addSimpleNode(file, nodes, edges, `${scope}.${node.childForFieldName?.("name")?.text ?? name}@${loc(node)}`, "attribute", node, parent); return; }
  if (node.type === "global_statement") { const label = `top-level@${loc(node)}`; const id = addSimpleNode(file, nodes, edges, label, "top-level-statement", node, parent, `${label}@${locKey(node)}`); addCalls(node, id, scope, label); return; }
  const kinds: Record<string, string> = { class_declaration: "class", struct_declaration: "struct", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "record", delegate_declaration: "delegate" };
  if (kinds[node.type]) { const qname = scope ? `${scope}.${name}` : name; const id = addSharedNode(qname, kinds[node.type], node, parent, "type"); const bases = node.namedChildren.find(child => child.type === "base_list"); for (const base of bases?.namedChildren ?? []) bindingReferences.push({ file, source: id, kind: "base", target: base.text.replace(/<.*$/, "").trim(), scope }); for (const child of node.namedChildren) walk(child, id, qname); return; }
  const members: Record<string, string> = { method_declaration: "method", constructor_declaration: "constructor", property_declaration: "property", event_declaration: "event", event_field_declaration: "event", field_declaration: "field" };
  if (members[node.type]) { const member = node.type === "event_field_declaration" ? node.descendantsOfType("variable_declarator")[0]?.childForFieldName?.("name")?.text ?? name : name; const label = scope ? `${scope}.${member}` : member; const uniqueLabel = `${label}@${locKey(node)}`; const id = addSimpleNode(file, nodes, edges, label, members[node.type], node, parent, uniqueLabel); if (["method_declaration", "constructor_declaration"].includes(node.type)) addCalls(node, id, scope, label); else if (["property_declaration", "event_declaration"].includes(node.type) && node.descendantsOfType("invocation_expression").length) diagnostics.push({ file, reason: "unsupported_callable", message: `Unsupported C# callable form (${node.type === "property_declaration" ? "property/indexer accessor" : "event accessor"}) at ${loc(node)}: calls inside it are not attributed to a callable owner.` }); else if (["field_declaration", "event_field_declaration"].includes(node.type)) for (const callback of [...node.descendantsOfType("lambda_expression"), ...node.descendantsOfType("anonymous_method_expression")]) diagnostics.push({ file, reason: "unsupported_callable", message: `Unsupported C# callable form (field initializer callback) at ${loc(callback)}: calls inside it are not attributed to a callable owner.` }); return; }
  for (const child of node.namedChildren) walk(child, parent, scope);
 }
 walk(tree.rootNode, fileId, "");
 for (const directive of tree.rootNode.descendantsOfType("using_directive")) {
  const match = /^\s*using\s+(static\s+)?(?:(\w+)\s*=\s*)?([\w.]+)/.exec(directive.text);
  const imported = match?.[3] ?? directive.childForFieldName?.("name")?.text ?? "";
  if (imported) bindingReferences.push({ file, source: fileId, kind: "import", target: imported, scope: "", ...(match?.[2] ? { alias: match[2] } : {}), ...(match?.[1] ? { staticImport: true } : {}) });
 }
 return { nodes, edges, diagnostics, bindingReferences };
}

function extractJson(file: string, source: string): ExtractionResult {
 const nodes: GraphNode[] = [makeFileNode(file)]; const edges: GraphEdge[] = []; const diagnostics: ExtractionDiagnostic[] = [];
 try { const value = JSON.parse(source); if (value && typeof value === "object" && !Array.isArray(value)) { const keys = Object.keys(value); for (const key of keys.slice(0, MAX_JSON_KEYS)) { const id = nodeId(file, key); nodes.push({ id, label: key, type: "field", sourceFile: file }); edges.push({ source: nodeId(file, "file"), target: id, relation: "contains", confidence: "EXTRACTED" }); } if (keys.length > MAX_JSON_KEYS) diagnostics.push({ file, reason: "truncated_json", message: `Only the first ${MAX_JSON_KEYS} top-level JSON keys are indexed.` }); } }
 catch (error) { diagnostics.push({ file, reason: "parser_failed", message: `Invalid JSON: ${String(error)}` }); }
 return { nodes, edges, diagnostics };
}

function extractGeneric(file: string, tree: Parser.Tree): ExtractionResult {
 const nodes: GraphNode[] = [makeFileNode(file)]; const edges: GraphEdge[] = [];
 function visit(node: Parser.SyntaxNode, owner = nodeId(file, "file"), scope = ""): void {
  const name = node.childForFieldName?.("name")?.text ?? node.childForFieldName?.("declarator")?.text;
  const classes = ["class_declaration", "class_definition", "struct_item", "interface_declaration", "trait_item", "object_definition", "enum_item", "enum_declaration", "type_declaration"];
  const funcs = ["function_declaration", "function_definition", "method_declaration", "method_definition", "function_item", "function_definition", "constructor_declaration"];
  let nextOwner = owner, nextScope = scope;
  if (name && classes.includes(node.type)) { const label = scope ? `${scope}.${name}` : name; nextOwner = addSimpleNode(file, nodes, edges, label, node.type.includes("interface") ? "interface" : "class", node); nextScope = label; }
  else if (name && funcs.includes(node.type)) { const label = scope ? `${scope}.${name}` : name; nextOwner = addSimpleNode(file, nodes, edges, label, "function", node); callExpressions(node, nextOwner, file, edges); }
  if (["import_declaration", "use_declaration", "import_statement"].includes(node.type)) edges.push({ source: nodeId(file, "file"), target: nodeId(file, node.text.slice(0, 80)), relation: "imports", confidence: "EXTRACTED" });
  for (const child of node.namedChildren) visit(child, nextOwner, nextScope);
 }
 visit(tree.rootNode);
 return { nodes, edges };
}

function extractFile(file: string, source: string, root: string, tree?: Parser.Tree): ExtractionResult {
 const grammar = pickGrammar(file); if (!grammar) return { nodes: [], edges: [], diagnostics: [{ file, reason: "unsupported", message: "No tree-sitter grammar is registered." }] };
 try { tree ??= (parser.setLanguage(grammar), parser.parse(source)); } catch (error) { return { nodes: [], edges: [], diagnostics: [{ file, reason: "parser_failed", message: String(error) }] }; }
 const lang = CODE_EXTENSIONS[file.slice(file.lastIndexOf("."))] ?? "unknown";
 if (["javascript", "typescript", "tsx"].includes(lang)) return extractTsJs(file, root, tree);
 if (lang === "csharp") return extractCSharp(file, tree);
 if (lang === "json") return extractJson(file, source);
 return extractGeneric(file, tree);
}

/** Resolve a relative import path to an existing supported source file. */
export function resolveModulePath(fromFile: string, modPath: string, root: string): string | null {
 if (!modPath.startsWith(".")) return null;
 const from = fromFile.replace(/\\/g, "/"); const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : ".";
 let base = (dir === "." ? modPath : `${dir}/${modPath}`).replace(/^\.\//, "").replace(/\/\.\//g, "/");
 if (/\.(ts|tsx|js|jsx|mts|mjs|py|go|cs)$/.test(base) && existsSync(join(root, base))) return base;
 for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".go", ".cs"]) if (existsSync(join(root, base + ext))) return base + ext;
 for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]) if (existsSync(join(root, `${base}/index${ext}`))) return `${base}/index${ext}`;
 return null;
}

function bindProjectLocalCalls(root: string, nodes: GraphNode[], edges: GraphEdge[], csharpReferences: BindingReference[] = []): ExtractionDiagnostic[] {
 const byId = new Map(nodes.map(node => [node.id, node])); const bindings = new Map<string, Map<string, string>>(); const diagnostics: ExtractionDiagnostic[] = [];
 const importsRe = /\bimport\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
 for (const file of new Set(nodes.filter(node => node.type === "file").map(node => node.sourceFile))) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
  let source = ""; try { source = readFileSync(resolve(root, file), "utf8"); } catch { continue; }
  importsRe.lastIndex = 0; let match: RegExpExecArray | null;
  while ((match = importsRe.exec(source))) {
   const targetFile = resolveModulePath(file, match[2], root); if (!targetFile) continue;
   const clause = match[1]; const fileBindings = bindings.get(file) ?? new Map<string, string>(); bindings.set(file, fileBindings);
   const targetNodes = nodes.filter(node => node.sourceFile === targetFile && node.type !== "file");
   const bind = (local: string, imported: string) => { const found = targetNodes.filter(node => node.label === imported || node.label.endsWith(`.${imported}`)); if (found.length === 1) fileBindings.set(local, found[0].id); };
   const defaultMatch = clause.match(/^\s*([A-Za-z_$][\w$]*)/);
   if (defaultMatch && defaultMatch[1] !== "type") {
    let exported = ""; let targetSource = ""; try { targetSource = readFileSync(resolve(root, targetFile), "utf8"); } catch { /* changed during build */ }
    const defaultDecl = /export\s+default\s+(?:async\s+)?(?:function|class)\s+([\w$]+)/.exec(targetSource);
    const defaultValue = /export\s+default\s+([\w$]+)\s*;/.exec(targetSource); exported = defaultDecl?.[1] ?? defaultValue?.[1] ?? "";
    if (exported) bind(defaultMatch[1], exported);
   }
   const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause); if (namespace) fileBindings.set(`${namespace[1]}.*`, targetFile);
   const named = /\{([^}]*)\}/.exec(clause);
   if (named) for (const item of named[1].split(",")) { const parts = /(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?/.exec(item.trim()); if (parts) bind(parts[2] ?? parts[1], parts[1]); }
  }
 }
 for (const edge of edges) {
  if (edge.relation !== "calls") continue; const sourceNode = byId.get(edge.source); const target = byId.get(edge.target); if (!sourceNode) continue;
  if (target) continue;
  const sourceFile = sourceNode.sourceFile; const prefix = nodeId(sourceFile, ""); const tail = edge.target.startsWith(prefix) ? edge.target.slice(prefix.length) : "";
  let targetId = bindings.get(sourceFile)?.get(tail);
  if (!targetId && tail.includes("_")) { const [ns, ...parts] = tail.split("_"); const module = bindings.get(sourceFile)?.get(`${ns}.*`); if (module) { const name = parts.join("_"); const matches = nodes.filter(node => node.sourceFile === module && (node.label === name || node.label.endsWith(`.${name}`))); if (matches.length === 1) targetId = matches[0].id; } }
  if (!targetId && sourceNode.type === "function") {
   const localFunctions = nodes.filter(node => node.type === "function" && node.sourceFile === sourceFile && (node.label === tail || node.label.endsWith(`.${tail}`)));
   const nested = localFunctions.filter(node => node.label.startsWith(`${sourceNode.label}.`));
   if (nested.length === 1) targetId = nested[0].id;
   else if (!nested.length && localFunctions.length === 1) targetId = localFunctions[0].id;
  }
  if (!targetId && sourceNode.type === "method") {
   const className = sourceNode.label.slice(0, sourceNode.label.lastIndexOf(".")); const member = tail.replace(/^this_/, ""); const matches = nodes.filter(node => node.type === "method" && node.sourceFile === sourceFile && node.label === `${className}.${member}`); if (matches.length === 1) targetId = matches[0].id;
  }
  if (targetId) edge.target = targetId;
  else diagnostics.push({ file: sourceFile, reason: "unresolved_reference", message: `Call target ${tail || edge.target} was not resolved unambiguously.` });
 }
 diagnostics.push(...bindCSharpProjectReferences(nodes, edges, csharpReferences));
 return diagnostics;
}

function bindCSharpProjectReferences(nodes: GraphNode[], edges: GraphEdge[], references: BindingReference[]): ExtractionDiagnostic[] {
 const diagnostics: ExtractionDiagnostic[] = []; const namespaces = nodes.filter(node => node.type === "namespace");
 const types = nodes.filter(node => ["class", "struct", "interface", "record"].includes(node.type)); const methods = nodes.filter(node => node.type === "method"); const localCallables = nodes.filter(node => node.type === "function" && /@L\d+$/.test(node.label));

 const aliasesByFile = new Map<string, Map<string, BindingReference>>(); const staticImportsByFile = new Map<string, string[]>();
 const add = (source: string, target: string, relation: GraphEdge["relation"], confidence: GraphEdge["confidence"]) => { if (nodes.some(node => node.id === source) && nodes.some(node => node.id === target) && !edges.some(edge => edge.source === source && edge.target === target && edge.relation === relation)) edges.push({ source, target, relation, confidence }); };
 const unresolved = (ref: BindingReference, message: string, referenceStatus: "ambiguous" | "external" | "dynamic" | "unknown") => diagnostics.push({ file: ref.file, reason: "unresolved_reference", message, referenceStatus });
 for (const ref of references.filter(item => item.kind === "import")) {
  const importTargets = ref.staticImport ? types : ref.alias ? [...namespaces, ...types] : namespaces;
  const candidates = importTargets.filter(node => node.label === ref.target || node.label.endsWith(`.${ref.target}`));
  if (candidates.length === 1) { add(ref.source, candidates[0].id, "imports", "EXTRACTED"); if (ref.alias) { const map = aliasesByFile.get(ref.file) ?? new Map(); map.set(ref.alias, { ...ref, target: candidates[0].label }); aliasesByFile.set(ref.file, map); } if (ref.staticImport) staticImportsByFile.set(ref.file, [...(staticImportsByFile.get(ref.file) ?? []), candidates[0].label]); }
  else unresolved(ref, `using ${ref.alias ? `${ref.alias} = ` : ""}${ref.target}: ${candidates.length ? "ambiguous project namespace/type" : "external or unknown namespace/type"}`, candidates.length ? "ambiguous" : "external");
 }
 for (const ref of references.filter(item => item.kind === "base")) {
  const raw = ref.target.replace(/[?]+$/, ""); const scoped = ref.scope ? `${ref.scope}.${raw}` : raw;
  let candidates = types.filter(node => node.label === raw || node.label === scoped || node.label.endsWith(`.${raw}`));
  const scopedCandidates = types.filter(node => node.label === scoped); if (scopedCandidates.length) candidates = scopedCandidates;
  if (candidates.length === 1) add(ref.source, candidates[0].id, "inherits", "EXTRACTED");
  else unresolved(ref, `base ${raw}: ${candidates.length ? "ambiguous project type" : "external or unknown type"}`, candidates.length ? "ambiguous" : "external");
 }
 for (const ref of references.filter(item => item.kind === "call")) {
  let target = ref.target.replace(/[?!]+$/, "").replace(/::/g, "."); const aliases = aliasesByFile.get(ref.file);
  for (const [alias, imported] of aliases ?? []) if (target === alias || target.startsWith(`${alias}.`)) target = `${imported.target}${target.slice(alias.length)}`;
  const currentType = ref.scope;
  let candidates: GraphNode[]; let ambiguousTypeQualifier = false;
  if (target.startsWith("this.")) candidates = methods.filter(node => node.label === `${currentType}.${target.slice(5)}`);
  else if (target.includes(".")) {
   const parts = target.split("."); const typeAndMember = parts.slice(-2).join("."); const qualifier = parts.slice(0, -1).join(".");
   const namespace = ref.scope.split(".").slice(0, -1).join(".");
   const qualified = namespace && !target.startsWith(`${namespace}.`) ? `${namespace}.${target}` : target;
   const exact = methods.filter(node => node.label === target); const scoped = methods.filter(node => node.label === qualified);
   const qualifierTypes = types.filter(node => node.label === qualifier || (parts.length === 2 && node.label.endsWith(`.${qualifier}`)));
   ambiguousTypeQualifier = !exact.length && !scoped.length && qualifierTypes.length > 1;
   candidates = exact.length ? exact : scoped.length ? scoped : qualifierTypes.length === 1 ? methods.filter(node => node.label.endsWith(`.${typeAndMember}`)) : [];
  } else {
   candidates = methods.filter(node => node.label === `${currentType}.${target}`);
   candidates.push(...localCallables.filter(node => node.sourceFile === ref.file && node.label.startsWith(`${currentType}.`) && node.label.includes(`.${target}@L`)));
   for (const importedType of staticImportsByFile.get(ref.file) ?? []) candidates.push(...methods.filter(node => node.label === `${importedType}.${target}`));
  }
  const unique = [...new Map(candidates.map(node => [node.id, node])).values()];
  if (unique.length === 1 && !ambiguousTypeQualifier) add(ref.source, unique[0].id, "calls", "INFERRED");
  else {
   const receiver = target.includes(".") && !target.startsWith("this.") ? target.slice(0, target.lastIndexOf(".")) : "";
   const knownReceiver = types.some(node => node.label === receiver || node.label.endsWith(`.${receiver}`));
   const status = unique.length > 1 || ambiguousTypeQualifier ? "ambiguous" : target.includes(".") && !knownReceiver ? "dynamic" : /^[A-Z]/.test(target) ? "external" : "unknown";
   unresolved(ref, `${ref.target}: ${unique.length > 1 || ambiguousTypeQualifier ? "ambiguous overload/target" : status === "external" ? "external target" : status === "dynamic" ? "dynamic receiver" : "unknown target"}`, status);
  }
 }
 return diagnostics;
}

export type CachedExtractionResult = ExtractionResult & { cached: number; extracted: number; skippedFiles: number; diagnostics: ExtractionDiagnostic[] };
function runExtraction(root: string, files: string[], cacheDir?: string, force = false, progress?: (done: number) => void, bind = true, prune = true): CachedExtractionResult {
 const cache = cacheDir ? loadCache(cacheDir) : new Map<string, CacheEntry>(); const nodes: GraphNode[] = []; const edges: GraphEdge[] = []; const refs: BindingReference[] = []; const ids = new Set<string>(); const diagnostics: ExtractionDiagnostic[] = []; let cached = 0, extracted = 0, skippedFiles = 0;
 for (const file of files) {
  let stat; try { stat = statSync(resolve(root, file)); } catch (error) { diagnostics.push({ file, reason: "unreadable", message: String(error) }); skippedFiles++; cache.delete(file); continue; }
  if (stat.size > MAX_SOURCE_FILE_SIZE) { diagnostics.push({ file, reason: "oversized", message: `File is ${stat.size} bytes; limit is ${MAX_SOURCE_FILE_SIZE}.` }); skippedFiles++; cache.delete(file); continue; }
  let bytes: Buffer; try { bytes = readFileSync(resolve(root, file)); } catch (error) { diagnostics.push({ file, reason: "unreadable", message: String(error) }); skippedFiles++; cache.delete(file); continue; }
  const hash = fileHash(bytes); const entry = cache.get(file);
  let result: ExtractionResult;
  if (!force && entry?.version === EXTRACTION_CACHE_VERSION && entry.hash === hash) { result = entry; cached++; }
  else { result = extractFile(file, bytes.toString("utf8"), root); cache.set(file, { hash, version: EXTRACTION_CACHE_VERSION, nodes: result.nodes, edges: result.edges, diagnostics: result.diagnostics, bindingReferences: result.bindingReferences }); extracted++; }
  for (const node of result.nodes) if (!ids.has(node.id)) { ids.add(node.id); nodes.push(node); }
  refs.push(...(result.bindingReferences ?? [])); edges.push(...result.edges.map(edge => ({ ...edge }))); diagnostics.push(...(result.diagnostics ?? [])); skippedFiles += (result.diagnostics ?? []).filter(diagnostic => diagnostic.reason !== "unsupported_callable").length; progress?.(cached + extracted);
 }
 if (prune) { const current = new Set(files); for (const key of cache.keys()) if (!current.has(key)) cache.delete(key); }
 if (bind) diagnostics.push(...bindProjectLocalCalls(root, nodes, edges, refs));
 if (cacheDir) saveCache(cacheDir, cache);
 return { nodes, edges, cached, extracted, skippedFiles, diagnostics, bindingReferences: refs };
}
export function extract(root: string, files: string[], cacheDir?: string, force?: boolean, onProgress?: (done: number) => void): CachedExtractionResult {
 return runExtraction(root, files, cacheDir, force, onProgress);
}
export async function extractAsync(root: string, files: string[], cacheDir?: string, force?: boolean, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<CachedExtractionResult> {
 const nodes: GraphNode[] = []; const edges: GraphEdge[] = []; const refs: BindingReference[] = []; const diagnostics: ExtractionDiagnostic[] = []; const ids = new Set<string>();
 let cached = 0, extracted = 0, skippedFiles = 0, processed = 0;
 for (const file of files) {
  if (signal?.aborted) throw new Error("Mind Place build cancelled.");
  const one = runExtraction(root, [file], cacheDir, force, undefined, false, false);
  for (const node of one.nodes) if (!ids.has(node.id)) { ids.add(node.id); nodes.push(node); }
  edges.push(...one.edges); refs.push(...(one.bindingReferences ?? [])); diagnostics.push(...one.diagnostics); cached += one.cached; extracted += one.extracted; skippedFiles += one.skippedFiles;
  processed++; onProgress?.(processed);
  await new Promise<void>(resume => setImmediate(resume));
 }
 if (signal?.aborted) throw new Error("Mind Place build cancelled.");
 diagnostics.push(...bindProjectLocalCalls(root, nodes, edges, refs));
 if (cacheDir) { const cache = loadCache(cacheDir); const current = new Set(files); for (const key of cache.keys()) if (!current.has(key)) cache.delete(key); saveCache(cacheDir, cache); }
 return { nodes, edges, cached, extracted, skippedFiles, diagnostics, bindingReferences: refs };
}
