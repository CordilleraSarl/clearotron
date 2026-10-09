#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// band-shape-probe.mjs — does CLEAROTRON_ORDER_PROBE_SEED move the band shape, and does it move the TIERS?
//
//   node scripts/band-shape-probe.mjs --run <preserved run dir> [--seed 7] [--json]
//
// Read-only and free: no model turn, no register call, no queue admission, nothing written anywhere. It
// re-derives the shape twice from a preserved band and diffs the two in memory.
//
// ── what it is for, and what it is NOT for ───────────────────────────────────────────────────────────
//
// The original spec asked for seeded-versus-unseeded `register-digest` arms and would have reported a
// noise floor of 0%. This is the cheap check that establishes WHY, before anyone spends a model turn on
// it: the seam permutes the shape's LISTS, and every record's TIER comes from a per-record mechanical
// classifier that does not read order. So order cannot move a tier, and an order-based floor is zero by
// construction rather than by measurement.
//
// Two questions, and the second is the one that matters:
//
//   1. Does the seam move its input at all?  A seam that is inert when ARMED is worse than no seam —
//      it is the same absence-read-as-success shape, shipped deliberately. If this reports NO MOVEMENT,
//      that is a finding about the probe, not a failed experiment.
//   2. Does tier membership change?  It must not. If it ever does, the classifier has started reading
//      order and `order-probe.test.mjs`'s permutation-is-a-permutation invariant has broken.
//
// Neither question is the placement floor actually needs. That lives in the model-authored
// `placements.json` tiers and needs repeat paid arms. This bounds what the free measurement can say.
//
// ── which directory ──────────────────────────────────────────────────────────────────────────────────
//
// The agent WORKSPACE archive dir, not the published pool dir: the pool keeps report.md and findings.json
// but not `_driver/` or `_records/`, and without the band there is nothing to re-derive.

import "../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

import { paths } from "../driver/stages.mjs";
import { buildBandShape, deriveRegisterPositions } from "../driver/band-shape.mjs";
import { parseVariantManifestModel } from "../driver/variant-manifest-model.mjs";
import { readRecordArtifacts } from "../driver/registry-fidelity.mjs";
import { probeSeed } from "../driver/order-probe.mjs";

const die = (m, c = 2) => { console.error(`\n${m}\n`); process.exit(c); };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

// ── args ─────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = "usage: band-shape-probe.mjs --run <preserved run dir> [--seed <positive int>] [--json]";
const opts = { run: null, seed: "7", json: false };
for (let i = 0, a = process.argv.slice(2); i < a.length; i++) {
  if (a[i] === "--json") opts.json = true;
  else if (a[i] === "--run") opts.run = a[++i];
  else if (a[i] === "--seed") opts.seed = a[++i];
  else die(`unexpected argument "${a[i]}"\n${USAGE}`);
}
if (!opts.run) die(USAGE);
if (!/^\d+$/.test(String(opts.seed)) || Number(opts.seed) <= 0)
  die(`--seed must be a positive integer — probeSeed fails closed on anything else, so "${opts.seed}" would run an UNARMED second arm and report no movement.`);

// ── the inputs deriveBandShape uses, read the same way it reads them ─────────────────────────────────
//
// Deliberately mirrors driver/pipeline.mjs:441-490 rather than inventing a gathering step. If the two
// diverge, this probe measures a shape the run never had.

const runDir = opts.run;
if (!existsSync(runDir)) die(`no run directory at ${runDir}`);
const P = paths(runDir);

const band = readJson(P.registerNamedBand);
if (!band) die(`no readable ${P.registerNamedBand}\n  This needs the WORKSPACE archive dir, not the published pool dir — the pool keeps\n  report.md and findings.json but not the band.`);
if (!Array.isArray(band.enumerated) || !band.enumerated.length)
  die(`${P.registerNamedBand} holds no \`enumerated\` records — nothing to re-derive. An empty band is a finding about the run, not a probe result.`);

const targets = [];
// — TWO SILENT DEFECTS FIXED HERE, and both inverted this probe's answer.
//
// `P.profile` does not exist. `paths()` has 63 keys and none of them is `profile`, so `readJson(undefined)`
// threw, `readJson` swallowed it, and `job` was ALWAYS null — every `job?.*` read below was dead code. The
// file it wants is `_driver/profile.json`, which is what VALIDATOR_SIDECARS reaches by literal filename.
//
// `instructed?.markName` never matches what the driver writes. `pipeline.mjs` writes instructed-scope with
// the key `marks` (an array), never `markName`. The unit test wrote a synthetic `markName`, which is why
// the suite never caught it.
//
// Together they left `variant-manifest.json` as the ONLY working target source. Point this probe at a run
// without one — a pool dir, or a run whose manifest was prose-only — and targets is `[]`, every record
// classifies `unclassifiable`, floors is empty, `probeOrder` returns the identity on a list shorter than
// two, and the probe prints "NO MOVEMENT … This is a FINDING". That is the ruling's
// paid-arms-are-unnecessary branch, fired by a missing file. An absence read as a pass, in the tool whose
// job is to decide whether to spend money.
const job = readJson(driverDir(runDir, "profile.json"))?.job ?? null;
const instructed = readJson(P.instructedScope);
const instructedMarks = Array.isArray(instructed?.marks) ? instructed.marks : (instructed?.marks ? [instructed.marks] : []);
for (const n of [job?.markName, job?.name, ...instructedMarks, instructed?.markName]) if (n) targets.push(n);
if (existsSync(P.variantManifestModel)) {
  try {
    const m = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8"));
    targets.push(m.mark, m.dominant_element,
      ...m.elements.filter((e) => e.kind === "distinctive").map((e) => e.value),
      ...m.variants.map((v) => v.value));
  } catch { /* prose-only manifest — the job's mark still classifies */ }
}
// AND SAY SO WHEN THERE ARE NONE. With no target every record is `unclassifiable`, so the two questions
// below are answered about a shape the run never had — and both answers read as reassuring. This refuses
// instead, because "no movement" and "nothing to move" must never print the same.
if (!targets.filter(Boolean).length) {
  die(`no target mark could be recovered from ${runDir}\n`
    + "  Looked at: _driver/profile.json (.job.markName/.name), _driver/instructed-scope.json (.marks),\n"
    + "  variant-manifest.json (.mark/.dominant_element/.variants).\n"
    + "  Without a target every record classifies `unclassifiable`, floors is empty, and this probe would\n"
    + "  print NO MOVEMENT — which is the answer that cancels the paid arms. Refusing rather than saying it.");
}
const inScopeClasses = (instructed?.classes ?? instructed?.nice_classes ?? job?.classes ?? []).map(String);
const crowdContext = existsSync(P.crowdContext) ? readJson(P.crowdContext) : null;

let positions = null;
try { positions = deriveRegisterPositions(band.enumerated, recordDetailIndex(runDir)); }
catch { positions = null; }   // same best-effort as the run: a positions failure omits the projection

function recordDetailIndex(dir) {
  const byUri = new Map();
  for (const [uri, body] of readRecordArtifacts(dir)) {
    const basics = (Array.isArray(body?.basicRegistrationApplications) ? body.basicRegistrationApplications : [])
      .flatMap((b) => (Array.isArray(b?.basicRegistrations) ? b.basicRegistrations : []))
      .map((b) => b?.basicRegistrationNumber).filter(Boolean);
    const md = body?.madridDesignations;
    byUri.set(uri, {
      registrationNumber: body?.registrationNumber ?? null,
      applicationNumber: body?.applicationNumber ?? null,
      basicRegistrationNumbers: basics,
      madridDesignations: [...(Array.isArray(md?.protocol) ? md.protocol : []), ...(Array.isArray(md?.agreement) ? md.agreement : [])],
    });
  }
  return byUri;
}

// ── the two arms ─────────────────────────────────────────────────────────────────────────────────────

const derive = () => buildBandShape(band, { targets: targets.filter(Boolean).slice(0, 64), inScopeClasses, crowdContext, positions }).shape;

const before = process.env.CLEAROTRON_ORDER_PROBE_SEED;
delete process.env.CLEAROTRON_ORDER_PROBE_SEED;
if (probeSeed() !== null) die("CLEAROTRON_ORDER_PROBE_SEED is still armed after being deleted — refusing to report an unarmed baseline that is not one.");
const off = derive();

process.env.CLEAROTRON_ORDER_PROBE_SEED = String(opts.seed);
if (probeSeed() === null) die(`seed ${opts.seed} did not arm the probe — probeSeed fails closed and this arm would be identical to the baseline.`);
const on = derive();
if (before === undefined) delete process.env.CLEAROTRON_ORDER_PROBE_SEED; else process.env.CLEAROTRON_ORDER_PROBE_SEED = before;

// ── the diff ─────────────────────────────────────────────────────────────────────────────────────────

/** Every array of records the shape carries, by dotted path — the lists the seam could permute. */
function recordLists(shape, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(shape ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      if (v.some((x) => x && typeof x === "object" && (x.record_id || x.qid || x.query))) out.set(path, v);
    } else if (v && typeof v === "object") recordLists(v, path, out);
  }
  return out;
}

const idsOf = (list) => list.map((x) => x?.record_id ?? x?.qid ?? x?.query ?? JSON.stringify(x));
const tiersOf = (list) => list.map((x) => [x?.record_id ?? x?.qid ?? "", x?.tier ?? null]);

const listsOff = recordLists(off);
const listsOn = recordLists(on);

const rows = [];
for (const [path, a] of listsOff) {
  const b = listsOn.get(path) ?? [];
  const ia = idsOf(a), ib = idsOf(b);
  const orderMoved = JSON.stringify(ia) !== JSON.stringify(ib);
  const membersSame = JSON.stringify([...ia].sort()) === JSON.stringify([...ib].sort());
  rows.push({ path, n: a.length, orderMoved, membersSame });
}

// Tier membership across the WHOLE shape, keyed on record — the question that decides whether an
// order-seeded floor can be anything but zero.
const tierMap = (shape) => {
  const m = new Map();
  for (const [, list] of recordLists(shape)) for (const [id, tier] of tiersOf(list)) if (id && tier != null) m.set(id, tier);
  return m;
};
const tOff = tierMap(off), tOn = tierMap(on);
const tierMoves = [];
for (const [id, tier] of tOff) if (tOn.has(id) && tOn.get(id) !== tier) tierMoves.push({ record: id, off: tier, on: tOn.get(id) });

const byTierIdentical = JSON.stringify(off.by_tier ?? off.byTier ?? null) === JSON.stringify(on.by_tier ?? on.byTier ?? null);
const movedLists = rows.filter((r) => r.orderMoved);
const membershipBroken = rows.filter((r) => !r.membersSame);

if (opts.json) {
  console.log(JSON.stringify({
    run: runDir, seed: Number(opts.seed), records: band.enumerated.length,
    lists: rows, tier_moves: tierMoves, by_tier_identical: byTierIdentical,
    seam_moves_input: movedLists.length > 0, membership_broken: membershipBroken.length > 0,
  }, null, 2));
  process.exit(0);
}

console.log(`\n${"═".repeat(78)}`);
console.log(`band-shape order probe — ${runDir}`);
console.log(`seed ${opts.seed} · ${band.enumerated.length} enumerated records · classes ${inScopeClasses.join(", ") || "(none recorded)"}`);

console.log(`\n── the lists ${"─".repeat(65)}`);
console.log(`  ${"list".padEnd(46)} ${"n".padStart(5)}  order   members`);
for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
  console.log(`  ${r.path.padEnd(46)} ${String(r.n).padStart(5)}  ${(r.orderMoved ? "MOVED" : "same").padEnd(7)} ${r.membersSame ? "same" : "CHANGED"}`);
}

console.log(`\n── question 1: does the seam move its input? ${"─".repeat(33)}`);
if (movedLists.length) {
  console.log(`  YES — ${movedLists.length} of ${rows.length} record lists were permuted.`);
} else {
  console.log(`  NO MOVEMENT. This is a FINDING, not a failed experiment: an inert-by-default seam that is`);
  console.log(`  also inert when armed is the same absence-read-as-success shape, shipped deliberately.`);
  console.log(`  Either this run's lists are all shorter than 2 entries, or probeOrder is not reached from`);
  console.log(`  buildBandShape on this path. Check driver/band-shape.mjs's three probeOrder call sites.`);
}

console.log(`\n── question 2: does a tier move? ${"─".repeat(45)}`);
if (tierMoves.length) {
  console.log(`  ${tierMoves.length} record(s) changed tier. That should be IMPOSSIBLE — the classifier is`);
  console.log(`  per-record and order-independent, and order-probe.test.mjs pins it. Something has changed:`);
  for (const m of tierMoves.slice(0, 10)) console.log(`    ${m.record}: ${m.off} → ${m.on}`);
} else {
  console.log(`  NO. ${tOff.size} record(s) compared, none moved; the by_tier census is ${byTierIdentical ? "byte-identical" : "DIFFERENT (investigate)"}.`);
  console.log(`  So an order-seeded arm CANNOT produce a tier disagreement on the band shape, and a floor`);
  console.log(`  measured that way would be 0% by construction rather than by measurement.`);
}
if (membershipBroken.length) {
  console.log(`\n  ${membershipBroken.length} list(s) changed MEMBERSHIP, not just order — the permutation is not a`);
  console.log(`  permutation. That is a defect in the seam, not a probe result:`);
  for (const r of membershipBroken.slice(0, 10)) console.log(`    ${r.path}`);
}

console.log(`\n${"═".repeat(78)}`);
console.log(`This measures the BAND SHAPE only, and it is free. It is NOT the noise floor #217 needs.`);
console.log(`That floor lives in the model-authored placement tier (placement-model.mjs:46) and needs`);
console.log(`repeat paid arms on a named run dir with approved spend. Nothing here substitutes for it.`);
console.log(`Nothing was written. Exit code is 0 either way — this records, it does not judge.\n`);
process.exit(0);
