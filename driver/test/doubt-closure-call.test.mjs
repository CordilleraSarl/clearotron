// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The typed closure transport's decision layer. PURE, so it tests offline.
//
// The properties under test are the three decisions, each driven against a PLANTED violation rather than
// asserted from the happy path — plus the one that matters most: that this layer and `applyClosure` agree
// BY CONSTRUCTION, not by coincidence. They share `squash`, imported one way, so a change to what counts
// as a verbatim match cannot move one without the other.
import { test } from "node:test";
import assert from "node:assert/strict";

import { acceptClosure, acceptClosureCall, toClosureLines, MAX_CLOSURES_PER_CALL, VERDICTS_BY_KIND } from "../doubt-closure-call.mjs";
import { applyClosure } from "../doubt-ledger.mjs";
import { applyAskClosure } from "../ask-ledger.mjs";

const FILES = ["findings.json", "audit.md"];
const TEXTS = {
  "findings.json": "The mark VENTURI is registered in CH for class 9.",
  "audit.md": "# Doubt Ledger\nnothing relevant here",
};
const CTX = { openIds: new Set(["d1", "d2", "d3"]), allowedFiles: FILES, fileTexts: TEXTS };
const settled = (over = {}) => ({ doubt_id: "d1", verdict: "settled", file_index: 0, quote: "VENTURI is registered in CH", reason: "register hit", ...over });

test("a well-formed settlement is accepted and resolves its file from the POSITION", () => {
  const r = acceptClosure(settled(), CTX);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.row.file, "findings.json", "the position resolved to the allowed file — the seat never named it");
  assert.equal(r.row.verdict, "settled");
});

test("DECISION 1 — a file cannot be NAMED, only positioned; an out-of-range position is refused", () => {
  // B's receipt_id ruling applied: a validator that rejects an unallowed citation has moved the defect,
  // a schema that cannot express one has removed it.
  assert.match(acceptClosure(settled({ file_index: 9 }), CTX).reason, /outside the 2 evidence file\(s\)/);
  assert.match(acceptClosure(settled({ file_index: -1 }), CTX).reason, /outside the 2 evidence file\(s\)/);
  assert.match(acceptClosure(settled({ file_index: "findings.json" }), CTX).reason, /must be an integer position/,
    "a filename in the position field is refused BY SHAPE — it is not a file name any more");
  assert.match(acceptClosure(settled({ file_index: 1.5 }), CTX).reason, /must be an integer position/);
  // And there is no `file` key to smuggle one through.
  const r = acceptClosure({ ...settled(), file: "/etc/passwd" }, CTX);
  assert.equal(r.ok, true, "an unknown key is inert");
  assert.equal(r.row.file, "findings.json", "…and cannot override the positional resolution");
});

test("DECISION 2 — the quote is verified against THAT file, at call time", () => {
  assert.match(acceptClosure(settled({ quote: "VENTURI is registered in FR" }), CTX).reason,
    /does not appear verbatim in findings\.json/);
  // Right text, wrong file: the position decides which haystack, so a real quote from the other file fails.
  assert.match(acceptClosure(settled({ file_index: 1 }), CTX).reason, /does not appear verbatim in audit\.md/);
  // Whitespace is normalised — the same latitude applyClosure gives, from the same predicate.
  assert.equal(acceptClosure(settled({ quote: "VENTURI   is\n registered in CH" }), CTX).ok, true);
  // A file with no readable text is a refusal that says so, not a silent non-match.
  assert.match(acceptClosure(settled(), { ...CTX, fileTexts: {} }).reason, /has no readable text in this run/);
});

test("DECISION 3 — partial accept: a refused row never voids its neighbours", () => {
  const { accepted, refused } = acceptClosureCall([
    settled(),
    settled({ doubt_id: "d2", quote: "not in any file" }),
    { doubt_id: "d3", verdict: "open", reason: "no on-disk evidence answers it" },
  ], CTX);
  assert.deepEqual(accepted.map((r) => r.doubt_id), ["d1", "d3"], "the good rows land");
  assert.deepEqual(refused.map((r) => r.doubt_id), ["d2"], "…and exactly the bad one is named");
});

test("a doubt the stage was not given cannot be spoken about", () => {
  assert.match(acceptClosure(settled({ doubt_id: "not-on-the-ledger" }), CTX).reason,
    /is not one of this stage's open doubts/);
});

test("an OPEN verdict carries no citation, and supplying one is REFUSED rather than ignored", () => {
  // Ignoring it would let a seat believe it had settled while the run recorded the opposite.
  assert.equal(acceptClosure({ doubt_id: "d2", verdict: "open", reason: "nothing answers it" }, CTX).ok, true);
  assert.match(acceptClosure({ doubt_id: "d2", verdict: "open", reason: "r", quote: "VENTURI is registered in CH" }, CTX).reason,
    /an open doubt carries no citation/);
  assert.match(acceptClosure({ doubt_id: "d2", verdict: "open", reason: "r", file_index: 0 }, CTX).reason,
    /an open doubt carries no citation/);
});

test("one verdict per doubt — a duplicate inside a call is refused, never last-wins", () => {
  const { accepted, refused } = acceptClosureCall([settled(), settled({ reason: "again" })], CTX);
  assert.equal(accepted.length, 1);
  assert.match(refused[0].reason, /appears twice in this call/);
});

test("the shape is closed: verdict, reason and a non-empty batch are all required", () => {
  assert.match(acceptClosure({ doubt_id: "d1", verdict: "maybe", reason: "r" }, CTX).reason, new RegExp(VERDICTS_BY_KIND.doubt.join(" / ")));
  assert.match(acceptClosure(settled({ reason: "" }), CTX).reason, /reason is required/);
  assert.match(acceptClosure({ verdict: "open", reason: "r" }, CTX).reason, /doubt_id is required/);
  assert.match(acceptClosureCall([], CTX).refused[0].reason, /at least one row/);
  const over = Array.from({ length: MAX_CLOSURES_PER_CALL + 1 }, () => settled());
  assert.match(acceptClosureCall(over, CTX).refused[0].reason, /exceeds 40 per call/);
  assert.deepEqual(acceptClosureCall(over, CTX).accepted, [], "an over-budget call accepts nothing — it is a shape error, not a partial");
});

test("⭐ THIS LAYER AND applyClosure AGREE BY CONSTRUCTION — the accepted row settles its doubt", () => {
  // The property that makes the transport safe to build before it is used. If the two verbatim checks
  // ever disagreed, a row accepted here would leave its doubt open downstream and land in `unverified` —
  // the seat told one thing and the ledger recording another, with no token for the disagreement.
  const { accepted } = acceptClosureCall([settled(), { doubt_id: "d3", verdict: "open", reason: "nothing" }], CTX);
  const out = applyClosure([{ id: "d1", status: "open" }, { id: "d3", status: "open" }], toClosureLines(accepted), TEXTS);

  assert.equal(out.settledByStage, 1, "the settlement this layer accepted is the settlement applyClosure makes");
  assert.equal(out.doubts[0].status, "checked-and-settled");
  assert.equal(out.doubts[0].ending.by, "doubt-closure-stage");
  assert.deepEqual(out.unverified, [], "nothing accepted here may fail verification there");
  assert.equal(out.doubts[1].status, "open", "an OPEN verdict changes nothing, exactly as the dictated form behaved");
});

test("…and the agreement is not luck: a quote this layer REFUSES would also fail downstream", () => {
  // The complement. Without it, the test above is satisfied by a layer that accepts everything and an
  // applyClosure that happens to agree on the one case tried.
  const bad = { verdict: "SETTLED", id: "d1", file: "findings.json", quote: "VENTURI is registered in FR", reason: "r" };
  assert.equal(acceptClosure(settled({ quote: "VENTURI is registered in FR" }), CTX).ok, false);
  const out = applyClosure([{ id: "d1", status: "open" }], [bad], TEXTS);
  assert.equal(out.settledByStage, 0);
  assert.equal(out.doubts[0].status, "open");
  assert.equal(out.unverified.length, 1, "downstream it lands in unverified — which is the outcome this layer prevents a turn earlier");
});

// ── THE ASK HALF: same file, second grammar, and it is NOT symmetric ─────────────────────────────────

test("KIND gates the verdict enum — an ask is IMMATERIAL, never settled", () => {
  // One enum across both kinds would accept `settled` on an ask and `immaterial` on a doubt. The same
  // doubt-closure.md is parsed by two parsers into two ledgers; the vocabularies are not interchangeable.
  assert.equal(acceptClosure({ kind: "ask", doubt_id: "d1", verdict: "immaterial", file_index: 0, quote: "VENTURI is registered in CH", reason: "answered on the record" }, CTX).ok, true);
  assert.match(acceptClosure({ kind: "ask", ...settled() }, CTX).reason, /immaterial \/ open for a ask/);
  assert.match(acceptClosure({ kind: "doubt", doubt_id: "d1", verdict: "immaterial", reason: "r" }, CTX).reason, /settled \/ open for a doubt/);
  assert.match(acceptClosure({ kind: "wish", doubt_id: "d1", verdict: "open", reason: "r" }, CTX).reason, /kind must be one of/);
});

test("⭐ AN OPEN ASK CARRIES `handoff`, NOT `reason` — the field name says what the text becomes", () => {
  // applyClosure's OPEN discards its reason. applyAskClosure's OPEN REWRITES the ask's handoff, so the
  // text is what the reviewing lawyer reads. Rather than validate that confusion, the grammar removes it.
  const ok = acceptClosure({ kind: "ask", doubt_id: "d2", verdict: "open", handoff: "ask the client which SKU ships first" }, CTX);
  assert.equal(ok.ok, true);
  assert.equal(ok.row.handoff, "ask the client which SKU ships first");
  assert.equal(ok.row.reason, undefined, "an open ask has no reason field at all");

  assert.match(acceptClosure({ kind: "ask", doubt_id: "d2", verdict: "open", reason: "looks fine" }, CTX).reason,
    /carries "handoff", not "reason"/, "the wrong field name is refused, not silently accepted as commentary");
  assert.match(acceptClosure({ kind: "doubt", doubt_id: "d2", verdict: "open", handoff: "x" }, CTX).reason,
    /carries "reason", not "handoff"/, "…and the mirror: a doubt does not take a handoff");
  assert.match(acceptClosure({ kind: "ask", doubt_id: "d2", verdict: "open" }, CTX).reason,
    /handoff is required — it REPLACES this ask's standing handoff/);
});

test("the ask rows round-trip into applyAskClosure, and the doubt rows do not follow them", () => {
  const { accepted } = acceptClosureCall([
    settled(),
    { kind: "ask", doubt_id: "d2", verdict: "immaterial", file_index: 0, quote: "VENTURI is registered in CH", reason: "on the record" },
    { kind: "ask", doubt_id: "d3", verdict: "open", handoff: "confirm the launch territory" },
  ], CTX);
  assert.equal(accepted.length, 3);

  // toClosureLines SPLITS by kind: each ledger sees only its own rows, which is what stops a doubt row
  // being handed to the ask parser and quietly doing nothing.
  assert.deepEqual(toClosureLines(accepted, "doubt").map((l) => l.verdict), ["SETTLED"]);
  assert.deepEqual(toClosureLines(accepted, "ask").map((l) => l.verdict), ["IMMATERIAL", "OPEN"]);

  const asks = [{ ask_id: "d2", ask: "is it on the register?", handoff: "OLD" }, { ask_id: "d3", ask: "which territory?", handoff: "OLD" }];
  const out = applyAskClosure(asks, toClosureLines(accepted, "ask"), TEXTS, { ts: "2026-08-16T00:00:00Z" });
  assert.ok(out.asks[0].ending, "the immaterial ask must actually END — this was a tautology in the first cut, comparing a value to itself");
  assert.equal(out.asks[0].ending.by, "doubt-closure-stage");
  assert.deepEqual(out.unverified, [], "and nothing this layer accepted may fail verification there");
  assert.equal(out.asks[1].handoff, "confirm the launch territory", "the open ask's handoff was REPLACED — the field name was telling the truth");
});
