// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Wave D — 15c, 15a, 15b and A-4, which are one change wearing four numbers.
//
// The ruling reordered them for a reason: dependency-ordered repair needs the dependency graph, so
// declaring the undeclared outputs stopped being a follow-on and became the prerequisite. You cannot
// tell which stale stage feeds which without knowing who WROTE the artifact that moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { paths, STAGES, stageInputs, stageOutputs, dependencyOrder } from "../stages.mjs";
import { partitionDeliveryStale } from "../pipeline.mjs";
import { DISPATCH_EXTRAS } from "../stage-context.mjs";

const P = paths("/run");

test("15c — every stage's authored surface is declared, not just the one file out() names", () => {
  const named = (name, opts = {}) => stageOutputs(name, P, opts).map((f) => basename(f));
  assert.deepEqual(named("synthesis"), ["narrative.md", "findings.json"],
    "findings.json is the most-consumed artifact in the run and was undeclared");
  assert.ok(named("clearance-variants").includes("variant-manifest.json"));
  assert.ok(named("blind-frame").includes("blind-frame-model.json"));
  assert.ok(named("frame-diff").includes("frame-diff.json"));
  // a judge's pass writes the merged decisions and the settled coverage ledger, and four stages read them
  assert.deepEqual(named("owner-judgment", { axis: "1" }), ["owner-judgment-1.json", "owner-decisions.json", "register-coverage-ledger.json"]);
  assert.ok(named("register-unit", { axis: "primary-sweep" }).some((f) => f.includes("primary-sweep")));
  assert.deepEqual(stageOutputs("nope", P), [], "an unknown stage answers empty, never throws");
});

// THE TRAP the ruling names: a list a snapshot deletes from. The one such list left with the placement
// step that declared it, so a snapshot copies and deletes nothing, and stageOutputs is never a reason to.
test("15c — the declaration is NOT a destructive list: a snapshot deletes nothing", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const start = src.indexOf("function snapshotOutputs(");
  const snap = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(start >= 0 && /copyFileSync/.test(snap), "premise: the snapshot was found, and it copies");
  assert.ok(!/rmSync|unlinkSync/.test(snap),
    "a snapshot deletes again — findings.json in a destructive list would be deleted before every "
    + "forced synthesis, and since a corrective pass EDITS, the edit would land on a file that is gone");
  assert.ok(!/stageOutputs|outSibs/.test(snap), "the snapshot reads a list of files to act on again");
  const stagesSrc = readFileSync(new URL("../stages.mjs", import.meta.url), "utf8");
  assert.equal((stagesSrc.match(/outSibs:/g) ?? []).length, 0, "a stage declares files to delete before a re-run");
});

test("15a — the order is DERIVED from the two maps: a writer precedes every reader of what it writes", () => {
  assert.deepEqual(dependencyOrder(["report-card:1", "synthesis", "report-overview", "owner-judgment:1"], P),
    ["owner-judgment:1", "synthesis", "report-card:1", "report-overview"]);
  // the decisions ARE the edge for the judges: their pass writes them, and the sceptic and the review read them
  assert.deepEqual(dependencyOrder(["narrative-refutation", "skeptic", "owner-judgment:2"], P),
    ["owner-judgment:2", "skeptic", "narrative-refutation"]);
  // …and it holds however the input is shuffled — the relation decides, not the incoming order
  assert.deepEqual(dependencyOrder(["report-overview", "synthesis"], P), ["synthesis", "report-overview"]);
  assert.deepEqual(dependencyOrder(["synthesis", "report-overview"], P), ["synthesis", "report-overview"]);
  // findings.json IS the edge here: synthesis writes it, report-overview declares it as an input
  assert.ok(stageOutputs("synthesis", P).includes(P.findings));
  assert.ok(stageInputs("report-overview", P).includes(P.findings));
});

test("15a — unrelated labels keep their incoming order, so a dependency-free set behaves as it always did", () => {
  const cards = ["report-card:3", "report-card:1", "report-card:2"];
  assert.deepEqual(dependencyOrder(cards, P), cards, "no relation between them ⇒ stable, never re-sorted for its own sake");
  assert.deepEqual(dependencyOrder([], P), []);
  assert.deepEqual(dependencyOrder(["not-a-stage", "synthesis"], P), ["not-a-stage", "synthesis"],
    "an unknown label is carried, not dropped — a repair pass is not the place to discover a graph problem");
});

test("15a — mixed staleness is repaired, not suppressed: the guard's own partition still names the halves", () => {
  const mixed = [{ label: "synthesis" }, { label: "report-card:1" }, { label: "report-overview" }];
  const { tail, upstream } = partitionDeliveryStale(mixed);
  assert.deepEqual(upstream.map((s) => s.label), ["synthesis"]);
  assert.deepEqual(tail.map((s) => s.label), ["report-card:1", "report-overview"]);
  // the pass no longer REFUSES to repair because `upstream` is non-empty; it orders instead. The one
  // thing that must not happen — a tail rebuilt while its upstream is still stale — is what the order
  // prevents, and suppressing everything never prevented it, it moved the same work into a resume.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.ok(!/if \(staleStages\.length && !partitionDeliveryStale\(staleStages\)\.upstream\.length\)/.test(src),
    "the all-or-nothing gate is gone");
  assert.match(src, /dependencyOrder\(staleStages\.map/, "…replaced by the ordering");
});

test("15a — the upstream repair map is the honest scope statement", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const map = src.slice(src.indexOf("// item 15a — the UPSTREAM repair arms"), src.indexOf("export const DELIVERY_TAIL_LABEL_RE"));
  for (const label of ["owner-judgment:1", "owner-judgment:2", "synthesis", "narrative-refutation", "skeptic"])
    assert.ok(map.includes(`"${label}"`) || map.includes(`${label}:`), `${label} has a repair arm`);
  assert.match(src, /const rejudgeStale = \(ctx\) => runOwnerJudgment\(ctx,/, "the judges route through runOwnerJudgment, never a bare stage() — else the decisions and the ledger stay as the last pass wrote them");
  assert.match(map, /WILL NOT REPAIR/, "…and the map says in place what a missing entry means");
});

test("15b — the blocked pass writes down WHAT is stale, so the recovery has something to aim at", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /delivery-stale\.json/, "the set is recorded at the throw");
  assert.match(src, /labels: dependencyOrder\(staleStages\.map/, "…in dependency order, so reader and repair agree about what happens first");
  assert.match(src, /export async function repairStale\(/, "and there is an entry point that runs exactly it");
  const fn = src.slice(src.indexOf("export async function repairStale("), src.indexOf("export async function repairStale(") + 2400);
  assert.match(fn, /RE-DERIVE THE ORDER rather than trusting the file/,
    "the file names WHAT, the live graph says WHEN — a recorded order can go stale with the code");
  assert.match(fn, /return null/, "nothing recorded ⇒ the ordinary resume, so this can never become a requirement");
  assert.ok(!/publishReport|evaluateClientGate/.test(fn),
    "it recomputes and returns — an entry point that could also clear the delivery guard would be the guard deciding about itself");
});

test("A-4 — the skeptic declares what it consumes, and has an arm to be repaired by", () => {
  const inputs = stageInputs("skeptic", P).map((f) => basename(f));
  assert.ok(inputs.includes("plan-execution.json"), "the receipt skepticDeferralExtra is built from");
  assert.ok(inputs.includes("register-coverage-ledger.json"));
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const map = src.slice(src.indexOf("const UPSTREAM_STALE_REPAIR = {"), src.indexOf("export const DELIVERY_TAIL_LABEL_RE"));
  assert.match(map, /skeptic:/, "…and the arm that makes declaring it safe, which is why it waited for Wave D");
});

// ── — A RE-DISPATCH THAT DROPS THE STAGE'S DRIVER-COMPUTED BLOCKS ────────────────────────────────
//
// `UPSTREAM_STALE_REPAIR`'s entries each hand-roll their dispatch, and only `synthesis` composed the
// blocks its stage declares. `narrative-refutation` declares two — the plan audit and the deterministic
// registry check that compares the narrative's claims against the fetched records in `_records` — and
// the repair pass composed NEITHER. The second is reachable only through the composer, so on a repair
// pass it does not exist: the reviewer is re-asked without the driver's own contradiction check, which
// is the class of error that was delivered on the run was filed from.
//
// THE POPULATION IS DISCOVERED FROM `DISPATCH_EXTRAS`, NEVER TYPED HERE. A hand-written subject list
// would contain exactly the entries I had already read, which is the same blind spot with a test around
// it — so this arm fails on a stage declared later that nobody wired into the repair path.
test("every stale-repair arm carries the driver-computed blocks its stage declares", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const map = src.slice(src.indexOf("const UPSTREAM_STALE_REPAIR = {"), src.indexOf("export const DELIVERY_TAIL_LABEL_RE"));
  assert.ok(map.length > 100, "the map was not located — this arm must fail loudly rather than vacuously pass");

  const declared = {};
  for (const x of DISPATCH_EXTRAS) (declared[x.stage] ??= []).push(x.id);
  assert.ok(Object.keys(declared).length >= 3,
    `expected the declared extras, found ${JSON.stringify(Object.keys(declared))}`);

  // The one legitimate exception, named with its reason rather than skipped: runDigest composes
  // digestDispatchExtra itself, and passes the trigger, so its arm must NOT also compose.
  const COMPOSES_INTERNALLY = { "register-digest": /runDigest\(/ };

  let checked = 0;
  for (const [stageName, ids] of Object.entries(declared)) {
    const m = new RegExp(`\\n  "?${stageName}"?:\\s*([\\s\\S]*?)(?=\\n  "?[a-zA-Z-]+"?:|\\n\\};)`).exec(map);
    if (!m) continue;                      // no stale-repair arm for that stage — not this guard's business
    checked++;
    if (COMPOSES_INTERNALLY[stageName]) {
      assert.match(m[1], COMPOSES_INTERNALLY[stageName],
        `${stageName} is listed as composing internally but its arm no longer does`);
      continue;
    }
    assert.match(m[1], /repairStage\(|composeDispatchExtra\(/,
      `the stale-repair arm for "${stageName}" re-dispatches WITHOUT composing the blocks it declares `
      + `(${ids.join(", ")}) — the repair pass runs blind to its own driver-computed input`);
  }
  assert.ok(checked >= 3, `expected to check at least three arms, checked ${checked}`);
});

test("the shared repair dispatcher forces, and composes through the SAME composer as the fresh path", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const helper = /const repairStage = [\s\S]{0,400}?\n\};?/.exec(src)?.[0] ?? "";
  assert.ok(helper, "there is one dispatcher for every stale-repair arm, so a new arm cannot omit the blocks");
  assert.match(helper, /composeDispatchExtra\(name, ctx\)/,
    "the same composer the fresh dispatch uses — not a second, near-identical loop, which is the shape in which two things that must agree stop agreeing");
  assert.match(helper, /force: true/,
    "a repair that did not force would skip on the artifact it is repairing");
  assert.match(helper, /trigger: "stale-repair"/, "and it stays labelled as a repair");
});
