// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — EVERY RESULT-NOUN FIELD IS CLASSIFIED, AND A NEW ONE CANNOT ARRIVE UNCLASSIFIED.
//
// fixed four instances in four modules and named the sweep it owed: every field written into
// `_driver/*.json` or `run.jsonl` whose name is a result noun, checked against what the writing site
// actually knows. No enumeration existed, so nothing could tell "no offenders" from "no offenders among
// the ones somebody happened to look at".
//
// THE POPULATION IS DERIVED FROM THE TREE, and the table is the classification of it. A row is not an
// exemption — a pair classified `out-of-scope` still appears, with its counts, for 's reason: a
// filtered population produces no number and nobody can see what was dropped.
//
// PARSED, NOT GREPPED. A regex over the same tree returned 66 hits, of which roughly a third were prose
// inside string literals — MCP tool-schema descriptions and prompt text, where `outcome:` appears inside
// a sentence. `ObjectExpression` properties only, never `ObjectPattern`, so a destructuring
// `list_searches({ runId, outcome })` is a read and not a write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { RESULT_NOUNS, RESULT_NOUN_FIELDS, VERDICTS } from "../result-noun-fields.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_CORPUS = skipReason("result-nouns-are-classified (#1529)");
const acorn = createRequire(import.meta.url)("acorn");

const NOUNS = new Set(RESULT_NOUNS);
// The calls that put an object into run.jsonl or a _driver artifact.
const LOGGERS = new Set(["runLog", "stageLog", "log", "appendLine", "recordSpan"]);

const walk = (n, fn) => {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { for (const c of n) walk(c, fn); return; }
  fn(n);
  for (const k of Object.keys(n)) if (k !== "loc" && k !== "start" && k !== "end") walk(n[k], fn);
};
const calleeName = (c) => (c?.type === "Identifier" ? c.name
  : c?.type === "MemberExpression" ? (c.property?.name ?? null) : null);
/** result-noun keys inside an ObjectExpression subtree, as `noun@line`. */
const nounSites = (node) => {
  const out = [];
  walk(node, (n) => {
    if (n.type !== "ObjectExpression") return;
    for (const p of n.properties) {
      if (p.type !== "Property" || p.computed) continue;
      const k = p.key?.name ?? p.key?.value;
      // LINE AND COLUMN. Keyed on the line alone, two sites on one line collapse into one and a new
      // field added beside an existing one passes the count check — caught by seeding exactly that.
      if (NOUNS.has(k)) out.push(`${k}@${p.loc.start.line}:${p.loc.start.column}`);
    }
  });
  return out;
};

/** (file, noun) → {sites, atWriteSite}, derived. Null off a checkout. */
function derive() {
  const tracked = trackedFiles("result-nouns-are-classified", { root: ROOT, pathspec: ["*.mjs"] });
  if (!tracked) return null;
  assert.ok(tracked.length > 0, "the tracked-file scan returned no .mjs files — an empty corpus makes every count below zero for the wrong reason");
  // `_driver` artifact keys, read from where the path table is built rather than listed here.
  const stages = readFileSync(join(ROOT, "driver", "stages.mjs"), "utf8");
  const driverKeys = new Set([...stages.matchAll(/^\s+([a-zA-Z_]\w*):\s*p\(driverRel\(/gm)].map((m) => m[1]));
  assert.ok(driverKeys.size > 0, "no `p(driverRel(…))` path keys were found — the write-site half cannot discriminate");

  const agg = new Map();
  const bump = (file, noun, key) => {
    const row = agg.get(`${file}|${noun}`) ?? { sites: new Set(), writes: new Set() };
    agg.set(`${file}|${noun}`, row);
    return row;
  };
  for (const f of tracked) {
    if (/(^|\/)tests?\//.test(f) || f.startsWith("node_modules/")) continue;
    let src; try { src = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    if (!/driverDir\(|run\.jsonl|atomicWrite\(/.test(src)) continue;
    let ast; try { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true }); } catch { continue; }
    for (const t of nounSites(ast)) bump(f, t.split("@")[0]).sites.add(t);
    walk(ast, (n) => {
      if (n.type !== "CallExpression") return;
      const name = calleeName(n.callee);
      let args = null;
      if (LOGGERS.has(name)) args = n.arguments;
      else if (name === "writeFileSync" || name === "atomicWrite") {
        const first = n.arguments[0];
        if (!first) return;
        const viaDriverDir = JSON.stringify(first).includes('"name":"driverDir"');
        const pKey = first.type === "MemberExpression" && first.object?.name === "P" ? first.property?.name : null;
        if (viaDriverDir || (pKey && driverKeys.has(pKey))) args = n.arguments.slice(1);
      }
      if (!args) return;
      for (const a of args) for (const t of nounSites(a)) bump(f, t.split("@")[0]).writes.add(t);
    });
  }
  const out = new Map();
  for (const [k, v] of agg) out.set(k, { sites: v.sites.size, atWriteSite: v.writes.size });
  return out;
}

const keyOf = (r) => `${r.file}|${r.noun}`;

test("#1529 every result-noun field in the tree is classified, with its counts", (ctx) => {
  const derived = derive();
  if (!derived) return ctx.skip(NO_CORPUS);
  assert.ok(derived.size > 0, "the derivation found no result-noun fields at all — it is not measuring the tree");

  const table = new Map(RESULT_NOUN_FIELDS.map((r) => [keyOf(r), r]));
  const problems = [];
  for (const [k, d] of derived) {
    const row = table.get(k);
    if (!row) { problems.push(`UNCLASSIFIED  ${k.replace("|", "  ")}  (${d.sites} site(s), ${d.atWriteSite} at a write site)`); continue; }
    if (row.sites !== d.sites || row.atWriteSite !== d.atWriteSite)
      problems.push(`COUNT MOVED   ${k.replace("|", "  ")}  table says ${row.sites}/${row.atWriteSite}, tree says ${d.sites}/${d.atWriteSite}`);
  }
  for (const k of table.keys()) if (!derived.has(k)) problems.push(`STALE ROW     ${k.replace("|", "  ")}  is in the table and not in the tree`);

  assert.deepEqual(problems, [],
    `${problems.length} result-noun field(s) are unclassified or have moved:\n  ${problems.join("\n  ")}\n\n`
    + `Classify each in driver/result-noun-fields.mjs by READING THE WRITING SITE — a field named for a `
    + `result whose value is a call returning is the defect (#960). "result", "invocation" or `
    + `"out-of-scope"; a count that moved means a new site in a file already listed.`);
});

test("#1529 nothing in the tree currently reports an INVOCATION under a result name", () => {
  // Criterion 3: every member classified `invocation` is renamed or given a sibling carrying the result.
  // After this sweep there are none, so the assertion is a ratchet rather than a description — a new one
  // has to be fixed or deliberately declared, and either way somebody looked.
  const unfixed = RESULT_NOUN_FIELDS.filter((r) => r.verdict === "invocation");
  assert.deepEqual(unfixed.map(keyOf), [],
    `${unfixed.length} field(s) name a result and carry an invocation. Rename, or add a sibling that `
    + `carries the result — the remedy repairs.mjs:724 uses, keeping the old key for existing readers.`);
});

test("#1529 every row carries a verdict from the closed set, and every in-scope row says WHY", () => {
  const bad = [], mute = [];
  for (const r of RESULT_NOUN_FIELDS) {
    if (!VERDICTS.includes(r.verdict)) bad.push(`${keyOf(r)} → ${JSON.stringify(r.verdict)}`);
    // An in-scope row's verdict rests on a reading of the writing site. Unstated, it is an assertion
    // nobody can check; out-of-scope rows are carried by their counts and need no prose.
    if (r.atWriteSite > 0 && !String(r.why ?? "").trim()) mute.push(keyOf(r));
  }
  assert.deepEqual(bad, [], `verdict(s) outside ${VERDICTS.join(" / ")}`);
  assert.deepEqual(mute, [], `in-scope row(s) classified with no stated reason:\n  ${mute.join("\n  ")}`);
});

test("#1529 the out-of-scope half is REPORTED, not filtered — and it is not empty", () => {
  // The half a lint would have dropped. If this ever reads zero, the derivation stopped seeing the sites
  // it classifies as out of scope, which is a change in the instrument and not in the tree.
  const out = RESULT_NOUN_FIELDS.filter((r) => r.verdict === "out-of-scope");
  assert.ok(out.length > 0, "the out-of-scope half is empty — the split has collapsed into a filter");
  for (const r of out) assert.equal(r.atWriteSite, 0, `${keyOf(r)} is out-of-scope with ${r.atWriteSite} write site(s)`);
});
