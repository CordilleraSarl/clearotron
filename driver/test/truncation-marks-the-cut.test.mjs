// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A TRUNCATION THAT READS AS A WORD IS WORSE THAN ONE THAT READS AS A CUT.
//
// The operator-facing `reason` on a dead run, as it shipped:
//
//     no readable coverage ledger — coverage machine-ledger unavailable
//     (coverage_ledger_empty: at least one row per active axis is r) — gates ran on the pr;
//     the prose table yielded zero rows — the coverage-honesty floor cannot run, so no verdict can ship
//
// Two cuts, neither of them visible. `is r` is `is required`, two characters short of the end of its own
// sentence. `the pr` is `the prose table`. Both look like a typo or a corrupt write, so the reader's
// first hypothesis is the wrong one — and the requirement the message exists to state is the part that
// went missing. `git log -S` puts it in the initial commit.
//
// `abbrev` already exists and already says why (`repair-contract.mjs`): it MARKS a cut rather than
// silently slicing one, and ABBREVIATED_VALUE_NOTE gives the marker its meaning wherever a value is
// shown. established that for values a model must copy. This is the same rule for values a HUMAN
// must act on, at every site the issue enumerates.
//
// BREAK MATRIX:
//   · the headline site marks its cut          → break: restore slice(0,60), arm 1 goes red
//   · every named site in the family marks it   → break: restore any one slice, arm 2 goes red
//   · a value that FITS is never marked         → break: always append …, arm 3 goes red
//   · the composed operator reason survives     → break: re-tighten the outer slice, arm 4 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { abbrev } from "../repair-contract.mjs";
import { parseCaseLawLedger } from "../case-law-ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (f) => readFileSync(join(HERE, "..", f), "utf8");

// The exact message that produced the report, from coverage-ledger.mjs's own throw site. 62 characters:
// a 60-character slice lands two short of the end and the cut is invisible.
const REQUIRED = "coverage_ledger_empty: at least one row per active axis is required";

test("#494 arm 1 — the headline cut is marked, so `is r` cannot be read as a word", () => {
  const cut = abbrev(REQUIRED, 60);
  assert.ok(cut.length <= 60, "the bound is still respected — this is not a widening");
  assert.ok(cut.endsWith("…"), "THE DEFECT: a cut that does not say it is a cut");
  assert.ok(!/\bis r$/.test(cut), "the reader must not be handed a truncation that parses as English");
  // …and the marker is what distinguishes it from a message that simply ends there.
  assert.equal(abbrev("short enough", 60), "short enough");
});

test("#494 arm 2 — every site the issue names marks its cut", () => {
  // Source-anchored, because the property is about a code shape and there is no other way to reach the
  // sites that fire only on a corrupt artifact. Comment lines are stripped first: this file's own
  // subject is the string `slice(0, 60)`, and a prose mention of it must not read as a live site.
  const live = (f) => SRC(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const SITES = {
    "named-band.mjs": /named_band_unparseable: \$\{abbrev\(/,
    "case-law-ledger.mjs": /unparseable json \(\$\{abbrev\(/,
    "jx-units.mjs": /fixture missing\/corrupt[^`]*\$\{abbrev\(/,
  };
  for (const [file, want] of Object.entries(SITES))
    assert.match(live(file), want, `${file} truncates an operator-facing message without marking the cut`);
  // The three sites that report a form the driver could not write — each one is the only account of a
  // write that did not happen, so a message cut mid-path is a message that names no file.
  const gw = live("gateway.mjs");
  // B — the disposition tag follows its machinery: the seat-facing form died, and the write this line
  // reports is the ACCUMULATOR's (syncDispositionForm's one write).
  for (const form of ["disposition-accumulator", "coverage-form", "placement-form"])
    assert.match(gw, new RegExp(`\\[${form}\\] could not write[^\`]*\\$\\{abbrev\\(`), `${form}'s write failure is cut without a marker`);
  // And no bare slice survives on the reasons this issue is about.
  const pl = live("pipeline.mjs");
  assert.ok(!/machineLedgerNote[^\n]*String\([^)]*\)\.slice\(/.test(pl),
    "the coverage machine-ledger note is sliced again — this is the exact string from the report");
});

test("#494 arm 3 — a value that FITS is returned whole, marker and all", () => {
  // The other half of "marks the cut": a marker on a complete value would teach the reader to distrust
  // every message, which is the same failure pointing the other way.
  for (const [v, n] of [["exactly ten", 11], ["short", 60], ["", 60]])
    assert.equal(abbrev(v, n), v, `a value that fits must not be marked: ${JSON.stringify(v)}`);
  assert.equal(abbrev("abcdef", 3), "ab…");
  // The parser this rides on still returns its named error, and the error still identifies itself.
  const { ledger, error } = parseCaseLawLedger("{not json");
  assert.equal(ledger, null);
  assert.match(error, /^unparseable json \(/, "the error must still name its class before its detail");
});

test("#494 arm 4 — the composed operator reason carries the whole requirement", () => {
  // The outer message truncates the inner note a second time. The report's `the pr` is that cut. Both
  // bounds have to admit the sentence or the fix only moves the wall.
  const inner = `coverage machine-ledger unavailable (${abbrev(REQUIRED, 60)}) — gates ran on the prose table`;
  const outer = `no readable coverage ledger — ${abbrev(inner, 200)}; the prose table yielded zero rows`;
  assert.ok(outer.includes("gates ran on the prose table"),
    "THE SECOND CUT: the outer bound still eats the end of the inner note");
  assert.ok(!/ the pr[;,]/.test(outer), "`the pr` is the exact string from the shipped report");
  const pl = SRC("pipeline.mjs");
  assert.match(pl, /no readable coverage ledger — \$\{abbrev\(String\(ctx\.machineLedgerNote\), 200\)\}/,
    "the outer bound is back to a bare slice, or is too tight for the inner note to survive it");
});
