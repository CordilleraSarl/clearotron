// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repair-digest.test.mjs — the D2 ops-digest recurrence aggregator over fixture run dirs:
// packet-borne and recomputed signatures group together, a corrupt packet degrades (never throws),
// parks count from recoveryHistory even on a run that recovered, and an empty window renders as an
// explicit all-clear line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
import { aggregateFailureRecurrence, failureEventsForRun, renderFailureRecurrence } from "../repair-digest.mjs";
import { failureSignature } from "../repairs.mjs";

const NOW = "2026-07-11T06:00:00Z";
const IN_WINDOW = "2026-07-09T12:00:00Z";
const OUT_OF_WINDOW = "2026-06-20T12:00:00Z";

// The recurring defect: same stage + reason ⇒ same signature, however it was recorded.
const REASON_414 = "register-plan fan-in: http 414 uri too long for band 0042";
const SIG = failureSignature("register-plan(plan-join)", REASON_414);

// A fixture run dir whose _driver/failure.json holds `packet` (a string writes verbatim — the
// corrupt-packet case; anything else is JSON-serialized; null skips the packet entirely) and whose
// root optionally holds a `.failed` sentinel (same string/object/null convention).
function runDirWith({ packet = null, sentinel = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rdig-"));
  mkdirSync(driverDir(dir));
  const ser = (x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2) + "\n");
  if (packet !== null) writeFileSync(driverDir(dir, "failure.json"), ser(packet));
  if (sentinel !== null) writeFileSync(join(dir, ".failed"), ser(sentinel));
  return dir;
}
const runDirWithPacket = (packet) => runDirWith({ packet });

function fixtureRuns() {
  return [
    // A — terminal, packet-borne (decorated stage; packet fields win verbatim)
    {
      runId: "venzy-2026-07-09-ashen-conduit", state: "failed",
      runDir: runDirWithPacket({ failureSignature: SIG.sig, failedStage: "register-plan(plan-join)", failClass: "deterministic", terminalKind: "deterministic", reason: REASON_414 }),
      status: { state: "failed", updatedAt: IN_WINDOW },
    },
    // B — terminal, CORRUPT packet, no .failed sentinel: last-resort recompute from
    // status.failedStage+reason must land in the SAME group as A (bareStage strips the decoration;
    // this SHORT reason survives status.json's 200-char truncation — long reasons need the sentinel)
    {
      runId: "venzy-2026-07-10-copper-lattice", state: "failed",
      runDir: runDirWithPacket("{ this is not json"),
      status: { state: "failed", failedStage: "register-plan(plan-join)", reason: REASON_414, updatedAt: "2026-07-10T09:00:00Z" },
    },
    // C — a DIFFERENT terminal failure with NO packet. Reachable only on an ARCHIVED run from before
    //, when a successful send stage suppressed the packet write. The digest must still read it.
    {
      runId: "novapulse-2026-07-08-teal-keystone", state: "failed", runDir: null,
      status: { state: "failed", failedStage: "synthesis", reason: "unparseable_json from the CLI envelope", updatedAt: IN_WINDOW },
    },
    // D — DELIVERED, but it parked twice on the recurring signature inside the window (plus one
    // ancient park that must not count): recovery worked, the defect class still surfaces
    {
      runId: "frostplum-2026-07-07-satin-steel", state: "delivered", runDir: null,
      status: {
        state: "delivered", updatedAt: IN_WINDOW,
        recoveryHistory: [
          { sig: SIG.sig, stage: "register-plan(plan-join)", class: "unknown", attempt: 1, ts: "2026-07-07T08:00:00Z" },
          { sig: SIG.sig, stage: "register-plan(plan-join)", class: "unknown", attempt: 2, ts: "2026-07-07T09:00:00Z" },
          { sig: SIG.sig, stage: "register-plan(plan-join)", class: "unknown", attempt: 1, ts: OUT_OF_WINDOW },
        ],
      },
    },
    // E — retired e2e noise: hidden from every surface, this one included
    {
      runId: "old-test-2026-07-09-w", state: "failed", runDir: null,
      status: { state: "failed", failedStage: "fan-in", reason: "e2e noise", updatedAt: IN_WINDOW, retired: true },
    },
    // F — failed BEFORE the window: excluded
    {
      runId: "stale-2026-06-19-x", state: "failed", runDir: null,
      status: { state: "failed", failedStage: "gather", reason: "timeout", updatedAt: OUT_OF_WINDOW },
    },
  ];
}

test("recurrence: packet, corrupt-packet fallback and parks all group on one signature", () => {
  const agg = aggregateFailureRecurrence({ enumerate: fixtureRuns, now: NOW, days: 7 });
  assert.equal(agg.groups.length, 2, "the 414 class + the synthesis one-off; retired and stale excluded");

  const g = agg.groups[0]; // most-recurrent first
  assert.equal(g.sig, SIG.sig);
  assert.deepEqual(g.runIds, ["venzy-2026-07-09-ashen-conduit", "venzy-2026-07-10-copper-lattice", "frostplum-2026-07-07-satin-steel"]);
  assert.equal(g.terminalCount, 2, "A (packet) + B (recomputed from status past the corrupt packet)");
  assert.equal(g.parkCount, 2, "D's two in-window parks; the out-of-window row must not count");
  assert.deepEqual(g.terminalKinds, ["deterministic"], "packet terminalKind carried; recomputed events add none");
  assert.equal(g.failClass, "deterministic", "packet class wins the group label");
  assert.ok(g.sample.includes("uri too long"));

  const one = agg.groups[1];
  assert.deepEqual(one.runIds, ["novapulse-2026-07-08-teal-keystone"]);
  assert.equal(one.failClass, "transient", "unparseable_json classifies transient from the reason text");
});

test("recurrence: render names the recurring class, its runs and the all-clear", () => {
  const agg = aggregateFailureRecurrence({ enumerate: fixtureRuns, now: NOW, days: 7 });
  const text = renderFailureRecurrence(agg);
  assert.match(text, /RECURRING/);
  assert.match(text, /3 runs\s+register-plan\|/);
  assert.match(text, /reason: register-plan fan-in/);
  assert.match(text, /venzy-2026-07-09-ashen-conduit, venzy-2026-07-10-copper-lattice, frostplum-2026-07-07-satin-steel/);
  assert.match(text, /Single-run signatures:/);
  assert.match(text, /1 run\s+synthesis\|.*— novapulse-2026-07-08-teal-keystone/);

  const empty = renderFailureRecurrence(aggregateFailureRecurrence({ enumerate: () => [], now: NOW, days: 7 }));
  assert.match(empty, /No prelim failures or auto-recovery parks in the last 7 days\./);
});

test("recurrence: an all-quiet window over healthy runs is empty (delivered runs contribute nothing)", () => {
  const runs = [
    { runId: "ok-1", state: "delivered", runDir: null, status: { state: "delivered", updatedAt: IN_WINDOW } },
    { runId: "ok-2", state: "running", runDir: null, status: { state: "running", updatedAt: IN_WINDOW } },
  ];
  const agg = aggregateFailureRecurrence({ enumerate: () => runs, now: NOW, days: 7 });
  assert.equal(agg.groups.length, 0);
});

// The truncation-divergence class the sentinel fallback exists for: a non-StageFailure throw makes
// reason = String(e.stack) (always long, path-heavy). The recorded sig hashes the FULL reason;
// status.json stores a 200-RAW-char truncation, and normalizeReason (paths→basename, then a
// 160-char cap AFTER normalization) maps the two to different token skeletons. Recomputing from
// status therefore splits the SAME defect into separate groups — the .failed sentinel (sig
// verbatim + untruncated reason) must be consulted first.
const STACK_REASON = [
  "Error: ENOENT: no such file or directory, open '/srv/agentplatform/workspace-clawdi/prelim/tmp8729/2026-07-05-open-country/_driver/register-plan.json'",
  "    at Object.openSync (node:fs:596:3)",
  "    at readFileSync (node:fs:464:35)",
  "    at planRegisterSweeps (file://%h/trademark-clearance/driver/pipeline.mjs:2103:19)",
  "    at async pipelineInner (file://%h/trademark-clearance/driver/pipeline.mjs:1180:9)",
  "    at async pipeline (file://%h/trademark-clearance/driver/pipeline.mjs:990:12)",
].join("\n");
const STACK_SIG = failureSignature("register-plan", STACK_REASON);
// status.json's shortReason, exactly as pipeline.mjs writes it (collapse, trim, slice 200 RAW chars)
const STACK_STATUS_REASON = STACK_REASON.replace(/\s+/g, " ").trim().slice(0, 200);

test("recurrence: long-reason terminals group via the .failed sentinel, not the truncated status recompute", () => {
  // the guard that makes this test load-bearing: the naive status recompute really does diverge
  assert.notEqual(failureSignature("register-plan", STACK_STATUS_REASON).sig, STACK_SIG.sig,
    "premise: recomputing from the 200-char status reason yields a DIFFERENT signature");

  const statusOf = (updatedAt) => ({ state: "failed", failedStage: "register-plan", reason: STACK_STATUS_REASON, updatedAt });
  const runs = [
    // packet-borne (ping failed on this run, so the packet was written)
    {
      runId: "venzy-2026-07-08-a", state: "failed",
      runDir: runDirWith({ packet: { failureSignature: STACK_SIG.sig, failedStage: "register-plan", failClass: "unknown", terminalKind: "no-park", reason: STACK_STATUS_REASON } }),
      status: statusOf("2026-07-08T10:00:00Z"),
    },
    // NO packet (an ARCHIVED pre- run whose send stage succeeded and suppressed it) — the.failed
    // sentinel carries the sig verbatim plus the untruncated reason (pipeline terminal shape)
    {
      runId: "venzy-2026-07-09-b", state: "failed",
      runDir: runDirWith({ sentinel: { stage: "register-plan", reason: STACK_REASON, sig: STACK_SIG.sig, class: "unknown", terminalKind: "no-park" } }),
      status: statusOf("2026-07-09T10:00:00Z"),
    },
    // sig-LESS sentinel (the runner self-resume-cap shape) — the UNTRUNCATED sentinel reason still
    // recomputes the true signature
    {
      runId: "venzy-2026-07-10-c", state: "failed",
      runDir: runDirWith({ sentinel: { stage: "register-plan", reason: STACK_REASON, reparks: 3, ts: "2026-07-10T10:00:00Z" } }),
      status: statusOf("2026-07-10T10:00:00Z"),
    },
  ];
  const agg = aggregateFailureRecurrence({ enumerate: () => runs, now: NOW, days: 7 });
  assert.equal(agg.groups.length, 1, "one defect, one group — no truncation split");
  const g = agg.groups[0];
  assert.equal(g.sig, STACK_SIG.sig);
  assert.deepEqual(g.runIds, ["venzy-2026-07-08-a", "venzy-2026-07-09-b", "venzy-2026-07-10-c"]);
  assert.equal(g.terminalCount, 3);
  assert.equal(g.failClass, "unknown", "sentinel class carried when the packet is absent");
  assert.deepEqual(g.terminalKinds, ["no-park"], "sentinel terminalKind carried too");
  assert.ok(!g.sample.includes("\n"), "stack-trace sample is collapsed to one digest line");
  assert.match(renderFailureRecurrence(agg), /RECURRING/);
});

test("recurrence: a corrupt .failed sentinel degrades to the status recompute, never throws", () => {
  const run = {
    runId: "torn-2026-07-09", state: "failed",
    runDir: runDirWith({ sentinel: "{ not json" }),
    status: { state: "failed", failedStage: "gather", reason: "timeout", updatedAt: IN_WINDOW },
  };
  const events = failureEventsForRun(run, { sinceMs: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].sig, failureSignature("gather", "timeout").sig);
  assert.equal(events[0].failClass, "transient");
});

test("failureEventsForRun: malformed history rows and a missing run dir degrade, never throw", () => {
  const run = {
    runId: "r", state: "failed", runDir: join(tmpdir(), "rdig-definitely-absent"),
    status: {
      state: "failed", failedStage: "gather", reason: "timeout", updatedAt: IN_WINDOW,
      recoveryHistory: [null, { stage: "gather" }, { sig: "gather|abc", ts: "not-a-date" }, "junk"],
    },
  };
  const events = failureEventsForRun(run, { sinceMs: Date.parse("2026-07-04T00:00:00Z") });
  assert.equal(events.length, 1, "only the terminal; no history row has both a sig and an in-window ts");
  assert.equal(events[0].kind, "terminal");
  assert.equal(events[0].sig, failureSignature("gather", "timeout").sig);
});

// ---- — the classifier gap reaches the digest, and an unmeasured park says so ---------------------
//
// runLog writes _driver/run.jsonl and this module never opens it, so the pipeline's `classifier-gap`
// event alone would leave the finding unreportable. The carrier is the recoveryHistory park row, which
// this module already reads — hence `quantityToken` and `classSource` on it.

// The codename is SYNTHETIC and deliberately outside phase0.mjs's ADJ/NOUN lists — the run this issue
// was filed on has a real codename, and no-client-identifiers.test.mjs refuses any generator-shaped pair.
const gapRun = (rows) => ({
  runId: "venzy-2026-08-12-linen-spindle", state: "delivered", runDir: null,
  status: { state: "delivered", updatedAt: IN_WINDOW, recoveryHistory: rows },
});
const PARK = (extra) => ({ sig: "common-law-half:m|80aa500874e6", stage: "common-law-half:m",
  class: "unknown", lane: "defect", attempt: 1, quantity: 1, ts: IN_WINDOW, ...extra });

test("#849 a park the classifier could not name is COUNTED and NAMED in the digest", () => {
  const agg = aggregateFailureRecurrence({
    enumerate: () => [gapRun([PARK({ classSource: "reason-text", quantityToken: "connotation_quote_unbound" })])],
    now: NOW, days: 7,
  });
  assert.equal(agg.classifierGaps.count, 1);
  assert.equal(agg.classifierGaps.unmeasured, 0);
  assert.deepEqual(agg.classifierGaps.tokens, ["connotation_quote_unbound"],
    "the TOKEN, not just a count — 'the classifier could not name it' is not something an operator can act on");
  assert.deepEqual(agg.classifierGaps.stages, ["common-law-half:m"]);
  const text = renderFailureRecurrence(agg);
  assert.match(text, /1 classifier gap/);
  assert.match(text, /connotation_quote_unbound/);
  assert.match(text, /budget is unchanged/i, "the line must not imply the ladder behaves differently");
});

test("#849 a measured park with no gap, and a park predating the fields, are DIFFERENT answers", () => {
  // measured and clean: the throw site stamped the class, so the classifier never guessed
  const clean = aggregateFailureRecurrence({
    enumerate: () => [gapRun([PARK({ classSource: "throw-site", quantityToken: "connotation_quote_unbound" })])],
    now: NOW, days: 7,
  });
  assert.equal(clean.classifierGaps.count, 0);
  assert.equal(clean.classifierGaps.unmeasured, 0, "it WAS measured — it just had no gap");
  assert.doesNotMatch(renderFailureRecurrence(clean), /classifier gap|NOT measured/);
  // ABSENT IS NOT ZERO. A row written before these fields existed carries no verdict, and letting it
  // read as clean is the same mistake this module already refuses to make about designed refusals.
  const old = aggregateFailureRecurrence({ enumerate: () => [gapRun([PARK({})])], now: NOW, days: 7 });
  assert.equal(old.classifierGaps.count, 0);
  assert.equal(old.classifierGaps.unmeasured, 1);
  const ev = failureEventsForRun(gapRun([PARK({})]), { sinceMs: 0 })[0];
  assert.equal(ev.classifierGap, null, "null = not measured; false would claim a verdict nobody took");
  assert.match(renderFailureRecurrence(old), /Not measured: 1 park in this window/);
});

test("#849 WIRING (source) — the park row pipeline.mjs WRITES carries the keys this module READS", () => {
  // A SOURCE ASSERTION, named as one, and it exists because this link fails SILENTLY. The two ends of
  // the fix each have a behavioural test; the middle — pipeline.mjs actually putting these two fields on
  // the recoveryHistory row — has none, because the run-level catch only reaches this line on a real
  // park. Rename either key at the write site and every test above still passes while the digest reports
  // zero classifier gaps forever. That is the exact shape of defect is about.
  //
  // It does NOT prove the values are right at run time, and no offline test in this repo can.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  const at = src.indexOf("recoveryHistory: [...recoveryHistory,");
  assert.ok(at > 0, "the park write moved — this guard needs re-aiming, not deleting");
  const row = src.slice(at, src.indexOf("}]", at) + 2);
  // The key names, as the reader spells them one screen up: `row.quantityToken`, `"classSource" in row`.
  assert.match(row, /quantityToken:/, "the token the classifier could not name must reach the park row");
  assert.match(row, /\bclassSource\b/, "and the source that decides whether it was a GAP or a stamp");
  // Written unconditionally as value|null — an absent KEY is what marks a pre-fix row as unmeasured, so
  // a conditional spread here would make new rows indistinguishable from old ones.
  assert.doesNotMatch(row, /\.\.\.\(.*(quantityToken|classSource)/,
    "conditional-spread would erase the epoch these fields exist to make legible");
});
