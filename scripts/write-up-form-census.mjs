#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// write-up-form-census.mjs — how many CARDS each product would not author, counted on a real run.
//
//   node scripts/write-up-form-census.mjs --run <preserved run dir> [--run <dir> …] [--json]
//
// Read-only and free: no model turn, no register call, no queue admission, nothing written anywhere.
//
// ── what this is for ─────────────────────────────────────────────────────────────────────────────────
//
// design question 4 asks for the measured floor/mid/tail split on a real run "so the time saving is
// projected from real counts before anyone builds". The saving the ladder actually makes is a card
// DISPATCH — a paid model turn per mark — so the unit is cards not authored, not minutes. Minutes need a
// rate measurement and a controlled pair; cards are countable off an archived run for nothing.
//
// It answers exactly one question per run: for each clearance product, how many findings earn a full card
// and how many drop to the short-entry/grouped forms.
//
// ── what it is NOT for ───────────────────────────────────────────────────────────────────────────────
//
// It does not time anything, and a card count is not a minute count — per-card authoring measured ~1.4
// min, but that figure is one run's mean and multiplying by it here would launder a count into a
// duration nobody measured. Multiply outside, and say you did.
//
// It is also not a recall check. "Every judged mark still APPEARS" (criterion 2) is about the rendered
// report, and an entry is a form rather than a filter — this counts forms, and cannot see whether the
// grouped render dropped a member.
//
// ── how it refuses ───────────────────────────────────────────────────────────────────────────────────
//
// Three ways, all of them because the wrong number here is a REASSURING one:
//
//   1. UNRESOLVED DEPTH. `depthFor` falls back to full-country depth stamped `default-ungraded` when it
//      cannot resolve a policy, and `writeUpForm` maps every ungraded rung to `full`. A census built on a
//      policy object that does not resolve therefore reports "every product authors every card, the ladder
//      saves nothing" — quotable, and false. 's own ladder shipped dead for exactly this reason. So
//      the depth row is asserted resolved before a single finding is counted.
//   2. NO BAND SHAPE. The floor tier joins from `band-shape.json`; absent, every finding reads as holding
//      no floor and the graded products UNDER-count their full cards — erasing the one class the owner
//      made non-negotiable. The graded rows are withheld entirely rather than printed low.
//   3. THE POSITIVE CONTROL. `adversarial` and `adversarial+floors` are the same CARD predicate (they
//      differ in how the remainder groups), so products 2 and 3 must return identical counts. If they
//      diverge, this instrument is wrong and it says so instead of printing.
//
// ── which directory ──────────────────────────────────────────────────────────────────────────────────
//
// The agent WORKSPACE archive dir, not the published pool dir: the pool keeps findings.json but not
// `_driver/band-shape.json`, and without the shape the floor class cannot be counted (refusal 2).

import "../shared/env-local.mjs";   // — FIRST, before any module-top capture below it evaluates.
import { existsSync } from "node:fs";

import { paths } from "../driver/stages.mjs";
import { readFindingsForReport, fullProseOrdinals } from "../driver/pipeline.mjs";
import { floorTierByMark, floorMarkKey } from "../driver/band-shape.mjs";
import { writeUpForm } from "../driver/write-up-form.mjs";
import { depthFor } from "../driver/search-policy.mjs";
import { readFileSync } from "node:fs";

// The same reader the card predicate uses (`safeReadJson` in pipeline.mjs) — a THROWING read here would refuse a run
// whose shape is mid-write, where the pipeline itself reads null and carries on.
const safeReadJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

const die = (m, c = 2) => { console.error(`\n${m}\n`); process.exit(c); };

// ── args ─────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = "usage: write-up-form-census.mjs --run <preserved run dir> [--run <dir> …] [--json]";
const opts = { runs: [], json: false };
for (let i = 0, a = process.argv.slice(2); i < a.length; i++) {
  if (a[i] === "--json") opts.json = true;
  else if (a[i] === "--run") opts.runs.push(a[++i]);
  else die(`unexpected argument "${a[i]}"\n${USAGE}`);
}
if (!opts.runs.length) die(USAGE);

// ── the three clearance products, by their real policy keys ──────────────────────────────────────────
//
// Keyed by `level`, which is the field a frozen policy carries — `depthFor` reads `level ?? product`, and
// a hand-built object naming neither resolves to `default-ungraded` (refusal 1).

const PRODUCTS = [
  { key: "full-country-search",        label: "product 4 · one country",   graded: false },
  { key: "multi-country-focus-search", label: "product 3 · multi-country", graded: true },
  { key: "global-preliminary-search",  label: "product 2 · worldwide",     graded: true },
];

const depths = PRODUCTS.map((p) => {
  const depth = depthFor({ level: p.key });
  // REFUSAL 1 — an unresolved row makes every finding `full` everywhere and the census reads as "no saving".
  if (String(depth?.source ?? "").startsWith("default-ungraded") || String(depth?.source ?? "").startsWith("ungraded:"))
    die(`"${p.key}" did not resolve to a graded depth row — depthFor stamped it \`${depth?.source}\`.\n`
      + "  Every finding would read as a full card and this census would report that the ladder saves\n"
      + "  nothing, which is what a DEAD ladder looks like from the outside. Refusing to count.");
  return { ...p, depth };
});

// ── the census, one run at a time ────────────────────────────────────────────────────────────────────
//
// Per run, never blended: one run is one draw, and a mean over four scenarios hides the scenario that
// makes the decision. The range is printed after the rows, as a range.

const rows = [];
for (const runDir of opts.runs) {
  if (!existsSync(runDir)) die(`no run directory at ${runDir}`);
  const P = paths(runDir);

  // The pipeline's own reader, imported rather than reimplemented: it falls back to a LENIENT parse when
  // the strict one rejects, and a census that bailed on a rejected file would report zero findings on
  // exactly the runs where the report joined many.
  const read = readFindingsForReport(P);
  const findings = read.findings ?? [];
  const byOrdinal = new Map(findings.filter((f) => f?.ordinal != null).map((f) => [f.ordinal, f]));
  // The population the card loop uses — withdrawn findings never reach a card in ANY product, so counting
  // them would inflate both sides and misstate the saving.
  const proseOrdinals = fullProseOrdinals(findings);

  const shape = safeReadJson(P.bandShape);
  const floorTiers = floorTierByMark(shape);
  const identicalFloors = [...floorTiers.values()].filter((t) => t === "identical").length;

  const row = {
    run: runDir,
    findings: findings.length,
    rejected: read.rejected ?? null,
    prose: proseOrdinals.length,
    bandShape: shape ? "present" : "absent",
    floorRows: shape ? floorTiers.size : null,
    identicalFloors: shape ? identicalFloors : null,
    products: {},
  };

  for (const p of depths) {
    // REFUSAL 2 — without the shape every floor reads as absent, so a graded count is low by exactly the
    // class that is not allowed to lose its card. Withheld, not printed low.
    if (p.graded && !shape) { row.products[p.key] = { withheld: "no band-shape.json — the floor class cannot be counted" }; continue; }
    const formOf = (f) => writeUpForm(p.depth, f, { floorTier: floorTiers.get(floorMarkKey(f?.mark)) ?? null });
    const full = proseOrdinals.filter((o) => formOf(byOrdinal.get(o)) === "full").length;
    row.products[p.key] = { full, entry: proseOrdinals.length - full, rung: p.depth.narrativeProse };
  }

  // REFUSAL 3 — the positive control. Same card predicate on both graded products by construction
  // (write-up-form.mjs says so); a divergence is this instrument being wrong, not a finding about the run.
  const g = depths.filter((p) => p.graded).map((p) => row.products[p.key]).filter((r) => r && !r.withheld);
  if (g.length === 2 && (g[0].full !== g[1].full || g[0].entry !== g[1].entry))
    die(`positive control FAILED on ${runDir}: the two graded products returned different card counts\n`
      + `  (${g[0].full}/${g[0].entry} vs ${g[1].full}/${g[1].entry}). They share one card predicate —\n`
      + "  `adversarial` and `adversarial+floors` differ in how the REMAINDER groups, not in which findings\n"
      + "  earn a card. A divergence means this census is wrong. Refusing to print a number.");

  rows.push(row);
}

// ── output ───────────────────────────────────────────────────────────────────────────────────────────

if (opts.json) { console.log(JSON.stringify({ rows }, null, 2)); process.exit(0); }

for (const r of rows) {
  console.log(`\n${r.run}`);
  console.log(`  findings read        ${String(r.findings).padStart(4)}${r.rejected ? `   LENIENT JOIN — strict parser rejected: ${r.rejected}` : ""}`);
  console.log(`  reach prose          ${String(r.prose).padStart(4)}   ${r.findings - r.prose} withdrawn or not prose-bearing`);
  console.log(`  band shape           ${r.bandShape === "present" ? `present — ${r.floorRows} floor row(s), ${r.identicalFloors} tier-identical` : "ABSENT — graded counts withheld (needs the workspace archive dir, not the pool dir)"}`);
  for (const p of depths) {
    const v = r.products[p.key];
    if (v?.withheld) { console.log(`  ${p.label.padEnd(22)} withheld — ${v.withheld}`); continue; }
    console.log(`  ${p.label.padEnd(22)} ${String(v.full).padStart(4)} full · ${String(v.entry).padStart(4)} entry   (rung ${v.rung})`);
  }
  const graded = r.products["global-preliminary-search"];
  if (graded && !graded.withheld)
    console.log(`  CARDS NOT AUTHORED   ${String(graded.entry).padStart(4)}   on either graded product; product 4 authors all ${r.prose}`);
}

// The range, as a range. A mean across runs would hide the scenario that decides the question.
const counted = rows.map((r) => r.products["global-preliminary-search"]).filter((v) => v && !v.withheld);
if (counted.length > 1) {
  const share = counted.map((v) => (v.full + v.entry ? v.entry / (v.full + v.entry) : 0));
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  console.log(`\nacross ${counted.length} run(s): cards not authored ${Math.min(...counted.map((v) => v.entry))}–${Math.max(...counted.map((v) => v.entry))}`
    + `, i.e. ${pct(Math.min(...share))}–${pct(Math.max(...share))} of prose-bearing findings. A RANGE, not a mean —`
    + "\n  one run is one draw, and the spread is the part a projection has to survive.");
}
if (counted.length && rows.some((r) => r.products["global-preliminary-search"]?.withheld))
  console.log(`\n${rows.filter((r) => r.products["global-preliminary-search"]?.withheld).length} run(s) withheld for want of a band shape — counted above only where it was present.`);
console.log("");
