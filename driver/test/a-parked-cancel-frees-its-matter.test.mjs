// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real ledger writers and the real dedup screen
//
//, criterion 2 — THE PARKED-VS-FAILED LEDGER SEMANTICS, MEASURED AND PINNED.
//
// The issue flagged this as unmeasured: whether a leg that hit a recovery park writes a ledger row the
// dedup skip recognises. It does not, and the trace is short — `failed` is set only by dropMatter, whose
// two callers are the run terminal (`if (!res.ok)`) and endClaimTerminal; `if (res.postponed)` returns
// before the terminal block and reaches neither.
//
// MOST OF THAT IS CORRECT. While a park is live, refusing a re-enqueue is right: it auto-resumes, so a
// second submission really is a duplicate. It is only wrong for a park that never resumes.
//
// THE UNCOVERED ROUTE WAS A CANCEL, AND IT WAS ASYMMETRIC:
//   cancelled while RUNNING → freed (the terminal block runs, res.ok is false, dropMatter fires)
//   cancelled while PARKED  → NOT freed (retireCancelledPark never touched the ledger)
// So stopping the same matter two seconds apart gave two different answers about whether it could be
// re-submitted — and the parked case is the likelier one, because a park is precisely the long wait
// during which somebody gives up.
//
// AND OUR OWN WORK RAISED THE STAKES. `clearotron cancel` made stopping one run a
// documented first-class operation, including a parked one. Before it this asymmetry was folklore; it
// is now a path operators walk, so the severity does not read correctly off the filing date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "prelim-2137-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const { matterLedgerPath, findDuplicateMatter, recordMatter, dropMatter, readMatterLedger, retireCancelledPark }
  = await import("../runner.mjs");

const qdir = () => {
  const d = join(mkdtempSync(join(tmpdir(), "q-2137-")), "queue");
  mkdirSync(d, { recursive: true });
  return d;
};
const SIG = "forwarder|MARKNAME|9,42|customer|ref";
const now = () => Date.now();
const enqueue = (q, msgId) => recordMatter(q, { sig: SIG, conversationId: "conv-1", msgId, id: "job-1", ts: now() });
const blocked = (q, msgId = "msg-2") =>
  Boolean(findDuplicateMatter(q, { sig: SIG, conversationId: "conv-1", msgId }, now()));

// ── the semantics, pinned in both directions ───────────────────────────────────────────────────────

test("2137 a LIVE row blocks a re-submission — that is the dedup doing its job", () => {
  const q = qdir();
  enqueue(q, "msg-1");
  assert.equal(blocked(q), true, "an un-failed row inside the window means the matter is still live");
});

test("2137 a FAILED row never blocks — the semantics the skip site now states", () => {
  const q = qdir();
  enqueue(q, "msg-1");
  dropMatter(q, "msg-1");
  assert.equal(readMatterLedger(q)[0].failed, true, "dropMatter MARKS rather than removes — spend still counts");
  assert.equal(blocked(q), false, "a stopped matter must be re-submittable");
});

// ── the asymmetry this closes ──────────────────────────────────────────────────────────────────────

test("2137 THE DEFECT: a cancel taken while PARKED frees the matter", () => {
  // retireCancelledPark was the one terminal writer that left the ledger alone. Everything else that
  // ends a run frees the matter, so an operator who stopped a parked run then found their re-submission
  // silently parked as a duplicate — with no run, and nothing anywhere saying why.
  const q = qdir();
  const runDir = mkdtempSync(join(tmpdir(), "run-2137-"));
  enqueue(q, "msg-1");
  assert.equal(blocked(q), true, "the control: it blocks before the cancel");

  const did = retireCancelledPark(q, "job-base", { msgId: "msg-1", codename: "some-codename", runDir });

  assert.equal(did.matterFreed, true, "the cancel must report freeing the matter, not do it silently");
  assert.equal(blocked(q), false, "a matter whose parked run was cancelled must be re-submittable");
  assert.equal(readMatterLedger(q)[0].failed, true, "and the row is MARKED, so the spend still counts");
});

test("2137 the terminals it already wrote are unchanged, and the matter is freed AFTER them", () => {
  // Ordering matters for the same reason the function's own note gives: the record a reader consults
  // must never be freed before the record that says why it was stopped.
  const q = qdir();
  const runDir = mkdtempSync(join(tmpdir(), "run-2137b-"));
  enqueue(q, "msg-1");
  const did = retireCancelledPark(q, "job-base", { msgId: "msg-1", codename: "some-codename", runDir });
  assert.equal(did.result, true, "the queue-side .cancelled.result still lands");
  assert.equal(did.sentinel, true, "the run-dir .cancelled sentinel still lands");
  assert.ok(existsSync(join(runDir, ".cancelled")), "and it is on disk, not merely reported");
  assert.equal(did.matterFreed, true);
});

test("2137 a park written before the msgId field simply does not free — no worse than before, never a throw", () => {
  // Same backward-compat story as `runDir` on that meta: an older park has no msgId, so its cancel
  // leaves the row exactly as it did before and the window closes it. What must NOT happen is a throw
  // in a terminal writer — that would trade a dedup nuisance for a run that cannot be ended.
  const q = qdir();
  const runDir = mkdtempSync(join(tmpdir(), "run-2137c-"));
  enqueue(q, "msg-1");
  let did;
  assert.doesNotThrow(() => { did = retireCancelledPark(q, "job-base", { codename: "some-codename", runDir }); });
  assert.equal(did.matterFreed, false, "it says it did not free, rather than claiming it did");
  assert.equal(blocked(q), true, "unchanged from the old behaviour — the 24h window still closes it");
  assert.doesNotThrow(() => retireCancelledPark(q, "job-base", { msgId: "msg-1" }),
    "a park with no run dir does the queue side only, and still must not throw");
});

// ── the wiring: the field has to be written, or every arm above is about a fixture ──────────────────

test("2137 the park meta CARRIES the msgId — an arm over a hand-built meta proves nothing otherwise", () => {
  // The arms above hand retireCancelledPark a meta. If the park writer never puts msgId in one, they
  // all pass while no real cancel frees anything. This is the half only the source can answer.
  const src = readFileSync(new URL("../runner.mjs", import.meta.url), "utf8");
  // Scoped to the park call's OWN object literal — from the call to the `});` that closes it — rather
  // than to a character count. The first cut used a fixed 3000-char window and missed it by 635
  // characters, which would have read as "the field is gone" on a file whose comments simply grew.
  const from = src.indexOf("parkPostponed(procPath, qdir, base, {");
  assert.ok(from > 0, "the park writer moved — re-check this arm rather than deleting it");
  const tail = src.slice(from);
  const park = tail.slice(0, tail.indexOf("\n    });"));
  assert.match(park, /msgId: job\?\.msgId \?\? null/,
    "the park meta stopped carrying the msgId — a parked cancel can no longer name the matter it frees");
});
