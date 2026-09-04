// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-deduped-read-must-exist-on-the-card.test.mjs — the card's risk read is a STRUCTURE, not a habit.
//
// render.mjs suppresses the typed `legal_position` / `practical_position` pair on any card whose prose
// already carries a "Risk assessment"-led bullet (, ONE ACCOUNT PER FACT). Until now that gate was a
// regex over a lead the dictation calls OPTIONAL and this acceptance never read — the same shape the card
// INDEX was in before the driver bound it, which O3c measured at 224/0 and then made a structure.
//
// could live with a habit because the typed pair was the LAST copy, and it said so: a drifted lead
// meant the reader saw the DUPLICATE, "visible, and fixable at the contract". D3 removes that
// safety — once the typed fields stop carrying a second authored account, a card whose read is led
// anything else leaves the reader with NO risk read on any surface, and nothing says so. The failure
// direction inverts from visible-duplicate to silent-absence.
//
// So the two sites share ONE exported predicate, and these arms hold the join: what the renderer
// deduplicates against is exactly what acceptance requires, on the same rendered bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { acceptReportCard, READ_LEAD_RE } from "../report-card-record.mjs";

const FINDING = (ord = 2) => ({
  ordinal: ord, mark: "NOVAPULSE",
  owner: { name: "Lumengarde SA", registrations: [{ uri: "/mark/eu/018123456", classes: ["9"], status: "Registered", jurisdiction: "EU" }] },
  source: { source_type: "register-euipo", resolved_link: "https://tm.example/m/018123456" },
});
// Long enough to clear BODY_FLOOR_CHARS on its own, so no arm below can pass or fail for the floor's
// reasons instead of the read's.
const FILL = "Registered in class 9 since 2016 and renewed to 2031, in the applicant's own goods lane";
const call = (bullets) => ({ ordinal: "2", full_detail: bullets });
const accept = (bullets) => acceptReportCard(call(bullets), { boundOrdinal: "2", finding: FINDING() });

test("a card carrying the read is accepted — the normal path stays open", () => {
  const v = accept([
    { lead: "Filing", text: FILL },
    { lead: "Risk assessment", text: "The marks are near-homophones in the class the senior right covers" },
  ]);
  assert.equal(v.ok, true, v.reason);
});

test("a card with NO read is REFUSED — this is the arm that reds before the guard exists", () => {
  const v = accept([
    { lead: "Filing", text: FILL },
    { lead: "Enforcement", text: "The owner has opposed twice in this class in the last five years" },
  ]);
  assert.equal(v.ok, false, "a card with no risk read must not be accepted");
  assert.match(v.reason, /^reportcard_read_lead_missing/);
});

test("a DRIFTED lead is refused — the failure #763 could only make visible, made impossible", () => {
  // "Legal lever" is the exact drift §L names and forbids in the dispatch. The renderer's dedupe misses
  // it, so before D3 the reader saw both copies; after D3 they would see neither.
  const v = accept([
    { lead: "Filing", text: FILL },
    { lead: "Legal lever", text: "The marks are near-homophones in the class the senior right covers" },
  ]);
  assert.equal(v.ok, false, "a drifted read lead must not pass acceptance");
  assert.match(v.reason, /^reportcard_read_lead_missing/);
});

test("an INTERNAL-marked read does not satisfy it — the client is the reader the dedupe deletes for", () => {
  // `::p::` renders FIRST, before the bold lead-in, so the renderer's regex does not match and the typed
  // pair is NOT suppressed. Acceptance must agree: a staff aside is not the client's risk read.
  const v = accept([
    { lead: "Filing", text: FILL },
    { lead: "Risk assessment", text: "The marks are near-homophones in the class the senior right covers", internal: true },
  ]);
  assert.equal(v.ok, false, "an internal-only read leaves the client card with none");
  assert.match(v.reason, /^reportcard_read_lead_missing/);
});

test("an UNLED bullet whose text opens the read satisfies it — acceptance never refuses what the render dedupes", () => {
  // The render keys on the rendered line, not on the `lead` field, so `- Risk assessment ...` with no
  // lead-in fires the dedupe. If acceptance were stricter than the renderer it would refuse cards the
  // report handles correctly — the two must be one predicate, not two opinions.
  const v = accept([
    { text: "Risk assessment on these facts is that the marks are near-homophones in the class covered" },
    { lead: "Filing", text: FILL },
  ]);
  assert.equal(v.ok, true, v.reason);
});

test("the phrase MID-SENTENCE does not satisfy it — the render would not dedupe on it either", () => {
  const v = accept([
    { lead: "Filing", text: FILL },
    { lead: "Enforcement", text: "Our risk assessment is recorded elsewhere and the owner has opposed twice" },
  ]);
  assert.equal(v.ok, false, "a mid-sentence mention is not a read bullet on either side");
  assert.match(v.reason, /^reportcard_read_lead_missing/);
});

// ── THE PREMISE: ONE PREDICATE, TWO SITES ─────────────────────────────────────────────────────────
//
// The arms above prove acceptance behaves. This one proves the thing that makes it SAFE: the renderer
// tests the very regex this module exports. A copy in render.mjs that drifted by one character would
// leave both sides green and put the silent-absence case back, which is the whole defect.
test("the PREMISE: render.mjs deduplicates on this module's exported predicate, not on a copy of it", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const render = readFileSync(join(here, "..", "publish", "render.mjs"), "utf8");
  assert.match(render, /READ_LEAD_RE/, "render.mjs must import the shared predicate");
  assert.match(render, /const proseHasRead = READ_LEAD_RE\.test\(proseFull \|\| ''\)/,
    "the dedupe gate must BE the shared predicate — a re-typed literal is how the two drift apart");
  // The literal it replaced must be gone, or a later edit could revive the copy beside the import and
  // nothing would notice: an absence is the assertion here, deliberately.
  assert.equal(/Risk assessment\\b/.test(render), false,
    "no re-typed 'Risk assessment' regex may remain in render.mjs");
});

test("the predicate matches the RENDERED card, which is the string render.mjs sees", () => {
  const v = accept([
    { lead: "Filing", text: FILL },
    { lead: "Risk assessment", text: "The marks are near-homophones in the class the senior right covers" },
  ]);
  assert.equal(v.ok, true, v.reason);
  // Assert the rendered LITERAL, not the predicate applied to itself: an arm that ran the exported regex
  // over the exported renderer's output would stay green under a change that broke both.
  assert.match(v.content, /\n- \*\*Risk assessment\.\*\* The marks are near-homophones/);
  assert.equal(READ_LEAD_RE.test(v.content), true);
});
