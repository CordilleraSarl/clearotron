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
import { evalAssertion, fromTheRun } from "../../scripts/e2e.mjs";

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
  assert.ok(!shown.includes("sentence 9"), "the location is the substitute for the quote, not an addition");
});

test("fromTheRun joins several quotes and clips a long one", () => {
  const long = "x".repeat(300);
  const shown = fromTheRun({ names: true, quotes: ["one", long], where: "n/a" });
  assert.match(shown, /"one" · "x{120}"$/, "two quotes, the second clipped at 120");
});

test("a location is never empty, because an empty one reads as a row with nothing to say", () => {
  const r = fromTheRun({ names: false, quotes: ["anything"], where: "sentence 1 of f.md" });
  assert.ok(r.trim().length > 0);
  assert.match(r, /sentence 1 of f\.md/);
});
