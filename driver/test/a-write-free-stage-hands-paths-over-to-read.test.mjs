// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the run-dir-grant disagreement note tells READS from WRITE ORDERS, and every
// seatWrites:false stage's REAL rendered dispatch is driven through it.
//
// The measured defect, both halves: the note used to fire on ANY run-dir path mention, and across the
// write-free stages that was SEVEN standing false alarms per healthy run (paths handed as data to
// read); and the one REAL disagreement drowned in them — synthesis's dispatch still carried the
// pre-conversion "save your findings as JSON to <path>" block (plus four "top-level field in <path>"
// clauses) beside the sentence "THE DISPATCH NAMES NO FILE FOR YOU TO WRITE". The declaration was the
// true side (record_synthesis carries the findings record; gather-config's own row history says so);
// the dispatch prose was the stale side, and it is rewritten to the call vocabulary.
//
// The all-stages drive below is the STANDING census: restore any stage's file-write order under a
// seatWrites:false declaration and its arm goes red by name — which is how the next conversion
// leftover is caught before a run ships with contradictory orders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, paths } from "../stages.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { SEAT_WRITE_FREE_STAGES } from "../engine/mcp/gather-config.mjs";
import { runDirGrant, dispatchOrdersRunDirWrite } from "../engine/anthropic-agent.mjs";

const RUN = "/tmp/rdg-census-run";
const P = paths(RUN);
const K = koPaths(RUN);
const mainCtx = () => ({ paths: P, axes: [], intakeAsks: [], openDoubts: [], openAsks: [], registerOnly: false, framework: null,
  job: { mark: "TESTMARK", classes: [25], territories: ["CH"], jurisdictions: ["CH"] }, profile: { key: "demo" },
  run: { runDir: RUN, slug: "t", codename: "t" }, flags: {} });
// The knockout stages take their own ctx shapes (read off their builders' destructuring).
const KO_CTX = {
  "knockout-frame": () => ({ K, job: { mark: "TESTMARK", marks: [{ mark: "TESTMARK" }], classes: [25], jurisdictions: ["CH"] }, profile: { key: "demo" } }),
  "knockout-assess": () => ({ K, chunkNo: 0, chunkMarks: [{ name: "TESTMARK" }], chunkTotal: 1,
    framework: { bands: [{ label: "HIGH" }, { label: "LOW" }] }, frameworkPath: `${RUN}/framework.md`, probeNote: "" }),
};

const render = (name) => {
  const def = STAGES[name] ?? KO_STAGES[name];
  assert.ok(def, `${name} is on SEAT_WRITE_FREE_STAGES and has no stage def in either table — the census lost a member`);
  const ctx = KO_CTX[name] ? KO_CTX[name]() : mainCtx();
  const msg = def.message(ctx);
  return Array.isArray(msg) ? msg.join("\n") : String(msg ?? "");
};

test("2084 EVERY write-free stage's rendered dispatch is silent — reads are not disagreements", () => {
  assert.ok(SEAT_WRITE_FREE_STAGES.length >= 10, "the write-free census shrank below plausibility — is the derivation broken?");
  for (const name of SEAT_WRITE_FREE_STAGES) {
    const text = render(name);
    const g = runDirGrant({ runDir: RUN, dispatch: text, seatWrites: false });
    assert.equal(g.note, null,
      `${name}: its dispatch ORDERS a write at a run-dir path while declaring seatWrites:false — a `
      + `conversion leftover ordering a hand-written file the transport replaced (the synthesis shape, `
      + `tracker 2084). One side is stale; resolve it, never silence this arm.\n${g.note}`);
  }
});

test("2084 the loud direction is REAL: a write order under seatWrites:false still fires", () => {
  const g = runDirGrant({ runDir: RUN, dispatch: `Save your findings as JSON to ${RUN}/findings.json when done.`, seatWrites: false });
  assert.ok(g.note, "the detector went silent on a literal write order — the census above now proves nothing");
  assert.match(g.note, /ORDERED to write/);
  assert.ok(g.grant, "the grant must survive the disagreement — dispatch wins, fail-safe");
});

test("2084 the detector's edges: read hand-over silent, negated order silent, verb-after-path loud", () => {
  assert.equal(dispatchOrdersRunDirWrite(`See ${RUN}/findings.json for context.`, RUN), false,
    "a path handed over to READ tripped the write detector — the seven-false-alarms shape is back");
  assert.equal(dispatchOrdersRunDirWrite(`Do NOT save ${RUN}/common-law-grid.json yourself — the tool writes it.`, RUN), false,
    "a NEGATED order tripped the detector — the driver claiming the write AGREES with seatWrites:false");
  assert.equal(dispatchOrdersRunDirWrite(`${RUN}/report-card-3.json is where you write your card.`, RUN), true,
    "an order with the verb after the path was missed — the detector is word-order-brittle");
  assert.equal(dispatchOrdersRunDirWrite("Write your notes somewhere.", RUN), false,
    "a write verb with NO run-dir path fired — the detector must key on both");
});

test("2084 synthesis speaks ONE transport: the typed order stands, the file order is gone", () => {
  const text = render("synthesis");
  assert.match(text, /record_synthesis/, "the typed order left the dispatch — that is a different regression");
  assert.match(text, /NAMES NO FILE FOR YOU TO WRITE/, "the no-file sentence is gone — the contract lost its statement");
  assert.doesNotMatch(text, /save your findings as JSON to/i,
    "the pre-conversion file order is back beside the typed transport — contradictory orders in one dispatch");
  assert.match(text, /findings record you send/, "the findings field rules lost their transport framing entirely");
});
