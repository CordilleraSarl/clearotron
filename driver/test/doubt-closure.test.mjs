// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// T2c — the doubt-closure stage contract: the settle-by-citation pass over stitch-open doubts.
// Everything here is offline/pure (STAGES declaration + message dictation + validator + the
// disabled/absent no-op guarantee); the verbatim-quote guard itself is tested in doubt-ledger.test.mjs
// (parseClosureLines / applyClosure). All marks invented — no client data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { STAGES, paths, stageInputs } from "../stages.mjs";
import { validators } from "../verify.mjs";
import { stitchDoubts, mintCrossCheckDoubts, applyClosure } from "../doubt-ledger.mjs";
import { buildAuditMd } from "../publish/audit-from-spine.mjs";

const P = paths("/run");
const OPEN_DOUBTS = [
  {
    id: "doubt:crosscheck:common-law-findings.md:1",
    birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "CROSS-CHECK REQUIRED: MARLOVIA QUENCHROOT EU designations — no EU register layer ran" },
    subject: { mark: "", owner: "", terms: ["MARLOVIA QUENCHROOT"], text: "MARLOVIA QUENCHROOT EU designations — no EU register layer ran" },
  },
  {
    id: "doubt:contradiction:voltmax-energycore:1",
    birth: { place: "audit-contradiction", artifact: "audit.md", quote: 'asserted: "A" / refuted: "B"' },
    subject: { mark: "VOLTMAX ENERGYCORE", owner: "NutriVolt Beverages, Inc.", terms: ["VOLTMAX ENERGYCORE"], text: "" },
  },
];

// THE OUTPUT PATH MOVED, AND THIS TEST WAS DEFENDING THE DEFECT.
// It asserted `_driver/doubt-closure.md` as the spec. later made `<runDir>/_driver/**` a tree a
// seat may NEVER write into (authority-trees.mjs, `live: true`) — and this is the one stage output a
// SEAT writes. The deny fired, the seat wrote the run root (the only place it could), the validator
// looked in `_driver/` and reported `missing_file`, and the escalation ladder burned out on an artifact
// that existed. Two consecutive rounds, three attempts each.
// Do not "restore" this path. The rule it now obeys is pinned by
// driver/test/seat-outputs-outside-driver-tree.test.mjs, which walks every stage output and asks the
// boundary itself rather than naming any one file.
test("the stage is declared exactly as specced: sonnet, LOW thinking, run-root output the seat may write, its own validator, three declared inputs", () => {
  const s = STAGES["doubt-closure"];
  assert.ok(s, "doubt-closure exists in STAGES");
  assert.equal(s.model, "sonnet", "the cheapest capable model — this pass only points at existing text");
  assert.equal(s.thinking, "low");
  // STILL DECLARED, and still at the run root — but the writer changed at conversion 6. The record tool
  // renders it now, so the path is the DRIVER's output rather than the seat's. `validators.doubtClosure`
  // reads it either way, which is exactly why the conversion renders it instead of dropping it: a
  // validator reading a file nobody writes, on a NON-FATAL stage, fails quietly.
  assert.equal(s.out(P), join("/run", "doubt-closure.md"),
    "the run root, NOT _driver/ — the write boundary denies that tree");
  assert.equal(s.validate, validators.doubtClosure);
  assert.deepEqual(stageInputs("doubt-closure", P), [P.findings, P.registerFindings, P.registerCoverageLedger],
    "the citable set is closed: exactly the three evidence surfaces");
});

test("the message states the contract: every open doubt (id + birth quote), the three evidence files BY POSITION, the verbatim demand — and NO line shape", () => {
  const msg = STAGES["doubt-closure"].message({ paths: P, openDoubts: OPEN_DOUBTS });
  for (const d of OPEN_DOUBTS) {
    assert.ok(msg.includes(d.id), `doubt id ${d.id} rides in the message`);
    assert.ok(msg.includes(d.birth.quote), "the birth quote rides verbatim");
  }
  assert.ok(msg.includes(P.findings) && msg.includes(P.registerFindings) && msg.includes(P.registerCoverageLedger),
    "all three evidence file paths are named");
  // CONVERSION 6: the two dictated line shapes are GONE from the message. The seat sends typed rows and
  // the driver renders the artifact, so a shape asserted here would be a shape nobody types. Asserted
  // NEGATIVELY as well as positively: a dictation that quietly grew a line shape back is the drift this
  // whole programme exists to stop, and only the negative arm can see it.
  assert.doesNotMatch(msg, /SETTLED <id>|OPEN <id>: <one-line|<verbatim quote ≤200 chars copied/,
    "no dictated line shape survives — the driver renders every line from typed rows");
  assert.match(msg, /record_doubt_closure/, "the seat is told how to hand the rows back");
  assert.match(msg, /verdict "settled"[\s\S]*verdict "open"/, "both doubt verdicts are named as VALUES, not as line shapes");
  // BY POSITION, and zero-based, because `file_index` is an index into this exact list. A dictation that
  // numbered from 1 would put every citation one file off, verifying against the wrong file's text.
  assert.match(msg, /0 = findings\.json/, "the citable files are numbered from 0, matching acceptClosure's bounds");
  assert.match(msg, /there is no field for a file name/i, "the seat is told a file it was not given cannot be named");
  assert.match(msg, /VERBATIM/, "the quote-must-be-verbatim demand is stated");
  assert.match(msg, /never write new analysis|never search/i, "the stage may only point, never produce");
  // presence-or-reason (2026-07-22): the ONE additive dictation line — a presence-reconciliation doubt
  // may be SETTLED by a delivered crowd/coverage disclosure that prices the row's family in (the
  // anti-flooding valve for crowd-corroboration rows); the verbatim-quote guard applies unchanged.
  assert.match(msg, /presence-reconciliation doubt[\s\S]*crowd\/coverage disclosure[\s\S]*prices that row's family in/,
    "the presence-reconciliation settle basis is dictated");
  // NO PATH IN THE DISPATCH — conversion 4's lesson, applied. The seat is handed no artifact path at all,
  // which is what stops it writing the file itself and what stops a MOCK_FAIL_STAGE-style knob keying on
  // a basename that the converted dispatch no longer contains.
  assert.ok(!msg.includes(P.doubtClosure), "the dispatch names no output path; the driver owns the artifact");
});

test("validator: dictated SETTLED/OPEN lines pass; wholly free prose fails (the only retry-worthy defect)", () => {
  const v = validators.doubtClosure;
  assert.equal(v(null, 'SETTLED doubt:x:1: findings.json: "finding #4: VOLTMAX" — recorded off-field').ok, true);
  assert.equal(v(null, "OPEN doubt:x:1: no on-disk evidence answers it").ok, true);
  assert.equal(v(null, "- OPEN doubt:x:1: bulleted lines are tolerated").ok, true);
  assert.equal(v(null, "I reviewed the doubts and believe they are all fine.").ok, false);
  // PR-6: an ask-only pass (no open doubts) emits only IMMATERIAL/OPEN ask lines — still valid
  assert.equal(v(null, 'IMMATERIAL ask:xcheck-overflow:1: register-findings.md: "the crowd is disclosed" — priced in').ok, true);
});

// PR-6 — the ASK extension: one stage, two dictated line-forms; asks can end IMMATERIAL (cited,
// code-verified) or stay OPEN with a recommendation — and the stage can NEVER claim executed.
test("the message states the ASK contract when open asks ride along — and omits it when none do", () => {
  const OPEN_ASKS = [
    { ask_id: "ask:xcheck-overflow:1", born: { place: "cross-check" }, ask: { text: "xcheck probe over the cap — never dispatched: Frost Hollow Trading" } },
    { ask_id: "ask:supplemental-rejected:primary-sweep:2", born: { place: "supplemental-proposal" }, ask: { text: "proposed register query rejected at the mint seam" } },
  ];
  const msg = STAGES["doubt-closure"].message({ paths: P, openDoubts: OPEN_DOUBTS, openAsks: OPEN_ASKS });
  for (const a of OPEN_ASKS) {
    assert.ok(msg.includes(a.ask_id), `ask id ${a.ask_id} rides in the message`);
    assert.ok(msg.includes(a.ask.text), "the ask text rides verbatim");
  }
  assert.doesNotMatch(msg, /IMMATERIAL <ask_id>|OPEN <ask_id>: <one-line/,
    "the ask line shapes are gone too — one conversion, both ledgers");
  assert.match(msg, /verdict "immaterial"[\s\S]*verdict "open"/, "both ask verdicts are named as VALUES");
  assert.match(msg, /handoff — what the reviewing lawyer should do with it/, "an open ask still carries its handoff, now as a field");
  assert.match(msg, /never mark an ask executed[\s\S]*computed by code/i, "executed is not the model's to assert");
  assert.match(msg, /IMMATERIAL is always available/, "the terminating move is always on the table");
  // doubts-only call (legacy shape): no ASK section at all
  const doubtsOnly = STAGES["doubt-closure"].message({ paths: P, openDoubts: OPEN_DOUBTS });
  assert.ok(!doubtsOnly.includes("THE OPEN ASKS"), "no asks ⇒ no ask dictation");
  // asks-only call: no doubt section, ask section present
  const asksOnly = STAGES["doubt-closure"].message({ paths: P, openDoubts: [], openAsks: OPEN_ASKS });
  assert.ok(!asksOnly.includes("THE OPEN DOUBTS"), "no doubts ⇒ no doubt dictation");
  assert.ok(asksOnly.includes("THE OPEN ASKS"));
});

// The no-op guarantee: when the stage never ran (failure/timeout — never a delivery gate), the shipped
// doubt records — and the audit built from them — are byte-identical to plain stitch output. This is
// the unit-level mirror of the pipeline guarantee that a dead closure stage changes nothing.
test("stage absent/disabled ⇒ byte-identical audit + doubt records to the stitch-only path", () => {
  const stitched = stitchDoubts(
    mintCrossCheckDoubts("CROSS-CHECK REQUIRED: MARLOVIA QUENCHROOT EU designations — no EU register layer ran", "common-law-findings.md"),
    {});   // nothing to join — stays open
  const REGISTER_MD = [
    "# Register findings — Mark: TESTMARK",
    "## Risk-relevant marks",
    "| Mark | Owner | Territory |",
    "|---|---|---|",
    "| QUELLSTAR | Quellstar AG | CH |",
  ].join("\n");
  const withoutStage = buildAuditMd(REGISTER_MD, "", { findings: null, doubts: stitched });
  const disabled = applyClosure(stitched, [], {});   // what the pipeline ships when the switch is off
  assert.deepEqual(disabled.doubts, stitched, "disabled ⇒ the records pass through untouched");
  const withDisabledStage = buildAuditMd(REGISTER_MD, "", { findings: null, doubts: disabled.doubts });
  assert.equal(withDisabledStage.md, withoutStage.md, "the audit is byte-identical");
  assert.deepEqual(withDisabledStage.counts, withoutStage.counts);
});
