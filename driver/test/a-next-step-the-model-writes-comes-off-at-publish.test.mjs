// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-next-step-the-model-writes-comes-off-at-publish.test.mjs — a knockout name's read reaches the client
// without the next-step section the model wrote into it, and the run is not sent back to remove it.
//
// Measured on a delivered knockout (2026-09-19): the model gave each name four sub-headers, the last one
// "## What to do with it" over three bullets, and the pre-delivery check refused the whole chunk and
// re-asked it. The owner ruled for delivery over the loop: the section comes off in code, with no model
// call, and the run record says so. The first arm below is that shape, in invented words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { stripNextStepSections, isNextStepHeading } from "../knockout-next-step.mjs";
import { removeNextStepSections } from "../pipeline-knockout.mjs";
import { validators } from "../verify-knockout.mjs";
import { renderKnockoutHtml, splitOutcome } from "../publish/render-knockout.mjs";

const FW = {
  framework_key: "house-triage",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};

const READ = [
  "## What the name is", "",
  "A compound of two ordinary kitchen words, used as the name of a frozen drink.", "",
  "- It reads as a description of the drink's texture.", "",
  "## What the landscape looks like", "",
  "Two storefronts trade under close names in the same goods.", "",
  "## What drives the rating", "",
  "- One live filing in class 32 is the closest right.",
  "- Its owner sells syrups, not frozen drinks.",
].join("\n");
const NEXT = [
  "## What to do with it", "",
  "- Pull the class 32 owner's full goods list.",
  "- Check the two storefronts for first use.",
  "- Take the name to a full search before filing.",
].join("\n");
const DELIVERED_SHAPE = `${READ}\n\n${NEXT}`;

// ── the shape that was sent back ────────────────────────────────────────────────────────────────────

test("the delivered shape: the next-step section and its heading come off, and the read above is untouched", () => {
  const { text, removed } = stripNextStepSections(DELIVERED_SHAPE);
  assert.equal(text, READ, "the three sections before it must survive byte for byte");
  assert.deepEqual(removed.map((r) => r.heading), ["What to do with it"]);
  assert.equal(removed[0].chars, NEXT.length, "the record counts what was removed, heading included");
});

test("the chunk carrying that shape is accepted — the stage is not sent back to remove it", () => {
  const d = mkdtempSync(join(tmpdir(), "ko-next-"));
  mkdirSync(driverDir(d), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(driverDir(d, "framework.json"), JSON.stringify(FW));
  writeFileSync(join(d, "research", "ironwhisk.md"), "payload");
  const mark = {
    name: "IRONWHISK", classesSearched: [32], classesDriving: [32], contextFraming: "a frozen drink",
    rating: "Manageable", ratingQualifier: null, bullets: ["Scattered informal uses; no dominant owner."],
    basis: "A compound of two ordinary kitchen words, used informally by two small sellers.",
    factors: ["Two storefronts trade under close names in the same goods.", "No owner has consolidated the name."],
    counterFactors: ["Its closest filing's owner sells syrups, not frozen drinks."],
    mitigation: "", purpleNotes: [], registerEstimate: "few filings expected", findings: [], negatives: [],
    degraded: null, assessment: DELIVERED_SHAPE,
  };
  const r = validators.knockoutAssessChunk(driverDir(d, "knockout-assess-0.json"),
    JSON.stringify({ chunkSummary: "One name, rated Manageable.", batch: { productContext: "drinks" }, marks: [mark] }));
  assert.equal(r.ok, true, `the chunk was refused, which re-asks the model for an edit code now makes: ${r.reason}`);
});

test("the run record names what came off, per name; a name with nothing to remove is left exactly as written", () => {
  const d = mkdtempSync(join(tmpdir(), "ko-next-log-"));
  mkdirSync(driverDir(d), { recursive: true });
  const marks = [{ name: "IRONWHISK", assessment: DELIVERED_SHAPE }, { name: "COPPERWHISK", assessment: `${READ}\n` }];
  const rows = removeNextStepSections(d, marks);
  assert.equal(marks[0].assessment, READ, "the record that ships is the stripped one");
  assert.equal(marks[1].assessment, `${READ}\n`, "a read with no next step is not even re-trimmed");
  const logged = readFileSync(driverDir(d, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((r) => r.event === "knockout-next-step-removed");
  assert.equal(logged.length, 1, "one row, for the one name something came off");
  assert.equal(logged[0].mark, "IRONWHISK");
  assert.deepEqual(logged[0].headings, ["What to do with it"]);
  assert.equal(logged[0].chars, NEXT.length);
  assert.deepEqual(rows, logged.map(({ ts, ...row }) => row), "what the caller is told is what the record says");
});

test("the page: no next-step section, no heading left behind, and the read is still drawn", () => {
  const marks = [{ name: "IRONWHISK", rating: "Manageable", basis: "b", factors: ["f"], counterFactors: ["c"],
    mitigation: "", findings: [], assessment: DELIVERED_SHAPE }];
  const d = mkdtempSync(join(tmpdir(), "ko-next-page-"));
  mkdirSync(driverDir(d), { recursive: true });
  removeNextStepSections(d, marks);
  const html = renderKnockoutHtml({ marks, batch: { executiveSummary: "s" } }, FW,
    { runId: "r", overall: "Manageable", identity: { identity: "Knockout search" } });
  assert.doesNotMatch(html, /<h2>What happens next<\/h2>/);
  for (const gone of ["What to do with it", "full goods list", "Take the name to a full search"])
    assert.ok(!html.includes(gone), `"${gone}" still reaches the page`);
  for (const kept of ["What drives the rating", "Its owner sells syrups"])
    assert.ok(html.includes(kept), `"${kept}" was lost with the section`);
});

// ── the other shapes a heading takes ────────────────────────────────────────────────────────────────

test("a bold label opening a paragraph takes that paragraph and nothing after it", () => {
  // The shape a 2026-09-18 re-run wrote: "Practical next step — <NAME> is not knocked out at this screening
  // depth. Advance it to clearance…".
  const text = `${READ}\n\n**Practical next step** — IRONWHISK is not knocked out at this screening depth.\n`
    + "Advance it to clearance.\n\nThe storefront use is recent.";
  const out = stripNextStepSections(text);
  assert.equal(out.text, `${READ}\n\nThe storefront use is recent.`);
  assert.deepEqual(out.removed.map((r) => r.heading), ["Practical next step"]);
});

test("a section in the middle comes off without moving anything around it", () => {
  const text = "## The name\n\nA compound.\n\n## Recommendation\n\nProceed for now.\n\n## What drives the rating\n\nTwo storefronts.";
  assert.equal(stripNextStepSections(text).text, "## The name\n\nA compound.\n\n## What drives the rating\n\nTwo storefronts.");
});

test("a sub-heading inside the section goes with it; the next heading at its level stays", () => {
  const text = "## The name\n\nA compound.\n\n## What to do with it\n\n### Timing\n\n- Before filing.\n\n"
    + "## What drives the rating\n\nTwo storefronts.";
  assert.equal(stripNextStepSections(text).text, "## The name\n\nA compound.\n\n## What drives the rating\n\nTwo storefronts.");
});

test("a line that is only bold text heads a section that runs to the next heading", () => {
  const text = "**What the field shows**\n\nTwo storefronts.\n\n**Next steps:**\n\n- Search class 32.\n- Ask the client.\n\n"
    + "**What drives the rating**\n\nNo registered right.";
  assert.equal(stripNextStepSections(text).text,
    "**What the field shows**\n\nTwo storefronts.\n\n**What drives the rating**\n\nNo registered right.");
});

// ── what stays ──────────────────────────────────────────────────────────────────────────────────────

test("headings that are not next steps stay, and so does a body that merely uses the words", () => {
  // "What is still open" is what the same run wrote on its accepted attempt. A filing that proceeds to
  // REGISTRATION is a fact about a filing; the degraded note this lane requires says "recommended".
  const text = "## What the field shows\n\nThe older filing proceeds to registration in October.\n\n"
    + "## What is still open\n\n- Whether the storefronts predate the filing.\n\n"
    + "**Manual verification recommended** — the research payload was thin.\n\n"
    + "## Recommended by resellers\n\nThe name appears on two reseller lists.";
  const out = stripNextStepSections(text);
  assert.equal(out.text, text, "nothing here is a next step, and the text comes back byte for byte");
  assert.deepEqual(out.removed, []);
});

test("THE STATED LIMIT: a closing sentence with no heading over it is not touched", () => {
  // Nothing bounds that sentence but judgement, and cutting a guess out of the client's read is worse than
  // leaving it. The instruction not to write one is what reaches it. If this arm is ever changed to expect
  // the sentence gone, the change is a new rule about the client's prose, and it is the owner's.
  const text = `${READ}\n\nOn this material IRONWHISK should proceed to a full clearance search.`;
  assert.equal(stripNextStepSections(text).text, text);
});

test("every heading the page would lift into a section of its own is one the pipeline removes first", () => {
  // The renderer still draws "What happens next" from a record written before this rule. Its test and the
  // strip's are the same function, so a heading cannot be lifted by one and missed by the other.
  for (const h of ["What to do with it", "What happens next", "Next steps", "Next step", "Recommendations",
    "Recommendation", "Practical next steps", "What to do"]) {
    const text = `${READ}\n\n## ${h}\n\nTake it to clearance.`;
    assert.ok(isNextStepHeading(`## ${h}`), `${h}: not recognised as a next step`);
    assert.ok(splitOutcome(text).outcome, `${h}: the page would not lift it — this arm needs a heading it would`);
    const { text: stripped } = stripNextStepSections(text);
    assert.equal(splitOutcome(stripped).outcome, "", `${h}: the page would still draw a section from it`);
    assert.ok(!stripped.includes("Take it to clearance"), `${h}: the section survived the strip`);
  }
});

test("a read that is nothing but a next-step section leaves an empty read, not a crash", () => {
  const { text, removed } = stripNextStepSections(NEXT);
  assert.equal(text, "");
  assert.equal(removed.length, 1);
});
