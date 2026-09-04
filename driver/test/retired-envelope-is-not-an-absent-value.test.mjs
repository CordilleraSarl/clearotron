// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A USABLE VALUE IN A RETIRED ENVELOPE IS NOT AN ABSENT VALUE.
//
// Two halves of one defect, both established from the terminal production run of 2026-08-18:
//
//   THE SCHEMA. `anchor` was retired and split into `segment_index` + `fragment`, and the validator has
//   required both since  — but the SERVED tool schema still declared `anchor` as its only evidence
//   field, while its own description one line up already told the seat to send the other two. The schema
//   is the half a seat's tool-calling binds to, so it had to guess an undeclared field name to comply.
//
//   THE REFUSAL. The seat held the CORRECT answer at call 112 and sent it under `anchor`. The binder
//   reads no `anchor`, returned `fragment_missing`, and the refusal told it that it had copied NOTHING.
//   It had copied exactly the right thing into a field the driver no longer reads. It then generated new
//   content for 116 further calls and the run died owing that one row.
//
// "You copied nothing" and "you copied the right thing into the wrong field" need OPPOSITE responses:
// one says look again, the other says re-send what you already have. Reporting the second as the first is
// what sent a correct seat hunting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDispositionCall } from "../disposition-call.mjs";
import { obligationRows, connotationObligations, segmentBinding } from "../connotation-search.mjs";

const SNIPPET = "The 1871 Meridian race riot was a violent episode recorded in contemporary newspapers.";
const RECORDED = [
  { query: "a meaning query", results: [
    { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: SNIPPET },
    { id: "R-BBBB2222", title: "second", url: "https://e.test/2", snippet: "y".repeat(240) }] },
];
const rows = () => obligationRows(connotationObligations(RECORDED));
const FRAGMENT = "1871 Meridian";
const base = (over = {}) => ({ row_index: 1, ruling: "benign", note: "a dictionary entry, nothing charged",
  receipt_index: 1, segment_index: 1, ...over });
const refusalFor = (row) => (validateDispositionCall([row], RECORDED).refused ?? [])[0] ?? null;

test("#1234 THE FIXTURE IS HONEST: the value really does bind when sent as `fragment`", () => {
  // Everything below is worthless if this fragment would not have bound anyway.
  const cand = rows()[0].candidates[0];
  assert.equal(segmentBinding({ segment_index: 1, fragment: FRAGMENT }, cand).state, "bound");
  assert.equal((validateDispositionCall([base({ fragment: FRAGMENT })], RECORDED).refused ?? []).length, 0,
    "the correct shape is being refused — this test file is measuring the wrong thing");
});

test("#1234 DISSOLVED by #1172 — the seq-112 shape binds outright, so there is no refusal to word", () => {
  // 's cure was to word a refusal well: the seat had sent the right characters under the retired
  // name `anchor`, and the message told it it had copied nothing. removes the duty that produced
  // the refusal at all, which is the stronger fix — a row that names a live passage now BINDS whatever
  // envelope any fragment arrived in, or none.
  //
  // Kept, and renamed rather than deleted, because the production forensics this file records are the
  // reason the fragment duty was measured at all. The arm now pins the outcome those 116 calls should
  // have had.
  assert.equal(refusalFor(base({ anchor: FRAGMENT })), null,
    "the seq-112 shape was refused — the pointer must bind regardless of which envelope a fragment used");
});

test("#1172 a NON-BINDING fragment is recorded, never charged — the seat is not sent hunting", () => {
  // The dangerous inverse guarded: never tell a seat a wrong value is correct. Under the
  // question does not arise, because no verdict is issued on the fragment at all. What must not happen
  // is the old outcome — a refusal that costs a call for text the ruling never depended on.
  assert.equal(refusalFor(base({ anchor: "text that appears nowhere in that passage" })), null,
    "a non-binding fragment still cost the seat a call");
  const cand = rows()[0].candidates[0];
  // And the signal survives the duty: this is the transcription-quality counter the receipts histogram
  // folds, and it is how 85% of an archived ledger's refusals stay measurable after they stop happening.
  assert.equal(segmentBinding({ segment_index: 1, fragment: "appears nowhere" }, cand).fragmentState, "unbound");
  assert.equal(segmentBinding({ segment_index: 1, fragment: FRAGMENT }, cand).fragmentState, "bound");
  assert.equal(segmentBinding({ segment_index: 1 }, cand).fragmentState, "absent");
});

test("#1234 the four-way envelope matrix, replayed against the deployed binder", () => {
  // Recorded because this is what the production forensics turned on, and because `fragment_missing`
  // (binder) surfaces as `fragment_absent` (ledger) — two names for one state that cost real diagnosis.
  const cand = rows()[0].candidates[0];
  const st = (o) => segmentBinding(o, cand).state;
  assert.equal(st({ segment_index: 1, fragment: FRAGMENT }), "bound");
  // — WAS `fragment_missing`, the retired-envelope state that cost 116 calls. The pointer is the
  // obligation now, so naming a live passage binds and the envelope stops mattering.
  assert.equal(st({ segment_index: 1, anchor: FRAGMENT }), "bound", "the retired-envelope state, now bound");
  // Unchanged, and the reason this arm is still worth running: the POINTER is still required. A row that
  // names no passage is refused exactly as before — removed the transcription duty, not the duty.
  assert.equal(st({ anchor: FRAGMENT }), "segment_missing");
  assert.equal(st({ fragment: FRAGMENT }), "segment_missing");
});

test("#1234 THE SCHEMA declares what the validator requires, and no longer declares what it refuses", () => {
  // Source-level on purpose: importing the server module starts a server. The schema is the half the
  // seat's tool-calling binds to, so a description that says one thing while the schema declares another
  // is the defect — not a cosmetic mismatch.
  // — the declaration moved to `dispositions-server.mjs` with the tool. The next line is the
  // guard that this path is still right: a wrong file reads as "the tool was renamed" rather than
  // passing on an empty slice.
  const src = readFileSync(new URL("../engine/mcp/dispositions-server.mjs", import.meta.url), "utf8");
  const at = src.indexOf('name: "record_dispositions"');
  assert.ok(at > 0, "the tool was renamed — this assertion is measuring nothing");
  const block = src.slice(at, src.indexOf("handler: record_dispositions", at));
  assert.match(block, /segment_index: \{ type: "integer"/, "the schema does not declare `segment_index`");
  assert.match(block, /fragment: \{ type: "string"/, "the schema does not declare `fragment`");
  assert.doesNotMatch(block, /\banchor: \{/, "the schema still declares the retired `anchor` — a declared field the driver refuses is a trap");
});

test("#1234 AGREEMENT GUARD: the schema's evidence fields ARE the validator's, derived from both ends", () => {
  // Acceptance 2 — one contract, two ends. Hardcoding "segment_index and fragment" in this test would
  // drift the moment the validator requires a third field: the test would still pass while the served
  // schema stopped declaring what the seat must send, which is EXACTLY the defect being fixed, one level
  // up. So both sides are READ, not asserted from memory.
  //
  // The validator end is `segmentBinding`'s own destructured signature — the fields it actually reads.
  const searchSrc = readFileSync(new URL("../connotation-search.mjs", import.meta.url), "utf8");
  const sig = searchSrc.match(/export function segmentBinding\(\{([^}]*)\}/);
  assert.ok(sig, "segmentBinding's signature changed shape — this guard is measuring nothing");
  const required = sig[1].split(",").map((x) => x.trim().split(/[:=]/)[0].trim()).filter(Boolean).sort();
  assert.deepEqual(required, ["fragment", "segment_index"], "the validator's evidence fields moved — update the schema WITH them");

  // The served end.
  const serverSrc = readFileSync(new URL("../engine/mcp/dispositions-server.mjs", import.meta.url), "utf8");
  const at = serverSrc.indexOf('name: "record_dispositions"');
  const block = serverSrc.slice(at, serverSrc.indexOf("handler: record_dispositions", at));
  for (const f of required)
    assert.ok(new RegExp(`\\b${f}: \\{ type:`).test(block),
      `the validator requires \`${f}\` and the served schema does not declare it — the seat must guess an undeclared field name, which is this issue`);

  // And no retired token may be declared: a field the driver refuses is a trap, not a courtesy.
  const retiredFields = ["anchor"];
  for (const f of retiredFields)
    assert.ok(!new RegExp(`\\b${f}: \\{ type:`).test(block), `the schema still declares the retired \`${f}\``);
});

test("#1234 SHAPE FUZZ: the recognition never throws on a malformed retired value", () => {
  // This runs inside live validation. A throw here turns a refusable row into a dead call.
  for (const bad of [null, undefined, 0, "", "   ", {}, []])
    assert.doesNotThrow(() => refusalFor(base({ anchor: bad })), `threw on anchor=${JSON.stringify(bad)}`);
});

test("#1172 the accepted row CARRIES the fragment verdict, so the signal outlives the duty", () => {
  // The half that makes dropping the duty defensible. `fragmentState` is recorded on the accepted row
  // whatever it says, so "how often does a seat reproduce non-Latin characters correctly" stays a
  // measurable question. A change that removed the enforcement AND the observation would leave the next
  // reader unable to check whether it was safe.
  const ok = (r) => (validateDispositionCall([r], RECORDED).accepted ?? [])[0];
  assert.equal(ok(base({ fragment: FRAGMENT })).fragment_state, "bound");
  assert.equal(ok(base({ fragment: "appears nowhere at all" })).fragment_state, "unbound");
  assert.equal(ok(base({})).fragment_state, "absent",
    "a row that sent no fragment must record `absent` — distinguishable from a row never asked");
  // And every one of them was ACCEPTED, which is the change itself.
  for (const r of [base({ fragment: FRAGMENT }), base({ fragment: "nope" }), base({})])
    assert.equal((validateDispositionCall([r], RECORDED).refused ?? []).length, 0,
      "a fragment verdict must never cost the seat a call");
});
