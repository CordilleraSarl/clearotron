// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the dispatch record: what a stage was TOLD, kept beside what it sent back.
//
// The question this closes is "was the model given this?", and it is asked about things that ride the
// MESSAGE BODY rather than a file — the deferred-slice hint, the rulings tail, the owner-cross screen.
// `reads` cannot answer it (those are not files) and the input fingerprint cannot answer it (same
// reason), which is why could not be settled from its own run.
//
// Pure + offline: node builtins only, no engine, $0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { recordDispatch, dispatchFileName, DISPATCH_SUFFIX } from "../dispatch-record.mjs";

test("#380: the file name is the stage label, its attempt, and its repair ordinal — beside the stage's own jsonl", () => {
  assert.equal(dispatchFileName("register-digest", 1), `register-digest.attempt1.${DISPATCH_SUFFIX}`);
  assert.equal(dispatchFileName("register-digest", 2, 1), `register-digest.attempt2.repair1.${DISPATCH_SUFFIX}`);
  // axis labels carry a colon on real runs (register-unit:primary-sweep.jsonl exists), so the name does too
  assert.equal(dispatchFileName("register-unit:primary-sweep", 1), `register-unit:primary-sweep.attempt1.${DISPATCH_SUFFIX}`);
});

test("#380: the message is written BYTE-FOR-BYTE and is never truncated at any size", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-bytes-"));
  try {
    // the shapes that actually get dispatched: a fenced block (the rulings tail), newlines, non-ASCII
    // (the jx lane's real content), and a message far past any sane display bound.
    const msg = [
      "Read the ledger and dispose every recorded receipt.",
      "", "```markdown", "| query | result | ruling |", "| 色度 meaning | … | benign |", "```", "",
      `Q-SYNTH-1: provider cannot express`, "", "x".repeat(300_000),
    ].join("\n");
    const r = recordDispatch(dir, "register-digest", { attempt: 1, message: msg });
    assert.equal(r.present, true);
    const onDisk = readFileSync(join(dir, r.file.replace(/^_driver\//, "_driver/")), "utf8");
    assert.equal(onDisk, msg, "byte-for-byte — a sliced prompt answers the question wrongly, not partly");
    assert.ok(onDisk.length > 300_000, "nothing is truncated at size");
    // bytes and chars differ on non-ASCII, which is the entire reason both fields exist
    assert.equal(r.bytes, Buffer.byteLength(msg, "utf8"));
    assert.equal(r.chars, msg.length);
    assert.notEqual(r.bytes, r.chars, "the CJK content makes the two diverge — pin it");
    // and no temp file survives a successful write
    assert.deepEqual(readdirSync(driverDir(dir)).filter((f) => f.endsWith(".tmp")), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#380: THE ACCEPTANCE QUESTION — a hint that rides the message BODY is findable in the record", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-qid-"));
  try {
    // 's shape exactly: the deferred-slice reasons were on disk before the digest started, and
    // nothing recorded whether they reached the prompt. They are not a declared INPUT — they are
    // composed into the message — so an input fingerprint proves nothing about them.
    const msg = `Deferred slices requiring a row:\n- owner-cross Q-SYNTH-1 — provider cannot express\n`;
    const r = recordDispatch(dir, "register-digest", { attempt: 2, kind: "corrective", message: msg });
    const text = readFileSync(driverDir(dir, dispatchFileName("register-digest", 2)), "utf8");
    assert.match(text, /Q-SYNTH-1/, "the qid is in the record, so 'was the model given this?' has an answer");
    assert.equal(r.kind, "corrective", "and the row says WHICH kind of dispatch carried it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#380: three-valued — no runDir is null, a failed write is a RECORDED absence, and neither throws", () => {
  assert.equal(recordDispatch(null, "s", { attempt: 1, message: "x" }), null);
  assert.equal(recordDispatch("", "s", { attempt: 1, message: "x" }), null);
  const dir = mkdtempSync(join(tmpdir(), "dispatch-fail-"));
  try {
    // _driver is a FILE, so mkdir/write cannot succeed — the shape must be reported, not thrown
    writeFileSync(driverDir(dir), "not a directory");
    let r;
    assert.doesNotThrow(() => { r = recordDispatch(dir, "s", { attempt: 1, message: "x" }); });
    assert.equal(r.present, false, "an absence is a record, never a silence");
    assert.ok(r.error && r.error.length, "and it carries the reason");
    assert.equal(r.sha, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#380: a re-dispatch of the same attempt PRESERVES the superseded record — an earlier row's sha must not point at bytes that moved", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-collide-"));
  try {
    // A recovery park re-enters the stage and dispatches ITS attempt 1 again. Overwriting would leave
    // the first attempt row's `sha` naming a file whose contents no longer match it — a record that
    // lies, which is worse than one that is missing.
    const first = recordDispatch(dir, "common-law-half:b", { attempt: 1, message: "the cold commission" });
    const second = recordDispatch(dir, "common-law-half:b", { attempt: 1, message: "the carried draft correction" });
    assert.equal(second.superseded, first.sha, "the return names what it displaced");
    const files = readdirSync(driverDir(dir));
    assert.ok(files.includes(`common-law-half:b.attempt1.${DISPATCH_SUFFIX}`));
    assert.ok(files.some((f) => f.endsWith(`.prev-${first.sha}`)), "and the displaced text is still on disk");
    assert.equal(readFileSync(driverDir(dir, `common-law-half:b.attempt1.${DISPATCH_SUFFIX}.prev-${first.sha}`), "utf8"),
      "the cold commission");
    assert.equal(readFileSync(driverDir(dir, `common-law-half:b.attempt1.${DISPATCH_SUFFIX}`), "utf8"),
      "the carried draft correction");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#380: an IDENTICAL re-dispatch displaces nothing — a resume that replays the same prompt leaves one file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-same-"));
  try {
    const a = recordDispatch(dir, "s", { attempt: 1, message: "identical" });
    const b = recordDispatch(dir, "s", { attempt: 1, message: "identical" });
    assert.equal(a.sha, b.sha);
    assert.equal(b.superseded, undefined, "no churn when nothing changed");
    assert.deepEqual(readdirSync(driverDir(dir)).filter((f) => f.includes(".prev-")), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#380: an empty or absent message is recorded as the empty string, not skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-empty-"));
  try {
    const r = recordDispatch(dir, "s", { attempt: 1 });
    assert.equal(r.present, true);
    assert.equal(r.bytes, 0);
    assert.equal(r.chars, 0);
    // a stage dispatched with nothing is a finding; a MISSING record of it is indistinguishable from
    // the gate being off, and those must not look the same.
    assert.ok(existsSync(driverDir(dir, dispatchFileName("s", 1))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
