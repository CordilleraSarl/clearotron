// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE SNAPSHOT SUB-SHAPE, CLASSIFIED COMPLETELY.
//
// The class: an ELIGIBILITY side computed against one snapshot of a collection, meeting an ENFORCEMENT
// side computed against a DIFFERENT snapshot of the same collection. The founding instance was
// `quote_required`, set at form-build against candidates that were later rebuilt textless — a flag from
// one snapshot judging data from another.
//
// 's deliverable is a CLASSIFICATION, not a sample: a partial enumeration reading as a complete one
// is the very class the issue belongs to. So this takes the sub-shape that can be enumerated exactly —
// every site in `driver/*.mjs` (tests excluded) whose own comment says a collection is REGENERATED or
// REBUILT on every pass — and rules on all of them.
//
// THE ENUMERATION CORRECTED MY OWN COUNT, WHICH IS THE ARGUMENT FOR WRITING IT AS CODE. I reported nine
// sites on the issue from a narrower phrase scan. The scan below finds TEN pre-existing ones: it also
// reaches the two `PROVENANCE` blocks, which are the strongest members of the class and were missed by a
// hand-run grep. A classification asserted from a number somebody remembered is the thing this issue is
// about.
//
// ── THE RULING, ALL TEN ─────────────────────────────────────────────────────────────────────────────
//
//  AGREE (9) — both ends read ONE snapshot, and the site says so with its mechanism:
//   · gateway.mjs:534           the judgement-time union IS the regeneration — "same builder, same
//                               predicate, same arguments as the tool's own fold" — and the counted
//                               state uses `isRuled`, the predicate the gate judges with.
//   · disposition-union.mjs:32  PROVENANCE: rows, ids and candidates come from `connotationObligations()`,
//                               "the same calculation the validator judges with", regenerated every pass.
//   · coverage-union.mjs:31     PROVENANCE: the same sentence for the coverage form. These two are the
//                               template in its purest form — the agreement is a property of the
//                               artifact's own provenance, not an assertion somewhere else.
//   · disposition-union.mjs:113 the anchor is deliberately NOT persisted; only extracted text is durable.
//   · disposition-call.mjs:637  the same rule stated at the other end, so the pair cannot drift.
//   · coverage-form.mjs:149     the driver's axis is the driver's; the seat contract governs only rows
//                               the seat adds.
//   · coverage-form.mjs:313     determinism, with its mechanism (a fixed axis ordering) beside it.
//   · stages.mjs:1504, :1780    OUT OF CLASS, and enumerated rather than quietly dropped: E12 contract
//                               classifications explaining why a dictation is code-rendered. No
//                               flag/data pair exists at either site.
//
//  DISAGREE (1) — the two ends read different snapshots and nothing converges:
//   · verify.mjs:1146           `activeAxes` is basename-derived from a directory listing, so a stray
//                               `.md` in register-units mints a DRIVER axis row the seat cannot repair
//                               and the union regenerates every pass. The ladder runs out. verify.mjs
//                               recorded this itself and asked for "its own token naming the driver" if
//                               it were ever observed.
//
// ── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ─────────────────────────────────────────────────────
//
// The disagreement is made OBSERVABLE, not filtered. Dropping an unrecognised unit would silently shrink
// the form's axis set, and a coverage form that quietly covers less is a worse artifact than the
// unrepairable row it would be avoiding — the same trade `coverage-form-io.mjs` already makes when an
// unknown provider "reads as unestablished, which discloses".
//
// The UNIT sub-shape (`.some(` / `.every(` — 241 sites) is NOT covered here and is not claimed to be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTER_AXES } from "../coverage-ledger.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVERY_PASS = /(regenerat\w*|rebuil\w*)[^.\n]{0,80}?(every|each|per) (pass|regeneration)/i;
const src = (f) => readFileSync(join(DRIVER, f), "utf8");

/**
 * A file's prose with its scaffolding removed, so a sentence can be matched whole however it is laid out.
 *
 * THREE KINDS OF SCAFFOLDING, and the third cost a failing test to find: comment markers, line wrapping,
 * and STRING CONCATENATION. The two PROVENANCE blocks carry the load-bearing sentence across a `" + "`
 * join, so a matcher that only unwrapped comments reported them as no longer saying it — a false alarm
 * on the two strongest members of the class.
 */
const flat = (f) => src(f)
  .replace(/^\s*(\/\/|\*)\s?/gm, "")     // comment markers
  .replace(/"\s*\+\s*"/g, "")             // "…" + "…" joins
  .replace(/\s+/g, " ");

/** Every `<file>:<line>` in driver/*.mjs whose line says a collection is regenerated every pass. */
function population() {
  const hits = [];
  for (const f of nonEmpty(readdirSync(DRIVER), "readdirSync(DRIVER)")) {
    if (!f.endsWith(".mjs")) continue;
    src(f).split("\n").forEach((ln, i) => { if (EVERY_PASS.test(ln)) hits.push(`${f}:${i + 1}`); });
  }
  return hits.sort();
}

// The files ruled on above, plus the two this change itself authored. Kept as FILES rather than
// line numbers on purpose: a line number is stale the moment anything above it moves, and what
// has to stay true is that no file joins the class unruled.
const RULED = new Set([
  "gateway.mjs", "stages.mjs", "disposition-union.mjs", "disposition-call.mjs",
  "coverage-form.mjs", "coverage-union.mjs", "verify.mjs",
  "coverage-form-io.mjs",   // the report for the one disagreement, authored by this change
]);

test("#1100 every site in the snapshot sub-shape has been ruled on", () => {
  const found = population();
  assert.ok(found.length >= 10,
    `the scan found ${found.length} sites — it is measuring less than it did when this was classified, `
    + "which means the phrases moved and the scan is now blind to members it used to see");
  const unruled = [...new Set(found.map((h) => h.split(":")[0]))].filter((f) => !RULED.has(f)).sort();
  assert.deepEqual(unruled, [],
    `these files joined the snapshot sub-shape and nobody ruled on them: ${unruled.join(", ")}. #1100's `
    + "deliverable is a COMPLETE classification, so this is not a passing test with an exception — it is "
    + "a site to read and rule agree/disagree in this file's header.");
  const vanished = [...RULED].filter((f) => !found.some((h) => h.startsWith(`${f}:`))).sort();
  assert.deepEqual(vanished, [],
    `the classification rules on ${vanished.join(", ")}, which no longer carries such a site. Re-read it: `
    + "either the pair went (delete the ruling) or the comment was reworded and the scan is now blind.");
});

test("#1100 the AGREE sites still state their mechanism, not merely their intent", () => {
  // A site that claims one snapshot without naming what makes it one has stopped being evidence.
  assert.match(flat("gateway.mjs"), /same builder, same predicate, same arguments as the tool's own fold/,
    "gateway's union no longer claims to BE the regeneration — the judgement-time bytes and the tool's "
    + "bytes could now differ for identical inputs");
  for (const f of ["disposition-union.mjs", "coverage-union.mjs"])
    assert.match(flat(f), /the same calculation the validator judges with/,
      `${f}'s PROVENANCE no longer says the driver's computation IS the validator's — that sentence is the `
      + "whole guarantee, stated on the artifact rather than asserted about it");
  assert.match(flat("disposition-union.mjs"), /The anchor itself does NOT persist/,
    "the anchor's non-persistence is the cure for pointing into a regenerated list");
  assert.match(flat("disposition-call.mjs"), /only the EXTRACTED TEXT is durable/,
    "the other end of that pair stopped saying the same thing — which is how two ends drift apart");
});

// ── THE ONE DISAGREEMENT ────────────────────────────────────────────────────────────────────────────

test("#1100 an axis minted from a stray unit file is REPORTED, and the driver names itself", () => {
  const io = src("coverage-form-io.mjs");
  assert.match(io, /const unknownAxisUnits = /,
    "the unrecognised-unit report is gone — the stray-file case is silent again and dead-ends on a row "
    + "the seat cannot repair");
  assert.match(io, /REGISTER_AXES\.includes/,
    "the report no longer compares against the closed axis set — a second copy of the axis vocabulary is "
    + "how one of them ends up with three entries");
  const gw = src("gateway.mjs");
  assert.match(gw, /input\.unknownAxisUnits/, "nothing consumes the report, so it says nothing to anyone");
  assert.match(gw, /driver fault, not a seat one/,
    "the note no longer names the DRIVER as the faulty party — which is the ask verify.mjs recorded");
});

test("#1100 the axis set is NOT filtered — a form that quietly covers less is the worse artifact", () => {
  const io = src("coverage-form-io.mjs");
  assert.ok(!/activeAxes\s*=\s*[^;]*\.filter\([^;]*REGISTER_AXES/.test(io),
    "activeAxes is being filtered against the axis set. That silently shrinks the coverage form, which is "
    + "worse than the unrepairable row it avoids — report the case, do not delete the axis");
  assert.ok(REGISTER_AXES.length >= 4, "premise held: the closed axis set is non-trivial");
});
