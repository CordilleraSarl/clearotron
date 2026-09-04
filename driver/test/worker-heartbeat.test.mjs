// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — IS ANYTHING DRAINING THIS INSTALL'S QUEUE?
//
// The question exists because `bin/start.mjs` now supervises a worker NON-FATALLY: a worker that dies
// leaves the portal serving, which is right, and is also the state in which a queued row saying "waiting
// its turn" is a lie. These arms pin the FAIL-SAFE DIRECTION, which is the opposite of claim liveness's
// and deliberately so — see the module header.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beat, workerAlive, heartbeatPath, drainingState } from "../worker-heartbeat.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "ct-hb-"));

test("#1721 a beat this process wrote reads as alive", () => {
  const d = dir();
  try {
    assert.equal(beat(d), true);
    assert.equal(workerAlive(d), true);
    const rec = JSON.parse(readFileSync(heartbeatPath(d), "utf8"));
    assert.equal(rec.pid, process.pid);
    assert.ok(rec.starttime, "no birth stamp — a recycled pid would read as alive");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1721 NO heartbeat is NOT a worker — the honest direction when nothing is known", () => {
  const d = dir();
  try { assert.equal(workerAlive(d), false); } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1721 a STALE beat is not a worker — a process that stopped leaves its last beat behind", () => {
  const d = dir();
  try {
    beat(d);
    assert.equal(workerAlive(d), true);
    // Three watch ticks. One missed tick is scheduling; three is a process that is gone.
    assert.equal(workerAlive(d, { now: Date.now() + 3 * 90_000 + 1 }), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1721 a RECYCLED pid cannot read as alive — the birth stamp is what makes the pid trustworthy", () => {
  const d = dir();
  try {
    beat(d);
    // Same live pid, a birth stamp from a process that no longer exists. Without the stamp comparison this
    // is indistinguishable from a running worker, and pid_max wraps at 4194304 on this platform.
    const rec = JSON.parse(readFileSync(heartbeatPath(d), "utf8"));
    writeFileSync(heartbeatPath(d), JSON.stringify({ ...rec, starttime: String(Number(rec.starttime) + 1) }));
    assert.equal(workerAlive(d), false, "a pid whose birth stamp does not match was reused by something else");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1721 a corrupt or half-written beat is not a worker — every unreadable state fails the same way", () => {
  const d = dir();
  try {
    for (const body of ["{not json", "", "null", '{"at":123}', '{"pid":"x","at":1}']) {
      writeFileSync(heartbeatPath(d), body);
      assert.equal(workerAlive(d), false, `\`${body}\` read as a live worker`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1721 a dead pid is not a worker", () => {
  const d = dir();
  try {
    writeFileSync(heartbeatPath(d), JSON.stringify({ pid: 0x3ffffe, starttime: "1", at: Date.now() }));
    assert.equal(workerAlive(d), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1721 beat() NEVER throws — a worker that cannot write its heartbeat must keep draining", () => {
  // The queue emptying matters more than the portal's label being precise, and the failure direction is
  // the honest one: the portal says "no worker" while one runs, which reads as a problem rather than as a
  // promise, and clears itself on the next successful beat.
  // A path whose PARENT IS A FILE — mkdir fails ENOTDIR, instantly and on every platform. (A `/proc`
  // path is the obvious choice and the wrong one: mkdirSync there BLOCKS under this box's sandbox, which
  // cost a timed-out suite before this comment existed.)
  const d = dir();
  try {
    const f = join(d, "a-file");
    writeFileSync(f, "x");
    assert.equal(beat(join(f, "nope")), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── — THE PRODUCER, WHICH ITS FIRST GUARD COULD NOT SEE ───────────────────────────────────────
// The e2e lane planted `: false` at the producer and the suite stayed 28/0: every arm checked the
// CONSUMER (`draining === false ? …`), and the consumer is correct under any producer. One character
// turns every queued row on every DEPLOYED instance into a false alarm — they drain through systemd,
// write no heartbeat, and would all have read "Waiting for a worker".
//
// These hold the producer to a contract instead of a shape. `alive` is injected so the tri-state is
// tested without a filesystem: what is under test is which STATE is returned, not whether a beat is fresh.

test("#1786 NOT a supervising install ⇒ null — never false, or every deployed row cries wolf", () => {
  const never = () => { throw new Error("workerAlive must not be consulted when nobody opted in"); };
  assert.equal(drainingState({}, { alive: never }), null);
  assert.equal(drainingState({ CLEAROTRON_RUN_LOCK_DIR: "/tmp/x" }, { alive: never }), null,
    "a lock dir alone is not an opt-in — every deployment sets one");
  assert.equal(drainingState({ PORTAL_LOCAL_WORKER: "0", CLEAROTRON_RUN_LOCK_DIR: "/tmp/x" }, { alive: never }), null);
  assert.equal(drainingState({ PORTAL_LOCAL_WORKER: "true", CLEAROTRON_RUN_LOCK_DIR: "/tmp/x" }, { alive: never }), null,
    "only the exact string \"1\" opts in — a truthy-looking value must not enable the alarm");
});

test("#1786 supervising but no lock dir ⇒ null — a supervisor that named no dir knows nothing", () => {
  const never = () => { throw new Error("workerAlive must not be consulted without a dir"); };
  assert.equal(drainingState({ PORTAL_LOCAL_WORKER: "1" }, { alive: never }), null);
  assert.equal(drainingState({ PORTAL_LOCAL_WORKER: "1", CLEAROTRON_RUN_LOCK_DIR: "" }, { alive: never }), null);
});

test("#1786 supervising WITH a lock dir ⇒ the liveness answer, and only then may a row be relabelled", () => {
  const env = { PORTAL_LOCAL_WORKER: "1", CLEAROTRON_RUN_LOCK_DIR: "/tmp/x" };
  assert.equal(drainingState(env, { alive: () => true }), true);
  assert.equal(drainingState(env, { alive: () => false }), false,
    "the ONLY path that may produce false — a supervising install whose worker is not beating");
});

test("#1786 the producer consults liveness EXACTLY ONCE, with the dir it was given", () => {
  // A producer that asked twice could answer differently within one response, which is the disagreement
  // the once-per-scan read exists to prevent.
  const seen = [];
  drainingState({ PORTAL_LOCAL_WORKER: "1", CLEAROTRON_RUN_LOCK_DIR: "/tmp/pinned" },
    { alive: (d) => { seen.push(d); return true; } });
  assert.deepEqual(seen, ["/tmp/pinned"]);
});
