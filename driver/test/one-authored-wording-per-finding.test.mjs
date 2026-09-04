// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// one-authored-wording-per-finding.test.mjs — D3, shape 1 as ruled 2026-08-19 ("yes shape 1").
//
// The owner read a rendered card beside the typed fields and ratified the defect as REPETITION:
// "it should be 1 output and preferably the better prose output". report-card holds that wording; the
// typed `legal_position` / `practical_position` carry the reads it is written FROM.
//
// The subtraction on the client surface was already 's: the report suppresses the typed pair on any
// card carrying a "Risk assessment" bullet, and made that bullet a structure rather than a habit.
// What is left, and what these arms hold, is the ASK — what the two seats are told, and one guard that
// must survive the change rather than going quiet under it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import { prescriptionProseChecks } from "../predelivery-lint.mjs";

const P = {
  narrative: "/r/n.md", registerFindings: "/r/rf.md", commonLaw: "/r/cl.md", placement: "/r/p.md",
  seniorEyeReview: "/r/le.md", matterContext: "/r/mc.md", report: "/r/report.md",
  reportOverview: "/r/ro.md", findings: "/r/findings.json", variantManifest: "/r/vm.md",
  reportCard: (a) => `/r/card-${a}.md`, runDir: "/r",
};
const FINDING = {
  ordinal: 1, mark: "NOVAPULSE", band: "high",
  owner: { name: "Lumengarde SA", registrations: [{ uri: "/mark/eu/018123456", classes: [9], status: "Registered", jurisdiction: "EU" }] },
  source: { source_type: "register-euipo", resolved_link: "https://tm.example/m/018123456" },
};
const synthesisText = () => String(STAGES["synthesis"].message({ paths: P, job: {}, profile: {} }) ?? "");
const cardText = () => String(STAGES["report-card"].message({
  paths: P, job: {}, profile: {}, finding: FINDING, axis: "1", caseLawProfile: null,
}) ?? "");

// ── THE RULED DELETION ────────────────────────────────────────────────────────────────────────────
test("the card seat is no longer offered a `Filing` lead — ruled dropped", () => {
  const text = cardText();
  assert.equal(/"Filing"[,)]/.test(text), false, "the report-card dispatch still offers a Filing lead");
});

test("VOID CONTROL: the card dispatch composed, and still asks for the half that stays", () => {
  // Without this the arm above is satisfied by a message() that throws or returns "" — every
  // absence assertion passes loudest on an empty string, which is the shape of a broken composer
  // rather than a ruling carried out.
  const text = cardText();
  assert.ok(text.length > 2000, `report-card dispatch composed to ${text.length} chars — too short to be the real one`);
  assert.match(text, /Send `full_detail`/);
  assert.match(text, /"Risk assessment"/, "the read lead must still be dictated — #1388 made it required");
  assert.match(text, /reportcard_read_lead_missing/, "and the dispatch must still name the refusal");
});

// ── WHAT SYNTHESIS IS TOLD ITS TWO FIELDS ARE FOR ─────────────────────────────────────────────────
test("synthesis is no longer told the two positions render VERBATIM on the report", () => {
  // They do not, on a rated finding: suppresses them wherever the card carries the read. Leaving
  // the claim in would keep asking a seat for a second client paragraph nobody prints.
  const text = synthesisText();
  const claim = /legal_position[\s\S]{0,2000}?these fields render VERBATIM on the report/;
  assert.equal(claim.test(text), false, "the positions dictation still claims a verbatim render");
});

test("and it IS told which finding the card speaks for, so the ask is not merely shorter", () => {
  const text = synthesisText();
  assert.match(text, /WHO READS THEM DEPENDS ON THE FINDING/);
  assert.match(text, /An OFF-FIELD finding gets NO card, and there these two fields ARE what the client reads/);
});

test("VOID CONTROL: the synthesis dispatch composed, and the rules that must NOT move are still in it", () => {
  const text = synthesisText();
  assert.ok(text.length > 5000, `synthesis dispatch composed to ${text.length} chars — too short to be the real one`);
  // The split, the anti-averaging rule and the prescription ban are what makes the two fields worth
  // having at all. D3 changes who reads them, not what they must contain.
  assert.match(text, /never blurred, never averaged/);
  assert.match(text, /NEVER prescribe/);
  assert.match(text, /a prescription typed here is a delivery defect the lint flags/);
});

// ── THE GUARD THAT MUST NOT GO QUIET ──────────────────────────────────────────────────────────────
//
// A converted field takes its guards quiet, not red. `prescriptionProseChecks` scans the two positions
// for advice-shaped language; asking for a TIGHTER field gives it less prose to scan, and less prose
// reads as clean. This is the proof that the check can still fail on the shape D3 asks for — a
// compact, fact-shaped read that smuggles in a prescription.
test("the prescription scan still FAILS on a compact typed read — the ask got tighter, the guard did not", () => {
  const compact = [{
    ordinal: 1, disposition: "adversarial",
    legal_position: "Identical mark, class 9 overlap, senior by six years.",
    practical_position: "Owner active in the lane. We recommend narrowing the goods before filing.",
  }];
  const checks = prescriptionProseChecks({ reportMd: "", clientSummaryMd: "", findings: compact, fourAnswers: {} });
  const zone = checks.find((c) => c.surface === "content-model");
  assert.ok(zone, "the content-model zone did not run at all — the scan cannot fail on what it never reads");
  assert.equal(zone.pass, false, "a prescription inside a compact typed read must still be flagged");
  assert.match(String(zone.detail ?? ""), /narrowing the goods/);
});

test("VOID CONTROL: the same compact shape with no prescription passes, so the arm above is not always-red", () => {
  const clean = [{
    ordinal: 1, disposition: "adversarial",
    legal_position: "Identical mark, class 9 overlap, senior by six years.",
    practical_position: "Owner active in the lane; two oppositions filed in this class since 2021.",
  }];
  const checks = prescriptionProseChecks({ reportMd: "", clientSummaryMd: "", findings: clean, fourAnswers: {} });
  const zone = checks.find((c) => c.surface === "content-model");
  assert.ok(zone, "the content-model zone did not run");
  assert.equal(zone.pass, true, `a clean compact read must pass: ${zone.detail ?? ""}`);
});
