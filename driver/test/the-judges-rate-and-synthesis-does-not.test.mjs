// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives findings through the synthesis recorder over a run that holds step 3's merged decisions
//
// THE RATING IN THE DECISIONS IS THE RATING (owner, 2026-10-01 and 2026-10-02).
//
// Step 3's judges rate each owner they carry and read how alike the marks are and how close the goods are;
// code merges the ratings, the higher where they differ, and stamps each finding's band and its two record
// reads from them, the reads from the judge whose rating was taken. Synthesis keeps its placements and its
// research reads and is told, in the owner's own sentence, not to rate again. A finding is made only for an
// owner the judges carried, a rated owner is never placed as awareness only, the run's overall rating is
// the judges' overall merged the same way, and a set-aside owner is listed under "also considered" with the
// judges' reason. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { STAGES } from "../stages.mjs";
import { recordSynthesis } from "../synthesis-record.mjs";
import { deriveDisplayVerdict } from "../findings-model.mjs";
import { searchDepthRecord } from "../publish/search-depth.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" }, { label: "Low", tone: "low" }],
  structure: { kind: "bands" },
});
const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
// The fixture's one finding: owner "Mystery Owner LLC", registration /mark/us/90000001.
const DECISIONS = {
  schema_version: 1, judges: { asked: 2, answered: [1, 2] },
  overall_ratings: [{ judge: 1, rating: "Medium" }, { judge: 2, rating: "High" }],
  carried: [{ owners: ["Mystery Owner LLC"], owners_in_the_pile: [], records: ["/mark/us/90000001"], web: [],
    ratings: [{ judge: 1, rating: "Medium", marks_alike: "close", goods_close: "different" }, { judge: 2, rating: "High", marks_alike: "same", goods_close: "overlapping" }],
    carried_by: [1, 2], decisions: [] }],
  set_aside: [{ owners: ["Quiet Holder GmbH"], owners_in_the_pile: [], records: ["/mark/de/30000002"], web: [], set_aside_by: [1, 2],
    decisions: [{ judge: 2, decision: "set_aside", reason: "Lapsed for non-renewal." }, { judge: 1, decision: "set_aside", reason: "A different mark for different goods." }] }],
};

function run({ decisions = DECISIONS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "judged-rating-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "framework.json"), JSON.stringify(MANIFEST, null, 2));
  if (decisions) writeFileSync(join(dir, "owner-decisions.json"), JSON.stringify(decisions, null, 2));
  return dir;
}
const doc = (dir, over = {}) => { const d = JSON.parse(synthesisFindings(dir)); Object.assign(d.findings[0], over); return d; };
const written = (dir) => JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings;

test("synthesis is told not to rate: the rating instructions leave its message and the owner's sentence stands at its inputs line", () => {
  const paths = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `<${k}>` : undefined) });
  const message = String(STAGES.synthesis.message({ paths, job: { mark: "VELTRIN" }, profile: { key: "demo" }, framework: MANIFEST,
    intakeAsks: [], registerOnly: false }));
  const inputs = message.indexOf("Inputs: merged decisions");
  assert.ok(inputs >= 0, "the inputs line is gone, so the sentence has no place to stand");
  assert.ok(message.slice(inputs).split("\n")[1]?.trim() === "The rating in the decisions is the rating. Do not rate again.",
    "the owner's sentence is not the line after the inputs line");
  for (const gone of ["FRAMEWORK IN FORCE", "RATING CALIBRATION CHALLENGE", "USE-MEETS-USE BASIS", "RESPONSE-BAND COHERENCE",
    "- band: the framework's band WORD", "- borderline_between:", "rate each conflict net of merits defences",
    `"band" (rated findings only)`, `"borderline_between" (OPTIONAL`])
    assert.ok(!message.includes(gone), `synthesis is still told to rate: "${gone}"`);
  // …nor to read the marks or the goods, which the judges now do (owner, 2026-10-02); the two research reads stay.
  for (const gone of ["mark_similarity = high | medium | low", "goods_proximity = high | medium | low", `"mark_similarity":{...}`,
    `"goods_proximity":{...}`, `"medium" is the honest middle`])
    assert.ok(!message.includes(gone), `synthesis is still told to read the marks or the goods: "${gone}"`);
  assert.ok(message.includes("enforcer = high | medium | low | unknown") && message.includes("use = confirmed | not-confirmed | unknown"),
    "the two research reads left with the record reads");
});

test("code stamps each finding's band from the judges' merged decisions, the higher where they differ", () => {
  const dir = run();
  try {
    const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: doc(dir, { band: "Low", borderline_between: ["Low", "Medium"] }) });
    assert.equal(r.refused, null, String(r.refused));
    const [f] = written(dir);
    assert.equal(f.band, "High", "the band the call typed survived, or the judges' disagreement did not resolve to the higher");
    assert.equal(f.borderline_between, undefined, "a band declaration survived a band the judges set");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the two record reads come from the judge whose rating was taken, and the research reads stay the writer's", () => {
  const meters = (dir) => written(dir)[0].meters;
  const dir = run();
  const tie = run({ decisions: { ...DECISIONS, carried: [{ ...DECISIONS.carried[0], ratings: [
    { judge: 2, rating: "High", marks_alike: "close", goods_close: "same" }, { judge: 1, rating: "High", marks_alike: "different", goods_close: "overlapping" }] }] } });
  const before = run({ decisions: { ...DECISIONS, carried: [{ ...DECISIONS.carried[0], ratings: [{ judge: 1, rating: "Medium" }, { judge: 2, rating: "High" }] }] } });
  try {
    const typed = doc(dir);
    const ownReads = { use: typed.findings[0].meters.use, enforcer: typed.findings[0].meters.enforcer };
    assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: typed }).refused, null);
    // Judge 2 rated High, the higher: judge 2's reads, "same" and "overlapping" — never judge 1's.
    assert.deepEqual([meters(dir).mark_similarity.token, meters(dir).goods_proximity.token], ["high", "medium"]);
    assert.equal(meters(dir).mark_similarity.basis, "inferred-from-signal", "a read reached the card as a fact taken from a source");
    assert.deepEqual({ use: meters(dir).use, enforcer: meters(dir).enforcer }, ownReads, "the writer's research reads were overwritten");
    // Both rated High: the lower-numbered judge's reads, whatever order the decisions list them in.
    assert.equal(recordSynthesis(tie, { narrative: NARRATIVE, findings: doc(tie) }).refused, null);
    assert.deepEqual([meters(tie).mark_similarity.token, meters(tie).goods_proximity.token], ["low", "medium"]);
    // Decisions from before the judges were asked for reads: the reads the writer gave stand.
    const given = doc(before);
    assert.equal(recordSynthesis(before, { narrative: NARRATIVE, findings: given }).refused, null);
    assert.deepEqual(meters(before).mark_similarity, given.findings[0].meters.mark_similarity);
  } finally { for (const d of [dir, tie, before]) rmSync(d, { recursive: true, force: true }); }
});

test("a finding the judges did not carry is refused, and so is a rated owner placed as awareness only", () => {
  const dir = run();
  try {
    const stray = recordSynthesis(dir, { narrative: NARRATIVE, findings: doc(dir, {
      owner: { name: "Nobody Carried Ltd", country: "US", registrations: [{ uri: "/mark/us/90000077" }] } }) });
    assert.match(String(stray.refused), /^synthesis_finding_not_carried:1 /);
    const offField = recordSynthesis(dir, { narrative: NARRATIVE, findings: doc(dir, { disposition: "off-field", off_field_ground: "no-material-risk", band: undefined }) });
    assert.match(String(offField.refused), /^synthesis_placement_contradicts_rating:1 — the judges rated this owner High/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the owner joins where the link does not, and a run with no decisions keeps the band its writer gave", () => {
  const judged = run();
  const legacy = run({ decisions: null });
  try {
    const byOwner = recordSynthesis(judged, { narrative: NARRATIVE, findings: doc(judged, {
      owner: { name: "Mystery Owner LLC", country: "US", registrations: [] },
      source: { source_type: "common-law-web", resolved_link: "https://shop.example.test/a-page-no-judge-cited" } }) });
    assert.equal(byOwner.refused, null, String(byOwner.refused));
    assert.equal(written(judged)[0].band, "High");
    const kept = recordSynthesis(legacy, { narrative: NARRATIVE, findings: doc(legacy, { band: "Medium" }) });
    assert.equal(kept.refused, null, String(kept.refused));
    assert.equal(written(legacy)[0].band, "Medium", "a run begun before step 3 was judged by owner lost its own rating");
  } finally { rmSync(judged, { recursive: true, force: true }); rmSync(legacy, { recursive: true, force: true }); }
});

test("the overall rating is the judges' overall where there is one, and the worst finding everywhere else", () => {
  const findings = [{ ordinal: 1, band: "Medium", disposition: "adversarial" }];
  const judged = deriveDisplayVerdict({ verdict: "CLEAR", reasons: [], kinds: {}, findings, manifest: MANIFEST, overallBand: "High" });
  assert.equal(judged.tier, "High");
  assert.equal(judged.band.label, "High");
  const legacy = deriveDisplayVerdict({ verdict: "CLEAR", reasons: [], kinds: {}, findings, manifest: MANIFEST });
  assert.equal(legacy.tier, "Medium");
});

test("a set-aside owner is listed under also considered with the judges' reason, the lower-numbered judge's", async () => {
  const { setAsideReasons, setAsideKey } = await import("../decision-ratings.mjs");
  const reasons = setAsideReasons(DECISIONS);
  const auditMd = "# Negative Results\n\n## NR1\n- source_layer: Register\n- search_term: QUIETMARK\n- notes: URI /mark/de/30000002; screen_verdict=drop:dead; class=9; status=EXPIRED\n";
  const record = searchDepthRecord({ auditMd, setAsideReasonOf: (uri) => reasons.get(setAsideKey(uri)) ?? null });
  assert.equal(record.cleared.register[0].reason, "A different mark for different goods.");
  const plain = searchDepthRecord({ auditMd });
  assert.equal(plain.cleared.register[0].reason, undefined, "a run with no decisions grew a reason");
});
