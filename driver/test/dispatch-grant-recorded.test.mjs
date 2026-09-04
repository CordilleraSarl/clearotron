// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A PRESERVED RUN CAN SAY WHAT EACH STAGE WAS ALLOWED TO CALL.
//
// The dispatch row recorded the envelope — file, sha, bytes, chars, kind, present — and nothing about
// the grant. So on an archived run, "offered the tool and declined it" and "never offered it" are the
// same bytes: no call directory, and no way to tell which silence it is. One is a judgment the seat
// made; the other is a decision the driver made and never wrote down.
//
// ── THE TRAP, WHICH IS THE MOST VALUABLE PART OF THE ISSUE ──────────────────────────────────────────
//
// `dispatch.txt` is the PROMPT. A tool grant rides in the spawn arguments, so grepping the dispatch
// bytes for `--allowedTools` returns nothing ON A RUN WHERE THE TOOL WAS GRANTED. An absence measured
// on a surface that cannot carry the signal reads exactly like an answer. That is why the grant is
// recorded in the same object as the sha rather than in a sibling file — the next auditor reads where
// the dispatch metadata is, and a grant filed elsewhere reads as "not recorded".
//
// ── AND WHY `[]` IS NOT THE SAME AS ABSENT ──────────────────────────────────────────────────────────
//
// A tool-free judgment stage was offered nothing DELIBERATELY, and omission cannot carry that. A row
// with no `grant` key at all predates this field; reporting it as "never offered" would manufacture a
// fact about a run nobody measured, which is this issue's own defect one level up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { recordDispatch, dispatchGrantState, dispatchFileName } from "../dispatch-record.mjs";

const run = () => mkdtempSync(join(tmpdir(), "grant-rec-"));
const TOOLS = "mcp__register__register_search mcp__register__register_fetch";

test("#1139 the grant is recorded beside the sha, in the same object", () => {
  const dir = run();
  try {
    const rec = recordDispatch(dir, "register-unit", { attempt: 1, message: "hello", grant: TOOLS });
    assert.equal(rec.present, true);
    assert.ok(rec.sha, "premise held: the row still carries what it always carried");
    assert.deepEqual(rec.grant, ["mcp__register__register_search", "mcp__register__register_fetch"],
      "the grant must ride in the dispatch object — a sibling file reads as 'not recorded' to the auditor "
      + "who looks where the dispatch metadata is");
    // And the message is still written verbatim: the record gained a field, it did not change job.
    assert.equal(readFileSync(driverDir(dir, dispatchFileName("register-unit", 1)), "utf8"), "hello");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1139 a tool-free stage records an explicit [] — omission cannot carry 'offered nothing'", () => {
  const dir = run();
  try {
    // `undefined` is what gateway.mjs passes for a judgment stage: `gatherAllowedTools` is never assigned.
    const rec = recordDispatch(dir, "synthesis", { attempt: 1, message: "x", grant: undefined });
    assert.deepEqual(rec.grant, [], "a tool-free stage must SAY it was offered nothing");
    assert.ok("grant" in rec, "the key is present — its absence means something else entirely");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1139 a failed write still records the grant — a disk fault is not 'offered nothing'", () => {
  // runDir points INSIDE A FILE, so `mkdir _driver` fails ENOTDIR immediately. The record's own contract
  // is that an absence is a record: `{present:false, error}`. The grant is a fact about the DISPATCH,
  // still true here, and dropping it would make a disk fault indistinguishable from a judgment stage.
  //
  // NOT a /proc path, which is the obvious way to write this and hangs: `mkdirSync(…, {recursive:true})`
  // under /proc/self stalls in a container rather than throwing, and a test that hangs the suite is
  // worse than one that fails — it takes the whole run with it and names nothing.
  const notADir = join(mkdtempSync(join(tmpdir(), "grant-file-")), "a-file");
  writeFileSync(notADir, "");
  const rec = recordDispatch(notADir, "register-unit", { attempt: 1, message: "x", grant: TOOLS });
  assert.equal(rec.present, false, "premise held: this path really does fail the write");
  assert.deepEqual(rec.grant, ["mcp__register__register_search", "mcp__register__register_fetch"]);
});

test("#1139 the grant list accepts the string the engine is actually handed", () => {
  const dir = run();
  try {
    // gateway.mjs joins with spaces and filters with split(" ") — the record takes that shape as-is
    // rather than asking the caller to reshape it, because a second representation is a second thing
    // that can disagree with what was granted.
    assert.deepEqual(recordDispatch(dir, "s", { attempt: 1, message: "x", grant: "  a   b  " }).grant, ["a", "b"]);
    assert.deepEqual(recordDispatch(dir, "s", { attempt: 2, message: "x", grant: "" }).grant, []);
    assert.deepEqual(recordDispatch(dir, "s", { attempt: 3, message: "x", grant: ["a", " b ", ""] }).grant, ["a", "b"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── THE THREE-STATE READ THE ISSUE ASKS FOR ─────────────────────────────────────────────────────────

test("#1139 declined and never-offered stop being the same silence", () => {
  assert.equal(dispatchGrantState({ grant: ["mcp__x__y"] }, false), "declined",
    "granted and called nothing — a judgment the SEAT made");
  assert.equal(dispatchGrantState({ grant: [] }, false), "never-offered",
    "granted nothing — a decision the DRIVER made, and the whole point of the field");
  assert.equal(dispatchGrantState({ grant: ["mcp__x__y"] }, true), "used",
    "positive evidence outranks the grant");
  assert.equal(dispatchGrantState({ grant: [] }, true), "used",
    "…and it outranks it even when the grant says nothing was offered — that combination is a driver "
    + "defect worth seeing, not something to resolve in favour of the record");
});

test("#1139 a row that predates the field reads as UNRECORDED, never as never-offered", () => {
  // Every archived run today. Reading them as "never offered" would answer a question nobody measured —
  // the exact failure this issue exists to end, arriving through the reader instead of the writer.
  assert.equal(dispatchGrantState({ file: "_driver/x.attempt1.dispatch.txt", sha: "abc" }, false), "unrecorded");
  assert.equal(dispatchGrantState(null, false), "unrecorded");
  assert.equal(dispatchGrantState({ grant: "mcp__x__y" }, false), "unrecorded",
    "a STRING is not the recorded shape — accepting it here would let a half-migrated row read as a full one");
});
