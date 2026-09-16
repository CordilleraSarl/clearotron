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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acceptRegisterDigest, renderRegisterFindings, emptyFacts, readDigestFacts, joinKey,
  identifierCells, mergeDigestPatch, recordRegisterDigest, refusalsFor, registerDigestCallPaths,
  registerDigestWasRecorded, lastAcceptedModel, FACTS_FILE, FINDINGS_FILE,
  VERIFY_VALUES, ADJUDICATION_DECISIONS, negativeMarkCell,
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
  const runDir = mkdtempSync(join(tmpdir(), "clearotron-facts-drive-"));
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

// ── THE NEGATIVE TABLE MUST NOT NAME A MARK WHERE IT MEANS ONE RECORD ────────────────────────────────
//
// A `duplicate-of-surfaced` row says "this registration is already reported under
// another record". Rendered with the bare mark under a column headed "Mark", the sheet said both
// "DELFITY — keep, here is the reasoning" (incumbent table) and "DELFITY — No separate row" (negative
// table), ninety lines apart, about two different records. Nine readers scan this document and one of
// them decides what the client is shown.
//
// ✕ THE ARM PROVES THE RENDERED CELL, NOT A MODEL'S READING OF IT. Whether removing the contradiction
// changes what a drafting seat carries is a question for a replay, not for this file. Written down
// because "arm green" must not be read as "the regression is fixed".
//
// The class member here is DELFITY/EM on purpose — the row that motivated the change was OSLER
// DELPHI/WO, and an arm that only tests the member it was written against proves nothing about the class.

const REC_DELFITY_CH = {
  record_id: "/mark/ch/SWITI377E54D3AEB311E08B41EED32564FCF4", mark_text: "DELFITY", owner_name: "Novartis AG",
  owner_country: "CH", classes: ["05"], status: "Registered",
  application_date: "2011-07-12", expiry_date: "2031-07-12",
};
const REC_DELFITY_EM = {
  record_id: "/mark/em/CTMSID282EA13B1A511E09C4FF82ECD3CB984", mark_text: "DELFITY", owner_name: "Novartis AG",
  owner_country: "CH", classes: ["05"], status: "Registered",
  application_date: "2011-07-13", expiry_date: "2031-07-13",
};

test("a duplicate-of-surfaced row names the RECORD, and the plain mark still names the mark everywhere else", () => {
  const f = factsWith(
    { ...REC_DELFITY_CH, screen: { screen_verdict: "surface:in-scope-live" } },
    { ...REC_DELFITY_EM, screen: { screen_verdict: "surface:in-scope-live" } },
    { ...REC_A, screen: { screen_verdict: "surface:in-scope-live" } });
  // THE CONTRADICTING SHEET, planted: the mark kept on the incumbent table AND dropped as a duplicate leg.
  const v = acceptRegisterDigest({
    incumbent_rows: [{ uri: REC_DELFITY_CH.record_id, flag_reason: "Watchlist entry on the same owner, carried so the seed is answered across its live positions.", verify: "no" }],
    negative_rows: [
      { uri: REC_DELFITY_EM.record_id, ground: "duplicate-of-surfaced", variant: "DELF",
        drop_reason: "No separate row — the EU leg of the Novartis DELFITY position already reported on the watch annex." },
      // THE CONTROL, a different ground: this row IS about the record on its own terms and its cell
      // must be untouched, or the change is a blanket rewrite of the column wearing a narrow name.
      { uri: REC_A.record_id, ground: "off-field", variant: "THORN",
        drop_reason: "Outside the instructed markets." },
    ],
  }, f);
  assert.ok(v.ok, v.reason);

  const lines = v.content.split("\n");
  const negStart = lines.findIndex((l) => /^#{1,6}\s.*negative results/i.test(l));
  assert.ok(negStart > 0, "the negative section must render");
  const negLines = lines.slice(negStart);
  const cell0 = (l) => l.split("|").map((c) => c.trim())[1];

  const dupRow = negLines.find((l) => l.includes("EU leg of the Novartis DELFITY"));
  assert.ok(dupRow, "the duplicate row must render");
  assert.equal(cell0(dupRow), "DELFITY — EM record",
    "a duplicate leg must name the record; the bare mark reads as a ruling about the mark");

  // THE CLAIM AS A CLASS, not as one row: no line in this section may put the bare mark in the Mark cell.
  for (const l of negLines.filter((x) => x.trim().startsWith("|")))
    assert.notEqual(cell0(l), "DELFITY", `a negative row still reads as the bare mark: ${l}`);

  // …and the control is untouched.
  const ctlRow = negLines.find((l) => l.includes("Outside the instructed markets"));
  assert.equal(cell0(ctlRow), "THORNMANTLE", "a non-duplicate ground must keep the bare mark");

  // The incumbent table is unchanged — the mark is still named as the mark where it IS the subject.
  const incLines = lines.slice(0, negStart);
  assert.ok(incLines.some((l) => l.includes("| DELFITY |")), "the incumbent row must still name the mark plainly");
});

test("negativeMarkCell falls back to the bare mark rather than rendering a broken qualifier", () => {
  // A missing qualifier is a smaller defect than "DELFITY — UNDEFINED record". Every uri in the archived
  // corpus carries a two-letter office, so this is the degradation path, not the expected one.
  const dup = (uri) => negativeMarkCell({ ground: "duplicate-of-surfaced", cells: { mark: "DELFITY", uri } });
  assert.equal(dup("/mark/em/CTMSID1"), "DELFITY — EM record");
  assert.equal(dup("/mark/WO/INTEI1"), "DELFITY — WO record", "the office is case-insensitive");
  for (const bad of ["", null, undefined, "nonsense", "/mark/", "/mark/eee/x", "/mark/1/x"])
    assert.equal(dup(bad), "DELFITY", `a uri with no readable office must degrade to the bare mark: ${JSON.stringify(bad)}`);
  // Out of scope for every other ground, and for a row with no mark at all.
  assert.equal(negativeMarkCell({ ground: "off-field", cells: { mark: "DELFITY", uri: "/mark/em/x" } }), "DELFITY");
  assert.equal(negativeMarkCell({ ground: "duplicate-of-surfaced", cells: { mark: "", uri: "/mark/em/x" } }), "");
});


// ── BATCHING: THE 2026-09-16 PRODUCTION FAILURE, AND THE ARMS THE RULING NAMES ───────────────────
//
// A dense matter carried 1,161 records into this stage. They went over in ONE turn against an
// all-or-nothing accounting refusal, so the turn ended with 902 of them unaccounted, the call was
// refused, the ladder re-sent the same shape, and the stage died after ~35 minutes and 172,900 output
// tokens having written nothing at all. The client got no report.
//
// These drive the batched shape through the REAL writer against a REAL run directory at the size the
// ruling names — never a hand-built facts object, for the reason the arms above this one give.
const { DIGEST_BATCH, digestBatches, remainingDigestBatches, accountedKeys } =
  await import("../register-digest-record.mjs");

/** A run directory whose band and placements both carry `n` records. */
function densRunDir(n) {
  const runDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "digest-batch-"));
  const P = runPaths(runDir);
  mkdirSync(driverDir(runDir), { recursive: true });
  const recs = Array.from({ length: n }, (_, i) => ({
    record_id: `/mark/eu/${String(2000000 + i)}`, mark_text: `DENSEMARK ${i}`,
    owner_name: `Holder ${i} AG`, classes: [9], status: "Registered",
  }));
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: recs }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify({
    schema_version: 1,
    placements: [{
      mark: "DENSEMARK", owner: "Holder AG", jurisdiction: "EU", tier: "sheet-2",
      records: recs.map((r) => r.record_id),
      reason: "A dense band: every record placement carried into the digest.",
    }],
  }) + "\n");
  const ctx = { paths: P, job: { markName: "DENSEMARK" }, run: { slug: "s", codename: "c" } };
  writeRegisterDigestFacts(ctx, "test");
  return { runDir, P, recs, facts: readDigestFacts(runDir) };
}

/** Account for `keys` as this batch's drops — the cheapest of the three exits to send in bulk. */
const dropRows = (keys) => keys.map((k) => ({
  uri: k, drop_reason: "off-field — the relevance gate decided it on its own goods", ground: "off-field",
}));

const sendBatch = (runDir, keys, batch, rows = null) =>
  recordRegisterDigest(runDir, { patch: true, negative_rows: rows ?? dropRows(keys) }, { batch });

/** How many typed calls this run has captured — refusals included, one file per call. */
const callCount = (runDir) => {
  const { dir } = registerDigestCallPaths(runDir);
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^call-\d+\.json$/.test(f)).length : 0;
};

test("CRITERION 1 — 1,200 records pass the gate accounted exactly once, across exactly 12 calls", () => {
  const { runDir, P, facts } = densRunDir(1200);
  const batches = digestBatches(facts.owed);
  assert.equal(DIGEST_BATCH, 100, "the constant is the one the ruling set, in one place");
  assert.equal(batches.length, 12, "1,200 records at 100 a batch is TWELVE batches, not eleven or thirteen");

  let last = null;
  batches.forEach((keys, i) => {
    last = sendBatch(runDir, keys, i);
    assert.equal(last.refused, null, `batch ${i + 1} must be accepted on its own records — ${last.refused ?? ""}`);
  });

  // THE FLOOR, not a ">=": eleven batches accounting for 1,200 records would mean a batch was skipped
  // and the run still passed, which is the defect one level down from the one being fixed.
  assert.equal(callCount(runDir), 12, "EXACTLY twelve recording calls — a thirteenth means a batch was re-sent");
  assert.equal(last.written, join(runDir, FINDINGS_FILE), "the twelfth call closes the union and writes the document");
  const stored = lastAcceptedModel(runDir);
  const accounted = accountedKeys(stored, facts.owed);
  assert.equal(accounted.size, 1200, "every one of the 1,200 is accounted, and DISTINCTLY — a set, so a double-send cannot pad it");
  assert.equal(stored.negative_rows.length, 1200, "…and the stored model carries one row each, not a survivor of the last batch");
  assert.deepEqual(remainingDigestBatches(runDir, facts), [], "nothing outstanding once the union closed");
});

test("CRITERION 2 — a batch with one unaccounted record is refused BY NAME, and the other batches stay accepted", () => {
  const { runDir, facts } = densRunDir(1200);
  const batches = digestBatches(facts.owed);
  for (const i of [0, 1]) assert.equal(sendBatch(runDir, batches[i], i).refused, null);

  // Batch 3 accounts for 99 of its 100 — the planted one ends nowhere.
  const planted = batches[2][57];
  const short = batches[2].filter((k) => k !== planted);
  const r = sendBatch(runDir, short, 2);
  assert.ok(r.refused, "a batch that leaves one of its own records unaccounted is refused");
  assert.match(r.refused, /registerdigest_unaccounted_records/);
  assert.ok(r.refused.includes(planted),
    "the refusal NAMES the record — the seat's next act is to account for exactly it, and a list "
    + "truncated to five made that act impossible to perform from the refusal");

  // THE SECOND CLAUSE, and the one that passes silently if it is not asserted: the refusal must not
  // take the accepted batches down with it. Asserting only that the refusal fired would be green with
  // a transport that discarded everything on any refusal.
  const stored = lastAcceptedModel(runDir);
  const accounted = accountedKeys(stored, facts.owed);
  assert.equal(accounted.size, 200, "batches 1 and 2 survive the refusal of batch 3 — 200 records still accounted");
  for (const k of [...batches[0], ...batches[1]]) assert.ok(accounted.has(k), `${k} was accepted and must still be`);
  assert.equal(accounted.has(planted), false, "and the planted record is NOT accounted");
});

test("CRITERION 3 — after a kill at batch 6, the retry records batches 7 to 12 and no others", () => {
  const { runDir, P, facts } = densRunDir(1200);
  const batches = digestBatches(facts.owed);
  for (let i = 0; i < 6; i++) assert.equal(sendBatch(runDir, batches[i], i).refused, null);

  // THE KILL. Nothing is cleaned up and no counter is decremented — the process simply stops, which is
  // what a wall-clock kill does. The resume then asks the stored model what landed.
  assert.equal(existsSync(P.registerFindings), false,
    "THE INVARIANT: six of twelve batches in, the client's document does NOT exist. Writing it per "
    + "batch would leave a page carrying a title, every heading and half the records — complete to the "
    + "nine parsers that read it, complete to the gateway, and complete to a client");
  assert.equal(accountedKeys(lastAcceptedModel(runDir), facts.owed).size, 600,
    "…while the driver's own model holds the 600 that did land, which is what makes the resume cheap");

  // A SET, NOT A COUNT. A count of six is satisfied by re-sending batches 1-6, which is the defect.
  const remaining = remainingDigestBatches(runDir);
  assert.deepEqual(remaining, [6, 7, 8, 9, 10, 11],
    "the resume's worklist is exactly the batches that never landed");

  const before = callCount(runDir);
  let last = null;
  for (const i of remaining) last = sendBatch(runDir, batches[i], i);
  assert.equal(callCount(runDir) - before, 6, "six further calls, one per outstanding batch");
  assert.equal(last.written, join(runDir, FINDINGS_FILE), "and the last of them closes the union");
  assert.equal(accountedKeys(lastAcceptedModel(runDir), facts.owed).size, 1200);
});

test("CRITERION 4 — a record already accounted in another batch is refused as double-counted", () => {
  const { runDir, facts } = densRunDir(1200);
  const batches = digestBatches(facts.owed);
  assert.equal(sendBatch(runDir, batches[0], 0).refused, null);

  // Batch 2 sends its own hundred AND one of batch 1's. Rows merge BY URI, so the merged model cannot
  // see this: the repeat REPLACES its twin and the count never moves. Slice membership on the call as
  // received is the only place it is visible, which is why the check reads the raw call.
  const stolen = batches[0][12];
  const r = sendBatch(runDir, [...batches[1], stolen], 1);
  assert.ok(r.refused, "a row for a record this call was not handed is refused");
  assert.match(r.refused, /registerdigest_record_not_in_batch/);
  assert.ok(r.refused.includes(stolen), "and it names the record, so the seat can drop that row and re-send");
  assert.equal(accountedKeys(lastAcceptedModel(runDir), facts.owed).size, 100,
    "batch 1 stands; the refused batch 2 added nothing");
});

test("the batch boundaries do NOT move when the facts sidecar is rewritten mid-run", () => {
  // THE PROMISE THE RESUME RESTS ON, and nothing else checks it. `remainingDigestBatches` returns batch
  // INDICES, so "batch 7" has to mean the same hundred records to the pass that resumes as it did to the
  // attempt that died. Between those two, `runDigest` rewrites the facts sidecar — that is where `owed`
  // comes from, and a rewrite that returned the same records in a different ORDER would silently re-cut
  // every boundary, leaving the resume to re-send hundreds it had already accounted for and skip ones it
  // had not. No refusal would fire: every batch would be internally consistent and the union would be
  // wrong. Driven by actually rewriting the sidecar, never by re-reading the same file twice.
  const { runDir, P, facts } = densRunDir(450);
  const before = digestBatches(facts.owed);
  assert.equal(before.length, 5, "precondition: 450 records is five batches, the last one short");

  const ctx = { paths: P, job: { markName: "DENSEMARK" }, run: { slug: "s", codename: "c" } };
  writeRegisterDigestFacts(ctx, "rewrite");
  const after = digestBatches(readDigestFacts(runDir).owed);
  assert.deepEqual(after, before,
    "the same placements must cut the same batches — the partition takes `owed` in the order the driver "
    + "built it and sorts nothing, precisely so this holds across processes");
});

test("an unbatched call is judged on the WHOLE owed list, exactly as it was before batching existed", () => {
  // THE CONTROL. Every arm above binds a batch, so all five would pass against a transport that had
  // quietly stopped checking the un-batched path — the one every archived run and every replay uses.
  const { runDir, facts } = densRunDir(250);
  const r = recordRegisterDigest(runDir, { negative_rows: dropRows(facts.owed.slice(0, 100)) }, {});
  assert.ok(r.refused, "100 of 250 accounted, no batch bound ⇒ still refused run-wide");
  assert.match(r.refused, /registerdigest_unaccounted_records/);
  const ok = recordRegisterDigest(runDir, { negative_rows: dropRows(facts.owed) }, {});
  assert.equal(ok.refused, null, "and the whole list in one call is accepted, as it always was");
  assert.equal(ok.written, join(runDir, FINDINGS_FILE), "with the document written on that same call");
});
