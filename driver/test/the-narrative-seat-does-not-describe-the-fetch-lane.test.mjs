// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// / part 2 — the clearance narrative seat does not characterise whether registry documents
// were obtained, and the renderer says so from the run's own records.
//
// A scored run on 2026-08-22 was refused by the reviewer: the narrative told the client, as a WHOLE-REPORT
// limitation, that no registry certificate was obtained and that every right's goods were therefore judged
// from class numbers rather than wording. The run's own record sidecar held 855 fetched bodies and nine
// findings recorded `meters.use.basis = "verified-from-record"` — and where the wording HAD been read, it
// contradicted the narrative on a headline conflict.
//
// The seat was not lying. The sidecar is not among its declared inputs, so it cannot see the fetch lane and
// it described the lane from the only thing it had. This is the third seat to do it: part 2 cured the
// knockout ASSESS seat, the SWEEP seat, and each cure was applied by hand to the seat that had just
// failed. Hence two halves here, and neither is sufficient alone:
//
//   the seat says nothing        it cannot see the lane, so anything it says is assumption
//   the RENDERER says it         from the records, in EVERY state — including the one where nothing was
//                                fetched, because silence there reads as "the wording was read"

import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import { documentCoverage, renderDocumentCoverageSection, spliceDocumentCoverage, canStateDocumentCoverage } from "../document-coverage.mjs";

/** The prohibition ruled, in the wording the seat now carries. */
const CARRIES_SILENCE = /SAY NOTHING ABOUT WHETHER REGISTRY DOCUMENTS WERE OBTAINED/;

/** Build the synthesis seat's real dispatch, the way the driver builds it. */
function synthesisPrompt() {
  const def = STAGES.synthesis;
  assert.ok(def && typeof def.message === "function", "the synthesis seat has no message builder — the "
    + "arms below assert over what this builds, so a seat this fixture cannot construct is a silent pass");
  // ONE destructured argument, the shape the driver passes. Every list-ish member is a real (empty) list:
  // the builder maps over several of them, and a fixture that threw would be a seat whose cure nothing
  // here checks — the failure the fixture calls out by name.
  const P = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `/tmp/1556-run/${k}` : undefined) });
  return String(def.message({
    paths: P, job: { markName: "VOLTARA", classes: [9] }, customerUnknown: false,
    profile: { key: "demo" }, intakeAsks: [], enforcerSignals: [],
    framework: { title: "House default", framework_key: "house-default", entity_label: "the applicant",
      bands: [{ label: "High" }, { label: "Manageable" }] },
    jxAim: null, registerOnly: false, crowdContext: null, dispatchBlocks: [], findingsSurface: [],
    depth: { narrativeProse: "every-finding" },
  }) ?? "");
}

test("#1556 the synthesis seat is told to say nothing about whether documents were obtained", () => {
  // Criterion 1, and criterion 3's failing half: on the code this replaces, the seat's dispatch and its
  // five skills files carried ZERO lines of this prohibition, so this arm reds there.
  const prompt = synthesisPrompt();
  assert.ok(prompt.length > 2000, `the synthesis dispatch built to ${prompt.length} chars — a fixture that `
    + "stopped building a real prompt would pass every arm below by having nothing to search");
  assert.match(prompt, CARRIES_SILENCE,
    "the clearance narrative seat carries no document-coverage prohibition. It cannot see the fetch lane, "
    + "so anything it writes about registry documents is assumption — and it has shipped one to a client.");
});

test("#1556 the prohibition names the SHAPE of the claim, not one sentence to avoid", () => {
  // The ruling is that the seat emits NO such claim. A prohibition keyed to the exact refused sentence
  // would be satisfied by rewording it, which is how a cure survives review and fails in production.
  const prompt = synthesisPrompt();
  const block = prompt.slice(prompt.search(CARRIES_SILENCE), prompt.search(CARRIES_SILENCE) + 1200);
  for (const shape of [/limitation/i, /caveat/i, /scope note/i, /aside/i, /whole-report/i])
    assert.match(block, shape, `the prohibition does not close the "${shape.source}" route`);
  assert.match(block, /cannot see the fetch lane/i, "and it must say WHY, or the next hand narrows it back");
});

// ── THE RENDERER: THE HALF THAT KEEPS THE SENTENCE HONEST RATHER THAN ABSENT ─────────────────────────

test("#1556 a run that DID retrieve documents is described as one that did", () => {
  // The refusal, inverted: this is the state the seat got wrong.
  const s = documentCoverage({
    records: new Map([["/mark/ch/1", { mark_text: "VOLTARA", goods: "class 9 apparatus" }],
      ["/mark/ch/2", { mark_text: "VOLTARAX", goods: "class 9" }]]),
    findings: { findings: [{ meters: { use: { basis: "verified-from-record" } } }, { meters: { use: { basis: "inferred" } } }] },
  });
  assert.equal(s.recordsWithBody, 2);
  assert.equal(s.findingsOnRecord, 1);
  const md = renderDocumentCoverageSection(s);
  assert.match(md, /Registry documents were retrieved/);
  assert.doesNotMatch(md, /No registry document was retrieved/,
    "a run holding two documents was described as holding none — that is the refused claim, from the renderer");
  assert.match(md, /1 of the 2 findings/, "and the finding count rides it, since that is what a reader weighs");
});

test("#1556 a run that retrieved NOTHING still gets the limitation — silence would read as coverage", () => {
  // Deleting the seat's claim without rendering anything would be worse than the defect here: a report
  // that says nothing about document coverage reads as one where the wording was read.
  const md = renderDocumentCoverageSection(documentCoverage({ records: new Map(), findings: { findings: [] } }));
  assert.match(md, /No registry document was retrieved/);
  assert.match(md, /not from the wording of the specification itself/,
    "the limitation must say what it costs the reader, not merely that it exists");
});

test("#1556 a record with NO body is a fetch receipt, not a document", () => {
  // 855 "fetched records" means nothing if a record can be its own address. This is the arm that stops the
  // renderer from making the opposite false claim to the one it was built to prevent.
  const s = documentCoverage({ records: new Map([["/mark/ch/1", { _uri: "/mark/ch/1", _fetchedAt: "2026-08-22" }]]) });
  assert.equal(s.recordsWithBody, 0, "a provenance-only artifact was counted as a retrieved document");
  assert.equal(s.recordsTotal, 1, "it is still a record — the two counts are different questions");
  assert.match(renderDocumentCoverageSection(s), /No registry document was retrieved/);
});

test("#1556 a MISSING artifact says so, and never renders as 'nothing was fetched'", () => {
  // The house rule, in the one place where getting it wrong puts a false limitation in front of a client:
  // null is "this run holds no such artifact", which is not zero.
  const s = documentCoverage({});
  assert.equal(s.recordsWithBody, null);
  assert.equal(canStateDocumentCoverage(s), false);
  const md = renderDocumentCoverageSection(s);
  assert.match(md, /holds no record of which registry documents were retrieved/);
  assert.doesNotMatch(md, /No registry document was retrieved for this search/,
    "an absent artifact was rendered as a measured zero — the defect, re-created by the cure");
});

test("#1556 the section NEVER renders empty, in any state", () => {
  // A heading with nothing under it asserts an absence it cannot explain, and a reader cannot tell it from
  // a run that retrieved everything. 's lesson, one lane over.
  for (const input of [undefined, {}, { records: new Map() }, { findings: { findings: [] } },
    { records: new Map([["a", { goods: "x" }]]), findings: { findings: [] } }]) {
    const md = renderDocumentCoverageSection(documentCoverage(input));
    assert.ok(md.trim().split("\n").filter((l) => l.trim() && !/^#/.test(l)).length >= 1,
      `an empty section rendered for ${JSON.stringify(input)}`);
  }
});

test("#1556 re-rendering REPLACES the section — two of them is the defect, manufactured by the cure", () => {
  // This renders on more than one pass. An appending splice would leave the report carrying two
  // document-coverage statements written from different states of the same run.
  const one = renderDocumentCoverageSection(documentCoverage({ records: new Map() }));
  const two = renderDocumentCoverageSection(documentCoverage({ records: new Map([["a", { goods: "x" }]]) }));
  const doc = spliceDocumentCoverage("# Register findings\n\nbody\n\n### Audit trail\n\nrows\n", one);
  const again = spliceDocumentCoverage(doc, two);
  assert.equal((again.match(/^## Document coverage$/gm) ?? []).length, 1, "the section was appended, not replaced");
  assert.match(again, /Registry documents were retrieved/, "and the later state is the one that survives");
  assert.match(again, /### Audit trail/, "the rest of the document is untouched");
});
