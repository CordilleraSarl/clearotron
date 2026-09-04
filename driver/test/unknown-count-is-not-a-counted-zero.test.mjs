// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unknown-count-is-not-a-counted-zero.test.mjs —.
//
// Two providers deliberately answer "I could not count this" with `total_hits: null`, and say so in
// their own tool descriptions — signa: "null means UNKNOWN: never 0, and never a number inferred from
// the pages you saw"; uspto-local: "a copy older than 24 hours cannot support a clean negative, so the
// count refuses with total:null rather than answering 0". Every projection between those providers and
// the reader collapsed that null to 0 with `Number(x) || 0` or `x ?? 0`.
//
// MEASURED BEFORE THE FIX, one null block through the whole chain: the crowd projection said 0, the
// quarantine path said 0, the band shape said 0 AND produced no blind spot at all, record-carry called
// it `counted-not-fetched` with `untraced: 0`, and the markdown a lawyer reads printed this —
//
//   - `name:"ZEPHYR" exact` — 0 hit(s), 0 fetched. the register would only
//     approximate the total, so no count was taken
//
// — the false count and the true reason on one line, because the number came from the collapsed field
// and the sentence came from the vendor.
//
// Every arm below carries a REAL COUNTED ZERO as the control. That is the value the collapse was
// indistinguishable from, so a fix that cannot tell them apart has not fixed anything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNamedBand, quarantineUnknownStates } from "../named-band.mjs";
import { buildBandShape } from "../band-shape.mjs";
import { untraceableSlices, traceRecordCarry } from "../record-carry.mjs";

// The register ran the slice and would not state a total.
const UNKNOWN = { qid: "u:1", state: "incomplete", total_hits: null, fetched: 3, sample: [],
  query: 'name:"ZEPHYR" exact', reason: "the register would only approximate the total, so no count was taken" };
// THE CONTROL — searched, and genuinely empty.
const ZERO = { qid: "z:1", state: "incomplete", total_hits: 0, fetched: 0, sample: [],
  query: 'name:"NOTHINGHERE" exact', reason: "count-only descriptor" };
// A real crowd, to prove ordinary counts are untouched.
const CROWD = { qid: "c:1", state: "incomplete", total_hits: 4821, fetched: 600, sample: [],
  query: 'name:"ZEPHYR" contains', reason: "over the enumerate ceiling" };

const band = (blocks) => parseNamedBand(JSON.stringify(blocks));
const crowdBy = (blocks, qid) => band(blocks).crowds.find((c) => c.qid === qid);

test("#1615 every real count survives; nothing else becomes one", () => {
  // Driven through parseNamedBand rather than importing the helper directly: the file then still
  // LOADS against the pre-fix tree, so each arm below reports its own verdict instead of the whole
  // suite dying on a missing export — and this is the path the collapse actually happened on.
  const totalFor = (v) => parseNamedBand(JSON.stringify([
    { qid: "t:1", state: "incomplete", total_hits: v, fetched: 0, sample: [], query: "q", reason: "r" },
  ])).crowds[0].total_hits;

  // A counted zero is a MEASUREMENT and must survive as 0 — that is the whole discrimination.
  assert.equal(totalFor(0), 0);
  assert.equal(totalFor("0"), 0);
  assert.equal(totalFor(4821), 4821);
  assert.equal(totalFor("12"), 12);
  // Everything that is not a number is unknown, which is the fail-safe direction.
  for (const v of [null, "", "abc"]) {
    assert.equal(totalFor(v), null, `${JSON.stringify(v)} was turned into a count`);
  }
  // The type test is load-bearing: Number([]) is 0 and Number([5]) is 5, so a bare Number.isFinite
  // check lets an array become a count. This arm is why the helper tests typeof before value.
  assert.equal(totalFor([]), null, "an empty array became a count of zero");
  assert.equal(totalFor([5]), null, "a one-element array became its element");
  assert.equal(totalFor({}), null);
});

test("#1615 an unknown total survives the crowd projection; a counted zero survives as zero", () => {
  assert.equal(crowdBy([UNKNOWN, ZERO, CROWD], "u:1").total_hits, null, "the register's UNKNOWN became a number");
  assert.equal(crowdBy([UNKNOWN, ZERO, CROWD], "z:1").total_hits, 0, "a real counted zero was turned into UNKNOWN");
  assert.equal(crowdBy([UNKNOWN, ZERO, CROWD], "c:1").total_hits, 4821);
});

test("#1615 the quarantine path does not invent a count for a block it already distrusts", () => {
  // This path is model-authored blocks ONLY: a qid-stamped block with an unknown state throws above it
  // ("machine states are code-owned"), which is asserted here so the arm cannot silently drift onto
  // the wrong branch.
  const { qid: _q, ...noQid } = UNKNOWN;
  assert.throws(() => quarantineUnknownStates(JSON.stringify([{ ...UNKNOWN, state: "checked" }])),
    /named_band_state_invalid/, "premise: a qid-stamped unknown state throws rather than quarantining");
  const q = quarantineUnknownStates(JSON.stringify([{ ...noQid, state: "checked" }]));
  assert.equal(q.blocks[0].total_hits, null);
  const { qid: _z, ...zeroNoQid } = ZERO;
  assert.equal(quarantineUnknownStates(JSON.stringify([{ ...zeroNoQid, state: "checked" }])).blocks[0].total_hits, 0);
});

test("#1615 an uncountable slice is a blind spot, and could never have been the unenumerated one", () => {
  const shape = buildBandShape(band([UNKNOWN, ZERO, CROWD]), { targets: ["ZEPHYR"] }).shape;
  const kinds = Object.fromEntries(shape.blind_spots.map((b) => [b.kind, b]));

  assert.ok(kinds["uncountable-slice"], "a slice of unmeasured size raised no blind spot");
  assert.equal(kinds["uncountable-slice"].count, 1);
  assert.equal(kinds["uncountable-slice"].zones[0].query, UNKNOWN.query);

  // THE ARITHMETIC THAT HID IT — criterion 4. `null > n` is false for every n, so the unenumerated
  // detector was never going to see one, exactly as `0 > 0` hid a refused slice.
  assert.equal(null > 0, false);
  assert.equal(null > 3, false);
  for (const z of (kinds["unenumerated-crowd"]?.zones ?? [])) {
    assert.notEqual(z.query, UNKNOWN.query, "an uncountable slice was reported as an unenumerated crowd");
  }
  // The real crowd still is one — the detector keeps working for what it was built for.
  assert.ok((kinds["unenumerated-crowd"]?.zones ?? []).some((z) => z.query === CROWD.query));
  // And the shape carries the null rather than re-collapsing it one projection later.
  assert.equal(shape.crowds.find((c) => c.query === UNKNOWN.query).total_hits, null);
});

test("#1615 record-carry says the remainder is unmeasured, not zero", () => {
  const rows = untraceableSlices({ crowds: band([UNKNOWN, ZERO, CROWD]).crowds });
  const u = rows.find((r) => r.qid === "u:1");
  const z = rows.find((r) => r.qid === "z:1");

  assert.equal(u.slice_class, "count-unavailable", "an unsizable slice was classed as one the run counted");
  assert.equal(u.total_hits, null);
  assert.equal(u.untraced, null, "unknown minus fetched must stay unknown");
  assert.equal(u.fetched, 3, "what WAS fetched is real and must survive");
  assert.match(u.reason, /SIZE UNKNOWN/);

  // THE CONTROL — a counted zero is still counted, still `counted-not-fetched`, still 0 untraced.
  assert.equal(z.slice_class, "counted-not-fetched");
  assert.equal(z.total_hits, 0);
  assert.equal(z.untraced, 0);

  // The unknown row sorts FIRST: it is the row nothing can be said about, and it used to sort last
  // with the empties because `b.untraced - a.untraced` reads a null as 0.
  assert.equal(rows[0].qid, "u:1", "the unmeasurable slice sorted below rows that are fully accounted for");
});

test("#1615 the hit total states its own incompleteness", () => {
  const t = traceRecordCarry({ crowds: band([UNKNOWN, ZERO, CROWD]).crowds }).totals;
  // 4821 - 600 = 4221 from the real crowd; 0 from the counted zero; the unknown adds NOTHING and
  // says so, rather than contributing a silent 0 that makes the sum look complete.
  assert.equal(t.untraced_hits, 4221);
  assert.equal(t.untraced_unknown_slices, 1, "the sum does not disclose that a slice could not be added to it");
  assert.equal(t.untraceable_slices, 3);
});

test("#1615 the prose does not print a count the register never gave", () => {
  const { md } = buildBandShape(band([UNKNOWN, ZERO, CROWD]), { targets: ["ZEPHYR"] });
  const lines = md.split("\n").filter((l) => l.includes(UNKNOWN.query));
  assert.ok(lines.length, "the uncountable slice is absent from the mirror entirely");
  for (const l of lines) {
    assert.equal(/\b0 hit\(s\)/.test(l), false, `a slice the register would not size is rendered as empty: ${l}`);
    assert.match(l, /UNKNOWN/i);
  }
  // fmtN(null) is "0" — the mechanism by which this printed a clean negative for a year.
  assert.equal(Number(null ?? 0).toLocaleString("en-US"), "0");
  // THE CONTROL — a genuine zero still reads as a zero, because that is a true statement about it.
  const zeroLine = md.split("\n").find((l) => l.includes(ZERO.query));
  assert.match(zeroLine, /0 hit\(s\)/);
});
