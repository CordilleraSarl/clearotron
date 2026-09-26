// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The court-decisions state is read from the case-law pass's own record; the file's words decide only for a
// run that kept none.
//
// THE DEFECT. The state was read from phrases in the case-law findings file, and a full country search's
// report said court decisions were searched, or found, when they were not:
//   · a pass that failed its check but left its file read as "searched" and "found";
//   · a source described as "unavailable" read as "found", because the reader knew five other phrasings;
//   · one profile's "none found" turned a pass that cited authorities into "none found".
// And the record the pass keeps does not settle it alone: on the test runs whose source was down, the
// retrieval record listed every query at 0 results. A 0 is what the model wrote for a query that reached
// nothing, so "none found" needs a sign the source answered.
//
// BREAK MATRIX:
//   · a failed last attempt reads not-checked        → break: drop the attempt arm, arm 1 red
//   · a 0 is not an answer                           → break: read any query row as none-found, arm 2 red
//   · a citation is found, whatever a profile says   → break: consult the words before the record, arm 3 red
//   · an unreadable record is not a clean one        → break: fall back to the words on a parse error, arm 4 red
//   · a run with no record keeps its words           → break: read no-record as not-checked, arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { courtDecisionsState, caseLawPassRecord } from "../publish/search-depth.mjs";
import { CASELAW_BRIDGES } from "../engine/mcp/gather-config.mjs";

// The file's words, in the shapes the pass writes. Neither carries an outage phrase.
const CITES = "### Grounded profile — the proposed mark vs the first finding (Japan)\n- ord: 1\n**On-point authorities:**\n- District Court, 2019: two coined marks sharing a prefix held confusable.\n";
const NONE = "### Grounded profile — the proposed mark vs the first finding (Japan)\n- ord: 1\n**No on-point precedent found.**\n";
const MIXED = `${CITES}\n${NONE.replace("- ord: 1", "- ord: 2").replace("first finding", "second finding")}`;

const ledger = ({ results = [], citations = 0, schema = 1 } = {}) => JSON.stringify({
  schema_version: schema,
  queries: results.map((n, i) => ({ query: `query ${i + 1}`, jurisdiction: "JP", results: n })),
  citations: Array.from({ length: citations }, (_, i) => ({ proceeding: `Case ${i + 1}`, forum: "District Court", jurisdiction: "JP",
    decided: "2019", url: `https://courts.example/${i + 1}`, read: "read", ord: i + 1, bearing: "grounds the finding" })),
});
const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const attempts = (...oks) => jsonl(...oks.map((ok, i) => ({ attempt: i + 1, ok })));
const record = (p) => caseLawPassRecord({ bridges: CASELAW_BRIDGES, ...p });
const sourceCall = (ok) => ({ tool: `${CASELAW_BRIDGES[0]}__search`, ok });

test("arm 1: a pass whose last attempt failed could not be completed, whatever its file and record say", () => {
  const failed = record({ attemptsJsonl: attempts(false, false), ledgerRaw: ledger({ results: [2], citations: 1 }) });
  assert.equal(courtDecisionsState(CITES, failed), "not-checked");
  // THE CONTROLS. The last attempt is the one that counts, and without the record the same words read found.
  assert.equal(courtDecisionsState(CITES, record({ attemptsJsonl: attempts(false, true), ledgerRaw: ledger({ results: [2], citations: 1 }) })), "found");
  assert.equal(courtDecisionsState(CITES), "found");
});

test("arm 2: with no citation, none found needs the source to have answered", () => {
  const zeros = { attemptsJsonl: attempts(true), ledgerRaw: ledger({ results: [0, 0, 0] }) };
  assert.equal(courtDecisionsState(NONE, record(zeros)), "not-checked", "every query at 0 is what an unreachable source leaves");
  assert.equal(courtDecisionsState(NONE, record({ ...zeros, readingLogJsonl: jsonl(sourceCall(true)) })), "none-found",
    "a call the case-law source answered is the sign it was reached");
  assert.equal(courtDecisionsState(NONE, record({ ...zeros, readingLogJsonl: jsonl(sourceCall(false)) })), "not-checked",
    "a call that failed is not an answer");
  assert.equal(courtDecisionsState(NONE, record({ ...zeros, readingLogJsonl: jsonl({ tool: "band_lookup", ok: true }, { tool: "perplexity_search", ok: true }) })), "not-checked",
    "only the case-law sources' own calls speak for the case-law source");
  assert.equal(courtDecisionsState(NONE, record({ attemptsJsonl: attempts(true), ledgerRaw: ledger({ results: [3, 0] }) })), "none-found",
    "a query that came back with hits, none of them cited, is the honest negative");
  // THE CONTROL: the same words with no record read none found, as they always did.
  assert.equal(courtDecisionsState(NONE), "none-found");
});

test("arm 2b: from version 2 a zero is an answer, because that version's instruction forbids a zero for a query it could not send", () => {
  // At version 1 a 0 meant either "searched, nothing back" or "never reached a source", so the reader
  // could not count it, and an honest pass whose queries all came back empty read as not completed.
  // Version 2's instruction tells the model to write null for a query it could not send, so the two are
  // now distinguishable and the honest pass gets its "none found" back.
  const v2 = (results) => record({ attemptsJsonl: attempts(true), ledgerRaw: ledger({ results, schema: 2 }) });
  assert.equal(courtDecisionsState(NONE, v2([0, 0, 0])), "none-found", "a version-2 zero is a search that returned nothing");
  assert.equal(courtDecisionsState(NONE, v2([null, null])), "not-checked", "a null is the record saying the query never went");
  assert.equal(courtDecisionsState(NONE, v2([null, 0])), "none-found", "one query that went is enough to have reached the source");
  // THE CONTROL, and it is the half that must not move: the same zeros at version 1 still read not-checked.
  assert.equal(courtDecisionsState(NONE, record({ attemptsJsonl: attempts(true), ledgerRaw: ledger({ results: [0, 0, 0] }) })), "not-checked",
    "a version-1 zero was counted as a search, which is the defect version 2 exists to end");
});

test("arm 2c: a record naming no version is read as the oldest, so its zeros are never counted", () => {
  // An unversioned record predates the field being asked for, so it is the ambiguous kind. Defaulting it
  // to whatever this build is at would hand it every promise the current instruction makes.
  const raw = JSON.stringify({ queries: [{ query: "q", jurisdiction: "JP", results: 0 }], citations: [] });
  assert.equal(courtDecisionsState(NONE, record({ attemptsJsonl: attempts(true), ledgerRaw: raw })), "not-checked");
});

test("arm 3: a record that cites a decision reads found, even where one profile found nothing", () => {
  assert.equal(courtDecisionsState(MIXED, record({ attemptsJsonl: attempts(true), ledgerRaw: ledger({ results: [2, 0], citations: 1 }) })), "found");
  assert.equal(courtDecisionsState(MIXED), "none-found", "the control: read by its words, one profile's none found took the whole pass");
});

test("arm 4: a record that is there and cannot be read shows nothing ran", () => {
  for (const raw of ["{not json", "", JSON.stringify({ queries: [] })]) {
    assert.equal(courtDecisionsState(CITES, record({ attemptsJsonl: attempts(true), ledgerRaw: raw })), "not-checked", JSON.stringify(raw));
  }
});

test("arm 5: a run that kept no record reads its file's words, and an unavailable source is an outage there", () => {
  const demoWords = "**No on-point precedent could be assessed.** The enrolled case-law source was unavailable at runtime.";
  assert.equal(courtDecisionsState(demoWords), "not-checked");
  assert.equal(courtDecisionsState(demoWords, record({})), "not-checked", "an empty record is no record");
  assert.equal(courtDecisionsState(CITES, record({ attemptsJsonl: attempts(true) })), "found",
    "a passed attempt with no retrieval record is a run from before the record existed");
  assert.equal(courtDecisionsState("", record({ attemptsJsonl: attempts(false) })), "not-in-scope",
    "an empty file is out of scope before any record is read — the absent file is recorded elsewhere");
});

test("caseLawPassRecord: only the last attempt's calls speak for the last attempt's record", () => {
  const rowsAt = (...ts) => jsonl(...ts.map((t, i) => ({ attempt: i + 1, ok: i === ts.length - 1, ts: t })));
  const call = (ts) => ({ ...sourceCall(true), ts });
  const two = rowsAt("2026-09-25T10:05:00.000Z", "2026-09-25T10:12:00.000Z");
  assert.equal(record({ attemptsJsonl: two, readingLogJsonl: jsonl(call("2026-09-25T10:03:00.000Z")) }).sourceAnswered, false,
    "an answer during the first attempt does not vouch for the second attempt's record");
  assert.equal(record({ attemptsJsonl: two, readingLogJsonl: jsonl(call("2026-09-25T10:09:00.000Z")) }).sourceAnswered, true);
  assert.equal(record({ attemptsJsonl: two, readingLogJsonl: jsonl({ ...sourceCall(true) }) }).sourceAnswered, false,
    "a call with no time cannot be placed in the last attempt");
  assert.equal(record({ attemptsJsonl: rowsAt("2026-09-25T10:05:00.000Z"), readingLogJsonl: jsonl(call("2026-09-25T10:03:00.000Z")) }).sourceAnswered, true,
    "with one attempt, every call in the log is its own");
  // THE CONTROL: a record with no attempt rows at all still reads its sources' calls.
  assert.equal(record({ readingLogJsonl: jsonl(sourceCall(true)) }).sourceAnswered, true);
});

test("caseLawPassRecord: the last attempt row decides, and a torn line costs only itself", () => {
  const torn = attempts(false, true) + '{"attempt":3,"ok":fa';
  assert.equal(record({ attemptsJsonl: torn }).lastAttemptOk, true);
  assert.equal(record({ attemptsJsonl: jsonl({ event: "dispatched" }, { attempt: 1, ok: false }, { event: "note" }) }).lastAttemptOk, false,
    "a row without an outcome is not an attempt");
  assert.equal(record({}).lastAttemptOk, null, "no rows is no evidence, never a pass");
  assert.equal(record({ ledgerRaw: null }).ledgerRaw, null);
  assert.equal(record({ ledgerRaw: "" }).ledgerRaw, "", "present and empty is not absent");
  assert.ok(CASELAW_BRIDGES.length > 0, "the case-law source list is not empty — an empty one would answer nothing and pass arm 2 by absence");
});
