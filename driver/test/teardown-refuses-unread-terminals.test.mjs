// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A TEARDOWN THAT DESTROYS AN UNREAD TERMINAL DESTROYS IT FOREVER.
//
// 38 of 62 rounds reached a terminal nobody read. One reached terminal FAILED carrying a blocking
// verdict and sat unread for 34 hours, surfacing only because the next launch of the SAME scenario
// happened to trip a stale-terminal warning. That one was recoverable. Of another scenario's four unread
// rounds, three had already been purged by the time anyone counted — whether they reached terminal, and
// what they said, is now unknowable forever.
//
// The lister that names them shipped first. This is the other half: the purge path never asked. Teardown
// archives and purges run dirs, deletes queue markers and outbox packets, prunes ledger rows and stamps
// `clearedAt` over every round — and its ONLY receipt interaction was that closing stamp, which records
// the destruction and never questions it. So the gate goes in FRONT, and the only way past is a person
// typing `--waive-unread`.
//
// TWO DISCRIMINATORS ARE SETTLED IN THE ISSUE AND BOTH ARE PINNED BELOW, because getting either wrong
// leaves a gate that blocks nothing and reports green:
//
//   UNREAD is `reportedState !== "settled"`, not `reportedAt == null`. A round read back as `unknown`
//   carries a stamp and is exactly as unclosed as one nobody opened; on the live receipts the weaker key
//   hid 9 of 30.
//
//   WORK PRESENT is at least one seat jsonl row with `run.jsonl` EXCLUDED. A directory, a `status.json`
//   and even a count of jsonl files all read identically for a run that died at birth (measured: 2ms
//   lifetime, `run.jsonl` only) and one that started a second ago.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { unreadTerminalsInTeardown } from "../../scripts/e2e.mjs";
import { hasAttemptRows } from "../../scripts/e2e-unread-terminals.mjs";

const round = (over = {}) => ({ token: "aaaa1111", startedAt: "2026-08-11T00:00:00.000Z",
  reportedAt: null, reportedState: null, runs: [{ runDir: "/w/one" }], ...over });

// Every run dir has work unless this says otherwise — the injected probe keeps the unit pure, and the
// real filesystem rule is exercised separately below.
const workAt = (...dirs) => (d) => dirs.includes(d);
const allWork = () => true;
const noWork = () => false;

test("#922 an UNSETTLED round with work on disk blocks the teardown", () => {
  const g = unreadTerminalsInTeardown([round()], { searched: true, hasWork: allWork });
  assert.equal(g.blocked.length, 1, "this is the whole point: it can still be read, so it is not destroyed yet");
  assert.deepEqual(g.blocked[0], { token: "aaaa1111", runDir: "/w/one", startedAt: "2026-08-11T00:00:00.000Z" },
    "the row carries the token, the run dir and the start time — a refusal an operator cannot act on is a refusal that gets forced past");
});

test("#922 a SETTLED round is done and never blocks — teardown has to stay usable", () => {
  const g = unreadTerminalsInTeardown([round({ reportedState: "settled", reportedAt: "2026-08-12T00:00:00.000Z" })],
    { searched: true, hasWork: allWork });
  assert.deepEqual(g.blocked, [], "a settled round has been read; keeping it would make teardown impossible");
  assert.deepEqual(g.unrecoverable, [], "…and it is not a loss either — it is the success case");
});

test("#922 READ IS NOT SETTLED — a round stamped `reportedAt` that came back `unknown` still blocks", () => {
  // The correction, and the one that decides whether this gate sees 21 rounds or 30. `unknown` is
  // the honest outcome for a round with nothing in it, and it leaves the round exactly as unclosed as it
  // was — re-reading it can never change that, which is what the waive is for.
  const g = unreadTerminalsInTeardown(
    [round({ reportedAt: "2026-08-12T00:00:00.000Z", reportedState: "unknown" })],
    { searched: true, hasWork: allWork });
  assert.equal(g.blocked.length, 1,
    "keying on `reportedAt` would drop this round while it stays unclosed — that hid 9 of 30 on the live receipts");
});

test("#922 a round with NOTHING LEFT TO READ does not block, but is counted and named", () => {
  // A loss that already happened cannot be prevented here, and blocking on it would brick teardown of
  // an already-emptied scenario forever. Reported rather than dropped: an absence nobody writes down
  // reads as though it never occurred, which is how these went missing.
  const g = unreadTerminalsInTeardown([round()], { searched: true, hasWork: noWork });
  assert.deepEqual(g.blocked, [], "nothing here can be saved by refusing");
  assert.equal(g.unrecoverable.length, 1, "…and it is still named, not silently skipped");
  assert.equal(g.unrecoverable[0].runDir, "/w/one");
});

test("#922 an unsettled round with NO run dir at all is an already-permanent loss, named not dropped", () => {
  const g = unreadTerminalsInTeardown([round({ runs: [] })], { searched: true, hasWork: allWork });
  assert.deepEqual(g.blocked, [], "there is no evidence left for this teardown to destroy");
  assert.deepEqual(g.unrecoverable, [{ token: "aaaa1111", runDir: null, startedAt: "2026-08-11T00:00:00.000Z" }]);
});

test("#922 NOT SEARCHED IS NOT CLEAN — the fail-silent case gets its own answer", () => {
  // A workspace nobody walked yields no run dirs. Reading that as "nothing is unread" is the same shape
  // as the defect this whole check exists to close, so it can never be reported as an empty blocked set
  // and nothing else.
  const g = unreadTerminalsInTeardown([round()], { searched: false, hasWork: allWork });
  assert.equal(g.searched, false, "the caller must be able to tell 'I looked and found none' from 'I did not look'");
  assert.deepEqual(g.blocked, []);
  assert.deepEqual(g.unrecoverable, [], "and it makes no claim about losses either — it did not look");
});

test("#922 every run of a multi-run round is judged on its own", () => {
  const r = round({ runs: [{ runDir: "/w/a" }, { runDir: "/w/b" }] });
  const g = unreadTerminalsInTeardown([r], { searched: true, hasWork: workAt("/w/b") });
  assert.deepEqual(g.blocked.map((b) => b.runDir), ["/w/b"], "the readable one blocks");
  assert.deepEqual(g.unrecoverable.map((b) => b.runDir), ["/w/a"], "…and the emptied one is counted, not conflated");
});

// ── the REAL probe, on a real tree ────────────────────────────────────────────────────────────────────
//
// NOT OPTIONAL, and not covered by anything above. Every test so far injects `hasWork`, so a gate wired
// to a probe that answers `false` for every real run dir would pass all of them while blocking nothing —
// which is the failure this issue is about, wearing a green suite. The measured shape of the defect is
// exactly this: the run dir level is load-bearing, `hasAttemptRows` reads `<dir>/_driver` with NO
// fallback, and handing it the matter directory one level up finds no `_driver` at all.
test("#922 the DEFAULT probe is the seat-attempt rule, and it reads <runDir>/_driver", () => {
  const base = mkdtempSync(join(tmpdir(), "teardown-922-"));

  const live = join(base, "2026-08-11-invented-run");
  mkdirSync(driverDir(live), { recursive: true });
  writeFileSync(join(live, "status.json"), JSON.stringify({ runId: "r1", state: "failed" }));
  writeFileSync(driverDir(live, "run.jsonl"), `${JSON.stringify({ stage: "matter-frame", attempt: 1 })}\n`);
  writeFileSync(driverDir(live, "matter-frame.jsonl"), `${JSON.stringify({ attempt: 1, key: "x", status: "ok" })}\n`);

  const stillborn = join(base, "2026-08-11-invented-stillborn");
  mkdirSync(driverDir(stillborn), { recursive: true });
  writeFileSync(join(stillborn, "status.json"), JSON.stringify({ runId: "r2", state: "failed" }));
  writeFileSync(driverDir(stillborn, "run.jsonl"), `${JSON.stringify({ stage: "claim", attempt: 1 })}\n`);

  assert.equal(hasAttemptRows(live), true, "a seat file with an attempt row is work");
  assert.equal(hasAttemptRows(stillborn), false,
    "`run.jsonl` is EXCLUDED — it exists from the first moment, so counting it calls a run that never dispatched readable");
  assert.equal(hasAttemptRows(base), false,
    "and the MATTER directory one level up carries no `_driver` — feed the gate this level and it blocks nothing while looking green");

  // Now through the gate with no injection at all: this is the wiring an operator actually gets.
  const g = unreadTerminalsInTeardown(
    [round({ token: "bbbb2222", runs: [{ runDir: live }, { runDir: stillborn }] })], { searched: true });
  assert.deepEqual(g.blocked.map((b) => b.runDir), [live], "the run with work refuses the purge");
  assert.deepEqual(g.unrecoverable.map((b) => b.runDir), [stillborn], "the one that died at birth does not");
});

// ── the wiring, source-anchored ───────────────────────────────────────────────────────────────────────
//
// The acceptance criterion is "the purge path demonstrably runs the check FIRST". That is a claim about
// order in a command that walks a live pool, deletes directories and calls process.exit — so it is
// proved by reading the source, the same way the closing-line rule is, rather than by running a
// teardown against anything real.
const SRC = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
const TEARDOWN = SRC.indexOf("function cmdTeardown");
const at = (needle) => {
  const i = SRC.indexOf(needle, TEARDOWN);
  assert.notEqual(i, -1, `"${needle}" is no longer in the teardown command — re-anchor this test`);
  return i;
};

test("#922 the gate runs BEFORE anything is destroyed", () => {
  assert.notEqual(TEARDOWN, -1);
  const gate = at("unreadTerminalsInTeardown(");
  assert.ok(gate < at("const pres = preserveRunDir(runDir, id)"),
    "the check must precede the preserve/purge loop — after it, the evidence it protects is already gone");
  assert.ok(gate < at("for (const ref of refs) {"),
    "…and precede the loop entirely, which also deletes queue markers, outbox packets and ledger rows");
  assert.ok(gate < at("const cleared = new Date().toISOString();"),
    "…and precede the `clearedAt` stamp, which is what retires the unreported-terminal warning for good");
});

test("#922 the refusal is a NON-ZERO exit, distinct from a usage error", () => {
  const fn = SRC.slice(TEARDOWN, at("const cleared = new Date().toISOString();"));
  assert.match(fn, /const REFUSED = 3;/,
    "2 is die()'s usage default and 4 is run's stale refusal, so a script can tell this refusal apart without parsing prose");
  assert.equal((fn.match(/, REFUSED\);/g) ?? []).length, 3,
    "all three arms refuse the same way: unreadable receipt, unsearched workspace, and unread work on disk");
});

test("#922 the waive is EXPLICIT — never a default, never inferred", () => {
  const fn = SRC.slice(TEARDOWN, at("const cleared = new Date().toISOString();"));
  assert.match(fn, /const waived = process\.argv\.includes\("--waive-unread"\);/,
    "read straight off argv like --stale, so the arg parser needs no change and the flag cannot acquire a default");
  assert.match(fn, /if \(!waived && gate\.blocked\.length\)/, "and the block is conditional on it being absent");
});

test("#922 the refusal NAMES the rounds and the exact waive flag", () => {
  // An operator who is told only that something is wrong reaches for --force. The message has to carry
  // the round, where its evidence is, the command that reads it, and the flag that overrides — or this
  // gate teaches people to route around it.
  const fn = SRC.slice(TEARDOWN, at("const cleared = new Date().toISOString();"));
  assert.match(fn, /round \$\{b\.token \?\? "\(untokened\)"\}/, "each blocked round is named by token");
  assert.match(fn, /run dir:  \$\{b\.runDir\}/, "…with the run dir its evidence is in");
  assert.match(fn, /node scripts\/e2e\.mjs report \$\{id\} --round \$\{b\.token \?\? "<token>"\}/,
    "…and a copy-paste line that reads it");
  assert.match(fn, /node scripts\/e2e\.mjs teardown \$\{id\} --waive-unread/,
    "…and the exact waive command, so the override is the documented one rather than --force");
  assert.match(fn, /READING A ROUND DOES NOT NECESSARILY SETTLE IT/,
    "and it does not promise that reading closes the round — an in-flight or `unknown` round stays unsettled");
});

test("#922 a waived teardown NAMES what it is destroying", () => {
  const fn = SRC.slice(TEARDOWN, at("const cleared = new Date().toISOString();"));
  assert.match(fn, /WAIVED \(--waive-unread\)/, "the waive is on the transcript, not silent");
  assert.match(fn, /for \(const c of covered\) console\.log/, "…and lists every finding it covers");
  assert.match(fn, /the round receipt could not be read/, "including the two that are about not being able to look:");
  assert.match(fn, /the workspace was NOT searched/, "…so a waive past a blind teardown is visible too");
});

test("#922 losses that already happened are named even when nothing blocks", () => {
  // A teardown whose unsettled rounds are ALL unrecoverable is not refused — nothing here can bring them
  // back. If it also said nothing about them it would be the absence-nobody-writes-down shape the issue
  // is about, so the narration sits outside the refusal arm rather than inside its message.
  const fn = SRC.slice(TEARDOWN, at("const cleared = new Date().toISOString();"));
  const narration = fn.indexOf("UNSETTLED AND ALREADY BEYOND RECOVERY");
  assert.notEqual(narration, -1, "the unrecoverable set is reported, not merely counted");
  assert.ok(!/if \(!waived && gate\.unrecoverable\.length\)/.test(fn),
    "…and NOT gated on being refused, or the operator who is waved through never learns of the losses");
  assert.match(fn.slice(narration), /for \(const u of gate\.unrecoverable\)/, "each one is named");
  assert.match(fn.slice(narration), /no run dir at all/,
    "…and a round with no run dir is distinguished from one whose dir survived empty — different events");
});

test("#922 the unread test is IMPORTED, never restated", () => {
  assert.match(SRC, /import \{ hasAttemptRows \} from "\.\/e2e-unread-terminals\.mjs";/,
    "two definitions of 'there is something here to read' is how one tool licenses a purge the other would refuse");
  assert.ok(!/function hasAttemptRows/.test(SRC), "…so this file must not carry a second copy");
});

test("#922 the flag is in the usage the operator is shown", () => {
  // A refusal naming a flag that the usage line never mentions is a flag nobody finds before they need it.
  assert.match(SRC, /node scripts\/e2e\.mjs teardown <ID> \[--waive-unread\]/, "the header block");
  assert.equal((SRC.match(/teardown <ID> \[--waive-unread\]/g) ?? []).length, 4,
    "the header, the unexpected-argument usage, the missing-ID usage and the default-case usage all say it");
});
