// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-state-not-shape.test.mjs —. Every check in the harness reads the state the run RECORDED.
// None of them infers it from the shape of a filename.
//
// WHY A SEPARATE FILE. This suite's history is nine harness defects against zero new engine defects, and
// every one had the same root: a check written from a mental model of the artifacts rather than from the
// artifacts. Until they all read an absence as SUCCESS. is the mirror image — an absence read
// as FAILURE, naming an engine defect that does not exist — and that direction is the more expensive one,
// because a false alarm on "the requester was never told" points an investigation at delivery when
// delivery is fine. The rule is one rule, so it gets one file.
//
// EVERY FIX HERE IS PAIRED WITH ITS TEETH. For each check that stopped failing wrongly there is a test
// that it still FAILS when it genuinely should, because a fix to this class is one careless line away
// from being a general loosening — and a loosened check in a harness is worse than no check, since it
// prints a word like `ok` next to a question it never asked.
//
// FIXTURE NAMES are the suite's neutral ones (`fixture-one`, `fixture-two`), disjoint from phase0.mjs's
// codename vocabulary, per no-client-identifiers.test.mjs. The SHAPES are real: the packet names, the
// marker suffixes and the sidecar names below were read off runner.mjs, pipeline.mjs and
// pipeline-knockout.mjs, which are the code that writes them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";

import {
  outboxPackets, runIdForms, readMarkerTerminal, queueOutcomes, dedupeAcrossDoors, evalAssertion,
  undrainableJob, TERMINAL_BY_SUFFIX, TERMINAL_BY_SUFFIX_RAN,
} from "../../scripts/e2e.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — the pin follows the emitter
// The queue's filename vocabulary, from the module that owns it — the same import the harness makes, so a
// test here cannot pass against a private copy.
import { PROSE_PARTS, CLAIM_SIDECAR_SUFFIXES, TERMINAL_QUEUE_SUFFIXES, isQueueSidecar, liveQueueState }
  from "../queue-markers.mjs";

const E2E_SRC = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");

// The R2 shape, 2026-08-05: a run that was admitted, started, ran nine attempts and went terminal. Its
// packet is named by the RUN, and carries no queue id anywhere.
const RUN_ID = "tmpe2er2-fixture-mark-2026-08-05-fixture-two";
const QUEUE_BASE = "mcp-fixture-a1b2c3";

/** A run's status.json, read the way findRunsByRef reads it — the shape cmdReport passes on. */
function readStatus(p) { return JSON.parse(readFileSync(p, "utf8")); }

function scratch(fn) {
  const root = mkdtempSync(join(tmpdir(), "e2e-428-"));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function withEnv(vars, fn) {
  // — EVERY spelling, saved and set. A fixture pinned under ONE spelling is displaced by any pin
  // of the other one upstream, and the arm then runs against a value this file never chose. `pinEnv`
  // writes every spelling for a value and deletes every spelling for `undefined`, which is what the
  // `null` case here means.
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    for (const spelling of [k]) saved[spelling] = process.env[spelling];
    pinEnv(process.env, k, v === null ? undefined : v);
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/** A queue dir + outbox + run dir laid out exactly as the runner leaves them. */
function deployment(root, { queue = {}, outbox = [], run = null } = {}) {
  const q = join(root, "queue"), ob = join(root, "outbox");
  mkdirSync(q, { recursive: true }); mkdirSync(ob, { recursive: true });
  for (const [name, body] of Object.entries(queue)) {
    writeFileSync(join(q, name), typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  for (const name of outbox) writeFileSync(join(ob, name), JSON.stringify({ kind: "fixture" }));
  let runDir = null;
  if (run) {
    runDir = join(root, "workspace", "prelim-search", "fixture-mark", "2026-08-05-fixture-two");
    mkdirSync(driverDir(runDir), { recursive: true });
    writeFileSync(join(runDir, "status.json"), JSON.stringify(run, null, 2));
  }
  return { q, ob, runDir };
}

// ── the matcher: two packet schemes, one function ─────────────────────────────────────────────────────

test("#428: the runId lane finds `<runId>.failed.pending` — the packet the queue-side matcher could never see", () => {
  scratch((root) => {
    const { ob } = deployment(root, { outbox: [`${RUN_ID}.failed.pending`] });
    const r = outboxPackets({ runId: RUN_ID, queueBase: QUEUE_BASE }, ob);
    assert.deepEqual(r.packets, [`${RUN_ID}.failed.pending`]);
    assert.equal(r.unreadable, null);
    // The defect verbatim: the shipped filter was `x.includes(base)` on the QUEUE id, and this packet
    // carries no queue id at all. 2112 bytes on disk, reported as "the requester was never told".
    assert.ok(!`${RUN_ID}.failed.pending`.includes(QUEUE_BASE),
      "the run-side packet contains no queue id — which is the whole reason the old matcher missed it");
  });
});

test("#428: the intake lane still finds both intake shapes — the R0 case must not regress", () => {
  scratch((root) => {
    const { ob } = deployment(root, {
      outbox: [`intake-${QUEUE_BASE}.failed.pending`, `intake-${QUEUE_BASE}.duplicate.pending`],
    });
    assert.deepEqual(outboxPackets({ queueBase: QUEUE_BASE }, ob).packets,
      [`intake-${QUEUE_BASE}.duplicate.pending`, `intake-${QUEUE_BASE}.failed.pending`]);
  });
});

test("#428: a DIFFERENT run's packet is not claimed — the trailing dot is what stops one runId prefixing another", () => {
  scratch((root) => {
    const { ob } = deployment(root, { outbox: [`${RUN_ID}-2.failed.pending`, "intake-other-queue-id.failed.pending"] });
    const r = outboxPackets({ runId: RUN_ID, queueBase: QUEUE_BASE }, ob);
    assert.deepEqual(r.packets, [], "a wider match would report someone else's notification as this run's");
    assert.equal(r.unreadable, null, "the outbox WAS readable — this is a real 'none written', not a blindness");
  });
});

test("#428: 'could not look' is not 'found none' — three absences, each naming itself", () => {
  scratch((root) => {
    const { ob } = deployment(root, {});
    // 1. the outbox was never configured
    assert.match(outboxPackets({ runId: RUN_ID }, "").unreadable,
      new RegExp(`CLEAROTRON_OUTBOX_DIR is unset`));   // — the pin follows the emitter
    // 2. it is configured and not there
    assert.match(outboxPackets({ runId: RUN_ID }, join(root, "nope")).unreadable, /does not exist or cannot be read/);
    // 3. nothing is known to search FOR
    assert.match(outboxPackets({}, ob).unreadable, /neither a runId nor a queue id/);
    for (const r of [outboxPackets({ runId: RUN_ID }, ""), outboxPackets({ runId: RUN_ID }, join(root, "nope")), outboxPackets({}, ob)]) {
      assert.deepEqual(r.packets, [], "and none of them invents a packet either");
    }
  });
});

test("#428: a readable, empty outbox reports NONE — the fix must not make 'never told' unreachable", () => {
  scratch((root) => {
    const { ob } = deployment(root, {});
    const r = outboxPackets({ runId: RUN_ID, queueBase: QUEUE_BASE }, ob);
    assert.deepEqual(r.packets, []);
    assert.equal(r.unreadable, null, "readable and empty is the state that MUST still read as a defect");
  });
});

// ── the marker suffix: one shape, two meanings, and the runner records which ───────────────────────────

test("#428: `.failed` beside a RUN TERMINAL record reads as a failed run, not as a clarification", () => {
  scratch((root) => {
    const { q, runDir } = deployment(root, {
      queue: {
        [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
        [`${QUEUE_BASE}.failed.result`]: { ok: false, failedStage: "common-law-half:b", reason: "invalid artifact after 9 attempts", runDir: null },
      },
      run: { state: "failed", runId: RUN_ID, failedStage: "common-law-half:b", terminalKind: "invalid-artifact-loop" },
    });
    // the .result carries the run dir, which is how the runId — and the terminalKind — are reached
    writeFileSync(join(q, `${QUEUE_BASE}.failed.result`), JSON.stringify({
      ok: false, failedStage: "common-law-half:b", reason: "invalid artifact after 9 attempts", runDir,
    }));
    const t = readMarkerTerminal(q, QUEUE_BASE, "failed");
    assert.equal(t.terminal, "failed", 'the report printed `parked as "clarify"` for this exact state');
    assert.equal(t.started, true);
    assert.equal(t.undetermined, false);
    assert.equal(t.runId, RUN_ID, "the runId comes off the run's own status.json, reached through the .result");
    assert.equal(t.terminalKind, "invalid-artifact-loop", "and the reader is told WHY the run ended");
    assert.match(t.why, /\.result/, "the row says which record it read the terminal from");
  });
});

test("#428: `.failed` beside an INTAKE reason still reads as a clarification — R0's whole subject", () => {
  scratch((root) => {
    const { q } = deployment(root, {
      queue: {
        [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R0a-cli" },
        [`${QUEUE_BASE}.failed.reason`]: `resolved no routing territory\nnotify: packet intake-${QUEUE_BASE}.failed.pending\n`,
      },
    });
    const t = readMarkerTerminal(q, QUEUE_BASE, "failed");
    assert.equal(t.terminal, "clarify");
    assert.equal(t.started, false);
    assert.equal(t.undetermined, false);
    assert.match(t.why, /\.reason/);
  });
});

test("#428: `.failed` with NEITHER sidecar is UNDETERMINED — it is never silently resolved to one reading", () => {
  scratch((root) => {
    const { q } = deployment(root, { queue: { [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R2" } } });
    const t = readMarkerTerminal(q, QUEUE_BASE, "failed");
    assert.equal(t.undetermined, true);
    assert.equal(t.terminal, "undetermined");
    assert.match(t.why, /neither/, "the reader is told which two records were looked for");
    assert.match(t.why, /clarify/); assert.match(t.why, /failed/);
  });
});

test("#428: undetermined is raised ONLY where the two readings disagree — .done and .duplicate must not go noisy", () => {
  scratch((root) => {
    const { q } = deployment(root, {
      queue: {
        [`${QUEUE_BASE}.done`]: { id: QUEUE_BASE, ref: "E2E-R0e-cli" },
        ["dup-id.duplicate"]: { id: "dup-id", ref: "E2E-R0d" },
      },
    });
    // `.done` means delivered whichever moment wrote it; `.duplicate` is written at intake only. A
    // missing sidecar decides nothing for either, so raising "undetermined" would be a new false alarm
    // introduced by the fix for the old one.
    const done = readMarkerTerminal(q, QUEUE_BASE, "done");
    assert.equal(done.terminal, "delivered"); assert.equal(done.undetermined, false);
    const dup = readMarkerTerminal(q, "dup-id", "duplicate");
    assert.equal(dup.terminal, "duplicate"); assert.equal(dup.undetermined, false);
  });
});

test("#428: an in-flight marker is not a terminal, and an unknown suffix is carried rather than dropped", () => {
  scratch((root) => {
    const { q } = deployment(root, { queue: {} });
    const proc = readMarkerTerminal(q, QUEUE_BASE, "processing");
    assert.equal(proc.inFlight, true);
    assert.equal(proc.undetermined, false);
    const stranded = readMarkerTerminal(q, QUEUE_BASE, "stopped-for-reboot");
    assert.equal(stranded.terminal, "stopped-for-reboot", "the suffix is reported as itself, not swallowed");
  });
});

test("#428: the two tables disagree on exactly one suffix, and that is the one the discriminator exists for", () => {
  assert.equal(TERMINAL_BY_SUFFIX.failed, "clarify", "intake semantics — unchanged, R0 depends on it");
  assert.equal(TERMINAL_BY_SUFFIX_RAN.failed, "failed");
  assert.equal(TERMINAL_BY_SUFFIX_RAN.done, TERMINAL_BY_SUFFIX.done);
  assert.equal(TERMINAL_BY_SUFFIX_RAN.cancelled, TERMINAL_BY_SUFFIX.cancelled);
  assert.equal(TERMINAL_BY_SUFFIX_RAN.duplicate, undefined,
    "a run terminal writes only done|cancelled|failed (runner.mjs runPrepared) — .duplicate is an intake park");
});

// ── queueOutcomes end to end: the R2 report, as it should have read ───────────────────────────────────

function r2Deployment(root, { packet = true } = {}) {
  const { q, ob, runDir } = deployment(root, {
    queue: { [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } },
    outbox: packet ? [`${RUN_ID}.failed.pending`] : [],
    run: { state: "failed", runId: RUN_ID, terminalKind: "invalid-artifact-loop" },
  });
  writeFileSync(join(q, `${QUEUE_BASE}.failed.result`),
    JSON.stringify({ ok: false, failedStage: "common-law-half:b", reason: "invalid artifact", runDir }));
  return { q, ob, runDir };
}

test("#428: the R2 row — terminal `failed`, and the packet FOUND, from one call", () => {
  scratch((root) => {
    const { q, ob } = r2Deployment(root);
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const rows = queueOutcomes("E2E-R2", q);
      assert.equal(rows.length, 1, "the .result sidecar must not be counted as a second door — it carries no ref");
      const [row] = rows;
      assert.equal(row.terminal, "failed");
      assert.equal(row.terminalKind, "invalid-artifact-loop");
      assert.deepEqual(row.packets, [`${RUN_ID}.failed.pending`]);
      assert.equal(row.packetsUnreadable, null);
    });
  });
});

test("#428: TEETH — the same run with NO packet on disk still reports the requester was never told", () => {
  scratch((root) => {
    const { q, ob } = r2Deployment(root, { packet: false });
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const [row] = queueOutcomes("E2E-R2", q);
      assert.equal(row.terminal, "failed");
      assert.deepEqual(row.packets, []);
      assert.equal(row.packetsUnreadable, null, "readable and empty — the finding stands, and cmdReport flags it");
    });
  });
});

test("#428: a run whose runId cannot be read says the runId lane was never searched — half a search is not a search", () => {
  scratch((root) => {
    const { q, ob } = r2Deployment(root, { packet: false });
    // the run dir went (a teardown, an archive move): the .result still proves a run started, but the
    // packet it would have written cannot be named. Searching the intake lane alone and reporting
    // "never told" would be the original defect wearing the fix.
    rmSync(join(root, "workspace"), { recursive: true, force: true });
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const [row] = queueOutcomes("E2E-R2", q);
      assert.equal(row.started, true);
      assert.equal(row.runId, null);
      // The `.result` still names the run dir, so the engine's `basename(runDir)` fallback name IS
      // composable and IS searched. What is missing is the run's own status.json, and with it the
      // canonical `<slug>-<date>-<codename>` name — so this is a partial search, and a partial search
      // that finds nothing must not say the requester was never told.
      assert.match(row.packetsUnreadable, /canonical .* name is unknown/);
      assert.match(row.packetsUnreadable, /2026-08-05-fixture-two/, "and the reader is told which name WAS searched");
    });
  });
});

test("#428: a marker with a suffix the drain does not know is REPORTED, not dropped", () => {
  scratch((root) => {
    const { q, ob } = deployment(root, {
      queue: { [`${QUEUE_BASE}.stopped-for-reboot`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } },
    });
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const rows = queueOutcomes("E2E-R2", q);
      // The shipped regex allowlisted seven suffixes and `continue`d past everything else, so a job in
      // exactly the state where NOTHING will ever drain it was reported as leaving no queue marker.
      assert.equal(rows.length, 1);
      assert.equal(rows[0].unrecognisedSuffix, true);
      assert.equal(rows[0].terminal, "stopped-for-reboot");
    });
  });
});

// The two queue names that are NOT what they look like. Both carry the job JSON, so both reach every
// scan that reads the queue by ref — and both were found by walking runner.mjs's filename composition
// rather than by reasoning about what a queue "should" hold.

test("#428: the #377 claim lock is an in-flight state, not a stranded marker", () => {
  scratch((root) => {
    // `<base>.processing.claimed-<pid>:<starttime>` is the job file renamed for the atomic claim. A live
    // token is a claim in progress; a dead one is restored by sweepAbandonedTakeovers. Reporting it as a
    // suffix nothing drains would put a false INVESTIGATE line on every claim race — this issue's own
    // defect, re-authored by its fix.
    const { q, ob } = deployment(root, {
      queue: { [`${QUEUE_BASE}.processing.claimed-4172:88431`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } },
    });
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const [row] = queueOutcomes("E2E-R2", q);
      assert.equal(row.inFlight, true);
      assert.equal(row.unrecognisedSuffix, false, "a normal claim state must not be flagged");
      assert.equal(row.undetermined, false);
      assert.match(row.terminalWhy, /claim lock/);
    });
    // TEETH: a genuinely stranded marker is still flagged
    const { q: q2 } = deployment(join(root, "b"), {
      queue: { [`${QUEUE_BASE}.stopped-for-reboot`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } },
    });
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      assert.equal(queueOutcomes("E2E-R2", q2)[0].unrecognisedSuffix, true);
    });
  });
});

test("#428: a `.manifest`-named job splits on the base the RUNNER uses, so its sidecars are found", () => {
  scratch((root) => {
    // assembleJob tolerates the observed `<id>.manifest.json` forwarding fumble (runner.mjs), which makes
    // the runner's base `<id>.manifest` — so it writes `<id>.manifest.failed` and
    // `<id>.manifest.failed.reason`. A split that stopped at the first dot would look for the sidecar
    // under `<id>` and report UNDETERMINED for a perfectly ordinary intake refusal.
    const base = `${QUEUE_BASE}.manifest`;
    const { q, ob } = deployment(root, {
      queue: {
        [`${base}.failed`]: { id: QUEUE_BASE, ref: "E2E-R0a-cli" },
        [`${base}.failed.reason`]: "resolved no routing territory\n",
      },
    });
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const [row] = queueOutcomes("E2E-R0a", q);
      assert.equal(row.base, base, "the base is the runner's base, dots and all");
      assert.equal(row.terminal, "clarify");
      assert.equal(row.undetermined, false);
    });
  });
});

test("#428: an intake refusal still comes back exactly as it did — both doors, both packets", () => {
  scratch((root) => {
    const { q, ob } = deployment(root, {
      queue: {
        "cli-ms0.failed": { id: "cli-ms0", ref: "E2E-R0a-cli" },
        "cli-ms0.failed.reason": "resolved no routing territory\nnotify: packet intake-cli-ms0.failed.pending\n",
        "opsmcp-ms1.failed": { id: "opsmcp-ms1", ref: "E2E-R0a-opsmcp" },
        "opsmcp-ms1.failed.reason": "resolved no routing territory\n",
      },
      outbox: ["intake-cli-ms0.failed.pending"],
    });
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const rows = queueOutcomes("E2E-R0a", q).sort((a, b) => a.ref.localeCompare(b.ref));
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.terminal), ["clarify", "clarify"]);
      assert.deepEqual(rows[0].packets, ["intake-cli-ms0.failed.pending"]);
      assert.deepEqual(rows[1].packets, [], "the door with no packet is still the finding it always was");
    });
  });
});

// ── dedupe arithmetic: an unknown counted as an admission is a guess dressed as a reading ─────────────

test("#428: a run that started and then FAILED counts as an admission — it got past the door", () => {
  const d = dedupeAcrossDoors(["failed", "duplicate"]);
  assert.equal(d.admitted, 1);
  assert.equal(d.parked, 1);
  assert.equal(d.ranMoreThanOnce, false);
  assert.equal(d.neverFired, false);
});

test("#428: an UNDETERMINED terminal counts as neither, and suspends the 'dedupe never fired' claim", () => {
  const d = dedupeAcrossDoors(["undetermined", "undetermined"]);
  assert.equal(d.admitted, 0, "an unreadable terminal is not an admission");
  assert.equal(d.undetermined, 2);
  assert.equal(d.neverFired, false, "incomplete arithmetic must not name a defect");
  assert.equal(d.ranMoreThanOnce, false);
});

test("#428: a door still in flight is not an admission — two of them used to read as 'it ran twice'", () => {
  const d = dedupeAcrossDoors(["processing", "processing"]);
  assert.equal(d.admitted, 0);
  assert.equal(d.inFlight, 2);
  assert.equal(d.ranMoreThanOnce, false);
  assert.equal(d.neverFired, false);
});

test("#428: TEETH — two genuine admissions still read as 'it ran more than once'", () => {
  assert.equal(dedupeAcrossDoors(["delivered", "delivered"]).ranMoreThanOnce, true);
  assert.equal(dedupeAcrossDoors(["delivered", "failed"]).ranMoreThanOnce, true,
    "one delivered and one failed is still two searches for one matter");
  assert.equal(dedupeAcrossDoors(["delivered"]).neverFired, true, "and a settled set with no park still fires");
});

// ── a stage the run never reached ─────────────────────────────────────────────────────────────────────

const DECISION = { event: "envelope-decision-early", source: "fan-in", deferred: 3, accepted: 3 };
const PLACEMENT = { event: "stage", stage: "placement-inquiry", ok: true };

function withRunLog(rows, fn) {
  return scratch((root) => {
    mkdirSync(driverDir(root), { recursive: true });
    if (rows !== null) writeFileSync(driverDir(root, "run.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return fn(root);
  });
}

test("#428: a run that never reached placement is NOT PROBED — the assert said so in its own message and failed anyway", () => {
  withRunLog([{ event: "plan-execution", executed: 1 }, DECISION], (dir) => {
    const r = evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir);
    assert.equal(r.notProbed, true);
    assert.match(r.saw, /NOT PROBED/);
    assert.match(r.saw, /not a pass/i);
    assert.match(r.saw, /never reached the stage/);
  });
});

test("#428: TEETH — every way this assert genuinely fails, it still fails", () => {
  // placement ran, decision came after it — the 2026-07-30 shape that cost 1,436s
  withRunLog([PLACEMENT, DECISION], (dir) => {
    const r = evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir);
    assert.equal(r.ok, false); assert.ok(!r.notProbed); assert.match(r.saw, /BEFORE the decision/);
  });
  // placement ran and nothing was ever decided
  withRunLog([PLACEMENT], (dir) => {
    const r = evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir);
    assert.equal(r.ok, false); assert.ok(!r.notProbed); assert.match(r.saw, /never decided/);
  });
  // the log is absent
  withRunLog(null, (dir) => {
    assert.equal(evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir).ok, false);
  });
  // the log is THERE and empty — an absence of evidence, which is a finding and NOT a not-probed
  scratch((root) => {
    mkdirSync(driverDir(root), { recursive: true });
    writeFileSync(driverDir(root, "run.jsonl"), "\n");
    const r = evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, root);
    assert.equal(r.ok, false);
    assert.ok(!r.notProbed, "zero rows says nothing about whether placement ran — it must not decline, it must flag");
    assert.match(r.saw, /no readable rows/);
  });
  // and the ordering it exists to check still passes
  withRunLog([DECISION, PLACEMENT], (dir) => {
    assert.equal(evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir).ok, true);
  });
});

// ── delivery-settled shares the matcher, and names its own blindness ──────────────────────────────────

const STATUS_HANDOFF = { state: "delivered", verdict: "Medium", sendPending: true, runId: RUN_ID };

test("#428: delivery-settled distinguishes 'not looked for' from 'none written', and FAILS on both", () => {
  scratch((root) => {
    writeFileSync(join(root, "status.json"), JSON.stringify(STATUS_HANDOFF));
    const ob = join(root, "outbox"); mkdirSync(ob);
    // outbox unset: the harness never looked, and must not report a delivery defect for it
    withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: null }, () => {
      const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, root);
      assert.equal(r.ok, false);
      assert.match(r.saw, /NOT LOOKED FOR/);
      assert.ok(!/NONE WRITTEN/.test(r.saw), "an unconfigured outbox is not an unwritten packet");
    });
    // outbox present and empty: the delivery defect, unchanged
    withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, root);
      assert.equal(r.ok, false);
      assert.match(r.saw, /NONE WRITTEN/);
    });
    // and the packet present is settled
    writeFileSync(join(ob, `${RUN_ID}.pending`), "{}");
    withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: ob }, () => {
      assert.equal(evalAssertion({ op: "delivery-settled", path: "status.json" }, root).ok, true);
    });
  });
});

test("#428: a status.json with no runId is searched under the name the ENGINE would have written", () => {
  scratch((root) => {
    // outbox-backoff.mjs's rescan composes `sanitize(status.runId ?? basename(runDir))`, so a status.json
    // with no runId does not mean the marker is unnameable — it means the marker is named after the run
    // dir. The draft under review dropped that fallback and reported a delivered notification as never
    // sent, which is the reported defect re-authored one lane over.
    const runDir = join(root, "2026-08-05-fixture-two");
    mkdirSync(runDir);
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ ...STATUS_HANDOFF, runId: undefined }));
    const ob = join(root, "outbox"); mkdirSync(ob);
    writeFileSync(join(ob, "2026-08-05-fixture-two.pending"), "{}");
    withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, runDir);
      assert.equal(r.ok, true, "the packet is on disk under the engine's own fallback name");
      assert.match(r.saw, /2026-08-05-fixture-two\.pending/);
    });
    // TEETH: the same status with NOTHING in the outbox is still the delivery defect it always was
    rmSync(join(ob, "2026-08-05-fixture-two.pending"));
    withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, runDir);
      assert.equal(r.ok, false);
      assert.match(r.saw, /NONE WRITTEN/);
    });
  });
});

// ── the premise, pinned against source ────────────────────────────────────────────────────────────────
//
// "There are exactly two packet naming schemes" is a claim about the ENGINE, so it is checked against the
// engine. A third writer would make the runId-first rule a lie the day it lands, and this is what says
// so — the same pattern as `: the knockout lane provably writes no register-plan.json`.

test("#428: every outbox packet the driver writes is named `intake-<queueBase>.…` or `<runId>.…`", () => {
  const files = ["runner.mjs", "pipeline.mjs", "pipeline-knockout.mjs", "outbox-backoff.mjs"];
  const names = [];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/writeOutboxPacket\(\s*`([^`]+)`/g)) names.push(`${f}: ${m[1]}`);
    // the wake markers, written straight into the outbox dir
    for (const m of src.matchAll(/config\.outboxDir,\s*`([^`]+)\.pending`/g)) names.push(`${f}: ${m[1]}`);
  }
  assert.ok(names.length >= 6, `expected the known writers to be found, saw ${names.length}: ${names.join(" | ")}`);
  for (const n of names) {
    const name = n.split(": ")[1];
    // `${id}` is outbox-backoff.mjs's dedupe probe over the runId FORMS, pinned by its own test below.
    assert.match(name, /^(intake-\$\{base\}|\$\{runId\}|\$\{packet\.runId\}|\$\{id\})(\.|$)/,
      `${n} is a THIRD packet naming scheme. scripts/e2e.mjs matches packets by runId first and the queue `
      + `base second (outboxPackets); a name this does not cover is a notification the harness will report `
      + `as never sent.`);
  }
});

test("#428: the harness derives the SAME runId forms the engine honours, FALLBACK INCLUDED", () => {
  // outbox-backoff.mjs mints the canonical dated runId and treats the legacy dateless `<slug>-<codename>`
  // as the same delivery. A harness that knew only status.runId would read a legacy marker as absent and
  // report a notified requester as never told — the issue's defect one level down.
  const src = readFileSync(new URL("../outbox-backoff.mjs", import.meta.url), "utf8");
  assert.match(src, /const legacy = status\.slug && status\.codename \? sanitize\(`\$\{status\.slug\}-\$\{status\.codename\}`\) : null;/,
    "the engine's legacy form — if this derivation changes, runIdForms in scripts/e2e.mjs must change with it");
  assert.match(src, /const forms = legacy && legacy !== runId \? \[runId, legacy\] : \[runId\];/);
  // THE FALLBACK IS PART OF THE FORM, and the first draft of runIdForms dropped it. This is the engine
  // line it drops back onto — `?? basename(runDir)` — so a status.json with no runId names the marker the
  // engine actually wrote instead of producing a confident "the requester was never told".
  assert.match(src, /const runId = sanitize\(status\.runId \?\? `\$\{basename\(runDir\)\}`\);/,
    "the engine's dated form and its fallback — runIdForms must compose both");

  const st = { runId: RUN_ID, slug: "fixture-mark", codename: "fixture-two" };
  assert.deepEqual(runIdForms(st), [RUN_ID, "fixture-mark-fixture-two"]);
  assert.deepEqual(runIdForms({ runId: RUN_ID }), [RUN_ID], "no legacy form when the status carries no slug/codename");
  assert.deepEqual(runIdForms(null), [], "and an unreadable status yields nothing to match, never a guess");

  // no runId, and a run dir: the engine names the marker `<date>-<codename>`, so the harness looks there.
  const runDir = "/w/prelim-search/fixture-mark/2026-08-05-fixture-two";
  assert.deepEqual(runIdForms({ slug: "fixture-mark", codename: "fixture-two" }, runDir),
    ["2026-08-05-fixture-two", "fixture-mark-2026-08-05-fixture-two", "fixture-mark-fixture-two"],
    "outbox-backoff's fallback, runner.mjs backstopFailureNotice's `<slug>-<basename(runDir)>`, and the legacy form");
  // the fallback is on the DATED form only — a runDir must never manufacture a legacy form
  assert.deepEqual(runIdForms({}, runDir), ["2026-08-05-fixture-two"]);
  assert.deepEqual(runIdForms(st, runDir), [RUN_ID, "fixture-mark-2026-08-05-fixture-two", "fixture-mark-fixture-two"],
    "a status that HAS a runId keeps it first — `??` only fires on the absence — and the backstop's "
    + "`<slug>-<basename(runDir)>` rides alongside (in a real run it IS the runId, so it collapses)");
});

test("#428: TEETH — a run with no runId and a packet on disk is found, and another run's is not", () => {
  scratch((root) => {
    const ob = join(root, "outbox"); mkdirSync(ob);
    // outbox-backoff.mjs's rescan wrote this name because status.json carried no runId
    writeFileSync(join(ob, "2026-08-05-fixture-two.pending"), "agent\n");
    const runDir = join(root, "workspace", "prelim-search", "fixture-mark", "2026-08-05-fixture-two");
    const st = { slug: "fixture-mark", codename: "fixture-two" };
    assert.deepEqual(outboxPackets({ runIds: runIdForms(st, runDir) }, ob).packets, ["2026-08-05-fixture-two.pending"]);
    // the draft under review searched only `fixture-mark-fixture-two` and reported this as never sent
    assert.deepEqual(outboxPackets({ runIds: ["fixture-mark-fixture-two"] }, ob).packets, []);
    // and the fallback does not reach a different date's run
    const other = join(root, "workspace", "prelim-search", "fixture-mark", "2026-08-04-fixture-two");
    assert.deepEqual(outboxPackets({ runIds: runIdForms(st, other) }, ob).packets, []);
  });
});

test("#428: a packet under the LEGACY dateless name is found, not reported as never sent", () => {
  scratch((root) => {
    const ob = join(root, "outbox"); mkdirSync(ob);
    writeFileSync(join(ob, "fixture-mark-fixture-two.pending"), "agent\n");
    const st = { runId: RUN_ID, slug: "fixture-mark", codename: "fixture-two" };
    assert.deepEqual(outboxPackets({ runIds: runIdForms(st) }, ob).packets, ["fixture-mark-fixture-two.pending"]);
    // TEETH: an unrelated run's legacy marker is still not this run's
    assert.deepEqual(outboxPackets({ runIds: runIdForms({ runId: "other-run" }) }, ob).packets, []);
  });
});

// ── the class guard: NOT PROBED must not decay into a pass ────────────────────────────────────────────

test("#428: every not-probed return in the harness carries both words the reader needs", () => {
  // Each `notProbed: true` site is a check declining to look. The convention — established by and
  // asserted by its tests — is that the reader is told nothing was examined AND that this is not a pass.
  // A site that returns `ok: true` with neither phrase reads as green in the report.
  const sites = [...E2E_SRC.matchAll(/notProbed: true,\s*\n?\s*saw: `?([^`\n]*)/g)].map((m) => m[1]);
  assert.ok(sites.length >= 3, `expected the not-probed sites to be found, saw ${sites.length}`);
  for (const s of sites) {
    assert.match(s, /NOT PROBED/, `a not-probed return whose message does not say so: ${s}`);
    assert.match(s, /not a pass/i, `a not-probed return that does not say it is not a pass: ${s}`);
  }
});


test("#428: cmdReport asks for the requester's notice on a FAILED run, and on an UNDETERMINED one", () => {
  assert.match(E2E_SRC, /const owesNotice = q\.terminal === "clarify" \|\| q\.terminal === "duplicate" \|\| q\.terminal === "failed" \|\| q\.undetermined/,
    "a run that started and then failed writes `<runId>.failed.pending` — it owes the requester a notice like any "
    + "other non-delivery; and a marker whose terminal could not be read must not be the one state where the "
    + "packet is neither looked for nor reported");
  assert.match(E2E_SRC, /if \(q\.undetermined\) \{\s*\n\s*notProbed\.push/,
    "an undetermined terminal neither passes nor fails the ordered one");
  assert.match(E2E_SRC, /else if \(q\.packetsUnreadable\) notProbed\.push/,
    "and 'we could not tell whether the requester was told' is not 'the requester was never told'");
  assert.match(E2E_SRC, /else if \(q\.undetermined\) notProbed\.push/,
    "an undetermined terminal's missing packet is a NOT PROBED line, not a defect and not silence");
});

// ── the false alarm THIS PATCH authored, and the mechanism that authored it ───────────────────────────
//
// The draft of that went to review added an unrecognised-suffix warning to the queue listing, gated
// on four sidecar suffixes typed from memory. runner.mjs carries NINE prose sidecars beside a job, and
// none of them matched — so a queue holding one ordinary job printed three copies of "this job is
// invisible to it", on every job enqueued through the prose-sidecar convention, i.e. every live run. The
// patch whose subject is false alarms of that shape shipped one.
//
// TWO REPAIRS, and the second is the one that matters. The vocabulary is now IMPORTED from
// queue-markers.mjs, which is the module that exists because this vocabulary "has now been written down
// three times and the copies disagreed ". And the warning's own claim — "this job is invisible to
// it" — is checked against the FILE: only a JSON record carrying a ref or an id is a job. The import
// fixes the nine suffixes that exist; reading the record fixes the tenth suffix nobody has written yet.

test("#428: a job's prose sidecars are not stranded jobs — the false alarm this patch authored", () => {
  scratch((root) => {
    const { q } = deployment(root, {
      queue: {
        [`${QUEUE_BASE}.processing`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
        [`${QUEUE_BASE}.processing.meta`]: { codename: "fixture-two", dateISO: "2026-08-05", agentId: "fixture" },
        [`${QUEUE_BASE}.markName.md`]: "FIXTURE MARK\n",
        [`${QUEUE_BASE}.rawRequest.txt`]: "please clear this mark\n",
        [`${QUEUE_BASE}.goods.txt`]: "class 9\n",
        [`${QUEUE_BASE}.brief.md`]: "the requester's own words\n",
        [`${QUEUE_BASE}.campaignShape.txt`]: "one market, one launch\n",
      },
    });
    for (const f of nonEmpty(readdirSync(q), "readdirSync(q)")) {
      assert.equal(undrainableJob(q, f), null,
        `${f} is a live job or one of its sidecars — nothing here is stranded, and warning about it points an `
        + "investigation at the intake convention working correctly");
    }
  });
});

test("#428: every prose sidecar the engine defines is covered, because the list is IMPORTED not retyped", () => {
  scratch((root) => {
    // The nine the draft missed. Sourced from runner.mjs's own PROSE_PARTS (which now lives in
    // queue-markers.mjs), so a tenth prose field is covered the day it lands rather than the day someone
    // remembers this check exists.
    assert.ok(Object.keys(PROSE_PARTS).length >= 9, "the engine carries at least the nine prose fields");
    const { q } = deployment(root, {
      queue: { [`${QUEUE_BASE}.json`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } },
    });
    for (const suffix of Object.values(PROSE_PARTS)) {
      const name = `${QUEUE_BASE}${suffix}`;
      writeFileSync(join(q, name), "prose\n");
      assert.ok(isQueueSidecar(name), `${name} must be recognised as a sidecar by the module that names it`);
      assert.equal(undrainableJob(q, name), null, `${name} is prose the runner assembles, not a stranded job`);
    }
    // and the claim's own sidecars
    for (const suffix of CLAIM_SIDECAR_SUFFIXES) {
      assert.ok(isQueueSidecar(`${QUEUE_BASE}.processing${suffix}`));
    }
  });
});

test("#428: TEETH — a job in a state nothing drains is still warned about, and it is the FILE that says so", () => {
  scratch((root) => {
    const { q } = deployment(root, {
      // the observed case: a marker renamed to a suffix no drain claims, which is how a run was stranded
      queue: {
        [`${QUEUE_BASE}.stopped-for-reboot`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
        // same suffix, no job record inside — a stray file, not a stranded job
        "leftover.stopped-for-reboot": "not json at all\n",
        // JSON, but carrying no ref and no id: the `.result` shape, which must not read as a job
        "orphan.stopped-for-reboot": { ok: false, failedStage: "matter-frame" },
      },
    });
    assert.match(undrainableJob(q, `${QUEUE_BASE}.stopped-for-reboot`), /no drain will ever claim it/);
    assert.equal(undrainableJob(q, "leftover.stopped-for-reboot"), null, "an unparseable stray is not a stranded job");
    assert.equal(undrainableJob(q, "orphan.stopped-for-reboot"), null, "JSON with no ref and no id is not a job either");
    // and every live and terminal state is quiet
    for (const [name, body] of Object.entries({
      [`${QUEUE_BASE}.json`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
      [`${QUEUE_BASE}.postponed`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
      [`${QUEUE_BASE}.processing.claimed-4172:88431`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
      [`${QUEUE_BASE}.done`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
      [`${QUEUE_BASE}.cancelled`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
      [`${QUEUE_BASE}.duplicate`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" },
    })) {
      writeFileSync(join(q, name), JSON.stringify(body));
      assert.equal(undrainableJob(q, name), null, `${name} is a state the drain knows`);
    }
  });
});

test("#428: the queue listing lists EVERYTHING — a hidden file is the same sin one notch quieter", () => {
  const fn = E2E_SRC.slice(E2E_SRC.indexOf("function cmdStatus"), E2E_SRC.indexOf("// ── refusals leave no run dir"));
  assert.match(fn, /THE QUEUE DIR DOES NOT EXIST/, "a missing queue dir is a deployment fact, not an empty queue");
  assert.match(fn, /for \(const f of all\)/, "every entry is printed; the draft silently dropped the ones it called sidecars");
  assert.match(fn, /undrainableJob\(QUEUE_DIR, f\)/, "and the warning is asked of the FILE, not of the filename");
  assert.ok(!/readdirSync\(QUEUE_DIR\)\.filter\(\(f\) => \/\\\.\(json/.test(fn), "the six-suffix allowlist that hid it is gone");
  assert.ok(!/const SIDECAR = /.test(E2E_SRC), "and the four-suffix sidecar regex typed from memory is gone with it");
});

// ── the vocabulary is imported, not retyped ───────────────────────────────────────────────────────────

test("#428: the harness holds NO private copy of the queue's live-state vocabulary", () => {
  // created queue-markers.mjs because this vocabulary "has now been written down three times and the
  // copies disagreed". The draft under review wrote it down twice more here. A private copy is how the
  // false alarm above was authored, and it is how the next one would be.
  assert.match(E2E_SRC, /from "\.\.\/driver\/queue-markers\.mjs"/, "the module is imported");
  assert.ok(!/const IN_FLIGHT_SUFFIXES/.test(E2E_SRC), "no private in-flight suffix set");
  assert.ok(!/const CLAIM_LOCK/.test(E2E_SRC), "no private claim-lock regex");
  assert.ok(!/\(json\|processing\|postponed\)/.test(E2E_SRC), "no private live-marker pattern");
  // and the module's own answers are the ones the harness uses
  assert.equal(liveQueueState("job-a.processing.claimed-4172:88431"), "processing",
    "the claim lock is the .processing marker renamed — it is that state, not a state of its own");
  assert.equal(liveQueueState("job-a.postponed"), "postponed");
  assert.equal(liveQueueState("job-a.failed"), null);
  assert.deepEqual([...TERMINAL_QUEUE_SUFFIXES].sort(), ["cancelled", "done", "duplicate", "failed"]);
});

test("#428: runner.mjs and the harness read ONE prose-sidecar list", () => {
  // The engine must SOURCE the list, not keep its own — otherwise the import above pins a copy.
  const runner = readFileSync(new URL("../runner.mjs", import.meta.url), "utf8");
  assert.match(runner, /import \{[^}]*PROSE_PARTS[^}]*\} from "\.\/queue-markers\.mjs"/,
    "runner.mjs imports the list rather than defining it");
  assert.ok(!/^const PROSE_PARTS = \{/m.test(runner), "and keeps no second copy");
  assert.match(runner, /for \(const suffix of CLAIM_SIDECAR_SUFFIXES\)/,
    "the claim sidecars come from the same module — cmdStatus needs them and cannot import runner.mjs");
  // scripts/e2e.mjs must NOT import the engine: that chain reaches driver.config.mjs, whose unset-env
  // defaults are PRODUCTION, into the one script whose safety story is refuseProduction() running first.
  assert.ok(!/from "\.\.\/driver\/runner\.mjs"/.test(E2E_SRC),
    "the harness reaches the vocabulary through the pure leaf module, never through the engine");
});

// ── a record that is there and unreadable is not a record that is absent ──────────────────────────────

test("#428: a TORN `.result` says so — `readJson` returns null for ENOENT and for broken JSON alike", () => {
  scratch((root) => {
    const { q } = deployment(root, { queue: { [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } } });
    writeFileSync(join(q, `${QUEUE_BASE}.failed.result`), '{"ok": false, "runDir": "/w/pre');   // cut mid-write
    const t = readMarkerTerminal(q, QUEUE_BASE, "failed");
    // the file EXISTING is the discriminator — the runner writes `.result` only at a run terminal — so
    // the terminal word survives; what is lost is the run dir inside it.
    assert.equal(t.terminal, "failed", "a run executed, and a torn record does not turn that into a clarification");
    assert.equal(t.started, true);
    assert.equal(t.runId, null);
    assert.match(t.why, /does not parse as JSON/);
    assert.ok(!/neither/.test(t.why),
      'the draft said "neither <base>.failed.reason nor <base>.failed.result is on disk" about a file that IS on disk');
  });
});

test("#428: TEETH — a genuinely absent `.result` still reads as absent, and .failed is still undetermined", () => {
  scratch((root) => {
    const { q } = deployment(root, { queue: { [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } } });
    const t = readMarkerTerminal(q, QUEUE_BASE, "failed");
    assert.equal(t.undetermined, true);
    assert.match(t.why, /neither/, "with nothing on disk, 'neither is on disk' is the true sentence");
  });
});

// ── the pre-run-throw lane: the run dir the caller already holds ──────────────────────────────────────

test("#428: a `.result` that names NO run dir still finds its packet, from the run dir cmdReport holds", () => {
  scratch((root) => {
    // runPrepared's catch sets `{ok:false, reason}` with no runDir — a throw in the SETUP code, before the
    // pipeline's own try{}. runner.mjs backstopFailureNotice then notifies as `<slug>-<basename(runDir)>`,
    // a run the marker's record never names. cmdReport has that run dir in `hits` from findRunsByRef.
    const { q, ob, runDir } = deployment(root, {
      queue: { [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } },
      outbox: ["fixture-mark-2026-08-05-fixture-two.failed.pending"],
      run: { state: "failed", ref: "E2E-R2-token1", slug: "fixture-mark", codename: "fixture-two", failedStage: "pre-run" },
    });
    writeFileSync(join(q, `${QUEUE_BASE}.failed.result`), JSON.stringify({ ok: false, reason: "Error: dropped register credential" }));
    const known = [{ runDir, status: readStatus(join(runDir, "status.json")) }];
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const [blind] = queueOutcomes("E2E-R2", q);
      assert.deepEqual(blind.packets, [], "without the run dir there is nothing to compose the packet name from");
      assert.match(blind.packetsUnreadable, /never searched/, "and that is NOT PROBED, not 'the requester was never told'");

      const [row] = queueOutcomes("E2E-R2", q, known);
      assert.deepEqual(row.packets, ["fixture-mark-2026-08-05-fixture-two.failed.pending"],
        "with it, the runId lane is searched and the notification is found");
      assert.equal(row.packetsUnreadable, null);
    });
  });
});

test("#428: TEETH — a searched runId lane with no packet is a FINDING, not a NOT PROBED line", () => {
  scratch((root) => {
    const { q, ob, runDir } = deployment(root, {
      queue: { [`${QUEUE_BASE}.failed`]: { id: QUEUE_BASE, ref: "E2E-R2-token1" } },
      outbox: [],
      run: { state: "failed", ref: "E2E-R2-token1", slug: "fixture-mark", codename: "fixture-two" },
    });
    writeFileSync(join(q, `${QUEUE_BASE}.failed.result`), JSON.stringify({ ok: false, reason: "Error: dropped register credential" }));
    const known = [{ runDir, status: readStatus(join(runDir, "status.json")) }];
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const [row] = queueOutcomes("E2E-R2", q, known);
      assert.deepEqual(row.packets, []);
      assert.equal(row.packetsUnreadable, null,
        "searched and empty is the finding this whole issue exists to keep real — suppressing it to fix the "
        + "false alarm would trade one direction of the same defect for the other");
    });
  });
});

// The match is EXACT, and driver/progress.mjs is why: it seeds status.json with `ref: job.ref ?? null`.
// Relaxing it to the `startsWith` findRunsByRef uses would cross doors — `cli` is a prefix of
// `client-mcp` — and this is the test that would fail if someone did.
test("#428: a caller's run dir never reaches ANOTHER door — the match is on the door's own ref", () => {
  scratch((root) => {
    const { q, ob, runDir } = deployment(root, {
      queue: {
        "cli-ms0.failed": { id: "cli-ms0", ref: "E2E-R0a-cli" },
        "cli-ms0.failed.reason": "resolved no routing territory\n",
        "opsmcp-ms1.failed": { id: "opsmcp-ms1", ref: "E2E-R0a-opsmcp" },
        "opsmcp-ms1.failed.reason": "resolved no routing territory\n",
      },
      outbox: ["fixture-mark-2026-08-05-fixture-two.failed.pending"],
      run: { state: "failed", ref: "E2E-R0a-opsmcp", slug: "fixture-mark", codename: "fixture-two" },
    });
    const known = [{ runDir, status: readStatus(join(runDir, "status.json")) }];
    withEnv({ CLEAROTRON_OUTBOX_DIR: ob }, () => {
      const rows = queueOutcomes("E2E-R0a", q, known).sort((a, b) => a.ref.localeCompare(b.ref));
      assert.deepEqual(rows[0].packets, [], "the cli door must not be credited with the opsmcp door's notification");
      assert.deepEqual(rows[1].packets, ["fixture-mark-2026-08-05-fixture-two.failed.pending"]);
    });
  });
});

test("#428: cmdReport hands its own findRunsByRef result to queueOutcomes", () => {
  assert.match(E2E_SRC, /const allQs = queueOutcomes\(ref, QUEUE_DIR, allHits\);/,
    "the run dirs the report already walked are what let the runId lane be searched at all");
});

test("#428: the prose-drift check reports an unreadable witness and a document that has GONE", () => {
  const fn = E2E_SRC.slice(E2E_SRC.indexOf("const witPath"), E2E_SRC.indexOf("// ── the deliverables the scenario ORDERED"));
  assert.match(fn, /gone\.push/, "a recorded document that is no longer on disk is a change, not a skip");
  assert.match(fn, /if \(!pairs\)/, "a witness with no readable path+sha pair is an absence, and an absence is a finding");
  assert.match(fn, /"sha\(\?:256\)\?"\\s\*:\\s\*\(\?:"\(\[0-9a-f\]\{6,\}\)"\|\(null\)\)/,
    "and a row whose hash the run recorded as null is matched rather than silently unmatched");
});

test("#428: cmdTeardown is untouched — it deletes files and reports no state, so it is outside this rule", () => {
  // The draft rewrote three things in cmdTeardown: a runId-keyed outbox deletion lane, the queue-id
  // derivation and the delete predicate. None of them reports a state, so none of them is in the ruling's
  // scope, and a widened DELETE predicate is the one kind of change that cannot be undone by re-reading.
  // Reverted whole. The two real defects behind it are recorded in the commit body as separately filable.
  const fn = E2E_SRC.slice(E2E_SRC.indexOf("function cmdTeardown"));
  assert.ok(!/hitsRun/.test(fn), "no third deletion lane");
  assert.match(fn, /const base = f\.split\("\."\)\[0\];/, "the queue-id derivation is as it shipped");
  assert.match(fn, /if \(!hitsId && !hitsRef\) continue;/, "and the delete predicate is as it shipped");
});

// ── the sweep, as a table rather than a number in a commit message ────────────────────────────────────
//
// The ruling asked how many checks infer a state rather than reading one, and said a patch to the three
// symptoms with no sweep should be rejected. A number in a commit body is not checkable: nobody can tell
// whether it was counted or remembered, and it silently stops being true the next time a check is added.
//
// So the sweep IS this table. One row per site, each anchored on a string that must still be in the
// source, each with the verdict the sweep reached, and the totals asserted — so the number in the commit
// body is the number this test computes, and a reader can walk all 49 anchors.
//
// WHAT THIS DOES NOT CATCH, said plainly because the alternative is this file committing the defect it
// is about: REMOVING or renaming a site fails here (its anchor goes missing). ADDING one does not.
// Nothing enumerates state-reporting sites out of the source to compare against the table, so a new
// check lands with no row and both tests below stay green. A site added later needs a row added by hand,
// and nothing mechanical will remind anyone.
//
// THE UNIT. A site is one place that hands a reader a word about a state — the engine's, the run's or the
// deployment's. Assertion ops count individually (each answers one ordered question); a command counts
// once per distinct line it prints about a state. cmdTeardown is NOT in the table: it deletes files and
// reports nothing, which is why the draft's changes to it were reverted rather than kept.
//
// THIS TABLE WAS RECOUNTED AFTER THE REPAIRS, not carried over. The draft's body said 47 examined and 11
// defective; the recount says 49 and 11 — the boundary above admits sites the draft left out, the
// teardown row left with the reverted hunks, and the false alarm the draft authored in the queue listing
// folds into the row that was already defective there.

const SWEEP = [
  // ── the assertion ops: each answers one ordered question about the run ──────────────────────────────
  ["e2e", "equals: (v, want) =>", "sound"],
  ["e2e", "falsy: (v) =>", "sound"],
  ["e2e", "exists: (v) =>", "sound"],
  ["e2e", '"non-empty": (v) =>', "sound"],
  ["e2e", "length: (v, want) =>", "sound"],
  ["e2e", 'a.op === "no-permission-prose"', "sound"],
  ["e2e", 'a.op === "settled-before-placement"', "fixed"],   // a stage never reached was scored FAIL
  ["e2e", 'a.op === "no-attempt-fail-token"', "sound"],
  ["e2e", 'a.op === "no-wildcard-exact-pair"', "sound"],
  ["e2e", 'a.op === "names-configured-depth"', "sound"],
  ["e2e", 'a.op === "register-claims-within-counts"', "sound"],
  ["e2e", 'a.op === "survivor-not-clear"', "sound"],
  ["e2e", 'a.op === "delivery-settled"', "fixed"],           // three absences all printed NONE WRITTEN

  // ── the queue and outbox readers ────────────────────────────────────────────────────────────────────
  ["e2e", "export function runIdForms(", "fixed"],           // one runId form; the engine honours three
  ["e2e", "export function outboxPackets(", "fixed"],        // was `x.includes(base)`; blind to `<runId>.…`
  ["e2e", "export function readMarkerTerminal(", "fixed"],   // `.failed` read with intake semantics always
  ["e2e", "function queueOutcomes(", "fixed"],               // a seven-suffix allowlist dropped the rest
  ["e2e", "export function dedupeAcrossDoors(", "fixed"],    // admission counted by exclusion

  // ── provenance, environment and the listings ────────────────────────────────────────────────────────
  ["e2e", "export function scenarioStore(", "sound"],
  ["e2e", "export function storeVersion(", "sound"],
  ["e2e", "export function storeLine(", "sound"],
  ["e2e", "function refuseProduction(", "sound"],
  ["e2e", "function commitState(", "sound"],
  ["e2e", "function reportCommit(", "sound"],
  ["e2e", "function scenarioDirOrDie(", "sound"],
  // MOVED, NOT DELETED. The walk itself is now driver/e2e-rounds.mjs's, so scripts/score.mjs can
  // reach it without importing the door graph; scripts/e2e.mjs keeps a one-line wrapper that binds
  // WORKSPACE_ROOT. The site is the same site and the verdict is unchanged — it is re-anchored to
  // where it lives, which is exactly what this table asks of a row whose site has moved.
  ["rounds", "export function findRunsByRef(", "sound"],
  ["e2e", "function queueDrainState(", "sound"],
  ["e2e", "function cmdList(", "sound"],
  ["e2e", "export function undrainableJob(", "fixed"],       // the queue listing: allowlist, then a false alarm
  ["e2e", "runs for E2E refs:", "sound"],
  ["e2e", "function runLedger(", "sound"],
  ["e2e", "function investigate(", "sound"],
  ["e2e", "function printLedger(", "sound"],
  ["e2e", "export async function probeStampedUrl(", "sound"],
  ["e2e", "export function preserveRunDir(", "sound"],

  // ── the lines cmdReport prints about one ref ────────────────────────────────────────────────────────
  ["e2e", "left no trace", "sound"],
  ["e2e", "no run dir, which is correct for a refusal", "fixed"],   // printed when nothing was searched
  ["e2e", "dedupe across ", "sound"],
  ["e2e", "terminal read from:", "sound"],
  ["e2e", "requester notified:", "fixed"],                  // only the two intake parks were asked
  ["e2e", "it may be firing on the wrong rule", "sound"],
  ["e2e", "prose drift:", "fixed"],                         // null sha, deleted doc and no-match all silent
  ["e2e", "ordered artifact(s) never written", "sound"],
  ["e2e", "the run's own report URL 404s", "sound"],
  ["e2e", "ordered-vs-ran:", "sound"],
  ["e2e", "THE DOORS DISAGREE", "sound"],
  ["e2e", "verdict=${st.verdict ?? \"-\"}", "sound"],

  // ── the two modules the harness imports ─────────────────────────────────────────────────────────────
  ["mcp", 'const ctype = String(headers["content-type"] ?? "");', "sound"],
  ["policy", "export function reportIdentityFor(", "sound"],
];

test("#428: the sweep is a table, and every site in it is still where the sweep found it", () => {
  const SRC = {
    e2e: E2E_SRC,
    mcp: readFileSync(new URL("../portal-mcp-client.mjs", import.meta.url), "utf8"),
    policy: readFileSync(new URL("../search-policy.mjs", import.meta.url), "utf8"),
    rounds: readFileSync(new URL("../e2e-rounds.mjs", import.meta.url), "utf8"),
  };
  const missing = SWEEP.filter(([where, anchor]) => !SRC[where].includes(anchor)).map(([w, a]) => `${w}: ${a}`);
  assert.deepEqual(missing, [],
    "a sweep row whose site has moved or gone: re-judge it and update the table, because this count is the "
    + "only claim anyone can check about how wide this patch looked");
});

test("#428: the sweep's own arithmetic — 49 state-reporting sites examined, 11 were defective", () => {
  assert.equal(SWEEP.length, 49, "sites examined");
  assert.equal(SWEEP.filter(([, , v]) => v === "fixed").length, 11, "sites that reported a state they had not read");
  assert.equal(SWEEP.filter(([, , v]) => v === "sound").length, 38);
  assert.deepEqual([...new Set(SWEEP.map(([, , v]) => v))].sort(), ["fixed", "sound"],
    "every row carries a verdict — an unjudged site is the sweep not having happened");
  assert.equal(new Set(SWEEP.map(([w, a]) => `${w} ${a}`)).size, SWEEP.length, "no row counted twice");
});

test("#428: no check in the harness reads a terminal state out of a filename's shape", () => {
  // The three shapes that started this: `x.includes(base)` over the outbox, the intake table applied to
  // every `.failed`, and a suffix allowlist that dropped what it did not recognise.
  assert.ok(!/readdirSync\(outbox\)\.filter\(\(x\) => x\.includes\(base\)\)/.test(E2E_SRC),
    "the queue-side outbox matcher must go through outboxPackets");
  assert.ok(!/terminal: TERMINAL_BY_SUFFIX\[suffix\] \?\? suffix/.test(E2E_SRC),
    "the terminal must come from readMarkerTerminal, which reads which moment wrote the marker");
  assert.equal((E2E_SRC.match(/readdirSync\(outbox\)/g) ?? []).length, 1,
    "exactly one place still lists the outbox directly — cmdTeardown, which selects files to delete rather than reporting a state");
});
