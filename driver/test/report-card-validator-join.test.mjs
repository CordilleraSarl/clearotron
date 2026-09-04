// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE PROMPT AND THE REPARSER, ASSERTED AGAINST EACH OTHER IN ONE PLACE.
//
// moved the `## <owner> — <MARK>` head from the seat to card-frame.mjs and told the seat, in
// capitals, to write no head at all. `verify.mjs` still required one. **A seat that obeyed its
// instructions could not pass** — 30 of 30 cards on R5 round `892dd88e` failed both attempts with an
// identical token, all 30 were delivered anyway, and all 60 attempt records read `status: "ok"`.
//
// shipped a 201-line test for the new dictation. It imports STAGES and card-frame.mjs and never
// imports verify.mjs, so it pinned one end of a two-ended contract and was green. This file is the join:
// it imports BOTH and asserts they cannot contradict each other. The class is 's — two ends of a
// contract measuring different things with no agreement guard.
//
// The warning was already in verify.mjs, written for and sitting two lines above the line that
// broke: "this gate had to move in the SAME commit as the prompt: a validator demanding a section the
// prompt no longer asks for fails every card on the next run and burns the corrective ladder on a
// contract nobody holds." A comment cannot fail a build. This can.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import { validators } from "../verify.mjs";
import { correctionHint } from "../gateway.mjs";

/** report-card's message as the seat receives it — composed, never read as source. */
function reportCardText() {
  const def = STAGES["report-card"];
  assert.ok(typeof def?.message === "function", "report-card has no composed message — this guard is reading nothing");
  return String(def.message({
    paths: { reportCard: (a) => `/run/card-${a}.md`, findings: "/run/findings.json", runDir: "/run" },
    finding: { ordinal: 1, mark: "QORI", owner: "Qori Holdings", disposition: "rated", net: "a net" },
    axis: "1", profile: {}, caseLawProfile: null,
  }) ?? "");
}

// A card written EXACTLY as the current prompt orders: starts at `### Full detail`, no head, no meta.
const OBEDIENT_CARD = `### Full detail

The mark is registered in class 9 by an unrelated proprietor, and the register entry is live. The owner
has used it continuously since 2014 on overlapping goods, which is what makes this a rated conflict
rather than a housekeeping note for the client to consider at leisure.
`;

// The pre- shape, and the one every replayed or archived card still has.
const FRAMED_CARD = `## Qori Holdings — QORI

- ord: 1

### Full detail

${OBEDIENT_CARD.split("\n").slice(2).join("\n")}`;

test("THE DEFECT: a card written exactly as the prompt orders now PASSES", () => {
  // This is the regression. On the tree before this change it fails, because the validator required the
  // one thing the prompt forbids.
  const r = validators.reportCard("/run/card-1.md", OBEDIENT_CARD);
  assert.equal(r.ok, true,
    `a card obeying its own dispatch was rejected (${r.reason}) — this is the 30-of-30 failure, and no seat can escape it`);
});

test("THE JOIN: the prompt forbids the head AND the validator does not require one", () => {
  // Both halves in one assertion, deliberately. Either alone is satisfiable by a broken pair: a prompt
  // that stopped forbidding the head would make the validator's requirement fine again, and a validator
  // that stopped requiring it would make a dictating prompt fine again. It is the CONTRADICTION that
  // costs a run, so the contradiction is what is asserted.
  const text = reportCardText();
  assert.match(text, /NO HEAD|no `?##/i,
    "the dispatch no longer forbids the head — if the seat is now told to write one, this validator must require it again and this test must be rewritten deliberately");

  assert.equal(validators.reportCard("/run/card-1.md", OBEDIENT_CARD).ok, true,
    "the prompt forbids the head and the validator demands it — a seat that obeys cannot pass, which is exactly #1110");
});

test("A FRAMED CARD STILL PASSES — carriesOwnFrame is a live branch, not a legacy comment", () => {
  // The tempting symmetric fix was to REFUSE `##` now that the driver writes it. That would fail every
  // replayed and archived card: pipeline.mjs takes the legacy path whenever carriesOwnFrame(body), and
  // that path is the fail-safe direction for a drifted seat too.
  assert.equal(validators.reportCard("/run/card-1.md", FRAMED_CARD).ok, true,
    "a card carrying its own head was rejected — replays and archived cards render through exactly this shape");
});

test("the validator still HAS teeth: the detail section is required and named when absent", () => {
  // Deleting a requirement is only safe if what remains can still fail. Without this the change above is
  // indistinguishable from deleting the validator.
  const r = validators.reportCard("/run/card-1.md",
    "Some prose about the finding with no section heading at all, long enough to clear the length floor easily.");
  assert.equal(r.ok, false, "a card with no `### Full detail` passed — the validator has stopped checking anything");
  assert.match(r.reason, /missing:detail\(full-detail-section\)/,
    "the token must NAME the member that failed; `missing:card+detail` over a card that HAS its detail is the defect");
});

test("THE TOKEN NAMES THE MEMBER, on every multi-marker validator — not just the card", () => {
  // The defect shape is a population: the group label misnames whichever member failed, at every
  // multi-marker call site. Fixed at all six rather than at the one that was caught.
  const long = (s) => s + "\n" + "filler prose to clear the length floor. ".repeat(20);

  // report-overview: front-matter missing, shell present.
  let r = validators.reportOverview("/run/report-overview.md", long("# Actions\n\nsomething"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing:front-matter\+shell\(front-matter\)/,
    "the missing half is the front-matter and the token must say so");

  // report-overview: front-matter present, shell missing.
  r = validators.reportOverview("/run/report-overview.md", long("---\ntitle: x\n---\n\nsome prose"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing:front-matter\+shell\(shell-section\)/,
    "the SAME group label with a different member — the two states were indistinguishable before");

  // client-summary: exec summary present, marks missing.
  r = validators.clientSummary("/run/client-summary.md", long("# Executive Summary\n\nprose"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing:exec-summary\+marks\(marks-section\)/);
});

test("THE BLAST RADIUS: the group label is PRESERVED, so correctionHint still finds its arm", () => {
  // The obvious fix — emit the failing marker INSTEAD of the label — silently degrades every corrective
  // hint that branches on the label. gateway.mjs:2181 keys on `findings+ledger` and :2188 on
  // `negative-results|coverage-ledger|audit-trail|findings-heading`, and #476 records that first arm
  // being removed once on a reading true for only one lane, then put back. Appending keeps them matching.
  const specific = correctionHint("invalid_file:/run/register-findings.md:missing:findings+ledger(coverage-ledger)");
  assert.match(specific, /findings heading plus a Coverage ledger/,
    "the token gained a member name and correctionHint fell through to a generic hint — the seat lost its specific repair");

  const sections = correctionHint("invalid_file:/run/register-findings.md:missing:findings-heading");
  assert.match(sections, /ALL required sections/, "the single-marker token must behave exactly as before");
});

test("NEGATIVE CONTROL: a call site with no names emits the token it always emitted", () => {
  // `names` is optional and positional. If omitting it changed the token, this change would be a silent
  // rename of every failure token in the file.
  const r = validators.audit("/run/audit.md", "prose with no findings section. " + "filler ".repeat(60));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing:findings-section",
    "an unnamed call site must emit the bare label — anything else is a token rename nobody asked for");
});

test("VOID CONTROL: the composed dispatch is non-empty and still asks for the judgment half", () => {
  // Every "the forbidden shape is absent" assertion passes loudest on an empty string. #1008's own test
  // states this rule; it applies to the prompt half of the join above.
  const text = reportCardText();
  assert.ok(text.length > 400, `report-card's message composed to ${text.length} chars — too short to be the real dispatch`);
  assert.match(text, /### Full detail/, "the dispatch no longer names the one section the validator requires");
});
