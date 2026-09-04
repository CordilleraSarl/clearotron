// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lever 1 — the synthesis prose directive, owner-ruled and rewritten verbatim.
//
// The directive scopes the SECOND account of a conflict — the per-finding prose in narrative.md beside
// the typed fields — and must never touch the typed register, which every delivered surface and the
// scorer build from.
//
// ── THE RULE THIS FILE USED TO ENFORCE, AND WHY IT IS GONE ───────────────────────────────────────────
//
// An arm here asserted NO DIGIT MAY APPEAR IN THE DIRECTIVE: "a number turns judgment back into a rule",
// on the reasoning that an arithmetic cut removes marks rather than prose. THAT RULING WAS REVERSED by
// the owner in the final target: "the number IS stated in the directive. A hidden bound the seat cannot
// see fails the owner's clarity rule." Known risk, accepted on the record: write-ups may pad toward the
// cap, and the response is lowering a parameter rather than hiding it again.
//
// Written down rather than deleted, because the reasoning that produced it is still good reasoning — a
// count that selects MARKS is still forbidden, and rule 5 is what keeps the two apart. The number here
// bounds prose length only; nothing in the directive counts findings.
//
// ── WHAT STILL HAS NO EXCEPTION ──────────────────────────────────────────────────────────────────────
//
//   · the one-country dispatch is byte-identical — no directive at all, not a permissive one;
//   · the directive states the typed register is untouched BEFORE it asks for less prose;
//   · an unrecognised or incomplete row is UNGRADED — wrong toward depth, never toward brevity.

import { test } from "node:test";
import assert from "node:assert/strict";
import { proseRungDirective } from "../stages.mjs";
import { depthFor } from "../search-policy.mjs";
import { narrativeWriteUpChecks } from "../predelivery-lint.mjs";

const WORLDWIDE = "global-preliminary-search", MULTI = "multi-country-focus-search", ONE = "full-country-search";
const BANDS = [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }];
const directive = (product) => proseRungDirective(depthFor({ product }), BANDS);

test("#1503 the one-country product gets NO directive, so its dispatch is byte-identical by construction", () => {
  assert.equal(directive(ONE), "",
    "the one-country product emits directive text. `lines()` drops only falsy entries, so anything here "
    + "lands in its dispatch and the byte-identical guarantee is gone.");
});

test("#1503 an incomplete or missing row is UNGRADED — the failure direction is depth", () => {
  // Both parameters are required. Half a rule is the dangerous state: a cap with no kept set would
  // shorten every write-up including the ones that must be full, and a kept set with no cap is a rule
  // the check cannot enforce.
  for (const d of [undefined, null, {}, { narrativeKeptBandRank: 3 }, { narrativeWriteUpWords: 270 },
    { narrativeKeptBandRank: 0, narrativeWriteUpWords: 270 }, { narrativeKeptBandRank: 3, narrativeWriteUpWords: 0 }])
    assert.equal(proseRungDirective(d, BANDS), "",
      `${JSON.stringify(d)} produced a directive. An incomplete row must fall to today's behaviour: being `
      + "wrong toward depth costs time, being wrong toward brevity silently shortens a report somebody paid for.");
});

test("#1503 the directive is the five ruled rules, in order, verbatim", () => {
  const d = directive(WORLDWIDE);
  assert.match(d, /^DEPTH OF WRITING — rules for prose write-ups in narrative\.md on this run\.$/m);
  assert.match(d, /^1\. Every finding gets its complete typed record in findings\.json\. No exceptions\./m);
  assert.match(d, /^2\. Write a prose write-up for a finding only if its band is one of: /m);
  assert.match(d, /^3\. For every other finding, write no prose write-up\. Its typed record is its write-up\.$/m);
  assert.match(d, /^4\. Each prose write-up is at most \d+ words\.$/m);
  assert.match(d, /^5\. These rules never change what you conclude, what disposition you assign, or which marks appear in the report\.$/m);
  assert.equal(d.split("\n").length, 6, "the directive grew a sixth line — the template is five rules and a heading");
});

test("#1503 RULE 1 COMES FIRST — the typed register is promised before less prose is asked for", () => {
  // A seat that reads "write less" as "record less" is a filter wearing a ladder's clothes. Order is
  // part of the instruction, not presentation.
  const d = directive(WORLDWIDE);
  assert.ok(d.indexOf("complete typed record") < d.indexOf("only if its band"),
    "the directive asks for less prose before it promises the complete typed record");
});

test("#1503 rule 2 names the run's OWN band labels — the seat is told values it holds", () => {
  const d = directive(WORLDWIDE);
  assert.match(d, /`Very High`, `High`, `Moderate`/,
    "rule 2 does not name this run's band labels, so the seat has to map a rank onto its framework itself");
  assert.doesNotMatch(d, /`Manageable`/, "a band below the cut was named as kept");
});

test("#1503 with NO manifest the rank is stated in words, never dropped or guessed", () => {
  // A dispatch that could not resolve the manifest must still carry a usable rule. Silently emitting
  // nothing would ungrade the product; naming bands it has not read would be an invention.
  const d = proseRungDirective(depthFor({ product: WORLDWIDE }), null);
  assert.ok(d, "no manifest produced no directive at all — the product silently ungraded");
  assert.match(d, /the top 3 bands of this run's risk framework/);
});

test("#1503 the two graded products share the kept rule and differ ONLY in the cap", () => {
  const ww = directive(WORLDWIDE), mc = directive(MULTI);
  assert.match(ww, /at most 270 words/);
  assert.match(mc, /at most 330 words/);
  assert.equal(ww.replace(/at most \d+ words/, "X"), mc.replace(/at most \d+ words/, "X"),
    "the two graded products differ somewhere other than the word cap — the kept rule is the same rank "
    + "on both, and a second difference would be an unruled one");
});

test("#1503 NO COUNT SELECTS A MARK — the reversed rule's reasoning still holds where it applies", () => {
  // The number bounds PROSE LENGTH. Nothing in the directive counts findings, ranks by arithmetic, or
  // caps how many marks are written about — that cut is the band rank, which is a judgment the seat
  // already made. Rule 5 is what keeps the two apart, so it is asserted here and not only above.
  const d = directive(WORLDWIDE);
  const numbered = d.split("\n").filter((l) => /\d/.test(l) && !/^[1-5]\. /.test(l));
  assert.deepEqual(numbered, [], `a line outside the rule numbering carries a digit: ${numbered.join(" | ")}`);
  const rule4 = d.split("\n").find((l) => l.startsWith("4. "));
  assert.match(rule4, /^4\. Each prose write-up is at most \d+ words\.$/,
    "the only count in the directive must be the per-write-up word bound");
  assert.match(d, /never change what you conclude, what disposition you assign, or which marks appear/);
});

// ── THE DIRECTIVE AND THE CHECK, AGAINST THE REAL PER-PRODUCT ROWS ───────────────────────────────────

test("#1503 the check ACTIVATES on the real rows the directive is built from — one rule, two ends", () => {
  // Neither half makes this claim alone: the directive arms read what the seat is TOLD, the check arms
  // read a fixture's parameters. This reads the shipped rows through both, so a row that instructs and
  // does not check — or checks and does not instruct — is visible.
  const MANIFEST = { bands: [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }] };
  const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const md = [
    "# N", "", "## Finding 1 — A", "", "**Composite:** 4", "", w(20), "",
    "## Finding 2 — B", "", "**Composite:** 2", "", w(400), "",
    "## Finding 3 — C", "", "**Composite:** 1", "", w(20), "",
  ].join("\n");
  const findings = { findings: [{ ordinal: 1, band: "Very High" }, { ordinal: 2, band: "High" }, { ordinal: 3, band: "Manageable" }] };

  for (const p of [WORLDWIDE, MULTI]) {
    const depth = depthFor({ product: p });
    assert.ok(proseRungDirective(depth, MANIFEST.bands), `${p}: instructed nothing`);
    const bad = narrativeWriteUpChecks({ narrativeMd: md, findings, depth, manifest: MANIFEST }).filter((r) => !r.pass);
    assert.deepEqual(bad.map((r) => r.id.replace(/^narrative-write-ups:/, "")).sort(),
      ["not-kept:3", "over-cap:2"],
      `${p}: instructed but did not catch a 400-word write-up and a rank-4 one`);
  }
  // And the ungraded product does NEITHER — no directive, no check, no row.
  const one = depthFor({ product: ONE });
  assert.equal(proseRungDirective(one, MANIFEST.bands), "");
  assert.deepEqual(narrativeWriteUpChecks({ narrativeMd: md, findings, depth: one, manifest: MANIFEST }), []);
});
