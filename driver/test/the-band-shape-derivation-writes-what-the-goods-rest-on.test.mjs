// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE BAND SHAPE'S DERIVATION WRITES WHAT EACH RECORD'S GOODS REST ON, BESIDE THE SHAPE.
//
// After every derivation of the band shape the run records, per band record, what the goods a stage can be shown
// rest on: the official record it holds and where that came from, nothing at all, or a fetch that failed this run.
// It is written into the driver's own folder and served by no band tool. Driven through the derivation the
// pipeline runs, on a run's own files and a register call ledger holding this run's and another run's fetches.
// Every mark, owner and record id is invented.
// SAFETY GUARD (repo convention): the workspace root and the call ledger are pinned BEFORE any driver module
// loads, so driver modules are imported dynamically below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";

pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
const LEDGER = join(mkdtempSync(join(tmpdir(), "goods-evidence-calls-")), "register-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
const { DERIVATION_RUNNERS } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");

const rec = (id, mark, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
const BAND = [rec("g1", "QZORVAK", "Alpha Ltd"), rec("g2", "Qzorvak", "Beta GmbH"), rec("tm_77", "Plimbo", "Gamma SA"), rec("n1", "Drellux", "Delta AG")];

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "goods-evidence-run-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND, crowds: [] }));
  const body = (statements) => ({ statusText: "Registered", goodsServices: statements.map(([c, t]) => ({ classes: [c], language: "en", description: t })) });
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), [
    { ts: "2026-10-18T00:00:00Z", provider: "clarivate", sessionKey: "clearance-qz-test-register-unit-primary-sweep", target: "/mark/eu/g1", body: body([[9, "joysticks"]]) },
    { ts: "2026-10-18T00:00:01Z", provider: "clarivate", sessionKey: "clearance-qz-test-register-unit-primary-sweep", target: "/mark/eu/g2", body: body([]) },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(LEDGER, [
    { ts: "2026-10-18T00:00:02Z", provider: "signa", sessionKey: "clearance-qz-test-register-unit-primary-sweep", tool: "record_fetch", target: "tm_77", ok: false, http_status: 503, cache_hit: false, bytes: 0 },
    { ts: "2026-10-18T00:00:03Z", provider: "signa", sessionKey: "clearance-other-run-register-unit", tool: "record_fetch", target: "n1", ok: false, http_status: 404, cache_hit: false, bytes: 0 },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { runDir, ctx: { paths: P, job: { markName: "Qzorvak", classes: ["9"], jurisdictions: ["EU"] }, profile: {}, run: { slug: "qz", codename: "test", runDir } } };
}

test("the derivation writes one row per band record, saying what its goods rest on", (t) => {
  const { runDir, ctx } = seedRun(t);
  assert.equal(DERIVATION_RUNNERS["band-shape"](ctx), true);
  const p = driverDir(runDir, "goods-evidence.json");
  assert.ok(existsSync(p), "no record of what the goods rest on was written beside the shape");
  assert.ok(existsSync(ctx.paths.bandShape), "guard: the shape itself was derived");
  const doc = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(doc.records.map((r) => [r.uri, r.state, r.basis]), [
    ["/mark/eu/g1", "complete", "full-record"],
    ["/mark/eu/g2", "absent", "full-record-without-goods"],
    ["/mark/eu/tm_77", "unavailable", "record-fetch-failed"],
    ["/mark/eu/n1", "not-held", "no-goods-held"],
  ], "another run's failed fetch says nothing about this run's record");
  assert.equal(doc.records[0].held.session, "clearance-qz-test-register-unit-primary-sweep", "where the body came from rides with it");
  assert.deepEqual([doc.records[2].fetch.sent, doc.records[2].fetch.last_status], [1, 503]);
  assert.equal(doc.fetches_read, true);
  assert.equal(doc.ts, undefined);
});

test("the run log carries the counts by state, and no record", (t) => {
  const { runDir, ctx } = seedRun(t);
  DERIVATION_RUNNERS["band-shape"](ctx);
  const events = readFileSync(join(runDir, "_driver", "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const e = events.find((x) => x.event === "goods-evidence");
  assert.ok(e, "no goods-evidence event");
  assert.deepEqual([e.records, e.by_state.complete, e.by_state.absent, e.by_state.unavailable, e.by_state["not-held"]], [4, 1, 1, 1, 1]);
  assert.equal(e.records_list, undefined);
});

test("a run whose call ledger cannot be read says so on the record, rather than reading every fetch as never made", (t) => {
  const { runDir, ctx } = seedRun(t);
  rmSync(LEDGER, { force: true });
  mkdirSync(LEDGER);                       // a directory where the ledger should be: present and unreadable
  t.after(() => rmSync(LEDGER, { recursive: true, force: true }));
  DERIVATION_RUNNERS["band-shape"](ctx);
  const doc = JSON.parse(readFileSync(driverDir(runDir, "goods-evidence.json"), "utf8"));
  assert.match(String(doc.fetches_read), /could not be read/);
});
