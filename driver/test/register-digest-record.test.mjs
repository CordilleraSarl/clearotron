// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Conversion 11 — the register findings transport.
//
// THE ARMS THAT MATTER HERE ARE THE PARSER ARMS, and they are what this conversion rests on. Nine
// readers scan `register-findings.md` for headings, pipe tables and `/mark/…` uris; the claim that the
// driver can render a document they all read correctly is not a claim about this module's own reader,
// so it is driven through the REAL parsers rather than through a copy of their regexes. Conversion 3's
// finding, stated as a test: a render that matches its own parser can still be wrong for everything
// downstream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acceptRegisterDigest, renderRegisterFindings, emptyFacts, readDigestFacts, joinKey,
  identifierCells, mergeDigestPatch, recordRegisterDigest, refusalsFor, registerDigestCallPaths,
  registerDigestWasRecorded, lastAcceptedModel, FACTS_FILE, FINDINGS_FILE,
  VERIFY_VALUES, ADJUDICATION_DECISIONS,
} from "../register-digest-record.mjs";

// THE REAL PARSERS. Every import here is a live consumer of the document this module renders.
import { parseFindingsEndings } from "../recall-reconciliation.mjs";
import { parseCarrySurfaces } from "../placement-carry.mjs";
import { findScreenGateParseGaps } from "../screen-gate.mjs";
import { readAnchors } from "../anchor-reader.mjs";
import { TOOL_WRITTEN_ARTIFACTS } from "../gateway.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

// containment — a bare mktemp lands on /mnt and the guard refuses; the refusal is then MINE and
// not the one under test.
const newRun = () => mkdtempSync(join(process.env.TMPDIR || tmpdir(), "digest-record-"));

const REC_A = {
  record_id: "/mark/eu/018999001", mark_text: "THORNMANTLE", owner_name: "Nordbro Advokater",
  owner_country: "DK", classes: ["09", "41"], status: "Registered",
  application_date: "2021-09-07", expiry_date: "2031-09-07",
};
const REC_B = {
  record_id: "/mark/us/99999", mark_text: "ACME GADGET", owner_name: "Dead Co",
  classes: ["25"], status: "dead", screen: { screen_verdict: "drop:dead" },
};

function factsWith(...records) {
  const f = emptyFacts();
  f.identity = { mark: "Thornmantle", date: "2026-05-11", provider: "corsearch" };
  f.recordHost = "https://records.trademark.test";
  f.counts = [["total queries executed (search + detail-fetch)", 50], ["enumerated records", records.length]];
  f.auditRows = [{ unit: "primary-sweep", searches: 12, detail_fetches: 4, query: "q1" }];
  f.readIds = ["/mark/eu/018999001"];
  for (const r of records) f.recordsByUri.set(joinKey(r.record_id), r);
  return f;
}

const FULL_CALL = {
  findings_rows: [{ uri: "/mark/eu/018999001", flag_reason: "exact dominant element in class 9", verify: "yes" }],
  negative_rows: [{ uri: "/mark/us/99999", drop_reason: "off-field — relevance gate", ground: "off-field", variant: "acme gadget (default)" }],
  instructed_checks: [{ ask: "Any EU oppositions?", answer: "None in the frozen band." }],
  disagreement_resolutions: [{ subject: "PHINIA", decision: "ADOPTED", reason: "the cl.12 overlap is off-field" }],
  opposition: "No opposition history surfaced.",
};

// ── THE PARSER ARMS ───────────────────────────────────────────────────────────────────────────────

test("the rendered document is read correctly by EVERY live consumer — driven through the real parsers", () => {
  const v = acceptRegisterDigest(FULL_CALL, factsWith(REC_A, REC_B));
  assert.ok(v.ok, `the call was refused: ${v.reason}`);
  const md = v.content;

  // recall-reconciliation: the delivery-blocking join. A Sheet-1 uri must read as CARRIED and a drop
  // uri as a DROP ROW — get the heading wrong and a compliant digest blocks its own delivery.
  const endings = parseFindingsEndings(md);
  assert.deepEqual([...endings.carried], ["/mark/eu/018999001"], "the Sheet-1 uri must end as carried");
  assert.deepEqual([...endings.dropRows], ["/mark/us/99999"], "the drop uri must end under Negative results");

  // placement-carry: the same split, plus the adjudication bucket, on its own heading regexes.
  const surfaces = parseCarrySurfaces(md);
  assert.deepEqual([...surfaces.uris.carried], ["/mark/eu/018999001"]);
  assert.deepEqual([...surfaces.uris["reasoned-negative"]], ["/mark/us/99999"]);

  // screen-gate: reads the Negative-results table POSITIONALLY (cells[0] mark, cells[2] result,
  // cells[3..] notes) and reports refs it cannot resolve. A gap here is a recall loss.
  assert.deepEqual(findScreenGateParseGaps(md), [], "the drop row's provenance must parse");

  // anchor-reader: looks columns up BY NAME out of the findings tables.
  const anchors = readAnchors({ registerFindingsMd: md });
  assert.ok(anchors.owners.includes("nordbro advokater"), `owner not anchored: ${anchors.owners}`);
  for (const c of ["09", "9", "41"]) assert.ok(anchors.classes.includes(c), `class ${c} not anchored`);
});

test("the driver renders the identifier cells FROM the band — the seat sends none of them", () => {
  const v = acceptRegisterDigest(FULL_CALL, factsWith(REC_A, REC_B));
  assert.ok(v.ok);
  // Every cell below came from the band record, not from the call: the call carried only a uri.
  for (const cell of ["THORNMANTLE", "Nordbro Advokater", "DK", "Registered", "2021-09-07", "2031-09-07"])
    assert.ok(v.content.includes(cell), `${cell} is not in the render, so the band was not read`);
  // …and the clickable URL is composed, which the seat was never given a host table for.
  assert.ok(v.content.includes("[/mark/eu/018999001](https://records.trademark.test/mark/eu/018999001)"),
    "the composed record URL is missing");
  // The drop row's provenance, likewise — all four fields off the record.
  assert.ok(/screen_verdict=drop:dead/.test(v.content) && /status=dead/.test(v.content),
    "the Notes provenance was not composed from the band record");
});

test("Expiry is NEVER filled from registration_date — a wrong date under that header is worse than none", () => {
  // The two are different facts. A record with a registration date and no expiry must render an empty
  // Expiry cell, because a lawyer reads that column as an expiry.
  const cells = identifierCells({ record_id: "/mark/x/1", registration_date: "2019-01-01" }, "");
  assert.equal(cells.expiry, "", "registration_date leaked into the Expiry cell");
});

// ── THE JOIN IS THE CHECK ─────────────────────────────────────────────────────────────────────────

test("a uri no band record carries is REFUSED, never rendered as a row of blank cells", () => {
  const v = acceptRegisterDigest(
    { findings_rows: [{ uri: "/mark/eu/000000", flag_reason: "x", verify: "no" }] }, factsWith(REC_A));
  assert.equal(v.ok, false);
  assert.match(v.reason, /^registerdigest_uri_unknown:/);
  assert.match(v.reason, /\/mark\/eu\/000000/, "the refusal must name the uri the seat can fix");
});

test("every field the call requires is refused BY NAME when missing or off-enum", () => {
  const f = factsWith(REC_A, REC_B);
  const cases = [
    [{ findings_rows: [{ uri: "", flag_reason: "x", verify: "no" }] }, /^registerdigest_uri_missing:/],
    [{ findings_rows: [{ uri: REC_A.record_id, flag_reason: "", verify: "no" }] }, /^registerdigest_flag_reason_missing:/],
    [{ findings_rows: [{ uri: REC_A.record_id, flag_reason: "x", verify: "maybe" }] }, /^registerdigest_verify_invalid:/],
    [{ negative_rows: [{ uri: REC_B.record_id, drop_reason: "", ground: "off-field" }] }, /^registerdigest_drop_reason_missing:/],
    [{ negative_rows: [{ uri: REC_B.record_id, drop_reason: "x" }] }, /^registerdigest_drop_ground_invalid:/],
    [{ ...FULL_CALL, instructed_checks: [{ ask: "q", answer: "" }] }, /^registerdigest_instructed_incomplete:/],
    [{ ...FULL_CALL, disagreement_resolutions: [{ subject: "s", decision: "MAYBE", reason: "r" }] }, /^registerdigest_adjudication_invalid:/],
    [{ ...FULL_CALL, disagreement_resolutions: [{ subject: "", decision: "ADOPTED", reason: "" }] }, /^registerdigest_adjudication_incomplete:/],
  ];
  for (const [params, re] of cases) {
    const v = acceptRegisterDigest(params, f);
    assert.equal(v.ok, false, `expected a refusal matching ${re}`);
    assert.match(v.reason, re);
  }
});

// ── THE FLOOR, AND WHAT ITS ZERO MEANS ────────────────────────────────────────────────────────────
//
// BOTH DIRECTIONS, because the first cut of this floor had exactly one and it was the wrong one. A
// floor that only refuses cannot tell "the seat judged nothing" from "there was nothing to judge", and
// M6's ruling for the second case is a DECLARED ABSENCE, not a refusal.

test("zero rows against a band WITH records is refused — the floor is live", () => {
  const v = acceptRegisterDigest({ findings_rows: [], negative_rows: [] }, factsWith(REC_A));
  assert.equal(v.ok, false);
  assert.match(v.reason, /^registerdigest_nothing_judged:0 rows against 1 record/);
});

test("zero rows against an EMPTY band is accepted and DECLARES the absence in the reader's own section", () => {
  // Reachable: readCoverageFormInput accepts a `skeleton: []` plan, so a run that executed nothing gets
  // here. Refusing it would leave the run with no findings document at all, where M6 ships a declared
  // one — and the gateway would then report a stage that never tried.
  const v = acceptRegisterDigest({ findings_rows: [], negative_rows: [] }, factsWith());
  assert.ok(v.ok, `an empty band must not refuse: ${v.reason}`);
  assert.match(v.content, /declared absence of findings/);
  assert.match(v.content, /no coverage claim is made here/);
});

// ── THE PATCH PATH ────────────────────────────────────────────────────────────────────────────────

test("a patch merges rows BY URI — replacing a named row, appending a new one, keeping the rest", () => {
  const stored = {
    findings_rows: [{ uri: "/mark/eu/018999001", flag_reason: "old", verify: "no" }],
    negative_rows: [], incumbent_rows: [], instructed_checks: [], disagreement_resolutions: [],
    opposition: "kept prose",
  };
  const merged = mergeDigestPatch(stored, {
    findings_rows: [
      { uri: "/mark/eu/018999001", flag_reason: "corrected", verify: "yes" },
      { uri: "/mark/us/99999", flag_reason: "added", verify: "no" },
    ],
  });
  assert.equal(merged.findings_rows.length, 2, "the named row replaced rather than duplicating");
  assert.equal(merged.findings_rows[0].flag_reason, "corrected");
  assert.equal(merged.findings_rows[1].uri, "/mark/us/99999");
  assert.equal(merged.opposition, "kept prose", "a section the patch did not name must survive");
});

test("a patch that names ONE instructed check or disagreement leaves the others byte-identical", () => {
  // ✕ THE DEFECT THIS ARM EXISTS FOR, and it is the same one that took R2 from 19 findings to 4.
  // `mergeSynthesisPatch` one transport over carries `if (patch?.findings !== undefined) out.findings =
  // patch.findings` — a whole-object assignment that destroys every sibling the new object does not
  // carry. This merge had the same shape on the two keys with no uri: they were REPLACED whenever the
  // patch carried them, so a seat correcting one disagreement resolution silently dropped the rest. The
  // flush rung's own words are "send only the rows and sections you are changing", so it is reachable.
  //
  // The arm is per-key and asserts the SURVIVOR, not the corrected entry — a happy-path merge test
  // passes on a merge that deletes everything it was not handed.
  const stored = {
    findings_rows: [], incumbent_rows: [], negative_rows: [],
    instructed_checks: [
      { ask: "Any EU oppositions?", answer: "None in the frozen band." },
      { ask: "Any CH filings after 2020?", answer: "Two, both the applicant's own." },
    ],
    disagreement_resolutions: [
      { subject: "PHINIA", decision: "ADOPTED", reason: "the cl.12 overlap is off-field" },
      { subject: "ZORVA", decision: "OVERRODE", reason: "the placement reason mis-reads class 9" },
    ],
  };

  const checks = mergeDigestPatch(stored, {
    instructed_checks: [{ ask: "Any EU oppositions?", answer: "One, withdrawn 2019." }],
  });
  assert.equal(checks.instructed_checks.length, 2, "the unnamed instructed check was deleted by a patch that did not mention it");
  assert.equal(checks.instructed_checks.find((c) => /CH filings/.test(c.ask))?.answer,
    "Two, both the applicant's own.", "the survivor must come back byte-identical");
  assert.equal(checks.instructed_checks.find((c) => /EU oppositions/.test(c.ask))?.answer,
    "One, withdrawn 2019.", "…and the named one is corrected in place, not appended");

  const adj = mergeDigestPatch(stored, {
    disagreement_resolutions: [{ subject: "PHINIA", decision: "OVERRODE", reason: "re-read: the overlap is real" }],
  });
  assert.equal(adj.disagreement_resolutions.length, 2, "the unnamed disagreement resolution was deleted by a patch that did not mention it");
  assert.equal(adj.disagreement_resolutions.find((d) => d.subject === "ZORVA")?.reason,
    "the placement reason mis-reads class 9", "the survivor must come back byte-identical");
  assert.equal(adj.disagreement_resolutions.find((d) => d.subject === "PHINIA")?.decision, "OVERRODE",
    "…and the named one is corrected in place");

  // A patch that names NEITHER key leaves both whole — the omitted-key direction, which is how the
  // register losses one transport over actually happened.
  const untouched = mergeDigestPatch(stored, { negative_rows: [{ uri: "/mark/us/1", drop_reason: "x", ground: "off-field" }] });
  assert.equal(untouched.instructed_checks.length, 2, "a patch naming neither key still lost one");
  assert.equal(untouched.disagreement_resolutions.length, 2, "a patch naming neither key still lost one");
});

test("a patch NEVER deletes a row — dropping a finding arrives as a whole re-send, where it is visible", () => {
  const stored = { findings_rows: [{ uri: "/mark/eu/018999001", flag_reason: "r", verify: "no" }] };
  // A patch that names OTHER rows leaves this one standing…
  const patched = mergeDigestPatch(stored, { negative_rows: [{ uri: "/mark/us/99999", drop_reason: "d", ground: "off-field" }] });
  assert.equal(patched.findings_rows.length, 1, "a patch silently dropped a row it did not name");
  // …and an empty rows array is not a deletion either.
  assert.equal(mergeDigestPatch(stored, { findings_rows: [] }).findings_rows.length, 1);
});

// ── THE RUN-FACING HALF ───────────────────────────────────────────────────────────────────────────

test("the facts sidecar is the DRIVER's: read from the run, never from the call", () => {
  const run = newRun();
  mkdirSync(driverDir(run), { recursive: true });
  writeFileSync(driverDir(run, FACTS_FILE), JSON.stringify({
    identity: { mark: "Thornmantle", date: "2026-05-11", provider: "corsearch" },
    recordHost: "https://records.trademark.test",
    counts: [["enumerated records", 2]], auditRows: [], readIds: [], records: [REC_A, REC_B],
  }));
  const f = readDigestFacts(run);
  assert.equal(f.recordsByUri.size, 2, "the slim record index did not load");
  assert.ok(f.recordsByUri.has(joinKey("/mark/eu/018999001")));

  const r = recordRegisterDigest(run, FULL_CALL, { facts: f });
  assert.equal(r.refused, null, `refused: ${r.refused}`);
  assert.equal(r.written, join(run, FINDINGS_FILE));
  assert.ok(readFileSync(r.written, "utf8").includes("Nordbro Advokater"));
  assert.ok(registerDigestWasRecorded(run), "the call capture is the ruled discriminator and is absent");
  assert.equal(lastAcceptedModel(run).findings_rows.length, 1, "the model was not stored for the next patch");
});

test("an ABSENT sidecar fails loud on call 1 rather than shipping a document of blank cells", () => {
  const run = newRun();
  assert.equal(readDigestFacts(run).recordsByUri.size, 0, "a missing sidecar must degrade to empty facts");
  const r = recordRegisterDigest(run, FULL_CALL);
  assert.match(String(r.refused), /^registerdigest_uri_unknown:/);
  assert.equal(r.written, null, "no document may be written when the band cannot be read");
});

test("a REFUSED call is captured and its reason recorded — a stage that tried is not a stage that never did", () => {
  // The distinction gateway.mjs reports on a missing tool-written artifact. Without the refusal record,
  // a seat refused on every call reads as one that produced nothing.
  const run = newRun();
  const r = recordRegisterDigest(run, { findings_rows: [{ uri: "/mark/eu/nope", flag_reason: "x", verify: "no" }] });
  assert.ok(r.refused, "the call should have been refused");
  assert.ok(existsSync(registerDigestCallPaths(run).payload), "the capture must exist even for a refusal");
  const refusals = refusalsFor(run);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0].reason, /^registerdigest_uri_unknown:/);
  // …and the gateway row is wired to read exactly this.
  const rowFn = TOOL_WRITTEN_ARTIFACTS.get(FINDINGS_FILE)?.refusals;
  assert.equal(typeof rowFn, "function", "the artifact row carries no refusal reader");
  assert.equal(rowFn(run, join(run, FINDINGS_FILE)).length, 1, "the gateway reads a different refusal set");
});

test("the artifact row names this tool, so a repair is routed to the CALL and not to the write tails", () => {
  assert.equal(TOOL_WRITTEN_ARTIFACTS.get(FINDINGS_FILE)?.tool, "record_register_digest");
});

// ── THE DROP GROUND: A CLOSED TOKEN, JOINED TO THE BAND ───────────────────────────────────────────

test("the ground token is checked AGAINST the screen — a surfaced record cannot be dropped on status", () => {
  // digest.md forbids this in as many words ("Never batch-drop a surface:in-scope-live / surface:all-class
  // row on goods/services"), and until the ground was a token nothing could see it happen: the ground was
  // prose. Both directions, because a refusal that fires on everything is not a join.
  const f = factsWith({ ...REC_B, screen: { screen_verdict: "surface:in-scope-live" } });
  const drop = (ground) => acceptRegisterDigest({ negative_rows: [{ uri: REC_B.record_id, drop_reason: "d", ground }] }, f);
  for (const bad of ["dead-status", "out-of-class"]) {
    const v = drop(bad);
    assert.equal(v.ok, false, `${bad} on a surfaced record must be refused`);
    assert.match(v.reason, /^registerdigest_drop_ground_contradicted:/);
    assert.match(v.reason, /surface:in-scope-live/, "the refusal must quote the verdict it is contradicting");
  }
  // …and the seat-judged grounds are ACCEPTED on that same record, or the join is just a ban.
  for (const good of ["off-field", "goods-distance", "duplicate-of-surfaced"])
    assert.ok(drop(good).ok, `${good} is the seat's own call and must be accepted: ${drop(good).reason}`);
});

test("a ground naming a screen verdict the record does not carry is refused", () => {
  const f = factsWith({ ...REC_B, screen: { screen_verdict: "drop:out-of-class" } });
  const v = acceptRegisterDigest({ negative_rows: [{ uri: REC_B.record_id, drop_reason: "d", ground: "dead-status" }] }, f);
  assert.equal(v.ok, false);
  assert.match(v.reason, /^registerdigest_drop_ground_contradicted:/);
  // The control: the token that MATCHES the verdict is accepted, so this is a join and not a ban on
  // screen-derived grounds.
  assert.ok(acceptRegisterDigest({ negative_rows: [{ uri: REC_B.record_id, drop_reason: "d", ground: "out-of-class" }] }, f).ok);
});

// ── THE ACCOUNTING REFUSAL, AND ITS ERA GATE ──────────────────────────────────────────────────────

test("every record carried into the digest must end somewhere — armed, it refuses and names them", () => {
  const f = factsWith(REC_A, REC_B);
  f.armed = true;
  f.owed = [REC_A.record_id, REC_B.record_id].map(joinKey);
  const v = acceptRegisterDigest({ findings_rows: [{ uri: REC_A.record_id, flag_reason: "r", verify: "no" }] }, f);
  assert.equal(v.ok, false);
  assert.match(v.reason, /^registerdigest_unaccounted_records:1 of 2 /);
  assert.match(v.reason, /\/mark\/us\/99999/, "the refusal names the record the seat can act on");
});

test("…and all three exits discharge it — a finding, a drop, or a disagreement resolution", () => {
  const f = factsWith(REC_A, REC_B);
  f.armed = true;
  f.owed = [REC_A.record_id, REC_B.record_id].map(joinKey);
  const viaDrop = acceptRegisterDigest({
    findings_rows: [{ uri: REC_A.record_id, flag_reason: "r", verify: "no" }],
    negative_rows: [{ uri: REC_B.record_id, drop_reason: "d", ground: "dead-status" }],
  }, f);
  assert.ok(viaDrop.ok, `a drop must discharge the duty: ${viaDrop.reason}`);
  // The third exit is the one a reader is least likely to expect, so it is asserted rather than assumed.
  const viaAdjudication = acceptRegisterDigest({
    findings_rows: [{ uri: REC_A.record_id, flag_reason: "r", verify: "no" }],
    disagreement_resolutions: [{ subject: `ACME GADGET ${REC_B.record_id}`, decision: "ADOPTED", reason: "tier stands" }],
  }, f);
  assert.ok(viaAdjudication.ok, `a disagreement resolution must discharge the duty: ${viaAdjudication.reason}`);
});

test("an ARCHIVED run is never refused — the era stamp is what arms it, so replay verdicts do not move", () => {
  // /M6's pattern. Without this the promotion re-judges every archived run, and a replay verdict
  // that moves because a NEW rule shipped is a records mutation nobody ordered.
  const f = factsWith(REC_A, REC_B);
  f.armed = false; f.owed = null;
  assert.ok(acceptRegisterDigest({ findings_rows: [{ uri: REC_A.record_id, flag_reason: "r", verify: "no" }] }, f).ok,
    "an unstamped run must be judged exactly as it was before this rule existed");
});

test("armed with NO owed list fails LOUD — the rule may not disarm itself on a driver fault", () => {
  // The fail-open named in the 1955 design as the arm most likely to be built wrong. The stamp lands
  // BEFORE the facts precisely so this state is reachable and refusable rather than silent.
  const f = factsWith(REC_A);
  f.armed = true; f.owed = null;
  const v = acceptRegisterDigest({ findings_rows: [{ uri: REC_A.record_id, flag_reason: "r", verify: "no" }] }, f);
  assert.equal(v.ok, false);
  assert.match(v.reason, /^registerdigest_accounting_unreadable:/);
  assert.match(v.reason, /driver-written/, "it must name the driver, not the model");
});

// ── THE VOCABULARIES ARE THE CODE'S ───────────────────────────────────────────────────────────────

test("the two closed vocabularies are exported as frozen lists the skill guard can pin", () => {
  // They are exported for `skill-contract-enumerations`, whose rule is that a passage calling a
  // vocabulary closed must enumerate a set the CODE owns. A vocabulary with no code counterpart is one
  // that guard exempts, and an exemption is how the next one drifts.
  assert.deepEqual([...VERIFY_VALUES], ["yes", "no"]);
  assert.deepEqual([...ADJUDICATION_DECISIONS], ["ADOPTED", "OVERRODE"]);
  assert.ok(Object.isFrozen(VERIFY_VALUES) && Object.isFrozen(ADJUDICATION_DECISIONS));
});

test("a cell carrying a pipe cannot open a column, and a newline cannot end a row", () => {
  // The seat's prose reaches a pipe table. Neither escape is cosmetic: an unescaped `|` shifts every
  // cell after it, which silently re-labels a lawyer's row.
  const f = factsWith(REC_A);
  const v = acceptRegisterDigest(
    { findings_rows: [{ uri: REC_A.record_id, flag_reason: "cl.9 | cl.41 overlap\nsecond line", verify: "no" }] }, f);
  assert.ok(v.ok, v.reason);
  const rowLine = v.content.split("\n").find((l) => l.includes("cl.9"));
  assert.ok(rowLine.includes("cl.9 \\| cl.41"), "the pipe was not escaped");
  assert.ok(rowLine.includes("second line"), "the newline broke the row instead of folding into it");
});

test("renderRegisterFindings is PURE — the same model and facts render byte-identically", () => {
  const f = factsWith(REC_A, REC_B);
  const v = acceptRegisterDigest(FULL_CALL, f);
  assert.equal(renderRegisterFindings(v.model, f), renderRegisterFindings(v.model, f));
  assert.equal(renderRegisterFindings(v.model, f), v.content);
});

// ── THE WRITER ITSELF, DRIVEN END TO END ────────────────────────────────────────────────────────────
//
// EVERY ARM ABOVE IS DOWNSTREAM OF A WRITER NOTHING EXERCISED, and two defects lived in that gap until
// a replay rig found them on a real run directory:
//
//   · `entryUris` was called in the owed loop and imported NOWHERE. A bare `catch {}` one line below
//     ate the ReferenceError, so `owed` was empty on every run, the stamp was never written, and the
//     accounting rule never armed — anywhere, including production. The transport's own header names
//     this fail-open as the arm most likely to be got wrong; it arrived through a swallowed crash
//     rather than through the write order the header defends.
//   · `readDigestFacts`'s catch returned `emptyFacts()`, whose `armed` is hardcoded false — so the
//     STAMPED-BUT-NO-FACTS state, the one the stamp-lands-first ordering exists to catch, could not be
//     reached at all. The call came back a SEAT defect where the truth was a DRIVER defect.
//
// Both were green under 110 passing arms. So these drive the writer against a fixture run directory
// and assert what it produced, not what a downstream reader makes of a hand-built facts object.
const { writeRegisterDigestFacts } = await import("../pipeline.mjs");
const { paths: runPaths } = await import("../stages.mjs");
const { ACCOUNTING_STAMP, accountingArmed } = await import("../register-digest-record.mjs");

const PLACEMENT = {
  mark: "VOLTMAX", owner: "Synth Beverages GmbH", jurisdiction: "EU",
  records: ["/mark/eu/000000001"], tier: "sheet-2",
  reason: "A regional bottler whose class-32 leg reads as private-label energy drinks sold through grocery.",
};
const BAND_REC = { record_id: "/mark/eu/000000001", mark_text: "VOLTMAX", owner_name: "Synth Beverages GmbH", classes: [32] };

/** A run dir carrying a band and, optionally, a placements.json written from `placementsRaw`. */
function fixtureRunDir({ placementsRaw = undefined } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "prelim-facts-drive-"));
  const P = runPaths(runDir);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: [BAND_REC] }) + "\n");
  if (placementsRaw !== undefined) writeFileSync(P.placementModel, placementsRaw);
  return { runDir, P, ctx: { paths: P, job: { markName: "VOLTMAX" }, run: { slug: "s", codename: "c" } } };
}

test("the writer ARMS the accounting rule on a run with structured placements", () => {
  const { runDir, ctx } = fixtureRunDir({
    placementsRaw: JSON.stringify({ schema_version: 1, placements: [PLACEMENT] }),
  });
  writeRegisterDigestFacts(ctx, "test");
  assert.ok(accountingArmed(runDir), `the era stamp must exist — without it the accounting rule is off `
    + "and nothing anywhere says so (this is the arm the ReferenceError walked past)");
  const facts = readDigestFacts(runDir);
  assert.equal(facts.armed, true);
  assert.deepEqual(facts.owed, [joinKey("/mark/eu/000000001")],
    "the owed set is the records placement carried in — EMPTY here was the whole defect");
  assert.ok(facts.recordsByUri.size > 0, "…and the render half still indexed the band");
});

test("no placements.json ⇒ NOT armed, and that is a real answer rather than a swallowed one", () => {
  // THE CONTROL FOR THE ARM ABOVE. Without it, a writer that armed unconditionally would pass there
  // and be wrong here — and "arms on everything" is as useless as "arms on nothing".
  const { runDir, ctx } = fixtureRunDir();
  writeRegisterDigestFacts(ctx, "test");
  assert.equal(accountingArmed(runDir), false, "no owed population ⇒ no stamp");
  assert.deepEqual(readDigestFacts(runDir).owed, [],
    "and the owed set reads as a stated empty, not as null");
});

test("placements.json PRESENT but unusable arms with owed:null, and the transport refuses by name", () => {
  // The defect direction. A present file the driver cannot turn into an owed set is a DRIVER fault, and
  // the one thing it must not do is quietly disarm the rule on exactly the runs it got wrong.
  const { runDir, ctx } = fixtureRunDir({ placementsRaw: "{ this is not json" });
  writeRegisterDigestFacts(ctx, "test");
  assert.ok(accountingArmed(runDir), "armed even though the owed set could not be built");
  const facts = readDigestFacts(runDir);
  assert.equal(facts.owed, null, "owed is NULL — 'could not tell me' is not 'told me none'");
  const v = acceptRegisterDigest(FULL_CALL, facts);
  assert.equal(v.ok, false);
  assert.match(v.reason, /registerdigest_accounting_unreadable/,
    "the seat meets a DRIVER-fault refusal, not a seat-fault one — opposite repairs");
});

test("STAMPED BUT NO FACTS is reachable, which is the whole point of stamping first", () => {
  // Driven by DELETING the artifact, never by hand-building a facts object: the bug was that the READER
  // could not produce this state, so an arm that constructs it directly would have passed throughout.
  const { runDir, ctx } = fixtureRunDir({
    placementsRaw: JSON.stringify({ schema_version: 1, placements: [PLACEMENT] }),
  });
  writeRegisterDigestFacts(ctx, "test");
  const at = driverDir(runDir, FACTS_FILE);
  assert.ok(existsSync(at), "precondition: the sidecar was written");
  rmSync(at);
  const facts = readDigestFacts(runDir);
  assert.equal(facts.armed, true, "the stamp still says the rule is armed");
  assert.equal(facts.owed, null);
  assert.match(acceptRegisterDigest(FULL_CALL, facts).reason, /registerdigest_accounting_unreadable/);
});

test("the rendered document does NOT move when the RUN moves under it", () => {
  // THE DEFECT THIS PINS. `## Summary` carried "tool calls recorded this run", read from the call log's
  // line count — a number that grows for as long as the run does. Four stages declare this document as
  // an input and hash it for freshness, so every digest pass rendered different bytes from identical
  // seat values, every downstream stage went stale, and delivery refused with "assembled from material
  // that has since changed". Found on a resume, 28 calls then 56, 108 bytes apart.
  //
  // Driven by MOVING THE RUN rather than by reading the render: the call log grows between the two
  // renders and the seat's values do not. Asserting the absent line instead would pass the day someone
  // renders a different live counter under another name.
  const { runDir, ctx } = fixtureRunDir({
    placementsRaw: JSON.stringify({ schema_version: 1, placements: [PLACEMENT] }),
  });
  const callLog = driverDir(runDir, "tool-calls.jsonl");
  const renderNow = () => {
    writeRegisterDigestFacts(ctx, "test");
    const f = readDigestFacts(runDir);
    const v = acceptRegisterDigest({
      findings_rows: [], incumbent_rows: [],
      negative_rows: [{ uri: BAND_REC.record_id, drop_reason: "screened out — dead-status", ground: "off-field" }],
    }, f);
    assert.equal(v.ok, true, `precondition: the call is accepted — ${v.reason ?? ""}`);
    return v.content;
  };
  writeFileSync(callLog, Array.from({ length: 3 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n");
  const first = renderNow();
  writeFileSync(callLog, Array.from({ length: 97 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n");
  const second = renderNow();
  assert.equal(second, first,
    "3 tool calls and 97 must render the SAME document — a value that moves with the run cannot go in an "
    + "artifact other stages hash for freshness");
  rmSync(runDir, { recursive: true, force: true });
});

test("no record host ⇒ the URL is EMPTY and the identity is still printed", () => {
  // THE RULE THE DOCTRINE STATES AND THE CODE BROKE. A provider that publishes no per-record page gets
  // "nothing", and nothing has a spelling: the empty string, NOT the relative path. This fell back to
  // `: uri`, so the bare `/mark/<cc>/<id>` arrived where a resolvable address belongs — the reading that
  // burned a synthesis attempt. Found by a DOC guard refusing the deleted prose, which says nothing
  // about the code, so the code gets its own arm.
  const none = identifierCells({ record_id: "/mark/xx/1", mark_text: "M" }, "");
  assert.equal(none.url, "", "no host ⇒ no URL — never the path");
  assert.equal(none.link, "/mark/xx/1",
    "…and the identity is still rendered, as plain text: the fix must not trade a dead link for a blank cell");
  // the control: WITH a host the link is composed, or the arm above would pass on a function that
  // always returns empty.
  const some = identifierCells({ record_id: "/mark/xx/1", mark_text: "M" }, "https://reg.example");
  assert.equal(some.url, "https://reg.example/mark/xx/1");
  assert.equal(some.link, "[/mark/xx/1](https://reg.example/mark/xx/1)");
});

test("a patch that names one key leaves EVERY other section byte-identical", () => {
  // The dictation now promises the seat "what you do not name comes back byte-identical", so the promise
  // is armed per key rather than on the one key that happened to break. Asserts the SURVIVOR, never the
  // corrected entry — a happy-path merge test passes on a merge that deletes everything it was not handed.
  const stored = {
    findings_rows: [{ uri: "/mark/eu/1", flag_reason: "r", verify: "no" }],
    incumbent_rows: [], negative_rows: [],
    instructed_checks: [{ ask: "A", answer: "kept" }],
    disagreement_resolutions: [{ subject: "S", decision: "ADOPTED", reason: "kept" }],
    opposition: "opp prose", merch_sweep: "merch prose",
    cross_checks: "cross prose", open_flags: "flags prose",
  };
  const merged = mergeDigestPatch(stored, { findings_rows: [{ uri: "/mark/eu/1", flag_reason: "corrected", verify: "no" }] });
  assert.equal(merged.findings_rows[0].flag_reason, "corrected", "precondition: the named key DID change");
  for (const [k, want] of [["opposition", "opp prose"], ["merch_sweep", "merch prose"],
                           ["cross_checks", "cross prose"], ["open_flags", "flags prose"]]) {
    assert.equal(merged[k], want, `\`${k}\` was not named by the patch and must survive untouched`);
  }
  assert.deepEqual(merged.instructed_checks, stored.instructed_checks, "and the keyed lists too");
  assert.deepEqual(merged.disagreement_resolutions, stored.disagreement_resolutions);
});
