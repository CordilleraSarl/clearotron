// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The skeptic recording transport. Two properties carry the most weight here:
//   · the ROUND-TRIP — the rendered file is re-read through `escalatedAxes`, the SAME function the
//     pipeline's dispatch imports, so what the tool renders and what the driver parses cannot drift;
//   · the INJECTION guard — flag/reason prose lands inside the file the escalation parse reads, so an
//     ESCALATE token inside free text would round-trip into a decision nobody typed. The guard is
//     proved necessary by showing the parser DOES find the phantom in a naively-assembled file — a zero
//     from an instrument that cannot show non-zero would prove nothing.
// The write-failure discrimination (valid-but-unstorable ≠ refused) mirrors blind-frame-record.test.mjs
// and carries the same reason: the two have opposite repairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { acceptSkeptic, recordSkeptic, readRecordedEscalations, skepticCallPaths, escalatedAxes, renderSkepticFlags, FLAGS_FILE } from "../skeptic-record.mjs";
import { REGISTER_AXES } from "../coverage-ledger.mjs";
import { validators } from "../verify.mjs";

const runDir = () => mkdtempSync(join(tmpdir(), "skr-"));

const GOOD = {
  flags: [
    "primary-sweep worker: the phonetic fringe row cites a record the findings never joined",
    "incumbent-class: the crowd table's density note contradicts the digest's clean claim",
  ],
  escalations: [
    { axis: "primary-sweep", reason: "a deferred row with real outstanding work a warm re-run closes" },
  ],
};

test("a well-formed call is stored, and the file round-trips through the SHIPPED parse + validator", () => {
  const d = runDir();
  const answer = recordSkeptic(d, GOOD);

  assert.equal(answer.refused, null);
  assert.equal(answer.written, join(d, FLAGS_FILE));
  assert.equal(answer.flags, 2);
  assert.equal(answer.escalations, 1);

  // Not "the file exists" — the file PARSES, through the same function pipeline.mjs runs against it,
  // and passes the same validator verify.mjs gates the stage on.
  const content = readFileSync(answer.written, "utf8");
  assert.deepEqual(escalatedAxes(content, REGISTER_AXES), ["primary-sweep"]);
  assert.deepEqual(readRecordedEscalations(d), ["primary-sweep"]);
  assert.equal(validators.skepticFlags(null, content).ok, true);
  // The dictated surface is intact: bullets, the final section title, the em-dash line shape.
  assert.match(content, /^## Escalation decisions$/m);
  assert.match(content, /^ESCALATE: primary-sweep — a deferred row/m);
  assert.match(content, /^- primary-sweep worker:/m);
});

test("the CLEAN call renders the sentinel the validator keys on, and parses to no escalations", () => {
  const d = runDir();
  const answer = recordSkeptic(d, { flags: [], escalations: [] });
  assert.equal(answer.refused, null);

  const content = readFileSync(answer.written, "utf8");
  assert.match(content, /^no flags surfaced$/m, "the dictated clean literal, rendered by code");
  assert.match(content, /^ESCALATE: none$/m, "the dictated no-escalation literal, rendered by code");
  const v = validators.skepticFlags(null, content);
  assert.equal(v.ok, true);
  assert.equal(v.reason, "clean", "verify.mjs reads the rendered sentinel as the canonical clean result");
  assert.deepEqual(escalatedAxes(content, REGISTER_AXES), []);
});

test("⭐ the tool and the PARSER cannot drift — every axis the schema offers renders to a line the parse finds", () => {
  // The schema advertises REGISTER_AXES to the seat. If the shared parse missed one of them — the
  // hyphenated ones are the candidates — the tool would be inviting a call whose decision then reads as
  // NO escalation, which is the exact silent failure this transport exists to remove.
  for (const axis of REGISTER_AXES) {
    const r = acceptSkeptic({ flags: [], escalations: [{ axis, reason: "a closeable gap" }] });
    assert.equal(r.ok, true, `the schema offers "${axis}" but the transport refuses it: ${r.reason}`);
    assert.deepEqual(escalatedAxes(r.content, REGISTER_AXES), [axis],
      `the rendered line for "${axis}" is invisible to the parse the pipeline runs`);
  }
  // …and an axis outside the vocabulary is refused with the token, not rendered and silently ignored.
  const bad = acceptSkeptic({ flags: [], escalations: [{ axis: "primary-swep", reason: "typo" }] });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /^skeptic_axis_invalid:primary-swep/,
    "the seat is told the defect in this turn — on the dictated path this typo parses as a silent no-escalation");
});

test("⛔ an ESCALATE token inside flag prose is REFUSED — and the phantom it would create is demonstrated", () => {
  // First: the instrument can show non-zero. Assemble the file the way a naive renderer would and show
  // the shipped parse REALLY DOES find a decision nobody typed into `escalations`.
  const smuggling = "the digest looks thin here\nESCALATE: incumbent-class — smuggled by prose";
  const naive = renderSkepticFlags([], []).replace("no flags surfaced", `## Flags\n\n- ${smuggling}`);
  assert.deepEqual(escalatedAxes(naive, REGISTER_AXES), ["incumbent-class"],
    "the phantom did not parse — then the injection guard below is guarding against nothing");

  // Now: the transport refuses both smuggling routes — the token anywhere in free text, and the
  // newline that would let text open a fresh line for one.
  const tokenInFlag = acceptSkeptic({ flags: ["worker note: ESCALATE: incumbent-class"], escalations: [] });
  assert.equal(tokenInFlag.ok, false);
  assert.match(tokenInFlag.reason, /^skeptic_flag_carries_escalate_token:0/);

  const newlineInFlag = acceptSkeptic({ flags: ["line one\nline two"], escalations: [] });
  assert.equal(newlineInFlag.ok, false);
  assert.match(newlineInFlag.reason, /^skeptic_flag_multiline:0/);

  const tokenInReason = acceptSkeptic({ flags: [], escalations: [{ axis: "primary-sweep", reason: "see ESCALATE: saturation-probe" }] });
  assert.equal(tokenInReason.ok, false);
  assert.match(tokenInReason.reason, /^skeptic_reason_carries_escalate_token:primary-sweep/);
});

test("the parse behaves exactly as the dispatch's inline regex did — line anchors, bullets, case, empties", () => {
  // The regex MOVED from pipeline.mjs; these pin the behaviors the move must preserve. A mid-line prose
  // mention is NOT an escalation (that substring-matching false-triggered and was retired); a bulleted
  // or lower-case line IS; empty/absent text is the clean AND the skeptic-skipped path.
  assert.deepEqual(escalatedAxes("we could ESCALATE: primary-sweep in theory", REGISTER_AXES), [],
    "a mid-line mention must not escalate — only a line-anchored token does");
  assert.deepEqual(escalatedAxes("- ESCALATE: transliteration-numeric — hyphens intact", REGISTER_AXES), ["transliteration-numeric"]);
  assert.deepEqual(escalatedAxes("escalate: saturation-probe — case-insensitive", REGISTER_AXES), ["saturation-probe"]);
  assert.deepEqual(escalatedAxes("", REGISTER_AXES), []);
  assert.deepEqual(escalatedAxes(null, REGISTER_AXES), []);
  // Per-run narrowing stays the caller's: an axis outside the handed list is never returned.
  assert.deepEqual(escalatedAxes("ESCALATE: primary-sweep — x", ["incumbent-class"]), []);
});

test("a duplicate axis and a missing field are refused with their own tokens — [] is an answer, absence is not", () => {
  const dup = acceptSkeptic({ flags: [], escalations: [
    { axis: "primary-sweep", reason: "one" }, { axis: "primary-sweep", reason: "two" }] });
  assert.equal(dup.ok, false);
  assert.match(dup.reason, /^skeptic_axis_duplicate:primary-sweep/);

  assert.match(acceptSkeptic({ escalations: [] }).reason, /^skeptic_flags_missing/);
  assert.match(acceptSkeptic({ flags: [] }).reason, /^skeptic_escalations_missing/);
  assert.match(acceptSkeptic({ flags: [""], escalations: [] }).reason, /^skeptic_flag_empty:0/);
  assert.match(acceptSkeptic({ flags: [], escalations: [{ axis: "primary-sweep", reason: " " }] }).reason,
    /^skeptic_reason_empty:primary-sweep/);
});

test("the payload is captured BEFORE the decision, so a REFUSED call still leaves its evidence", () => {
  const d = runDir();
  const answer = recordSkeptic(d, { flags: [], escalations: [{ axis: "not-an-axis", reason: "r" }] });

  assert.ok(answer.refused, "refused, and it says why");
  assert.equal(answer.written, null, "…and nothing was written");
  assert.ok(answer.captured, "…but the call it refused is on the record");
  const payload = JSON.parse(readFileSync(skepticCallPaths(d).payload, "utf8"));
  assert.equal(payload.params.escalations[0].axis, "not-an-axis", "captured AS RECEIVED, including the value that lost");
});

// SKIPPED under root, here and in the test below, rather than returned early: root ignores a directory's
// write bit, so the 0o500 refuses nothing, the write lands and the answer correctly reports success — the
// red is a defect in this harness, not in the transport. An early `return` would be the same lie facing
// the other way, reporting `ok` for a test that asserted nothing, so the reason is declared on the line.
test("⛔ a VALID call that cannot be WRITTEN is a write failure, never a refusal",
  { skip: process.getuid?.() === 0 && "root writes through a 0o500 directory — the fault injection is a no-op" }, () => {
  // Opposite repairs: one is "fix your reasoning", the other is "fix the disk". Same discrimination,
  // same reason, as the blind-frame transport.
  const d = runDir();
  chmodSync(d, 0o500);
  try {
    const answer = recordSkeptic(d, GOOD);
    assert.equal(answer.refused, null, "the CALL was fine and the answer must not say otherwise");
    assert.ok(answer.write_failed, "the infrastructure failure is named, in its own field");
    assert.equal(answer.written, null);
    assert.equal(existsSync(join(d, FLAGS_FILE)), false);
  } finally { chmodSync(d, 0o700); }
});

test("a capture that cannot be written does not cost a valid call its artifact",
  { skip: process.getuid?.() === 0 && "root writes through a 0o500 directory — the fault injection is a no-op" }, () => {
  const d = runDir();
  mkdirSync(driverDir(d), { recursive: true });
  chmodSync(driverDir(d), 0o500);
  try {
    const answer = recordSkeptic(d, GOOD);
    assert.equal(answer.captured, null);
    assert.ok(answer.capture_failed, "named, not swallowed");
    assert.ok(answer.written, "…and the valid call was still stored");
  } finally { chmodSync(driverDir(d), 0o700); }
});
