// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// travelling-predicates.mjs — 's candidate population, DISCOVERED rather than recalled.
//
// hunts a class: a contract whose two ends measure different things — a demand computed against
// one unit or snapshot, satisfaction enforced against another, with no guard asserting the two agree.
// Its stated deliverable is "an enumerated sweep (DISCOVERED POPULATION, NOT RECALLED)", and that phrase
// is the reason this file exists rather than another comment full of line numbers.
//
// ── WHY A SCRIPT AND NOT A LIST ──────────────────────────────────────────────────────────────────────
//
// The population has already gone stale twice on this issue's own thread. 241 lines were recorded on
// 2026-08-18; the same predicate gave 248 lines and 251 sites a day later. A candidate list posted as
// `file:line` expires the moment anyone edits above it — and the list that WAS posted came with the
// warning attached: "line numbers drift; they are a starting index, not an identity". An earlier version
// of it pointed at a path in one box's scratchpad, which for any other agent is a reference to nothing.
//
// So the durable artifact is the method. Run this and you have tonight's population, on tonight's tree.
//
// ── THE METHOD, AND THE ONE TRICK IN IT ──────────────────────────────────────────────────────────────
//
// A member of the class needs a demand SET in one place and satisfaction ENFORCED in another. A
// predicate computed and acted on where it stands has one end, and cannot be a member. So: find every
// `.some()`/`.every()` call, then decide WHERE ITS BOOLEAN GOES.
//
// The trick is the climb. Classifying on the immediate parent files nearly a third of the population
// wrongly, because so many of these sit under a `&&` whose ENCLOSING expression is the thing that gets
// stored. This climbs through boolean plumbing — `!x`, `a && b`, `a ?? b`, optional chaining — to the
// first ancestor that actually decides where the value lands, and classifies on that.
//
// Measured difference, on the tree that first ran it: immediate-parent 22% travelling, climbing 37%.
//
// ── WHAT THIS DOES NOT ESTABLISH, said here because a tool gets trusted more than a comment ──────────
//
// · TRAVELLING IS NECESSARY, NOT SUFFICIENT. A boolean stored and read three lines down in the same
//   function travels and is still one end. This output is a candidate CEILING; the reading is the work.
// · IT BOUNDS PRECISION, NEVER RECALL. A member whose demand is computed without `.some()`/`.every()`
//   is invisible to this hunt entirely., the founding instance, happens to be a `.some` — that
//   is why the pattern was chosen, and it is not evidence the pattern finds the others.
// · A REGEX GOT THIS WRONG FIRST, and the way it was wrong is instructive: it asked whether a LINE
//   looked like an assignment, and filed `const push = (row) => { if (!asks.some(…)) … }` as "stored"
//   because the line starts with `const`. That is a proxy validating a proxy. This parses.
//
// ── THE SECOND QUESTION: WHERE DOES IT COME TO REST? ('s adjudication set) ──────────────────────
//
// "Travelling" is a candidate ceiling and this file has said so since it was written. Ninety-nine
// candidates is not a population anybody adjudicates one essay at a time, and reading them as ninety-nine
// separate questions is how the classification kept not happening. They collapse, by mechanism, on one
// further question: WHERE THE BOOLEAN COMES TO REST.
//
//   contained   bound to a local and read inside the same function, and nowhere else. ONE END. A demand
//               and its enforcement cannot be a pair when both are the same three lines. Out of class by
//               mechanism, computed rather than asserted.
//
//   value       leaves as a VALUE — returned to a caller, or the body of a named predicate the caller
//               invokes. The collection is supplied AT THE CALL, so the demand and the enforcement read
//               one snapshot by construction: there is no stored flag for fresh data to contradict.
//
//   structure   written into something that OUTLIVES the expression that computed it — an object field,
//               an assignment, or a local that lands in a returned object. THIS is the class's shape:
//               's `quote_required` was a flag on a form, judged later against candidates that had
//               been rebuilt. A boolean at rest can be met by data that has moved.
//
// The three are exhaustive and mechanical, so the sweep's own numbers say how much reading is owed and
// the ruling covers a stated population rather than a sample of one.
//
// Usage:  node scripts/travelling-predicates.mjs [--json] [--bucket travels|decided|unresolved]
//                                                         [--holds contained|value|structure]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { trackedFiles } from "../shared/tracked-files.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

/** Named once so the test can report the SAME guard in its skip reason. */
export const GUARD = "#1100 travelling-predicate candidates";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The two calls the hunt is keyed on. Non-computed member calls only — `x["some"]` is not this. */
const HUNTED = new Set(["some", "every"]);

/**
 * Boolean plumbing: nodes that pass a boolean through without deciding anything about where it goes.
 * The climb walks THROUGH these. Every one of them was measured to matter — `&&` alone accounts for
 * most of the 22%→37% difference between the naive and the climbing view.
 */
function isPlumbing(node, child) {
  if (!node) return false;
  if (node.type === "UnaryExpression" && node.operator === "!") return true;
  if (node.type === "LogicalExpression") return true;          // && || ??  — either side
  if (node.type === "ChainExpression") return true;            // a?.b.some(…)
  if (node.type === "SequenceExpression") return node.expressions.at(-1) === child;
  // An expression-bodied function passes its value out to whatever holds the FUNCTION — climb through
  // it and let the next ancestor decide whether this is a named predicate or an inline one.
  if ((node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") && node.body === child) return true;
  if (node.type === "TSNonNullExpression") return true;        // harmless if never seen
  // A ternary BRANCH is plumbing; a ternary TEST is a decision, and classify() handles that separately.
  // This was the whole of the unresolved bucket — three sites, all one shape:
  //
  //     const wrote   = files.length ? files.some(…) : null;              gateway.mjs:1407
  //     const inScope = scope.size   ? tokens.some(…) : (…);              reasoning-tripwires.mjs:82
  //     const reached = b.layer === "national" ? (…) : regions.some(…);   register-plan.mjs:318
  //
  // The climb stopped at the ternary and reported "unresolved", which reads as a limit of the pattern
  // and was a missing case. All three are `local` — the boolean is bound and read in the same function.
  if (node.type === "ConditionalExpression" && (node.consequent === child || node.alternate === child)) return true;
  return false;
}

/** Where the value lands. `null` ⇒ this node does not decide, keep climbing. */
function classify(parent, child) {
  switch (parent?.type) {
    case "VariableDeclarator":
      return parent.init === child ? (isFn(child) ? "named-pred" : "local") : null;
    case "ReturnStatement":    return parent.argument === child ? "return" : null;
    case "AssignmentExpression": return parent.right === child ? "assign" : null;
    case "Property":           return parent.value === child ? (isFn(child) ? "named-pred" : "field") : null;
    case "PropertyDefinition": return parent.value === child ? "field" : null;
    // An expression-bodied arrow is NOT a verdict on its own, and treating it as one was this
    // classifier's first bug — caught by disagreeing with an independent count of the same population
    // (111 travelling against a measured 93). What decides is where the ARROW goes:
    //
    //     const isReady = (x) => x.every(…)      the predicate is NAMED — its boolean travels
    //     rows.filter((x) => x.tags.some(…))     an inline predicate — acted on where it stands
    //
    // Both have `body === child`. So the arrow is plumbing, and the climb continues through it; the
    // node above tells them apart. See isPlumbing.
    case "ArrowFunctionExpression": return null;
    // ── decided in place ──
    case "IfStatement":        return parent.test === child ? "decided" : null;
    case "ConditionalExpression": return parent.test === child ? "decided" : null;
    case "WhileStatement":
    case "DoWhileStatement":   return parent.test === child ? "decided" : null;
    case "ForStatement":       return parent.test === child ? "decided" : null;
    case "SwitchStatement":    return parent.discriminant === child ? "decided" : null;
    case "ExpressionStatement": return "decided";
    // An inline predicate handed straight to another call — `filter(x => x.some(…))` — is acted on where
    // it stands. Note this is reached only when the arrow's body was NOT the hunted call itself.
    case "CallExpression":
    case "NewExpression":      return parent.arguments?.includes(child) ? "decided" : null;
    default: return null;
  }
}

const isFn = (n) => n?.type === "ArrowFunctionExpression" || n?.type === "FunctionExpression";

const TRAVELS = new Set(["local", "return", "assign", "field", "named-pred"]);

const FN_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/**
 * Does `name`, bound inside `frame`, come to rest in something that outlives the expression?
 *
 * Two answers, not one, because they are different findings: `structure` if the identifier lands in an
 * object property or on a member target — where a stale flag can meet fresh data — and `value` if it
 * merely leaves (returned, or handed to another call). Nested functions are skipped: a name read inside
 * one belongs to that frame's own question, not this one.
 */
function restOf(frame, name) {
  let seen = "contained";
  walk(frame.body ?? frame, [], (n, ps) => {
    if (seen === "structure") return;
    if (n.type !== "Identifier" || n.name !== name) return;
    for (let i = ps.length - 1; i >= 0; i -= 1) {
      const a = ps[i];
      if (FN_TYPES.has(a.type) && a !== frame) break;
      if (a.type === "Property" || (a.type === "AssignmentExpression" && a.left?.type === "MemberExpression")) { seen = "structure"; return; }
      if (a.type === "ReturnStatement" || a.type === "CallExpression" || a.type === "NewExpression") { seen = "value"; return; }
    }
  });
  return seen;
}

/**
 * Where a travelling boolean comes to rest. See the header — this is the collapse that makes the
 * population adjudicable.
 *
 * `field` and `assign` are `structure` by definition: both write the boolean somewhere it can be read
 * after the collection it summarises has changed. `return` and `named-pred` are `value` by definition:
 * the caller supplies the collection at the call, so nothing is stored to go stale. Only `local` has to
 * be looked at, and the question there is whether the name reaches a structure before the frame ends.
 */
function holdOf(bucket, parents, landedAt) {
  if (bucket === "field" || bucket === "assign") return "structure";
  if (bucket === "return" || bucket === "named-pred") return "value";
  if (bucket !== "local") return "contained";
  const decl = parents[landedAt];
  const name = decl?.id?.type === "Identifier" ? decl.id.name : null;
  if (!name) return "value";                 // a destructured binding — cannot be followed, so never called contained
  let frame = null;
  for (let k = landedAt; k >= 0; k -= 1) if (FN_TYPES.has(parents[k].type)) { frame = parents[k]; break; }
  if (!frame) return "structure";            // module top level: it outlives every call by construction
  return restOf(frame, name);
}

/** Generic walk that carries the ancestor chain, because acorn gives no parent pointers. */
function walk(node, parents, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parents);
  const next = [...parents, node];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") walk(c, next, visit); }
    else if (v && typeof v.type === "string") walk(v, next, visit);
  }
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

export function scanSource(src, file) {
  const out = [];
  let ast;
  // A file this cannot parse is REPORTED, never skipped in silence — an unparsed file is a hole in the
  // population, and a population with a silent hole is the thing is about.
  try { ast = parse(src, { ecmaVersion: "latest", sourceType: "module", locations: false }); }
  catch (e) { return [{ file, line: 0, bucket: "unparsed", why: String(e?.message ?? e).slice(0, 120) }]; }

  walk(ast, [], (node, parents) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee;
    if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
    if (callee.property?.type !== "Identifier" || !HUNTED.has(callee.property.name)) return;

    // THE CLIMB.
    let child = node;
    let i = parents.length - 1;
    let bucket = null;
    while (i >= 0) {
      const parent = parents[i];
      bucket = classify(parent, child);
      if (bucket) break;
      if (!isPlumbing(parent, child)) break;
      child = parent; i -= 1;
    }
    const travels = bucket ? TRAVELS.has(bucket) : false;
    out.push({
      file, line: lineOf(src, node.start),
      bucket: bucket ? (travels ? "travels" : "decided") : "unresolved",
      where: bucket ?? "unresolved",
      // Only a travelling boolean has anywhere to come to rest; a decided one was spent where it stood.
      holds: travels ? holdOf(bucket, parents, i) : null,
      call: callee.property.name,
    });
  });
  return out;
}

/** The tracked driver corpus, minus tests. Through the helper — never `git` directly. */
export function corpus() {
  const listed = trackedFiles(GUARD,
    { root: ROOT, pathspec: ["driver/*.mjs", "driver/**/*.mjs"] });
  if (listed === null) return null;
  return listed.filter((f) => !f.includes("/test/") && !f.endsWith(".test.mjs"));
}

export function sweep() {
  const files = corpus();
  if (files === null) return null;
  const rows = [];
  for (const f of files) {
    let src; try { src = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    if (!src.includes(".some(") && !src.includes(".every(")) continue;   // cheap prefilter, parse is the authority
    rows.push(...scanSource(src, f));
  }
  return rows;
}

if (isEntrypoint(import.meta.url)) {
  const asJson = process.argv.includes("--json");
  const arg = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };
  const only = arg("--bucket");
  const holds = arg("--holds");
  const rows = sweep();
  if (rows === null) { console.error("no checkout — the corpus could not be listed; nothing was scanned"); process.exit(2); }
  const shown = rows.filter((r) => (!only || r.bucket === only) && (!holds || r.holds === holds));
  const tally = rows.reduce((a, r) => { a[r.bucket] = (a[r.bucket] ?? 0) + 1; return a; }, {});
  if (asJson) { console.log(JSON.stringify({ tally, rows: shown }, null, 2)); }
  else {
    const byFile = new Map();
    for (const r of shown) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
    for (const [f, rs] of [...byFile].sort()) {
      console.log(`${f}  (${rs.length})`);
      console.log(`  ${rs.map((r) => `${r.line}:${r.where}${r.holds ? `/${r.holds}` : ""}`).join(", ")}`);
    }
    const total = rows.length;
    const pct = (n) => total ? `${Math.round((n / total) * 100)}%` : "—";
    console.log(`\nsites ${total} across ${new Set(rows.map((r) => r.file)).size} file(s)`);
    for (const k of ["travels", "decided", "unresolved", "unparsed"])
      if (tally[k]) console.log(`  ${k.padEnd(11)} ${String(tally[k]).padStart(4)}  ${pct(tally[k])}`);
    const held = rows.filter((r) => r.holds).reduce((a, r) => { a[r.holds] = (a[r.holds] ?? 0) + 1; return a; }, {});
    console.log("\nof the travelling, where the boolean comes to rest:");
    for (const k of ["contained", "value", "structure"])
      if (held[k]) console.log(`  ${k.padEnd(11)} ${String(held[k]).padStart(4)}`);
    console.log("\nTRAVELLING IS NECESSARY, NOT SUFFICIENT — this is a candidate ceiling, and it bounds the");
    console.log("pattern's precision, never its recall. `structure` is the adjudication set: a boolean at");
    console.log("rest is the only one fresh data can arrive and contradict. Read those; the rest are ruled");
    console.log("as classes in driver/test/unit-pair-classification.test.mjs.");
  }
}
