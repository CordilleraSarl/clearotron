// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SCORER WITHHOLDS NAMES UNLESS ASKED. A scenario's reference answer is a real lawyer's answer to a
// real matter; scoring a run is routine and happens in sessions that record what they print. So the
// default output carries counts and indexes, and `--names` carries the words.
//
// EVERY ARM HERE HAS ITS CONTROL, and that is the point rather than thoroughness for its own sake: a
// redaction test that only checks the default path passes just as happily over a command that printed
// nothing at all, or over a redactor that blanked the page. So each arm asserts the name is GONE from
// the redacted text AND PRESENT in the named text built from the same input, and that the numbers
// survive both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { protectedStrings, redactor, installRedaction, unclassifiedNotice, REDACTION_NOTICE } from "../score-redaction.mjs";

// Invented names, never a scenario's. The shapes are what matter: a mark, a proprietor, a longer mark
// that CONTAINS the shorter one, and a sentence that reasons about them.
const REFERENCE = {
  mark: "Quillion",
  covers_marks: ["Quillion", "Quillion Forge"],
  scenario_note: "The subject sits in a crowded field for tabletop goods.",
  register: [
    { mark: "Quillion Forge", owner: "Bracken Holdings AG", note: "A live registration the lawyer raised.", classes: ["28"] },
    { mark: "Quillon", owner: "Marrowgate Limited", note: "Cited as a near spelling.", classes: ["28"] },
  ],
  assertions: ["Bracken Holdings AG is analysed as a permitted-use dispute rather than a bare conflict."],
  controls: ["The delivered run of this matter found 1 of the 2 register floor owners."],
  counts: [{ mark: "Quillion", close_variations: ["Quillian", "Kwillion"] }],
};

const SCORED = {
  buckets: {
    found: [{ mark: "Quillion Forge", matched: "QUILLION FORGE", rule: "exact" }],
    lost: [{ mark: "Quillon", owner: "Marrowgate Limited" }],
    noise: [{ mark: "Thresher Optics", owner: "Thresher Optics NV" }],
  },
};

const build = () => {
  const { names, prose } = protectedStrings({ reference: REFERENCE, scored: SCORED });
  return { names, prose, redact: redactor({ names, prose }) };
};

test("every name in the reference and in the run's own buckets is collected", () => {
  const { names } = build();
  for (const n of ["Quillion", "Quillion Forge", "Quillon", "Bracken Holdings AG", "Marrowgate Limited",
    "Thresher Optics", "Thresher Optics NV", "Quillian", "Kwillion"])
    assert.ok(names.has(n), `${n} is a name this scorer must not print by default, and it was not collected`);
});

test("a proprietor the run surfaced and the lawyer never named is protected too", () => {
  // The reference does not mention it; it reaches the page through `noise`. Somebody's name either way.
  const { names, redact } = build();
  assert.ok(names.has("Thresher Optics NV"));
  assert.ok(!redact("noise: Thresher Optics NV").includes("Thresher Optics NV"));
});

test("a redacted line keeps its numbers and loses its names", () => {
  const { redact } = build();
  const line = "  found       1         Quillion Forge  →  matched \"QUILLION FORGE\" on exact";
  const out = redact(line);
  assert.ok(!/Quillion/i.test(out), `a mark survived redaction: ${out}`);
  assert.match(out, /found/, "the bucket label must survive");
  assert.match(out, /\b1\b/, "the count must survive");
  assert.match(out, /«name \d+»/, "the entry must still be identifiable");
});

test("CONTROL: the same line with names asked for still carries them", () => {
  // Without this arm, a redactor that returned the empty string would pass every assertion above.
  const line = "  found       1         Quillion Forge  →  matched \"QUILLION FORGE\" on exact";
  const identity = redactor({ names: new Set(), prose: new Set() });
  assert.match(identity(line), /Quillion Forge/, "the flagged path must print the name unchanged");
  assert.equal(identity(line), line, "with nothing protected, redaction is the identity");
});

test("the longer mark is redacted before the shorter one it contains", () => {
  // Shortest-first leaves " Forge" on the page beside a token claiming the name was removed. A redaction
  // that reports itself complete while it is not is worse than none: the next reader trusts it.
  const { redact } = build();
  const out = redact("the run found Quillion Forge in class 28");
  assert.ok(!out.includes("Forge"), `a fragment of the longer mark survived: ${out}`);
  assert.equal((out.match(/«name \d+»/g) ?? []).length, 1, `expected one token, got: ${out}`);
});

test("a mark is redacted whatever its case", () => {
  const { redact } = build();
  for (const form of ["QUILLON", "quillon", "Quillon"])
    assert.ok(!redact(`surfaced ${form}`).toLowerCase().includes("quillon"), `${form} survived redaction`);
});

test("the same name gets the same token every time, and two names get two", () => {
  // A token that moved between two scores of the same run would make the two impossible to compare,
  // which is the reason to prefer an index over a blanked span in the first place.
  const { redact } = build();
  const a = redact("Marrowgate Limited");
  assert.equal(a, redact("Marrowgate Limited"), "the token must be stable across calls");
  assert.notEqual(a, redact("Bracken Holdings AG"), "two names must not collapse into one token");
});

test("a reference sentence is withheld whole, not name-substituted", () => {
  // Swapping the names out of "X is analysed as a permitted-use dispute" leaves a sentence that still
  // says what the matter is about. Prose goes as a unit.
  const { redact } = build();
  const out = redact(`    [assertion] ${REFERENCE.assertions[0]}`);
  assert.ok(!out.includes("permitted-use"), `the sentence survived: ${out}`);
  assert.ok(!out.includes("Bracken"), `a name inside the sentence survived: ${out}`);
  assert.match(out, /\[assertion\]/, "the reader must still see that an assertion was there");
  assert.match(out, /--names/, "and how to read it");
});

test("a control sentence and a reference note are withheld the same way", () => {
  const { redact } = build();
  assert.ok(!redact(REFERENCE.controls[0]).includes("floor owners"));
  assert.ok(!redact(REFERENCE.register[0].note).includes("lawyer raised"));
  assert.ok(!redact(REFERENCE.scenario_note).includes("crowded field"));
});

test("a one- or two-character name is not swapped, because it would shred ordinary words", () => {
  const { names, redact } = protectedStringsFor({ reference: { register: [{ mark: "MC" }] } });
  assert.ok(!names.has("MC"), "too short to swap safely");
  assert.equal(redact("the record was incomplete"), "the record was incomplete");
});

function protectedStringsFor(root) {
  const { names, prose } = protectedStrings(root);
  return { names, prose, redact: redactor({ names, prose }) };
}

test("the notice says what was done and how to undo it", () => {
  assert.match(REDACTION_NOTICE, /withheld/);
  assert.match(REDACTION_NOTICE, /--names/);
  assert.match(REDACTION_NOTICE, /counts and buckets below are unaffected/);
});

test("text with no protected string is returned untouched", () => {
  // The redactor runs over every line the scorer prints, so the axes, the headings and the rules of
  // thumb must come through exactly as written.
  const { redact } = build();
  for (const line of [
    "  bucket      n         of the marks the lawyer named",
    "── axis D · gap discipline ──",
    "  lost NOT COMPUTED — this run dir has no _driver/",
  ]) assert.equal(redact(line), line);
});

// ── FINDINGS FROM REVIEW OF 811aeda9 ─────────────────────────────────────────────────────────────────

test("a short name does not rewrite the tool's own words", () => {
  // Unbounded, a three-letter proprietor turned `Search found 3` into `Se«name 1»h found 3` and mangled
  // `searched / not-searched` in the bucket rows. Worse than a miss: the page then carries a token
  // asserting a name was removed beside a word that never was one.
  const { redact } = protectedStringsFor({ reference: { register: [{ mark: "Arc" }] } });
  const line = "Search found 3; bucket: searched / not-searched; noise 1";
  assert.equal(redact(line), line, `the tool's own words were rewritten: ${redact(line)}`);
});

test("CONTROL: the same short name IS redacted where it stands on its own", () => {
  // Without this, a matcher that had simply stopped matching would pass the arm above.
  const { redact } = protectedStringsFor({ reference: { register: [{ mark: "Arc" }] } });
  for (const line of ["the owner is Arc", "Arc, and others", "(Arc)", "\"Arc\"", "Arc's filing", "two Arcs"])
    assert.match(redact(line), /«name \d+»/, `a standalone name survived: ${line} → ${redact(line)}`);
  assert.ok(!/\bArcs?\b/i.test(redact("two Arcs")), "a plural must be consumed, not left beside the token");
});

test("a string-valued key this module does not classify is reported, by key and never by value", () => {
  // The per-site problem moved one level up: the site that gets forgotten becomes the key that gets
  // forgotten, and a reference gaining a field is exactly when nobody is thinking about this file.
  const { unclassified } = protectedStrings({
    reference: { mark: "Quillion", tagline: "Kestrel Holdings SA is the proprietor" },
  });
  assert.deepEqual(unclassified, ["tagline"], "the new key is named");
  const notice = unclassifiedNotice(unclassified);
  assert.match(notice, /tagline/, "the notice names the key");
  assert.ok(!notice.includes("Kestrel"), "and never its value, which is the thing it failed to protect");
  assert.match(notice, /NOT withheld/, "and says plainly what did not happen");
});

test("CONTROL: a reference of known keys reports nothing, so the warning stays worth reading", () => {
  // Seven harmless keys reported on every run is a warning ignored inside a week, which is the same
  // absence-as-pass one level up.
  const { unclassified } = protectedStrings({ reference: REFERENCE, scored: SCORED });
  assert.deepEqual(unclassified, [], `steady state must be silent, got: ${unclassified.join(", ")}`);
});

test("a key beginning with an underscore documents the file, not the matter", () => {
  const { unclassified } = protectedStrings({ reference: { _sessionNames_why: "a sentence about this file" } });
  assert.deepEqual(unclassified, []);
});

test("the boundary covers every way out of the process, not console.log alone", () => {
  // `console.log` alone was the whole install. A later `console.error` carrying a mark, or a throw whose
  // message interpolates one, printed in full — and both are error paths, where a name is most likely to
  // be interpolated and least likely to be read again.
  const { redact } = build();
  const wrote = [];
  const fake = {
    console: { log: (s) => wrote.push(["log", s]), error: (s) => wrote.push(["error", s]),
      warn: (s) => wrote.push(["warn", s]), info: () => {}, debug: () => {} },
    process: { stdout: { write: (s) => wrote.push(["stdout", s]) },
      stderr: { write: (s) => wrote.push(["stderr", s]) }, on: () => {}, off: () => {}, exit: () => {} },
  };
  const uninstall = installRedaction(redact, fake);
  fake.console.log("via log: Quillion Forge");
  fake.console.error("via error: Quillion Forge");
  fake.console.warn("via warn: Quillion Forge");
  fake.process.stdout.write("via stdout: Quillion Forge");
  fake.process.stderr.write("via stderr: Quillion Forge");
  uninstall();
  assert.equal(wrote.length, 5);
  for (const [via, text] of wrote)
    assert.ok(!/Quillion/i.test(text), `${via} leaked the name: ${text}`);
});

test("CONTROL: uninstalling puts every writer back, so nothing stays wrapped after the run", () => {
  const { redact } = build();
  const wrote = [];
  const log = (s) => wrote.push(s);
  const write = (s) => wrote.push(s);
  const fake = {
    console: { log, error: log, warn: log, info: log, debug: log },
    process: { stdout: { write }, stderr: { write }, on: () => {}, off: () => {}, exit: () => {} },
  };
  const uninstall = installRedaction(redact, fake);
  assert.notEqual(fake.console.log, log, "installed");
  uninstall();
  assert.equal(fake.console.log, log, "console.log restored");
  assert.equal(fake.process.stdout.write, write, "stdout.write restored");
  fake.console.log("Quillion Forge");
  assert.equal(wrote.at(-1), "Quillion Forge", "and the restored writer does not redact");
});

test("a stream write keeps its encoding and callback arguments", () => {
  // `write(chunk, encoding, cb)` — a wrapper that dropped the tail would hang a caller waiting on cb.
  const { redact } = build();
  const seen = [];
  const fake = {
    console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    process: { stdout: { write: (...a) => { seen.push(a); return true; } },
      stderr: { write: () => true }, on: () => {}, off: () => {}, exit: () => {} },
  };
  const uninstall = installRedaction(redact, fake);
  let called = false;
  fake.process.stdout.write("Quillion Forge", "utf8", () => { called = true; });
  uninstall();
  assert.equal(seen[0][1], "utf8", "the encoding survives");
  seen[0][2]();
  assert.ok(called, "the callback survives");
  assert.ok(!/Quillion/i.test(seen[0][0]), "and the chunk is still redacted");
});

test("a non-string chunk passes through untouched", () => {
  // A Buffer write must not be stringified on its way to the terminal.
  const { redact } = build();
  const seen = [];
  const fake = {
    console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    process: { stdout: { write: (c) => { seen.push(c); return true; } },
      stderr: { write: () => true }, on: () => {}, off: () => {}, exit: () => {} },
  };
  const uninstall = installRedaction(redact, fake);
  const buf = Buffer.from("bytes");
  fake.process.stdout.write(buf);
  uninstall();
  assert.equal(seen[0], buf, "the same Buffer, not a copy and not a string");
});
