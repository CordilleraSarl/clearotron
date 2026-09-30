// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN INVESTIGATE ROW SAYS WHERE THE CLAIM IS, NOT WHAT IT SAYS.
//
// `report` is the cheap instrument: free, re-runnable, and the doctrine tells a lane to re-run it rather
// than re-run the clearance. So it is the one most often pointed at a real matter, in a session that
// records whatever it prints — and its INVESTIGATE rows earned their usefulness by quoting the sentence
// they object to, which is the engine's own words about a client's matter.
//
// A location is as actionable and carries nothing: it sends a reader to the same words in the file that
// already holds them. `--names` puts them on the page for the one job that needs them.
//
// EVERY ARM HERE HAS ITS CONTROL, and the control is the one that matters: a row that stopped printing
// its quotation and a row that stopped printing at all look identical from the default path alone. So
// each arm asserting the words are absent is paired with one asserting `--names` carries them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { evalAssertion, fromTheRun, doorReasonLine, setReportNames, REPORT_NAMES } from "../../scripts/e2e.mjs";

// An invented sentence, in the shape the engine writes and the check refuses: a claim over the FIELD,
// which no number of held records can support.
const FIELD_CLAIM = "The register is crowded for this term.";
const FILLER = "The subject was searched on five stores.";

function makeRun({ records = 12 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "investigate-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "search-policy.json"), JSON.stringify({ pipeline: "knockout" }));
  writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify({
    marks: [{ name: "E2E LOCATION PROBE", records: Array.from({ length: records }, (_, i) => ({ recordId: `R${i}` })) }],
  }));
  // The offending sentence is third, so the row has a non-trivial index to report.
  writeFileSync(join(dir, "knockout-findings.md"), [FILLER, FILLER, FIELD_CLAIM].join("\n"));
  return dir;
}

const check = (opts = {}) => {
  const dir = makeRun();
  try {
    return evalAssertion({ op: "register-claims-within-counts", path: "knockout-findings.md" }, dir, opts);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("by default the row names the count and the location, and not the sentence", () => {
  const r = check({ names: false });
  assert.equal(r.ok, false, "the claim is still refused — this changes the wording, not the rule");
  assert.ok(!r.saw.includes(FIELD_CLAIM), `the sentence reached the row: ${r.saw}`);
  assert.match(r.saw, /1 register claim\(s\)/, "the count is never withheld — it IS the finding");
  assert.match(r.saw, /sentence 3 of knockout-findings\.md/, "and the row says where to read it");
  assert.match(r.saw, /run again with --names/, "and how to put it on the page");
});

test("CONTROL: --names carries the sentence, so the default is redaction and not silence", () => {
  const r = check({ names: true });
  assert.equal(r.ok, false);
  assert.ok(r.saw.includes(FIELD_CLAIM), `--names did not carry the sentence: ${r.saw}`);
  assert.doesNotMatch(r.saw, /run again with --names/, "and does not tell a reader to do what they did");
});

test("the verdict is identical either way — this touches what is shown, not what was judged", () => {
  assert.equal(check({ names: false }).ok, check({ names: true }).ok);
});

test("the location is the sentence's real index, not a position in the offending set", () => {
  // Reported as 3 because it is the third sentence of the file. A row saying "claim 1" would send a
  // reader to the wrong line and read just as confidently.
  assert.match(check({ names: false }).saw, /sentence 3 /);
});

// ── the helper itself, both directions ───────────────────────────────────────────────────────────────

test("fromTheRun withholds by default and quotes when asked", () => {
  const args = { quotes: ["a sentence about a matter"], where: "sentence 9 of findings.md" };
  const withheld = fromTheRun({ ...args, names: false });
  assert.ok(!withheld.includes("a sentence about a matter"));
  assert.match(withheld, /sentence 9 of findings\.md/);
  const shown = fromTheRun({ ...args, names: true });
  assert.match(shown, /"a sentence about a matter"/);
  assert.ok(shown.includes("sentence 9"),
    "the location is kept when the words are shown — it costs one clause and a reader chasing a surprising row wants to read around it");
});

test("fromTheRun joins several quotes and clips a long one", () => {
  const long = "x".repeat(300);
  const shown = fromTheRun({ names: true, quotes: ["one", long], where: "n/a" });
  assert.match(shown, /"one" · "x{160}" \(n\/a\)$/, "two quotes, the second clipped at 160, then the location");
  assert.ok(!shown.includes("x".repeat(161)), "the clip is the only limit — no caller slices first");
});

test("a location is never empty, because an empty one reads as a row with nothing to say", () => {
  const r = fromTheRun({ names: false, quotes: ["anything"], where: "sentence 1 of f.md" });
  assert.ok(r.trim().length > 0);
  assert.match(r, /sentence 1 of f\.md/);
});

// ── a document that says the same thing twice ────────────────────────────────────────────────────────

test("two copies of one sentence get their own locations, not two copies of the first", () => {
  // THE CASE THE LOCATION HAS TO SURVIVE. Looking the sentence up by its text returns the FIRST copy for
  // both rows, so a document that repeats its claim sends the reader to the same line twice and hides
  // that there was a second. A run that states a thing twice is exactly the run somebody is reading the
  // report about, so this is not a corner.
  const dir = mkdtempSync(join(tmpdir(), "investigate-dup-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(driverDir(dir, "search-policy.json"), JSON.stringify({ pipeline: "knockout" }));
    writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify({
      marks: [{ name: "E2E LOCATION PROBE", records: [{ recordId: "R0" }] }],
    }));
    writeFileSync(join(dir, "knockout-findings.md"), [FIELD_CLAIM, FILLER, FIELD_CLAIM].join("\n"));
    const a = { op: "register-claims-within-counts", path: "knockout-findings.md" };

    const withheld = evalAssertion(a, dir, { names: false });
    assert.equal(withheld.ok, false);
    assert.match(withheld.saw, /2 register claim\(s\)/, "both copies are counted");
    assert.match(withheld.saw, /sentence 1 and 3 of knockout-findings\.md/,
      `the two rows must carry their own indices, not the first one twice: ${withheld.saw}`);

    // CONTROL: the same run with --names still carries the words, so the arm above is about the index
    // and not about the row having gone quiet.
    const shown = evalAssertion(a, dir, { names: true });
    assert.equal(shown.ok, false);
    assert.ok(shown.saw.includes(FIELD_CLAIM), `--names did not carry the sentence: ${shown.saw}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the filings listing: the row that fires when a mark is missing ───────────────────────────────────

const ASKED = "E2E ABSENT PROBE";
const LISTED = ["E2E OTHER PROBE ONE", "E2E OTHER PROBE TWO"];

function makeFilings({ marks }) {
  const dir = mkdtempSync(join(tmpdir(), "filings-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "knockout-filings.json"), JSON.stringify({ marks }));
  return dir;
}

const floor = (dir, mark, opts) => evalAssertion(
  { op: "register-records-floor", path: `knockout-filings.json:${mark}`, value: { records: 1, offices: 1 } },
  dir, opts);

test("a missing mark does not print the mark asked for, nor the ones the listing held", () => {
  // THE WIDEST ROW IN THE OP. It fires exactly when somebody is investigating — a mark is absent — and it
  // used to print the name asked for and every name the listing carried, in clear, with no flag involved.
  const dir = makeFilings({ marks: LISTED.map((name) => ({ name, records: [], terms: [] })) });
  try {
    const r = floor(dir, ASKED, { names: false });
    assert.equal(r.ok, false);
    for (const n of [ASKED, ...LISTED]) assert.ok(!r.saw.includes(n), `a name reached the row: ${r.saw}`);
    assert.match(r.saw, /listed 2 mark\(s\)/, "the count is never withheld — a listing of 2 and a listing of 0 are different defects");
    assert.match(r.saw, /run again with --names/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CONTROL: --names carries the mark asked for and the ones listed", () => {
  const dir = makeFilings({ marks: LISTED.map((name) => ({ name, records: [], terms: [] })) });
  try {
    const r = floor(dir, ASKED, { names: true });
    assert.equal(r.ok, false);
    for (const n of [ASKED, ...LISTED]) assert.ok(r.saw.includes(n), `--names did not carry ${n}: ${r.saw}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an EMPTY listing says so rather than trailing an empty quotation", () => {
  const dir = makeFilings({ marks: [] });
  try {
    const r = floor(dir, ASKED, { names: false });
    assert.match(r.saw, /listed 0 mark\(s\)/);
    assert.doesNotMatch(r.saw, /run again with --names/, "there is nothing to print, so the row must not offer to print it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a refused term is located by its mark's position as well as its own", () => {
  // `term 2 of knockout-filings.json` is ambiguous the moment the listing holds more than one mark, and
  // it always does — the row would send a reader to a term belonging to a different mark.
  const dir = makeFilings({ marks: [
    { name: LISTED[0], records: [], terms: [] },
    { name: LISTED[1], records: [{ territory: "atlantis" }], terms: [{ term: "ok one", ok: true }, { term: "E2E REFUSED SPELLING", ok: false, reason: "the office declined the wildcard" }] },
  ] });
  try {
    const r = floor(dir, LISTED[1], { names: false });
    assert.ok(!r.saw.includes("E2E REFUSED SPELLING"), `the spelling reached the row: ${r.saw}`);
    assert.ok(!r.saw.includes("wildcard"), `the engine's reason reached the row: ${r.saw}`);
    assert.match(r.saw, /term 2 of mark 2 of knockout-filings\.json/, `both coordinates must be named: ${r.saw}`);
    const shown = floor(dir, LISTED[1], { names: true });
    assert.ok(shown.saw.includes("E2E REFUSED SPELLING") && shown.saw.includes("wildcard"), `--names did not carry the term: ${shown.saw}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the path a human actually takes ──────────────────────────────────────────────────────────────────

test("the argv flag reaches a call that passes no options at all", () => {
  // EVERY ARM ABOVE PASSES `names` EXPLICITLY, and the report's own call site passes nothing: it reads
  // the module-level default. So the wiring from `--names` to that default is the one link none of them
  // touch, and it is the only link a human uses.
  const dir = makeFilings({ marks: [{ name: LISTED[0], records: [], terms: [] }] });
  try {
    setReportNames(false);
    assert.equal(REPORT_NAMES, false, "the default is off, so nothing has to remember to turn it on");
    const off = evalAssertion({ op: "register-records-floor", path: `knockout-filings.json:${ASKED}`, value: {} }, dir);
    assert.ok(!off.saw.includes(LISTED[0]), `the default path printed a name: ${off.saw}`);
    setReportNames(true);
    const on = evalAssertion({ op: "register-records-floor", path: `knockout-filings.json:${ASKED}`, value: {} }, dir);
    assert.ok(on.saw.includes(LISTED[0]), `--names did not reach the default path: ${on.saw}`);
  } finally { setReportNames(false); rmSync(dir, { recursive: true, force: true }); }
});

// ── the counts op carries the same two rows, and had neither fix ──────────────────────────────────────

function makeCounts({ marks }) {
  const dir = mkdtempSync(join(tmpdir(), "counts-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify({ marks }));
  return dir;
}

const countFloor = (dir, mark, value, opts) => evalAssertion(
  { op: "register-count-floor", path: `_driver/register-records.json:${mark}`, value }, dir, opts);

test("the counts op withholds its missing-mark row too — one defect, two ops", () => {
  // The two floor ops each carry this row, with one verb each. Fixing one and not the other is the
  // failure this arm exists to prevent: the fixed op is what makes the other easy to miss.
  const dir = makeCounts({ marks: LISTED.map((name) => ({ name, counts: {} })) });
  try {
    const r = countFloor(dir, ASKED, { identical: 1 }, { names: false });
    assert.equal(r.ok, false);
    for (const n of [ASKED, ...LISTED]) assert.ok(!r.saw.includes(n), `a name reached the row: ${r.saw}`);
    assert.match(r.saw, /counted 2 mark\(s\)/, "and it says 'counted', not 'listed' — this op counted them");
    const shown = countFloor(dir, ASKED, { identical: 1 }, { names: true });
    for (const n of [ASKED, ...LISTED]) assert.ok(shown.saw.includes(n), `--names did not carry ${n}: ${shown.saw}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a count that was never taken withholds the reason and names the predicate", () => {
  // `cell.unavailable` is the same field, with the same provenance, as the `doc.unavailable` the listing
  // op withholds — the engine's own prose about why a count could not be taken. One withheld and one not,
  // twenty lines apart, is how this survived the first pass.
  const dir = makeCounts({ marks: [{ name: LISTED[0], counts: { identical: { unavailable: "the office refused the hit-count endpoint for E2E OTHER PROBE ONE" } } }] });
  try {
    const r = countFloor(dir, LISTED[0], { identical: 1 }, { names: false });
    assert.equal(r.ok, false);
    assert.ok(!r.saw.includes("E2E OTHER PROBE ONE"), `the reason carried a name onto the row: ${r.saw}`);
    assert.ok(!r.saw.includes("refused the hit-count"), `the engine's prose reached the row: ${r.saw}`);
    assert.match(r.saw, /identical: NOT TAKEN/, "the predicate and the verdict are never withheld");
    assert.match(r.saw, /counts\.identical\.unavailable/, "and the row says where the reason is");
    const shown = countFloor(dir, LISTED[0], { identical: 1 }, { names: true });
    assert.ok(shown.saw.includes("refused the hit-count"), `--names did not carry the reason: ${shown.saw}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing reason says so rather than offering to print nothing", () => {
  const dir = makeCounts({ marks: [{ name: LISTED[0], counts: { identical: { total: null } } }] });
  try {
    const r = countFloor(dir, LISTED[0], { identical: 1 }, { names: false });
    assert.match(r.saw, /identical: NOT TAKEN — no reason recorded/);
    assert.doesNotMatch(r.saw, /run again with --names/, "there is no reason to print, so the row must not offer to print it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── a door's refusal text ────────────────────────────────────────────────────────────────────────────

test("a door's refusal reason is withheld by default and located instead", () => {
  // The text is the DOOR's, not ours. Nothing here governs a third party's error-message discipline, so
  // the half of these that can echo an order — a `tools/call` refusal, sent after the order is on the
  // wire — is guarded rather than trusted.
  const r = doorReasonLine({ door: "cli", reason: "refused: could not search E2E SECRET MARK" }, false);
  assert.ok(!r.includes("E2E SECRET MARK"), `the door's words reached the row: ${r}`);
  assert.match(r, /rounds\[\]\.cases\[\]\.answers\[\]\.reason/, "and the row says where to read them");
  assert.match(r, /run again with --names/);
});

test("CONTROL: --names carries the door's words", () => {
  const r = doorReasonLine({ door: "cli", reason: "refused: could not search E2E SECRET MARK" }, true);
  assert.ok(r.includes("E2E SECRET MARK"), `--names did not carry the reason: ${r}`);
});

test("A MISSING REASON IS NOT A WITHHELD ONE, and does not offer to print what does not exist", () => {
  // Otherwise a receipt that recorded nothing reads as a receipt that recorded something private, and a
  // reader goes looking for words no door ever wrote.
  for (const row of [{ door: "cli" }, { door: "cli", reason: null }, { door: "cli", reason: "   " }]) {
    const r = doorReasonLine(row, false);
    assert.equal(r, "(no reason recorded)", `a missing reason read as withheld: ${JSON.stringify(row)} -> ${r}`);
    assert.doesNotMatch(r, /run again with --names/);
  }
});

test("the DOOR is never withheld — it is which door refused, not what it said", () => {
  // The door name is a fixed vocabulary and it is the finding: one door refusing and both refusing are
  // different results, and a reader cannot tell them apart if the name goes too.
  assert.equal(doorReasonLine({ door: "ops-mcp", reason: "anything" }, false).includes("ops-mcp"), false,
    "the helper renders only the reason; the caller prints the door beside it");
});
