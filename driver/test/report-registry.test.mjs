// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The level → report mapping, and the republish dispatch that reads it.
//
// A report must never describe work other than the work that ran. Before this, the renderer was picked
// ~3000 lines downstream of the registry by dispatching on `pipeline`, and NO renderer read the level:
// a Depth 2 run — register hit-counts and all — published a document that never said what it was.
// `report` now sits on the same registry row as the machinery, so the two cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { PRODUCT_POLICIES, reportIdentityFor, productCoverageNote } from "../search-policy.mjs";
import { templateOfMeta, republishRun } from "../publish/report-registry.mjs";

test("every level states its report identity — a new level cannot ship without one", () => {
  for (const [level, p] of Object.entries(PRODUCT_POLICIES)) {
    assert.ok(p.report, `${level} has no report descriptor`);
    assert.ok(["knockout", "clearance"].includes(p.report.template), `${level}: unknown template ${p.report.template}`);
    assert.ok(p.report.identity?.trim(), `${level} has no plain-English identity line`);
    // The template must match the machinery: a clearance-pipeline level rendering through the knockout
    // publisher (or the reverse) would hand the renderer a shape it cannot read.
    assert.equal(p.report.template, p.pipeline === "knockout" ? "knockout" : "clearance",
      `${level}: report template contradicts its pipeline`);
  }
});

test("the banner joins the stage label to the identity — this is the line the reader sees", () => {
  assert.equal(reportIdentityFor("knockout-register").banner, "Depth 2 — Knockout review with register hit-counts");
  assert.equal(reportIdentityFor("prelim").banner, "Depth 4 — Preliminary clearance");
  assert.equal(reportIdentityFor("knockout-search").banner, "Knockout search");
});

test("a FROZEN policy sidecar names WHICH level ran — the registry names what that level is called", () => {
  const frozen = { level: "knockout-register", pipeline: "knockout", stageLabel: "Depth 2" };
  const id = reportIdentityFor(frozen);
  assert.equal(id.template, "knockout");
  assert.equal(id.banner, "Depth 2 — Knockout review with register hit-counts");
  // ONE NUMBERING SYSTEM. The sidecar's own stageLabel used to WIN here, so a run delivered under an
  // older scale re-rendered under that scale — which meant the product had two names in circulation at
  // once. The registry now wins for any level it still knows: the sidecar decides WHICH level ran, the
  // registry decides what it is called. A run sold as "Stage 0.5" re-renders as "Depth 2" — the same
  // product, named the way the product is named today.
  const stale = reportIdentityFor({ level: "knockout-register", pipeline: "knockout", stageLabel: "Stage 0.5" });
  assert.equal(stale.banner, "Depth 2 — Knockout review with register hit-counts",
    "a retired label on the sidecar must not drag the old scale forward");
});

test("an unknown level degrades to the bare stage label rather than guessing a stage", () => {
  const id = reportIdentityFor({ level: "stage-nine-thousand", pipeline: "knockout", stageLabel: "Stage 9000" });
  assert.equal(id.identity, null, "no invented identity");
  assert.equal(id.template, "knockout", "but the pipeline still routes it to a renderer that can read it");
  assert.equal(id.banner, "Stage 9000");
  // Nothing at all is still better than a wrong stage.
  assert.equal(reportIdentityFor(null).banner, null);
  assert.equal(reportIdentityFor("nonsense").banner, null);
});

test("templateOfMeta reads the stamp that was always written and never read", () => {
  assert.equal(templateOfMeta({ template: "knockout", kind: "knockout-batch" }), "knockout");
  assert.equal(templateOfMeta({ template: "standard", kind: "clearance" }), "clearance");
  // Belt-and-braces for a meta written before the stamp existed: `kind` has been on every knockout meta.
  assert.equal(templateOfMeta({ kind: "knockout-batch" }), "knockout");
  assert.equal(templateOfMeta({}), "clearance", "the older shape is the clearance one");
});

// ── republish dispatch ────────────────────────────────────────────────────────────────────────────────
// The defect this closes: doRepublish called publishReport unconditionally, so `republish <knockout run>`
// died on a missing report.md — for a workspace that was perfectly intact. A report shape you cannot
// re-render is a report shape you cannot fix after delivery.

const wsWith = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "republish-ws-"));
  mkdirSync(driverDir(dir), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    writeFileSync(join(dir, rel), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
};

test("a knockout workspace routes to the knockout publisher — not to publishReport's report.md check", async () => {
  const runDir = wsWith({ "knockout-findings.json": { marks: [] } });     // no framework sidecar
  await assert.rejects(
    () => republishRun({ runId: "r", meta: { kind: "knockout-batch" }, pool: runDir, runDir }),
    /no _driver\/framework\.json/,
    "it got as far as the knockout publisher's own precondition, i.e. it dispatched correctly");
});

test("a knockout re-render REFUSES to invent the bands the run was rated under", async () => {
  // Re-rendering under today's framework instead of the run's frozen one would silently restate its
  // verdict. Loud refusal beats a report that quietly changed its mind.
  const runDir = wsWith({ "knockout-findings.json": { marks: [{ name: "X", rating: "High" }] } });
  await assert.rejects(() => republishRun({ runId: "r", meta: { template: "knockout" }, pool: runDir, runDir }),
    /cannot be re-rendered without the bands it was rated under/);
});

test("a clearance workspace still routes to publishReport, and still says so when it is not one", async () => {
  const runDir = wsWith({ "findings.json": [] });                         // no report.md
  await assert.rejects(() => republishRun({ runId: "r", meta: { kind: "clearance" }, pool: runDir, runDir }),
    /has no report\.md/);
});

// charter ruling 1 (2026-07-30) — the masthead depth strip: every registry level yields a coverage
// note naming what the depth covers and what it omits, so "the same section" at two depths cannot be
// confused. Derived from COMPONENTS (a recipe with overridden components speaks the truth), and
// null-safe for archived runs with no policy at all.
test("productCoverageNote: every level states its coverage; adjacent depths never read identically", () => {
  const notes = Object.keys(PRODUCT_POLICIES).map((lvl) => productCoverageNote(lvl));
  for (const [i, n] of notes.entries()) assert.ok(n && n.length > 20, `level #${i} has a coverage note`);
  assert.equal(new Set(notes).size, notes.length, "no two depths share a masthead note");
  assert.match(productCoverageNote("knockout"), /registers are not searched in this search/,
    "the RETIRED plain screen — the row that still names an archived run");
  assert.match(productCoverageNote("knockout-search"), /register hit-counts/,
    "the one Knockout search we offer carries the counts, and its note says so");
  assert.match(productCoverageNote("knockout-register"), /register hit-counts/);
  assert.match(productCoverageNote("prelim-register-only"), /unregistered \(common-law\) use is not covered/);
  assert.match(productCoverageNote("prelim"), /covers registered rights and unregistered \(common-law\) use/);
  assert.match(productCoverageNote("prelim-jx"), /native-script/);
});

// charter ruling 1, NAME-LED (match 's registry-name pills): the note LEADS with the product's
// registry name — never a rung ("Depth 4") and never the bare "This depth" — so the depth is visibly
// clear the way the pills made it clear: by naming the product.
test("productCoverageNote is name-led: every registry level's note leads with its report identity", () => {
  for (const lvl of Object.keys(PRODUCT_POLICIES)) {
    const name = reportIdentityFor(lvl).identity;
    assert.ok(productCoverageNote(lvl).startsWith(`${name} — `), `${lvl} leads with "${name}"`);
    assert.doesNotMatch(productCoverageNote(lvl), /^Depth \d/, `${lvl} never leads with a rung`);
  }
  assert.match(productCoverageNote("prelim"), /^Preliminary clearance — covers /);
  assert.match(productCoverageNote("knockout-search"), /^Knockout search — screens /);
});

test("productCoverageNote: a frozen sidecar's own components decide; no policy ⇒ null (archived runs stay silent)", () => {
  // a frozen prelim sidecar with the grid switched OFF must speak register-only truth in the clauses,
  // while the NAME stays the registry join for the level that ran (the doctrine: name what was
  // sold; the clauses disclose what actually ran).
  const frozen = { level: "prelim", pipeline: "clearance", components: { registerProbe: false, jxLanes: false, commonLawGrid: false } };
  assert.match(productCoverageNote(frozen), /^Preliminary clearance — /);
  assert.match(productCoverageNote(frozen), /unregistered \(common-law\) use is not covered/);
  // a level the registry no longer knows has no name to lead with — degrade to the nameless form,
  // never invent one
  const retired = { level: "gone-forever", pipeline: "clearance", components: {} };
  assert.match(productCoverageNote(retired), /^This search covers /);
  assert.equal(productCoverageNote(null), null);
  assert.equal(productCoverageNote("no-such-level"), null);
});

// ── the republish path threads the delivery overlay to BOTH templates ──────────────────────────
// THIS SEAM FAILS SILENTLY WHEN IT IS MISSED, which is why it is pinned at the source rather than left to
// a rendering test that would have to build a whole archived run dir. republishRun reads the run's frozen
// profile sidecar once (`prof`) and has always handed `delivery` to publishReport; the publishKnockout
// call beside it read the same `prof` and dropped it. With the confidentiality marking now decided by the
// profile, that gap means a republished privileged knockout loses "Attorney Work Product" and NOTHING
// raises an error — an absence, which this repo counts as a finding, not a pass.
test("#761 republishRun hands the frozen delivery overlay to the knockout publisher, not only the clearance", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../publish/report-registry.mjs", import.meta.url), "utf8");
  // Both publish calls, each carrying the overlay off the SAME frozen sidecar.
  assert.equal((src.match(/delivery: prof\?\.delivery,/g) ?? []).length, 2,
    "both publishReport and publishKnockout receive delivery: prof?.delivery");
  // And it is the frozen sidecar that supplies it — never a re-resolve against today's profiles/, which
  // would re-render an archived run under a posture its customer holds NOW rather than the one it shipped.
  assert.match(src, /const prof = readJsonOr\(driverDir\(runDir, 'profile\.json'\)\)/,
    "the overlay comes off the run's own frozen profile");
  // — the old hand-built spelling must not come back; this assertion is the only thing pinning
  // that the sidecar is read from the run rather than re-resolved.
  assert.doesNotMatch(src, /join\(runDir, '_driver'/);
  assert.doesNotMatch(src, /resolveProfile\(/, "a republish never re-resolves the profile");
});
