#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-plan-shape.mjs — recompile a recorded run's register plan from its own inputs and print
// the SHAPE of the result: how many questions run without being asked for, how many wait, and whether
// the waiting ones are waiting for the reading turn.
//
//   node scripts/register-plan-shape.mjs <run-directory>
//
// WHY THIS PRINTS COUNTS AND NOTHING ELSE. It exists to be run against recorded client runs, where the
// mark, the goods words, the owners and the records are not ours to quote anywhere — and a plan entry's
// own qid contains the mark, so even an identifier list would be a disclosure. What comes out is
// arithmetic: numbers, axis names and predicate names, all of which are vocabulary this repository
// already publishes. Nothing here reads a record, and nothing here can print one.
//
// IT WRITES NOTHING, which is the other half of being safe to point at a real run. The ordinary compile
// path freezes the plan it built and writes run-journal rows; this reads the same inputs and compiles
// in memory. A recorded run is evidence, and a tool that measures it must leave it byte-identical.
//
// WHAT IT IS FOR. The plan a recorded run froze was compiled by the compiler of its day. Reading that
// artifact says what the engine DID ask; it cannot say what today's engine WOULD ask. Recompiling from
// the run's own inputs answers the second question, which is the one a rule change has to be judged on.
//
// AN ABSENT INPUT IS A FINDING, NOT A DEFAULT. Every input is named and checked, and a missing one
// stops the run with the path that was looked for. A compile over a half-read run directory would
// produce a number, and a number produced that way is worse than no number.

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { paths } from "../driver/stages.mjs";
import { driverDir } from "../shared/driver-dir.mjs";   // — the run-directory layout has one namer; a literal here is how two spellings drift
import { compileRegisterPlan, awaitsReadingTurn, planMaxOrWidth } from "../driver/register-plan.mjs";
import { parseVariantManifestModel } from "../driver/variant-manifest-model.mjs";
import { registerCapabilities, registerUnavailableOffices } from "../driver/register-unreachable.mjs";
import { frameIdentifiedClassRows } from "../driver/matter-frame-record.mjs";
import { excludeHouseElement, mintSupplementalQid, HOUSE_ELEMENT_RECEIPT } from "../driver/register-plan.mjs";
import { inScopeClassList, registerJurisdictions } from "../driver/pipeline.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/**
 * The three kinds that run without being asked for (decision 10, as ruling 204 leaves it).
 *
 * READ OFF THE ENTRY, deliberately, rather than re-deriving the compiler's own test: this is a
 * measuring instrument, and an instrument that shares the mechanism it measures cannot disagree with
 * it. The subtlety worth stating is the third line — the BARE contains entry on the mark waits, and
 * only the goods-narrowed one is always on (ruling 180), so `provenance === "mark"` alone is not the
 * test and a reader who assumed it were would count a waiting entry as open.
 */
function openKind(e) {
  if (e.axis === "saturation-probe") return "saturation probe";
  if (Array.isArray(e.goods_text) && e.goods_text.length) return "goods-narrowed";
  if (e.provenance === "mark" && String(e.predicate) !== "default") return "identical mark";
  if (e.unsupported === true) return "unsupported (a disclosure, not a search)";
  return null;
}

export function planShape(plan) {
  const open = [], waiting = [], other = [], unexpected = [];
  for (const e of plan.entries ?? []) {
    if (awaitsReadingTurn(e.when)) { waiting.push(e); continue; }
    if (e.when) { other.push(e); continue; }
    const kind = openKind(e);
    if (kind) open.push({ e, kind }); else unexpected.push(e);
  }
  const byKind = {};
  for (const { kind } of open) byKind[kind] = (byKind[kind] ?? 0) + 1;
  const byAxis = {};
  for (const e of waiting) byAxis[e.axis] = (byAxis[e.axis] ?? 0) + 1;
  // EVERY entry by axis, waiting or not — the comparison against a frozen plan needs the whole
  // population per lane, not only the part that waits.
  const byAxisAll = {};
  for (const e of plan.entries ?? []) byAxisAll[e.axis] = (byAxisAll[e.axis] ?? 0) + 1;
  return { total: (plan.entries ?? []).length, open: open.length, byKind,
    waiting: waiting.length, byAxis, byAxisAll, parentGated: other.length,
    unexpected: unexpected.map((e) => `${e.axis}/${e.predicate}`) };
}

function inputsFor(runDir) {
  const P = paths(runDir);
  const need = (label, p) => {
    if (!existsSync(p)) {
      console.error(`register-plan-shape: ${label} is not in this run directory — looked for ${p}.`);
      console.error("  Without it the compile would be over a population this run never had. Refusing.");
      process.exit(2);
    }
    return p;
  };
  let manifest = parseVariantManifestModel(readFileSync(need("the variant manifest", P.variantManifestModel), "utf8"));
  // ── THE CLIENT'S OWN ELEMENT, IF THIS RUN VERIFIED THAT IT OWNS IT ──────────────────────────────
  //
  // MISSING FROM THE FIRST CUT, and it mattered on the first real run this tool was pointed at. Where
  // a run verified that the client owns an element of its own mark, that element leaves the conflict
  // analysis: the compile is handed the element so its form band becomes unreachable rather than
  // merely unasked-for, and a single confirmation question is appended in its place. On a matter that
  // is a house mark plus a tagline, that element can account for more than half the questions — so a
  // recompile that skipped it reported a population the run could never have had, in the direction of
  // too many. The condition is the receipt's own, exactly as the run applies it: an absent,
  // unreadable or unverified receipt excludes nothing, which is the safe direction and the one a
  // client is never harmed by.
  let houseElement = null, houseConfirmation = null;
  try {
    const receipt = readJson(driverDir(runDir, HOUSE_ELEMENT_RECEIPT));
    if (receipt?.verified === true) {
      const r = excludeHouseElement(manifest, { element: receipt.element, remainder: receipt.remainder });
      // REFUSED IS NOT APPLIED. The receipt answers who owns the element; the transform answers whether
      // this manifest's mark survives the cut. The run requires both, so this does too.
      if (!r.refused) { manifest = r.manifest; houseConfirmation = r.confirmation; houseElement = receipt.element; }
    }
  } catch { /* no receipt — nothing was verified, so nothing is excluded */ }
  const scope = readJson(need("the instructed scope", driverDir(runDir, "instructed-scope.json")));
  const profile = readJson(need("the customer profile", driverDir(runDir, "profile.json")));
  // OPTIONAL INPUTS ARE REPORTED, NOT DEFAULTED IN SILENCE. Each one that is absent removes questions
  // from the recompile, and an absence nobody is told about is indistinguishable from a compiler that
  // stopped asking them. A preserved run directory that lost an input recompiles exactly like a
  // compiler that retired a lane, and those are different facts.
  //
  // EACH LINE SAYS HOW MUCH, not that something is missing. The first cut said the form band "compiles
  // to nothing" — true, and read by a careful reader as a large number on every register. It is a large
  // number only where the register has no OR surface. That wording was acted on before it was measured.
  const absent = [];
  let form = null;
  if (existsSync(P.formNeighbourhood)) form = readJson(P.formNeighbourhood);
  else {
    // QUANTIFIED, AND BY THIS REGISTER, because the qualitative version of this line was misleading and
    // was acted on. The form band is OR-BATCHED at the provider's declared width, so on a register with
    // a wide OR surface the WHOLE band — eight terms or forty — compiles to one question plus one
    // wildcard fringe. Measured: 40 terms cost 2 questions on a 500-wide register and 41 on one with no
    // OR surface. "A whole lane compiles to nothing" reads as a large number on every register and is
    // one only on the narrow ones.
    const w = planMaxOrWidth(registerCapabilities());
    absent.push(`form-neighbourhood.json — the form band does not compile. On this register `
      + `(OR width ${w}) that is about ${w > 1 ? "2 questions however many terms the band held" : "one question per term in the band"}.`);
  }
  if (!existsSync(driverDir(runDir, HOUSE_ELEMENT_RECEIPT)))
    absent.push(`${HOUSE_ELEMENT_RECEIPT} — no element was excluded, so the client's own element is searched as a conflict`);
  if (!(manifest.goods_words ?? []).length)
    absent.push("goods_words on the manifest — no goods-narrowed question can compile from it");

  // THE RUN'S OWN RESOLVERS, NOT THE RAW FIELDS. An earlier cut read `scope.classes` and
  // `scope.jurisdictions` straight off the file. Two of those reads are wrong:
  //
  //   · A matter that instructed NO class falls back to the customer profile's defaults, so the raw
  //     read compiles an unscoped plan where the run compiled a scoped one — and a plan is always
  //     class-scoped, so the compiler would refuse outright rather than differ quietly.
  //   · Territories come off a shared ladder that reads the geography stamp, not off the field alone.
  //
  // MEASURED, because the obvious third claim is not true and was in this comment until it was
  // checked: a worldwide matter records `jurisdictions: null` and the resolver answers `[]`, which is
  // the SAME answer the raw read gives, and `[]` is correct — worldwide means no region clause at all.
  // The resolvers earn their place on the two cases above, not on that one.
  //
  // The whole scope object is handed over rather than two fields, so the ladder sees the stamp it reads.
  const job = { ...scope, jobKey: "shape-read" };
  return {
    manifest,
    job: { ...job, classes: inScopeClassList(job, profile), jurisdictions: registerJurisdictions(job, profile) },
    addedClasses: frameIdentifiedClassRows(runDir),
    form,
    houseElement,
    __houseConfirmation: houseConfirmation,
    __absent: absent,
    capabilities: registerCapabilities(),
    unavailableOffices: registerUnavailableOffices(),
  };
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("usage: node scripts/register-plan-shape.mjs <run-directory>");
    console.error("  Prints how many register questions run unasked and how many wait. Counts only —");
    console.error("  no marks, no terms, no identifiers. Writes nothing into the run directory.");
    process.exit(2);
  }
  const dir = resolve(runDir);
  if (!existsSync(dir)) { console.error(`register-plan-shape: no such run directory: ${dir}`); process.exit(2); }

  const inputs = inputsFor(dir);
  const plan = compileRegisterPlan(inputs);
  // THE ONE QUESTION THE EXCLUDED ELEMENT STILL OWES, appended after the compile exactly as the run
  // appends it: the element leaves the conflict analysis, and in its place the plan asks once whether
  // the client's own registrations are there. It is not derived from the manifest, so it cannot come
  // out of the compile — and a recompile that dropped it would under-count by one on every run that
  // excluded an element.
  if (inputs.__houseConfirmation && plan?.entries) {
    const used = new Set(plan.entries.map((e) => e.qid));
    plan.entries.push({ ...inputs.__houseConfirmation,
      qid: mintSupplementalQid({ prefix: "house", term: inputs.__houseConfirmation.term, used }),
      nice_classes: plan.nice_classes ?? [], regions: plan.regions ?? [] });
  }
  const s = planShape(plan);

  // WHICH REGISTER THIS BOX IS CONFIGURED FOR, because the shape depends on it — a provider that cannot
  // express a predicate stamps the entry unsupported, and unsupported entries are counted here. A
  // number read against the wrong provider is not this run's shape. The vendor name is vocabulary this
  // repository already publishes; nothing about the matter is.
  // ── AND WHAT THIS RUN ACTUALLY FROZE, BESIDE IT ────────────────────────────────────────────────
  //
  // The recompile answers "what would today's engine ask". On its own that number is uninterpretable:
  // the first real run this tool saw compiled 44 questions against 129 in the frozen plan, and nobody
  // could say from one number whether that was a deliberate removal, a defect, or a difference in the
  // inputs. Printed side by side and split by axis, the same two numbers say WHERE the population
  // moved, which is the question a reader actually has. Still counts only, and the frozen plan is read,
  // never rewritten.
  // THE CATCH IS NARROWED TO THE FILE BEING ABSENT, deliberately. A blanket catch here swallowed a
  // ReferenceError on the first cut — the path was read off a variable that is not in scope in this
  // function — and the comparison silently never printed, reading exactly like a run with no frozen
  // plan. An absent artifact is a fact about the run; anything else is a fault in this script and must
  // say so rather than look like one.
  let frozen = null;
  const frozenPath = paths(dir).registerPlan;
  if (existsSync(frozenPath)) frozen = planShape(JSON.parse(readFileSync(frozenPath, "utf8")));

  if (inputs.__absent?.length) {
    console.log("  INPUTS THIS RUN DIRECTORY DOES NOT CARRY — each one lowers the counts below:");
    for (const a of inputs.__absent) console.log(`      · ${a}`);
    console.log("");
  }
  console.log(`  register configured here    ${inputs.capabilities?.id ?? "none — CLEAROTRON_DATABASE is unset"}`);
  console.log(`  questions compiled          ${s.total}`);
  console.log(`  run without being asked for ${s.open}`);
  for (const [kind, n] of Object.entries(s.byKind).sort()) console.log(`      ${String(n).padStart(4)}  ${kind}`);
  console.log(`  waiting for the reading turn ${s.waiting}`);
  for (const [axis, n] of Object.entries(s.byAxis).sort()) console.log(`      ${String(n).padStart(4)}  ${axis}`);
  if (s.parentGated) console.log(`  waiting on a parent question ${s.parentGated}   (the crowd-gated fringe)`);
  if (plan.added_classes?.length) console.log(`  classes the frame added      ${plan.added_classes.length}`);

  if (frozen) {
    console.log(`\n  THIS RUN'S OWN FROZEN PLAN, for comparison — what it asked, not what today would ask:`);
    console.log(`  questions frozen            ${frozen.total}   (recompiled now: ${s.total})`);
    const axes = [...new Set([...Object.keys(frozen.byAxis), ...Object.keys(s.byAxis),
      ...(frozen.byAxisAll ? Object.keys(frozen.byAxisAll) : []), ...Object.keys(s.byAxisAll ?? {})])].sort();
    for (const a of axes) {
      const was = frozen.byAxisAll?.[a] ?? 0, now = s.byAxisAll?.[a] ?? 0;
      if (was || now) console.log(`      ${String(was).padStart(4)} -> ${String(now).padStart(4)}  ${a}`);
    }
    if (frozen.total !== s.total) {
      console.log(`\n  The two populations differ by ${Math.abs(frozen.total - s.total)}. Gating marks an entry WAITING,`);
      console.log("  it never removes one, so a difference here is the compiler's, not the gate's — the axis");
      console.log("  rows above say which lane moved. Expected where a lane was deliberately retired.");
    }
  }

  // THE PROPERTY, STATED AS A VERDICT the reader does not have to derive from the numbers above.
  // `unexpected` is the whole of it: an entry that neither waits nor is one of the three sanctioned
  // kinds is a question this plan would ask in the same breath as the identical mark.
  if (s.unexpected.length) {
    console.log(`\n  NOT HELD — ${s.unexpected.length} question(s) run unasked that are none of the three kinds:`);
    for (const u of [...new Set(s.unexpected)].sort()) console.log(`      ${u}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  HELD — every question outside the identical-mark, saturation and goods-narrowed set waits.");
}

if (isEntrypoint(import.meta.url)) main();
